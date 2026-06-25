import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function TerminalComponent({ sessionId, title, isActive, onDisconnect, onReconnect }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  const ipcSessionRef = useRef(null);
  
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'ready' | 'disconnected' | 'error'
  const [statusMessage, setStatusMessage] = useState('Initializing terminal session...');

  useEffect(() => {
    // 1. Initialize Xterm.js Terminal
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Fira Code, Courier New, monospace',
      scrollback: 5000,
      theme: {
        background: '#0f1015',
        foreground: '#a9b1d6',
        cursor: '#f7768e',
        black: '#1a1b26',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        lightBlack: '#414868',
        lightRed: '#f7768e',
        lightGreen: '#73daca',
        lightYellow: '#e0af68',
        lightBlue: '#7aa2f7',
        lightMagenta: '#bb9af7',
        lightCyan: '#7dcfff',
        lightWhite: '#c0caf5'
      }
    });

    // 2. Load FitAddon to handle auto-resize
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Render terminal in container
    term.open(terminalRef.current);
    
    // Fit terminal if parent container is visible and has size
    if (terminalRef.current) {
      const parent = terminalRef.current.parentElement;
      if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
        try {
          fitAddon.fit();
        } catch (fitErr) {
          console.warn('[Terminal] Initial fit failed:', fitErr.message);
        }
      }
    }

    let ws = null;

    // Custom key handler to force capture of Space key and standard copy/paste shortcuts
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === ' ' || event.keyCode === 32) {
        if (event.type === 'keydown') {
          if (ipcSessionRef.current) {
            ipcSessionRef.current.send(JSON.stringify({ type: 'data', data: ' ' }));
          } else if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'data', data: ' ' }));
          }
        }
        event.preventDefault();
        return false;
      }

      // Check for Ctrl+C or Cmd+C (Copy)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        if (term.hasSelection()) {
          if (event.type === 'keydown') {
            const selectedText = term.getSelection();
            navigator.clipboard.writeText(selectedText).catch(err => {
              console.error('Failed to copy selection:', err);
            });
          }
          event.preventDefault();
          return false;
        }
        // Let Ctrl+C pass through to xterm.js when no selection is present (sends SIGINT)
        return true;
      }

      // Check for Ctrl+Shift+C or Cmd+Shift+C (Copy)
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        if (term.hasSelection()) {
          if (event.type === 'keydown') {
            const selectedText = term.getSelection();
            navigator.clipboard.writeText(selectedText).catch(err => {
              console.error('Failed to copy selection:', err);
            });
          }
          event.preventDefault();
          return false;
        }
      }

      // Check for Ctrl+V or Cmd+V or Ctrl+Shift+V (Paste)
      if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        if (event.type === 'keydown') {
          navigator.clipboard.readText()
            .then((text) => {
              if (ipcSessionRef.current) {
                ipcSessionRef.current.send(JSON.stringify({ type: 'data', data: text }));
              } else if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: text }));
              }
            })
            .catch(err => console.error('Failed to read clipboard: ', err));
        }
        event.preventDefault();
        return false;
      }

      return true;
    });

    // 3. Register Focus & Blur Handlers to inform Electron Main Process
    const handleTextAreaFocus = () => {
      if (window.electronAPI) {
        window.electronAPI.setTerminalFocus(true);
      }
    };

    const handleTextAreaBlur = () => {
      if (window.electronAPI) {
        window.electronAPI.setTerminalFocus(false);
      }
    };

    if (term.textarea) {
      term.textarea.addEventListener('focus', handleTextAreaFocus);
      term.textarea.addEventListener('blur', handleTextAreaBlur);
    }

    // 4. Establish Session connection
    if (window.electronAPI) {
      // IPC Connection Mode (Electron Desktop)
      ipcSessionRef.current = window.electronAPI.connectSession(sessionId, {
        onStatus: (msg) => {
          if (msg === 'ready') {
            setStatus('ready');
            term.focus();
            if (window.electronAPI) {
              window.electronAPI.setTerminalFocus(true);
            }
            if (ipcSessionRef.current && term.cols > 0 && term.rows > 0) {
              ipcSessionRef.current.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
              }));
            }
          } else {
            setStatusMessage(msg);
          }
        },
        onData: (data) => {
          term.write(data);
        },
        onError: (err) => {
          setStatus('error');
          setStatusMessage(err);
          term.write(`\r\n\x1b[31;1mError: ${err}\x1b[0m\r\n`);
        },
        onClose: () => {
          setStatus(prev => (prev === 'error' ? 'error' : 'disconnected'));
          term.write('\r\n\r\n\x1b[31;1m=== SSH Connection Closed ===\x1b[0m\r\n');
        }
      });
    } else {
      // WebSocket Connection Mode (Web / Dev server fallback)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const socketUrl = `${protocol}//${host}/ws?sessionId=${sessionId}`;
      
      ws = new WebSocket(socketUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setStatusMessage('Connected to server proxy. Requesting SSH tunnel...');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'status') {
            if (message.message === 'ready') {
              setStatus('ready');
              term.focus();
              ws.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
              }));
            } else {
              setStatusMessage(message.message);
            }
          } else if (message.type === 'data') {
            term.write(message.data);
          } else if (message.type === 'error') {
            setStatus('error');
            setStatusMessage(message.message);
            term.write(`\r\n\x1b[31;1mError: ${message.message}\x1b[0m\r\n`);
          }
        } catch (e) {
          term.write(event.data);
        }
      };

      ws.onerror = () => {
        setStatus('error');
        setStatusMessage('WebSocket connection error. Make sure the proxy backend is running.');
      };

      ws.onclose = (event) => {
        setStatus(prev => (prev === 'error' ? 'error' : 'disconnected'));
        term.write('\r\n\r\n\x1b[31;1m=== SSH Connection Closed ===\x1b[0m\r\n');
      };
    }

    // 5. Connect Keyboard Input to Tunnel
    const disposableData = term.onData((data) => {
      if (ipcSessionRef.current) {
        ipcSessionRef.current.send(JSON.stringify({ type: 'data', data }));
      } else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    // 6. Monitor terminal window resize
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current && terminalRef.current) {
        const parent = terminalRef.current.parentElement;
        if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
          try {
            fitAddonRef.current.fit();
            const cols = xtermRef.current.cols;
            const rows = xtermRef.current.rows;
            if (cols > 0 && rows > 0) {
              if (ipcSessionRef.current) {
                ipcSessionRef.current.send(JSON.stringify({
                  type: 'resize',
                  cols,
                  rows
                }));
              } else if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols,
                  rows
                }));
              }
            }
          } catch (fitErr) {
            console.warn('[Terminal] fit during resize failed:', fitErr.message);
          }
        }
      }
    };

    // Setup ResizeObserver on container rather than just window resize
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(handleResize, 50);
    });
    
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current.parentNode);
    }
    
    window.addEventListener('resize', handleResize);

    // 7. Cleanup on Unmount
    return () => {
      disposableData.dispose();
      if (term.textarea) {
        term.textarea.removeEventListener('focus', handleTextAreaFocus);
        term.textarea.removeEventListener('blur', handleTextAreaBlur);
      }
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      
      if (ipcSessionRef.current) {
        ipcSessionRef.current.close();
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      if (window.electronAPI) {
        window.electronAPI.setTerminalFocus(false);
      }
      
      term.dispose();
    };
  }, [sessionId]);

  // Auto-focus terminal when tab becomes active
  useEffect(() => {
    if (xtermRef.current) {
      if (isActive) {
        const timer = setTimeout(() => {
          if (xtermRef.current) {
            xtermRef.current.focus();
            if (window.electronAPI) {
              window.electronAPI.setTerminalFocus(true);
            }
          }
        }, 100);
        return () => clearTimeout(timer);
      } else {
        xtermRef.current.blur();
        if (window.electronAPI) {
          window.electronAPI.setTerminalFocus(false);
        }
      }
    }
  }, [isActive]);

  // Ensure terminal receives focus when state changes to 'ready'
  useEffect(() => {
    if (status === 'ready' && xtermRef.current) {
      const timer = setTimeout(() => {
        xtermRef.current.focus();
        if (window.electronAPI) {
          window.electronAPI.setTerminalFocus(true);
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleReconnect = () => {
    if (onReconnect) {
      onReconnect();
    }
  };

  const handleTerminalClick = () => {
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  return (
    <div className="terminal-tab-wrapper" onClick={handleTerminalClick} style={{ position: 'relative' }}>
      
      {/* 1. Terminal Container (Always visible in layout, covered by absolute status overlay if connecting) */}
      <div className="terminal-container" style={{ display: 'block', height: '100%' }}>
        <div 
          ref={terminalRef}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* 2. Loading Overlay (Connecting only) */}
      {status === 'connecting' && (
        <div className="terminal-status-overlay">
          <div className="status-spinner"></div>
          <div className="status-message">{statusMessage}</div>
        </div>
      )}

      {/* 3. Disconnected / Error Popup Dialog (Semi-transparent overlay + popup window) */}
      {(status === 'disconnected' || status === 'error') && (
        <div className="terminal-dialog-overlay" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(10, 11, 14, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div className="terminal-dialog-box" style={{
            width: '400px',
            background: 'hsla(230, 25%, 12%, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 600,
              color: status === 'error' ? 'var(--danger)' : 'var(--text-primary)'
            }}>
              {status === 'error' ? 'Connection Error' : 'Connection Terminated'}
            </h3>
            
            <p style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5
            }}>
              {status === 'error' 
                ? (statusMessage || 'A network error or timeout has occurred.')
                : 'The SSH connection was closed or timed out.'
              }
            </p>

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '12px',
              marginTop: '8px'
            }}>
              <button 
                className="btn-primary" 
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: status === 'error' ? 'var(--danger)' : 'var(--primary)',
                  boxShadow: status === 'error' ? '0 4px 12px var(--danger-glow)' : '0 4px 12px var(--primary-glow)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer'
                }}
                onClick={handleReconnect}
              >
                Reconnect
              </button>
              <button 
                className="btn-secondary" 
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
                onClick={onDisconnect}
              >
                Close Tab
              </button>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}
