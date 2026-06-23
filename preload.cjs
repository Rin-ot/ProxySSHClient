const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createSession: (config) => ipcRenderer.invoke('create-session', config),
  setTerminalFocus: (focused) => ipcRenderer.send('terminal-focus', focused),
  loadProfiles: () => ipcRenderer.invoke('load-profiles'),
  saveProfiles: (profiles) => ipcRenderer.invoke('save-profiles', profiles),
  connectSession: (sessionId, callbacks) => {
    const channel = `session-message-${sessionId}`;
    
    const messageListener = (event, message) => {
      if (message.type === 'status') {
        callbacks.onStatus(message.message);
      } else if (message.type === 'data') {
        callbacks.onData(message.data);
      } else if (message.type === 'error') {
        callbacks.onError(message.message);
      } else if (message.type === 'close') {
        callbacks.onClose();
      }
    };
    
    ipcRenderer.on(channel, messageListener);
    
    // Defer triggering the session connection to ensure connectSession returns first in the renderer
    setTimeout(() => {
      ipcRenderer.send('session-connect', sessionId);
    }, 0);
    
    return {
      send: (msg) => ipcRenderer.send('session-send', sessionId, msg),
      close: () => {
        ipcRenderer.removeListener(channel, messageListener);
        ipcRenderer.send('session-close', sessionId);
      }
    };
  }
});
