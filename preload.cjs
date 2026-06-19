const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createSession: (config) => ipcRenderer.invoke('create-session', config),
  setTerminalFocus: (focused) => ipcRenderer.send('terminal-focus', focused),
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
    ipcRenderer.send('session-connect', sessionId);
    
    return {
      send: (msg) => ipcRenderer.send('session-send', sessionId, msg),
      close: () => {
        ipcRenderer.removeListener(channel, messageListener);
        ipcRenderer.send('session-close', sessionId);
      }
    };
  }
});
