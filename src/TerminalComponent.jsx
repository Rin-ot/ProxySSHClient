import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function TerminalComponent({ sessionId, title, onDisconnect }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'ready' | 'disconnected' | 'error'
  const [statusMessage, setStatusMessage] = useState('Initializing terminal session...');

  useEffect(() => {
    // 1. Initialize Xterm.js Terminal
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Fira Code, Courier New, monospace',
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
    fitAddon.fit();

    // Custom key handler to force capture of Space key
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === ' ' || event.keyCode === 32) {
        if (event.type === 'keydown') {
          const ws = socketRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'data', data: ' ' }));
          }
        }
        event.preventDefault();
        return false;
      }
      return true;
    });

    // 3. Establish WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; // Handles Vite dev proxy (5173 -> 5000) or production server (5000)
    const socketUrl = `${protocol}//${host}/ws?sessionId=${sessionId}`;
    
    const ws = new WebSocket(socketUrl);
    socketRef.current = ws;

    // 4. WebSocket Event Handlers
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
            
            // Send initial resize to fit remote terminal rows/cols to container size
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
        // Fallback for raw websocket text data
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

    // 5. Connect Keyboard Input to Socket
    const disposableData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    // 6. Monitor terminal window resize
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows
          }));
        }
      }
    };

    // Setup ResizeObserver on container rather than just window resize
    const resizeObserver = new ResizeObserver(() => {
      // Throttle resize updates slightly to avoid layout flicker
      setTimeout(handleResize, 50);
    });
    
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current.parentNode);
    }
    
    window.addEventListener('resize', handleResize);

    // 7. Cleanup on Unmount
    return () => {
      disposableData.dispose();
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      
      term.dispose();
    };
  }, [sessionId]);

  // Ensure terminal receives focus when state changes to 'ready' (after DOM has completed rendering)
  useEffect(() => {
    if (status === 'ready' && xtermRef.current) {
      const timer = setTimeout(() => {
        xtermRef.current.focus();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleReconnect = () => {
    window.location.reload();
  };

  const handleTerminalClick = () => {
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  return (
    <div className="terminal-tab-wrapper" onClick={handleTerminalClick}>
      {status !== 'ready' && (
        <div className="terminal-status-overlay">
          {status === 'connecting' && (
            <>
              <div className="status-spinner"></div>
              <div className="status-message">{statusMessage}</div>
            </>
          )}
          {status === 'error' && (
            <div className="status-error">
              <h3>Connection Failed</h3>
              <p>{statusMessage}</p>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button className="btn-reconnect" onClick={handleReconnect}>Reload Page</button>
                <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={onDisconnect}>Close Tab</button>
              </div>
            </div>
          )}
          {status === 'disconnected' && (
            <div className="status-error" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
              <h3>Connection Terminated</h3>
              <p>The SSH terminal session has ended.</p>
              <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px', marginTop: '10px' }} onClick={onDisconnect}>Close Tab</button>
            </div>
          )}
        </div>
      )}
      
      <div 
        className="terminal-container" 
        ref={terminalRef}
        style={{ display: status === 'ready' ? 'block' : 'none' }}
      />
    </div>
  );
}
