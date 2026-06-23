const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client: SSHClient } = require('ssh2');
const { SocksClient } = require('socks');
const net = require('net');
const dns = require('dns/promises');
const { v4: uuidv4 } = require('uuid');

let mainWindow;
const sessions = new Map();
const activeSshConnections = new Map(); // sessionId -> { conn, stream }
let isTerminalFocused = false;

const PROFILES_PATH = path.join(app.getPath('userData'), 'profiles.json');

// Safe IPC sender helper to prevent main process crashes if the renderer window is closed or reloaded mid-connection
function safeSend(sender, channel, message) {
  if (sender && !sender.isDestroyed()) {
    try {
      sender.send(channel, message);
    } catch (e) {
      console.warn('[IPC Warning] Failed to send message:', e.message);
    }
  }
}

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

ipcMain.handle('load-profiles', async () => {
  try {
    if (fs.existsSync(PROFILES_PATH)) {
      const data = fs.readFileSync(PROFILES_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Profiles] Failed to load profiles from file:', err);
  }
  return [];
});

ipcMain.handle('save-profiles', async (event, profiles) => {
  try {
    fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Profiles] Failed to save profiles to file:', err);
    throw err;
  }
});

ipcMain.on('terminal-focus', (event, focused) => {
  isTerminalFocused = focused;
});

ipcMain.on('session-connect', async (event, sessionId) => {
  const sender = event.sender;

  if (!sessionId || !sessions.has(sessionId)) {
    safeSend(sender, `session-message-${sessionId}`, { type: 'error', message: 'Connection rejected: Invalid or expired session ID.' });
    safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
    return;
  }

  const session = sessions.get(sessionId);
  if (session.connected) {
    safeSend(sender, `session-message-${sessionId}`, { type: 'error', message: 'Connection rejected: Session is already in use.' });
    safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
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
    safeSend(sender, `session-message-${sessionId}`, { type: 'status', message: `Connecting to ${proxy.type.toUpperCase()} proxy at ${proxy.host}:${proxy.port}...` });
    try {
      const sshWithResolvedHost = { ...ssh, host: resolvedSshHost };
      if (proxy.type === 'http') {
        tunnelSocket = await connectHttpProxy(proxy, sshWithResolvedHost);
      } else if (proxy.type === 'socks4' || proxy.type === 'socks5') {
        tunnelSocket = await connectSocksProxy(proxy, sshWithResolvedHost);
      } else {
        throw new Error(`Unsupported proxy protocol: ${proxy.type}`);
      }
      safeSend(sender, `session-message-${sessionId}`, { type: 'status', message: 'Proxy tunnel established. Authenticating with SSH host...' });
    } catch (err) {
      safeSend(sender, `session-message-${sessionId}`, { type: 'error', message: `Proxy Tunnel Failed: ${err.message}` });
      safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
      return;
    }
  } else {
    safeSend(sender, `session-message-${sessionId}`, { type: 'status', message: `Connecting directly to SSH host ${resolvedSshHost}:${ssh.port || 22}...` });
  }

  const conn = new SSHClient();

  conn.on('ready', () => {
    safeSend(sender, `session-message-${sessionId}`, { type: 'status', message: 'SSH authenticated. Creating interactive shell...' });

    conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) {
        safeSend(sender, `session-message-${sessionId}`, { type: 'error', message: `Failed to open SSH shell: ${err.message}` });
        conn.end();
        return;
      }

      activeSshConnections.set(sessionId, { conn, stream });

      safeSend(sender, `session-message-${sessionId}`, { type: 'status', message: 'ready' });

      stream.on('data', (data) => {
        safeSend(sender, `session-message-${sessionId}`, { type: 'data', data: data.toString('utf-8') });
      });

      stream.on('close', () => {
        safeSend(sender, `session-message-${sessionId}`, { type: 'status', message: 'SSH session closed by remote host.' });
        safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
        activeSshConnections.delete(sessionId);
      });
    });
  });

  conn.on('error', (err) => {
    safeSend(sender, `session-message-${sessionId}`, { type: 'error', message: `SSH Connection Error: ${err.message}` });
    safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
    activeSshConnections.delete(sessionId);
  });

  conn.on('close', () => {
    safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
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
    safeSend(sender, `session-message-${sessionId}`, { type: 'error', message: `SSH Connect Call Failed: ${err.message}` });
    safeSend(sender, `session-message-${sessionId}`, { type: 'close' });
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
        try {
          connection.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
        } catch (resizeErr) {
          console.warn('[SSH] setWindow failed:', resizeErr.message);
        }
      }
    } catch (e) {
      try {
        connection.stream.write(msg);
      } catch (writeErr) {
        console.warn('[SSH] Stream write failed:', writeErr.message);
      }
    }
  }
});

ipcMain.on('session-close', (event, sessionId) => {
  const connection = activeSshConnections.get(sessionId);
  if (connection) {
    if (connection.stream) {
      try { connection.stream.end(); } catch (e) {}
    }
    if (connection.conn) {
      try { connection.conn.end(); } catch (e) {}
    }
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

// Transparent migration of old profiles from http://localhost:5000 localStorage (runs only once if profiles.json is missing)
async function migrateOldProfiles() {
  if (fs.existsSync(PROFILES_PATH)) {
    return; // Already migrated or profiles exist
  }

  console.log('[Migration] Checking for old profiles from http://localhost:5000...');
  try {
    const tempWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await tempWindow.loadURL('http://localhost:5000');
    const data = await tempWindow.webContents.executeJavaScript("localStorage.getItem('proxy_ssh_profiles')");
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        fs.writeFileSync(PROFILES_PATH, JSON.stringify(parsed, null, 2), 'utf8');
        console.log(`[Migration] Successfully migrated ${parsed.length} profiles to profiles.json!`);
      }
    }
    tempWindow.destroy();
  } catch (err) {
    console.warn('[Migration Warning] Failed to migrate profiles:', err.message);
  }
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
    .then(async () => {
      mainWindow.show();
      // Run profiles migration asynchronously on startup
      await migrateOldProfiles();
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
