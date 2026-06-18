const { app, BrowserWindow } = require('electron');
const { fork } = require('child_process');
const path = require('path');

let mainWindow;
let serverProcess;
let hasLoaded = false;

function loadAppUrl() {
  if (hasLoaded || !mainWindow) return;
  hasLoaded = true;
  mainWindow.loadURL('http://localhost:5000')
    .then(() => {
      mainWindow.show();
    })
    .catch((err) => {
      console.warn('[Electron Main] Direct URL load failed, falling back to polling:', err.message);
      hasLoaded = false;
      function pollApp() {
        if (hasLoaded || !mainWindow) return;
        mainWindow.loadURL('http://localhost:5000')
          .then(() => {
            hasLoaded = true;
            mainWindow.show();
          })
          .catch(() => {
            setTimeout(pollApp, 100);
          });
      }
      pollApp();
    });
}

function startBackendServer() {
  const serverPath = path.join(__dirname, 'server.js');
  
  // Fork the Express backend as a separate Node process.
  serverProcess = fork(serverPath, [], {
    env: { 
      ...process.env, 
      PORT: '5000' 
    },
    silent: false
  });

  serverProcess.on('message', (msg) => {
    if (msg && msg.type === 'ready') {
      console.log('[Electron Main] Backend server reported ready via IPC. Loading URL.');
      loadAppUrl();
    }
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron Main] Backend server process error:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[Electron Main] Backend server exited with code ${code} and signal ${signal}`);
  });
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
      contextIsolation: true
    }
  });

  mainWindow.setAutoHideMenuBar(true);

  // Safety fallback: if IPC ready message isn't received within 1500ms, force loading anyway
  setTimeout(() => {
    if (!hasLoaded) {
      console.log('[Electron Main] IPC ready timeout reached. Forcing load URL.');
      loadAppUrl();
    }
  }, 1500);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Bootstrap App
app.whenReady().then(() => {
  startBackendServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Teardown processes on exit
app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});
