const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { Client: SSHClient } = require('ssh2');
const { SocksClient } = require('socks');
const net = require('net');
const dns = require('dns/promises');
const { v4: uuidv4 } = require('uuid');

let mainWindow;
const sessions = new Map();
const activeSshConnections = new Map(); // sessionId -> { conn, stream }
let isTerminalFocused = false;

// HTTP proxy connection function (via HTTP CONNECT)
function connectHttpProxy(proxyOpts, sshOpts) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({
      host: proxyOpts.host,
      port: parseInt(proxyOpts.port, 10)
    });

    socket.setTimeout(15000); // 15 seconds timeout
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection to HTTP Proxy timed out.'));
    });

    socket.on('connect', () => {
      let connectReq = `CONNECT ${sshOpts.host}:${sshOpts.port} HTTP/1.1\r\n` +
                       `Host: ${sshOpts.host}:${sshOpts.port}\r\n`;

      if (proxyOpts.username && proxyOpts.password) {
        const auth = Buffer.from(`${proxyOpts.username}:${proxyOpts.password}`).toString('base64');
        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
      }

      connectReq += '\r\n';
      socket.write(connectReq);
    });

    let buffer = '';
    function onData(chunk) {
      buffer += chunk.toString('utf-8');
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        socket.removeListener('data', onData);
        socket.setTimeout(0);
        
        const lines = buffer.split('\r\n');
        const statusLine = lines[0];
        const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/);

        if (match && match[1].startsWith('2')) {
          const extra = buffer.substring(headerEnd + 4);
          if (extra.length > 0) {
            socket.unshift(Buffer.from(extra, 'utf-8'));
          }
          resolve(socket);
        } else {
          socket.destroy();
          reject(new Error(`HTTP Proxy rejected tunnel: ${statusLine}`));
        }
      }
    }

    socket.on('data', onData);
    socket.on('error', (err) => {
      reject(err);
    });
  });
}

// SOCKS proxy connection function
async function connectSocksProxy(proxyOpts, sshOpts) {
  const options = {
    proxy: {
      host: proxyOpts.host,
      port: parseInt(proxyOpts.port, 10),
      type: proxyOpts.type === 'socks5' ? 5 : 4
    },
    command: 'connect',
    destination: {
      host: sshOpts.host,
      port: parseInt(sshOpts.port, 10)
    },
    timeout: 15000
  };

  if (proxyOpts.username && proxyOpts.password) {
    options.proxy.userId = proxyOpts.username;
    options.proxy.password = proxyOpts.password;
  }

  const info = await SocksClient.createConnection(options);
  return info.socket;
}

// Register IPC message handlers
ipcMain.handle('create-session', async (event, config) => {
  const { ssh, proxy } = config;
  if (!ssh || !ssh.host || !ssh.username) {
    throw new Error('SSH host and username are required.');
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, {
    ssh,
    proxy,
    connected: false,
    timestamp: Date.now()
  });

  // Expire sessions that fail to establish connection within 30 seconds
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      const sess = sessions.get(sessionId);
      if (!sess.connected) {
        sessions.delete(sessionId);
      }
    }
  }, 30000);

  return { sessionId };
});

ipcMain.on('terminal-focus', (event, focused) => {
  isTerminalFocused = focused;
});

ipcMain.on('session-connect', async (event, sessionId) => {
  const sender = event.sender;

  if (!sessionId || !sessions.has(sessionId)) {
    sender.send(`session-message-${sessionId}`, { type: 'error', message: 'Connection rejected: Invalid or expired session ID.' });
    sender.send(`session-message-${sessionId}`, { type: 'close' });
    return;
  }

  const session = sessions.get(sessionId);
  if (session.connected) {
    sender.send(`session-message-${sessionId}`, { type: 'error', message: 'Connection rejected: Session is already in use.' });
    sender.send(`session-message-${sessionId}`, { type: 'close' });
    return;
  }

  session.connected = true;
  sessions.delete(sessionId);

  const { ssh, proxy } = session;

  // Resolve target host locally
  let resolvedSshHost = ssh.host;
  try {
    const lookupResult = await dns.lookup(ssh.host);
    resolvedSshHost = lookupResult.address;
    console.log(`[DNS] Resolved target '${ssh.host}' locally to IP '${resolvedSshHost}'`);
  } catch (dnsErr) {
    console.warn(`[DNS Warning] Local lookup failed for target '${ssh.host}': ${dnsErr.message}. Bypassing.`);
  }

  let tunnelSocket = null;

  // Establish proxy connection if required
  if (proxy && proxy.type && proxy.type !== 'none' && proxy.host && proxy.port) {
    sender.send(`session-message-${sessionId}`, { type: 'status', message: `Connecting to ${proxy.type.toUpperCase()} proxy at ${proxy.host}:${proxy.port}...` });
    try {
      const sshWithResolvedHost = { ...ssh, host: resolvedSshHost };
      if (proxy.type === 'http') {
        tunnelSocket = await connectHttpProxy(proxy, sshWithResolvedHost);
      } else if (proxy.type === 'socks4' || proxy.type === 'socks5') {
        tunnelSocket = await connectSocksProxy(proxy, sshWithResolvedHost);
      } else {
        throw new Error(`Unsupported proxy protocol: ${proxy.type}`);
      }
      sender.send(`session-message-${sessionId}`, { type: 'status', message: 'Proxy tunnel established. Authenticating with SSH host...' });
    } catch (err) {
      sender.send(`session-message-${sessionId}`, { type: 'error', message: `Proxy Tunnel Failed: ${err.message}` });
      sender.send(`session-message-${sessionId}`, { type: 'close' });
      return;
    }
  } else {
    sender.send(`session-message-${sessionId}`, { type: 'status', message: `Connecting directly to SSH host ${resolvedSshHost}:${ssh.port || 22}...` });
  }

  const conn = new SSHClient();

  conn.on('ready', () => {
    sender.send(`session-message-${sessionId}`, { type: 'status', message: 'SSH authenticated. Creating interactive shell...' });

    conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) {
        sender.send(`session-message-${sessionId}`, { type: 'error', message: `Failed to open SSH shell: ${err.message}` });
        conn.end();
        return;
      }

      activeSshConnections.set(sessionId, { conn, stream });

      sender.send(`session-message-${sessionId}`, { type: 'status', message: 'ready' });

      stream.on('data', (data) => {
        sender.send(`session-message-${sessionId}`, { type: 'data', data: data.toString('utf-8') });
      });

      stream.on('close', () => {
        sender.send(`session-message-${sessionId}`, { type: 'status', message: 'SSH session closed by remote host.' });
        sender.send(`session-message-${sessionId}`, { type: 'close' });
        activeSshConnections.delete(sessionId);
      });
    });
  });

  conn.on('error', (err) => {
    sender.send(`session-message-${sessionId}`, { type: 'error', message: `SSH Connection Error: ${err.message}` });
    sender.send(`session-message-${sessionId}`, { type: 'close' });
    activeSshConnections.delete(sessionId);
  });

  conn.on('close', () => {
    sender.send(`session-message-${sessionId}`, { type: 'close' });
    activeSshConnections.delete(sessionId);
  });

  const sshConfig = {
    username: ssh.username,
    readyTimeout: 20000
  };

  if (tunnelSocket) {
    sshConfig.sock = tunnelSocket;
  } else {
    sshConfig.host = resolvedSshHost;
    sshConfig.port = parseInt(ssh.port, 10) || 22;
  }

  if (ssh.authType === 'key') {
    sshConfig.privateKey = ssh.privateKey;
    if (ssh.passphrase) {
      sshConfig.passphrase = ssh.passphrase;
    }
  } else {
    sshConfig.password = ssh.password;
  }

  try {
    conn.connect(sshConfig);
  } catch (err) {
    sender.send(`session-message-${sessionId}`, { type: 'error', message: `SSH Connect Call Failed: ${err.message}` });
    sender.send(`session-message-${sessionId}`, { type: 'close' });
  }
});

ipcMain.on('session-send', (event, sessionId, msg) => {
  const connection = activeSshConnections.get(sessionId);
  if (connection && connection.stream) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'data') {
        connection.stream.write(parsed.data);
      } else if (parsed.type === 'resize') {
        connection.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
      }
    } catch (e) {
      connection.stream.write(msg);
    }
  }
});

ipcMain.on('session-close', (event, sessionId) => {
  const connection = activeSshConnections.get(sessionId);
  if (connection) {
    if (connection.stream) connection.stream.end();
    if (connection.conn) connection.conn.end();
    activeSshConnections.delete(sessionId);
  }
});

function closeAllSshConnections() {
  for (const [sessionId, connection] of activeSshConnections.entries()) {
    try {
      if (connection.stream) connection.stream.end();
      if (connection.conn) connection.conn.end();
    } catch (e) {
      // ignore
    }
  }
  activeSshConnections.clear();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0f1015',
    icon: path.join(__dirname, 'icon.ico'),
    show: false, // Don't show until page is loaded
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.setAutoHideMenuBar(true);

  // Intercept standard keyboard shortcuts for editing (cut, copy, paste, select all, undo, redo)
  // when standard text boxes are focused, but pass them directly to xterm.js if the terminal is focused
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isTerminalFocused) {
      // Let all keyboard events pass through directly to xterm.js
      return;
    }

    if (input.type === 'keyDown' && (input.control || input.meta) && !input.alt) {
      const key = input.key.toLowerCase();
      const isShift = input.shift;

      if (key === 'c') {
        mainWindow.webContents.copy();
        if (isShift) {
          event.preventDefault();
        }
      } else if (key === 'v') {
        mainWindow.webContents.paste();
        event.preventDefault();
      } else if (key === 'x') {
        mainWindow.webContents.cut();
        event.preventDefault();
      } else if (key === 'a') {
        mainWindow.webContents.selectAll();
        event.preventDefault();
      } else if (key === 'z') {
        if (isShift) {
          mainWindow.webContents.redo();
        } else {
          mainWindow.webContents.undo();
        }
        event.preventDefault();
      } else if (key === 'y') {
        mainWindow.webContents.redo();
        event.preventDefault();
      }
    }
  });

  // Handle right-click context menu for copy/paste actions
  mainWindow.webContents.on('context-menu', (e, params) => {
    const contextMenuTemplate = [];
    
    if (params.editFlags.canUndo) contextMenuTemplate.push({ role: 'undo' });
    if (params.editFlags.canRedo) contextMenuTemplate.push({ role: 'redo' });
    if (params.editFlags.canUndo || params.editFlags.canRedo) contextMenuTemplate.push({ type: 'separator' });
    
    if (params.editFlags.canCut) contextMenuTemplate.push({ role: 'cut' });
    if (params.selectionText || params.editFlags.canCopy) {
      contextMenuTemplate.push({ role: 'copy' });
    }
    if (params.editFlags.canPaste) {
      contextMenuTemplate.push({ role: 'paste' });
    } else if (!params.isEditable) {
      contextMenuTemplate.push({ role: 'paste' });
    }
    if (params.editFlags.canSelectAll) contextMenuTemplate.push({ role: 'selectAll' });

    if (contextMenuTemplate.length > 0) {
      const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
      contextMenu.popup({ window: mainWindow });
    }
  });

  // Load local static entry point directly
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
    .then(() => {
      mainWindow.show();
    })
    .catch((err) => {
      console.error('[Electron Main] Failed to load index.html:', err);
    });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Bootstrap App
app.whenReady().then(() => {
  // Set application menu to register default keyboard accelerators even when hidden
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Teardown processes on exit
app.on('window-all-closed', () => {
  closeAllSshConnections();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  closeAllSshConnections();
});
