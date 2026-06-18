const { app, BrowserWindow } = require('electron');
const { fork } = require('child_process');
const path = require('path');

let mainWindow;
let serverProcess;

function startBackendServer() {
  const serverPath = path.join(__dirname, 'server.js');
  
  // Fork the Express backend as a separate Node process.
  // Because the root package.json defines "type": "module",
  // Node will run server.js as an ES Module.
  serverProcess = fork(serverPath, [], {
    env: { 
      ...process.env, 
      PORT: '5000' 
    },
    silent: false // Keeps server console logs visible in development
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

  // Hides standard desktop menu bar for a premium app appearance (Alt key toggles it)
  mainWindow.setAutoHideMenuBar(true);

  // Poll loop: wait for backend server to boot up before showing window
  function loadApp() {
    mainWindow.loadURL('http://localhost:5000')
      .then(() => {
        mainWindow.show();
      })
      .catch(() => {
        // Wait 150ms and retry if connection fails (port 5000 not listening yet)
        setTimeout(loadApp, 150);
      });
  }

  loadApp();

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
