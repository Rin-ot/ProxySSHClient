const { app, BrowserWindow, Menu } = require('electron');
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

  // Handle right-click context menu for copy/paste actions (works in text inputs and the terminal)
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
      // Fallback paste capability for terminal panel right-clicks
      contextMenuTemplate.push({ role: 'paste' });
    }
    if (params.editFlags.canSelectAll) contextMenuTemplate.push({ role: 'selectAll' });

    if (contextMenuTemplate.length > 0) {
      const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
      contextMenu.popup({ window: mainWindow });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Bootstrap App
app.whenReady().then(() => {
  // Set application menu to register default keyboard accelerators (Ctrl+C, Ctrl+V, etc.) even when hidden
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
