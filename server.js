import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Client as SSHClient } from 'ssh2';
import { SocksClient } from 'socks';
import net from 'net';
import dns from 'dns/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Temporary storage for SSH configurations prior to WS upgrade
const sessions = new Map();

// REST endpoint to initialize session and store connection parameters
app.post('/api/sessions', (req, res) => {
  const { ssh, proxy } = req.body;
  if (!ssh || !ssh.host || !ssh.username) {
    return res.status(400).json({ error: 'SSH host and username are required.' });
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, {
    ssh,
    proxy,
    connected: false,
    timestamp: Date.now()
  });

  // Expire sessions that fail to establish a WebSocket within 30 seconds
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      const sess = sessions.get(sessionId);
      if (!sess.connected) {
        sessions.delete(sessionId);
      }
    }
  }, 30000);

  return res.status(201).json({ sessionId });
});

// Serve frontend build static files (for production mode)
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback for client-side routing
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

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
        // Disable timeout once connected
        socket.setTimeout(0);
        
        const lines = buffer.split('\r\n');
        const statusLine = lines[0];
        const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/);

        if (match && match[1].startsWith('2')) {
          // Tunnel established. If we read extra data past headers, put it back
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

// Handle WebSocket connection and coordinate SSH connection
wss.on('connection', async (ws, req) => {
  const urlParams = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sessionId = urlParams.searchParams.get('sessionId');

  if (!sessionId || !sessions.has(sessionId)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Connection rejected: Invalid or expired session ID.' }));
    ws.close(4001, 'Invalid Session');
    return;
  }

  const session = sessions.get(sessionId);
  if (session.connected) {
    ws.send(JSON.stringify({ type: 'error', message: 'Connection rejected: Session is already in use.' }));
    ws.close(4002, 'Session Active');
    return;
  }

  // Consume session
  session.connected = true;
  sessions.delete(sessionId);

  const { ssh, proxy } = session;

  // Resolve target host locally using dns.lookup to respect custom hosts mapping (e.g. C:\Windows\System32\drivers\etc\hosts)
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
    ws.send(JSON.stringify({ type: 'status', message: `Connecting to ${proxy.type.toUpperCase()} proxy at ${proxy.host}:${proxy.port}...` }));
    try {
      // Pass the locally resolved IP to the proxy connect call so it can find hosts file records
      const sshWithResolvedHost = { ...ssh, host: resolvedSshHost };
      
      if (proxy.type === 'http') {
        tunnelSocket = await connectHttpProxy(proxy, sshWithResolvedHost);
      } else if (proxy.type === 'socks4' || proxy.type === 'socks5') {
        tunnelSocket = await connectSocksProxy(proxy, sshWithResolvedHost);
      } else {
        throw new Error(`Unsupported proxy protocol: ${proxy.type}`);
      }
      ws.send(JSON.stringify({ type: 'status', message: 'Proxy tunnel established. Authenticating with SSH host...' }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: `Proxy Tunnel Failed: ${err.message}` }));
      ws.close(4003, 'Proxy Failed');
      return;
    }
  } else {
    ws.send(JSON.stringify({ type: 'status', message: `Connecting directly to SSH host ${resolvedSshHost}:${ssh.port || 22}...` }));
  }

  // Create SSH Connection
  const conn = new SSHClient();

  conn.on('ready', () => {
    ws.send(JSON.stringify({ type: 'status', message: 'SSH authenticated. Creating interactive shell...' }));

    conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: `Failed to open SSH shell: ${err.message}` }));
        conn.end();
        return;
      }

      // Signal to frontend that terminal is ready
      ws.send(JSON.stringify({ type: 'status', message: 'ready' }));

      // Forward SSH stream output to client
      stream.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') }));
      });

      stream.on('close', () => {
        ws.send(JSON.stringify({ type: 'status', message: 'SSH session closed by remote host.' }));
        ws.close();
      });

      // Listen for frontend commands
      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'data') {
            stream.write(parsed.data);
          } else if (parsed.type === 'resize') {
            stream.setWindow(parsed.rows, parsed.cols, 0, 0);
          }
        } catch (e) {
          // Fallback if raw text was sent
          stream.write(message);
        }
      });

      ws.on('close', () => {
        stream.end();
        conn.end();
      });
    });
  });

  conn.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', message: `SSH Connection Error: ${err.message}` }));
    ws.close(4004, 'SSH Error');
  });

  conn.on('close', () => {
    ws.close();
  });

  // Build SSH configuration
  const sshConfig = {
    username: ssh.username,
    readyTimeout: 20000 // 20s authentication timeout
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
    ws.send(JSON.stringify({ type: 'error', message: `SSH Connect Call Failed: ${err.message}` }));
    ws.close(4005, 'SSH Config Error');
  }
});

// Upgrade HTTP requests to WebSocket connection if path is /ws
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[ProxySSH Server] Running on http://localhost:${PORT}`);
});
