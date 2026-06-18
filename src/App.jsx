import React, { useState, useEffect } from 'react';
import TerminalComponent from './TerminalComponent';

// SVG Icons as components to ensure zero package dependencies
const ServerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
    <line x1="6" y1="6" x2="6.01" y2="6"></line>
    <line x1="6" y1="18" x2="6.01" y2="18"></line>
  </svg>
);

const ProxyIcon = ({ active }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--info)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"></polyline>
    <line x1="12" y1="19" x2="20" y2="19"></line>
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"></polyline>
  </svg>
);

const SidebarToggleIcon = ({ isOpen }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.3s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="9" y1="3" x2="9" y2="21"></line>
    <path d="M14 9l-3 3 3 3"></path>
  </svg>
);

const ConnectIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
);

const AppTemplate = {
  id: '',
  name: '',
  ssh: {
    host: '',
    port: '22',
    username: '',
    authType: 'password', // 'password' | 'key'
    password: '',
    privateKey: '',
    passphrase: ''
  },
  proxy: {
    type: 'none', // 'none' | 'http' | 'socks4' | 'socks5'
    host: '',
    port: '',
    username: '',
    password: ''
  }
};

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [activeTabId, setActiveTabId] = useState('welcome'); // 'welcome' | 'form' | 'terminal-[session_id]'
  const [editingProfile, setEditingProfile] = useState(null);
  const [activeTerminals, setActiveTerminals] = useState([]); // [{ id, title, sessionId }]
  const [proxyPanelOpen, setProxyPanelOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Custom non-blocking Toast & Modal states to bypass Electron focus bugs on Windows
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev && prev.message === message ? null : prev);
    }, 3000);
  };

  const showConfirm = (title, message) => {
    return new Promise((resolve) => {
      setModal({
        title,
        message,
        showCancel: true,
        onConfirm: () => {
          setModal(null);
          resolve(true);
        },
        onCancel: () => {
          setModal(null);
          resolve(false);
        }
      });
    });
  };
  // Drag and Drop states for saved profiles and active terminal tabs
  const [draggedProfileIndex, setDraggedProfileIndex] = useState(null);
  const [dragOverProfileIndex, setDragOverProfileIndex] = useState(null);
  const [draggedTabIndex, setDraggedTabIndex] = useState(null);
  const [dragOverTabIndex, setDragOverTabIndex] = useState(null);

  const handleProfileDragStart = (e, index) => {
    setDraggedProfileIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleProfileDragOver = (e, index) => {
    e.preventDefault();
  };

  const handleProfileDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedProfileIndex === null || draggedProfileIndex === targetIndex) return;

    const updated = [...profiles];
    const [removed] = updated.splice(draggedProfileIndex, 1);
    updated.splice(targetIndex, 0, removed);
    saveProfilesToStorage(updated);
    
    setDraggedProfileIndex(null);
    setDragOverProfileIndex(null);
  };

  const handleProfileDragEnd = () => {
    setDraggedProfileIndex(null);
    setDragOverProfileIndex(null);
  };

  const handleTabDragStart = (e, index) => {
    setDraggedTabIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTabDragOver = (e, index) => {
    e.preventDefault();
  };

  const handleTabDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedTabIndex === null || draggedTabIndex === targetIndex) return;

    const updated = [...activeTerminals];
    const [removed] = updated.splice(draggedTabIndex, 1);
    updated.splice(targetIndex, 0, removed);
    setActiveTerminals(updated);
    
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
  };

  const handleTabDragEnd = () => {
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
  };

  const moveTabUp = (index) => {
    if (index === 0) return;
    const updated = [...activeTerminals];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    setActiveTerminals(updated);
  };

  const moveTabDown = (index) => {
    if (index === activeTerminals.length - 1) return;
    const updated = [...activeTerminals];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    setActiveTerminals(updated);
  };

  // Load profiles from LocalStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('proxy_ssh_profiles');
    if (saved) {
      try {
        setProfiles(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved profiles.', e);
      }
    }
  }, []);

  // Sync profiles to localStorage
  const saveProfilesToStorage = (updated) => {
    setProfiles(updated);
    localStorage.setItem('proxy_ssh_profiles', JSON.stringify(updated));
  };

  const startNewProfile = () => {
    setEditingProfile(JSON.parse(JSON.stringify(AppTemplate)));
    setActiveTabId('form');
    setErrorMessage('');
    setProxyPanelOpen(false);
  };

  const handleEditProfile = (profile, e) => {
    e.stopPropagation();
    setEditingProfile(JSON.parse(JSON.stringify(profile)));
    setActiveTabId('form');
    setErrorMessage('');
    setProxyPanelOpen(profile.proxy.type !== 'none');
  };

  const handleSelectProfileToConnect = (profile) => {
    setEditingProfile(JSON.parse(JSON.stringify(profile)));
    setActiveTabId('form');
    setErrorMessage('');
    setProxyPanelOpen(profile.proxy.type !== 'none');
  };

  const handleDeleteProfile = async (id, e) => {
    e.stopPropagation();
    const confirmed = await showConfirm('Delete Profile', 'Are you sure you want to delete this profile?');
    if (confirmed) {
      const updated = profiles.filter(p => p.id !== id);
      saveProfilesToStorage(updated);
      if (editingProfile && editingProfile.id === id) {
        setActiveTabId('welcome');
        setEditingProfile(null);
      }
    }
  };

  const handleSaveProfile = () => {
    if (!editingProfile.name || !editingProfile.ssh.host || !editingProfile.ssh.username) {
      setErrorMessage('Profile name, SSH host, and SSH username are required to save.');
      return;
    }

    let updated;
    if (editingProfile.id) {
      // Edit existing
      updated = profiles.map(p => p.id === editingProfile.id ? editingProfile : p);
    } else {
      // Create new
      const newProfile = {
        ...editingProfile,
        id: 'profile-' + Date.now()
      };
      updated = [...profiles, newProfile];
      setEditingProfile(newProfile);
    }
    saveProfilesToStorage(updated);
    setErrorMessage('');
    showToast('Profile saved successfully!', 'success');
  };


  // Read private key file contents
  const handleKeyFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setEditingProfile(prev => ({
        ...prev,
        ssh: {
          ...prev.ssh,
          privateKey: event.target.result
        }
      }));
    };
    reader.readAsText(file);
  };

  const initiateSshConnection = async (sshConfig, proxyConfig, aliasName) => {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ssh: sshConfig,
          proxy: proxyConfig
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to initialize session.');
      }

      const { sessionId } = await response.json();

      // Create new terminal tab
      const tabTitle = aliasName || `${sshConfig.username}@${sshConfig.host}`;
      const newTab = {
        id: `terminal-${sessionId}`,
        title: tabTitle,
        sessionId: sessionId,
        profileId: editingProfile ? editingProfile.id : null,
        connectionConfig: {
          ssh: JSON.parse(JSON.stringify(sshConfig)),
          proxy: JSON.parse(JSON.stringify(proxyConfig))
        }
      };

      setActiveTerminals(prev => [...prev, newTab]);
      setActiveTabId(`terminal-${sessionId}`);
      
      // Auto-collapse sidebar upon successful connection to maximize screen space
      setSidebarOpen(false);
    } catch (err) {
      showToast(err.message || 'Server error. Is the backend running?', 'error');
      setErrorMessage(err.message || 'Server error.');
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    
    if (!editingProfile.ssh.host || !editingProfile.ssh.username) {
      setErrorMessage('SSH Host and Username are required.');
      return;
    }

    setConnecting(true);
    await initiateSshConnection(editingProfile.ssh, editingProfile.proxy, editingProfile.name);
    setConnecting(false);
  };

  const handleDirectConnect = async (profile, e) => {
    e.stopPropagation();
    showToast(`Connecting to ${profile.name || profile.ssh.host}...`, 'info');
    await initiateSshConnection(profile.ssh, profile.proxy, profile.name);
  };

  const handleCloseTerminal = (tabId) => {
    const updated = activeTerminals.filter(t => t.id !== tabId);
    setActiveTerminals(updated);

    if (activeTabId === tabId) {
      if (updated.length > 0) {
        // Fallback to last open tab
        setActiveTabId(updated[updated.length - 1].id);
      } else {
        // Fallback to welcome screen
        setActiveTabId('welcome');
      }
    }
  };

  const handleReconnectTab = async (tabId) => {
    const tabIndex = activeTerminals.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = activeTerminals[tabIndex];
    
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ssh: tab.connectionConfig.ssh,
          proxy: tab.connectionConfig.proxy
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to initialize session.');
      }

      const { sessionId } = await response.json();
      
      const updated = activeTerminals.map(t => {
        if (t.id === tabId) {
          return {
            ...t,
            id: `terminal-${sessionId}`,
            sessionId: sessionId
          };
        }
        return t;
      });
      
      setActiveTerminals(updated);
      setActiveTabId(`terminal-${sessionId}`);
    } catch (err) {
      showToast(`Reconnection failed: ${err.message}`, 'error');
    }
  };

  const handleFormInputChange = (section, field, value) => {
    setEditingProfile(prev => {
      if (section === 'root') {
        return { ...prev, [field]: value };
      }
      return {
        ...prev,
        [section]: {
          ...prev[section],
          [field]: value
        }
      };
    });
  };

  return (
    <div className="app-container">
      {/* 1. Sidebar Panel */}
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-header">
          <div className="logo-section">
            <div className="logo-icon">⚡</div>
            <div className="logo-text">ProxySSH</div>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="section-label">Profiles</div>
          <div className="profile-list">
            {profiles.length === 0 ? (
              <div style={{ padding: '0 8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                No saved profiles yet. Click "+ New Profile" below to start.
              </div>
            ) : (
              profiles.map((p, index) => {
                const isActive = editingProfile && editingProfile.id === p.id && activeTabId === 'form';
                const hasProxy = p.proxy && p.proxy.type !== 'none';
                return (
                  <div 
                    key={p.id} 
                    className={`profile-item ${isActive ? 'active' : ''} ${dragOverProfileIndex === index ? 'drag-over' : ''}`}
                    onClick={() => handleSelectProfileToConnect(p)}
                    draggable
                    onDragStart={(e) => handleProfileDragStart(e, index)}
                    onDragOver={(e) => handleProfileDragOver(e, index)}
                    onDrop={(e) => handleProfileDrop(e, index)}
                    onDragEnd={handleProfileDragEnd}
                    onDragEnter={() => setDragOverProfileIndex(index)}
                    onDragLeave={() => setDragOverProfileIndex(null)}
                    style={{ opacity: draggedProfileIndex === index ? 0.4 : 1 }}
                  >
                    <div className="profile-info">
                      <div className="profile-name">{p.name}</div>
                      <div className="profile-meta">
                        <ServerIcon />
                        <span>{p.ssh.host}:{p.ssh.port}</span>
                        {hasProxy && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--info)' }}>
                            <ProxyIcon active={true} />
                            <span style={{ fontSize: '10px', textTransform: 'uppercase' }}>{p.proxy.type}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="profile-actions">
                      <button className="action-btn connect-action-btn" title="Connect Directly" onClick={(e) => handleDirectConnect(p, e)}>
                        <ConnectIcon />
                      </button>
                      <button className="action-btn" title="Edit" onClick={(e) => handleEditProfile(p, e)}>
                        <EditIcon />
                      </button>
                      <button className="action-btn delete-btn" title="Delete" onClick={(e) => handleDeleteProfile(p.id, e)}>
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {activeTerminals.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: '24px' }}>Active Sessions</div>
              <div className="profile-list">
                {activeTerminals.map((tab, index) => {
                  const isActive = activeTabId === tab.id;
                  return (
                    <div 
                      key={tab.id} 
                      className={`profile-item ${isActive ? 'active' : ''} ${dragOverTabIndex === index ? 'drag-over' : ''}`}
                      onClick={() => setActiveTabId(tab.id)}
                      draggable
                      onDragStart={(e) => handleTabDragStart(e, index)}
                      onDragOver={(e) => handleTabDragOver(e, index)}
                      onDrop={(e) => handleTabDrop(e, index)}
                      onDragEnd={handleTabDragEnd}
                      onDragEnter={() => setDragOverTabIndex(index)}
                      onDragLeave={() => setDragOverTabIndex(null)}
                      style={{ opacity: draggedTabIndex === index ? 0.4 : 1 }}
                    >
                      <div className="profile-info">
                        <div className="profile-name">{tab.title}</div>
                        <div className="profile-meta" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="status-indicator-dot online"></span>
                          <span>Active Session</span>
                        </div>
                      </div>
                      <div className="profile-actions" style={{ display: 'flex', gap: '4px' }}>
                        <button 
                          className="action-btn" 
                          title="Move Up" 
                          onClick={(e) => { e.stopPropagation(); moveTabUp(index); }}
                          disabled={index === 0}
                          style={{ opacity: index === 0 ? 0.3 : 1 }}
                        >
                          ▲
                        </button>
                        <button 
                          className="action-btn" 
                          title="Move Down" 
                          onClick={(e) => { e.stopPropagation(); moveTabDown(index); }}
                          disabled={index === activeTerminals.length - 1}
                          style={{ opacity: index === activeTerminals.length - 1 ? 0.3 : 1 }}
                        >
                          ▼
                        </button>
                        <button className="action-btn delete-btn" title="Close Session" onClick={(e) => { e.stopPropagation(); handleCloseTerminal(tab.id); }}>
                          <CloseIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="btn-primary-gradient" onClick={startNewProfile}>
            <PlusIcon />
            <span>New Profile</span>
          </button>
        </div>
      </aside>

      {/* 2. Main Terminal and Form Space */}
      <main className="main-content">
        {/* Tab Bar (Shows connection manager + active terminals) */}
        <div className="tab-bar">
          <button 
            type="button"
            className="sidebar-toggle-btn" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <SidebarToggleIcon isOpen={sidebarOpen} />
          </button>
          <div 
            className={`tab-item ${(activeTabId === 'welcome' || activeTabId === 'form') ? 'active' : ''}`}
            onClick={() => {
              if (editingProfile) {
                setActiveTabId('form');
              } else {
                setActiveTabId('welcome');
              }
            }}
          >
            <ServerIcon />
            <span>Connection Manager</span>
          </div>

          {activeTerminals.map((tab, index) => (
            <div 
              key={tab.id} 
              className={`tab-item ${activeTabId === tab.id ? 'active' : ''} ${dragOverTabIndex === index ? 'drag-over' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
              draggable
              onDragStart={(e) => handleTabDragStart(e, index)}
              onDragOver={(e) => handleTabDragOver(e, index)}
              onDrop={(e) => handleTabDrop(e, index)}
              onDragEnd={handleTabDragEnd}
              onDragEnter={() => setDragOverTabIndex(index)}
              onDragLeave={() => setDragOverTabIndex(null)}
              style={{ opacity: draggedTabIndex === index ? 0.4 : 1 }}
            >
              <TerminalIcon />
              <span>{tab.title}</span>
              <button 
                className="tab-close" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTerminal(tab.id);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>

        {/* Content Pane */}
        <div className="pane-container">
          {/* Welcome view */}
          {activeTabId === 'welcome' && (
            <div className="welcome-container">
              <div className="welcome-icon-box">⚡</div>
              <h2 className="welcome-title">Welcome to ProxySSH</h2>
              <p className="welcome-description">
                A highly secure, tabbed SSH terminal client optimized to establish stable connections 
                even through restrictive HTTP and SOCKS proxy environments.
              </p>
              
              <div className="welcome-features">
                <div className="feature-badge">
                  <div className="feature-icon" style={{ color: 'var(--primary)' }}>🔌</div>
                  <div>
                    <div className="feature-title">HTTP & SOCKS Tunnels</div>
                    <div className="feature-desc">Connect using SOCKS4, SOCKS5, or HTTP CONNECT proxies with ease.</div>
                  </div>
                </div>

                <div className="feature-badge">
                  <div className="feature-icon" style={{ color: 'var(--info)' }}>🔑</div>
                  <div>
                    <div className="feature-title">Key Authentication</div>
                    <div className="feature-desc">Supports private keys and encrypted passphrases securely locally.</div>
                  </div>
                </div>

                <div className="feature-badge">
                  <div className="feature-icon" style={{ color: 'var(--success)' }}>📑</div>
                  <div>
                    <div className="feature-title">Multi-Tab Sessions</div>
                    <div className="feature-desc">Establish and switch between multiple active terminal connections.</div>
                  </div>
                </div>

                <div className="feature-badge">
                  <div className="feature-icon" style={{ color: 'var(--warning)' }}>💾</div>
                  <div>
                    <div className="feature-title">Profile Storage</div>
                    <div className="feature-desc">Profiles are stored locally on your own browser storage.</div>
                  </div>
                </div>
              </div>

              <button 
                className="btn-primary-gradient" 
                style={{ marginTop: '40px', width: 'auto', padding: '14px 32px' }}
                onClick={startNewProfile}
              >
                <PlusIcon />
                <span>Configure SSH Connection</span>
              </button>
            </div>
          )}

          {/* Configuration / Edit Profile View */}
          {activeTabId === 'form' && editingProfile && (
            <div className="form-card glass-panel">
              <div className="form-header">
                <h2 className="form-title">
                  {editingProfile.id ? `Edit Profile: ${editingProfile.name}` : 'New SSH Connection'}
                </h2>
                <p className="form-subtitle">
                  Configure SSH details and optional routing proxy tunnels below.
                </p>
              </div>


              <form onSubmit={handleConnect}>
                <div className="form-grid">
                  {/* Profile Name (Required to Save) */}
                  <div className="form-group form-grid-full">
                    <label className="form-label">Profile Alias Name</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="e.g. My Production Bastion" 
                      value={editingProfile.name} 
                      onChange={(e) => handleFormInputChange('root', 'name', e.target.value)}
                    />
                  </div>

                  {/* SSH Host */}
                  <div className="form-group">
                    <label className="form-label">SSH Host / IP Address *</label>
                    <input 
                      type="text" 
                      required
                      className="form-input" 
                      placeholder="ssh.example.com" 
                      value={editingProfile.ssh.host} 
                      onChange={(e) => handleFormInputChange('ssh', 'host', e.target.value)}
                    />
                  </div>

                  {/* SSH Port */}
                  <div className="form-group">
                    <label className="form-label">SSH Port *</label>
                    <input 
                      type="number" 
                      required
                      className="form-input" 
                      placeholder="22" 
                      value={editingProfile.ssh.port} 
                      onChange={(e) => handleFormInputChange('ssh', 'port', e.target.value)}
                    />
                  </div>

                  {/* SSH Username */}
                  <div className="form-group">
                    <label className="form-label">SSH Username *</label>
                    <input 
                      type="text" 
                      required
                      className="form-input" 
                      placeholder="root" 
                      value={editingProfile.ssh.username} 
                      onChange={(e) => handleFormInputChange('ssh', 'username', e.target.value)}
                    />
                  </div>

                  {/* Auth Type selection */}
                  <div className="form-group">
                    <label className="form-label">Authentication Method</label>
                    <select 
                      className="form-input" 
                      value={editingProfile.ssh.authType} 
                      onChange={(e) => handleFormInputChange('ssh', 'authType', e.target.value)}
                    >
                      <option value="password">Password</option>
                      <option value="key">SSH Private Key</option>
                    </select>
                  </div>

                  {/* Password Auth Inputs */}
                  {editingProfile.ssh.authType === 'password' && (
                    <div className="form-group form-grid-full">
                      <label className="form-label">SSH Password</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="••••••••••••" 
                        value={editingProfile.ssh.password} 
                        onChange={(e) => handleFormInputChange('ssh', 'password', e.target.value)}
                      />
                    </div>
                  )}

                  {/* Private Key Auth Inputs */}
                  {editingProfile.ssh.authType === 'key' && (
                    <>
                      <div className="form-group form-grid-full">
                        <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>Private Key Content (PEM Format)</span>
                          <span style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <input 
                              type="file" 
                              id="key-uploader" 
                              style={{ display: 'none' }} 
                              onChange={handleKeyFileUpload}
                            />
                            <label htmlFor="key-uploader" style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--primary-hover)' }}>
                              Upload Key File
                            </label>
                          </span>
                        </label>
                        <textarea 
                          className="form-input form-textarea" 
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                          value={editingProfile.ssh.privateKey}
                          onChange={(e) => handleFormInputChange('ssh', 'privateKey', e.target.value)}
                        />
                      </div>
                      
                      <div className="form-group form-grid-full">
                        <label className="form-label">Key Passphrase (Optional)</label>
                        <input 
                          type="password" 
                          className="form-input" 
                          placeholder="Password protecting private key (if encrypted)"
                          value={editingProfile.ssh.passphrase}
                          onChange={(e) => handleFormInputChange('ssh', 'passphrase', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Proxy Configuration Panel */}
                <div 
                  className="proxy-toggle-header"
                  onClick={() => setProxyPanelOpen(!proxyPanelOpen)}
                >
                  <div className="proxy-toggle-title">
                    <ProxyIcon active={editingProfile.proxy.type !== 'none'} />
                    <span>Proxy Routing Tunnel Settings</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`proxy-toggle-badge ${editingProfile.proxy.type === 'none' ? 'badge-none' : 'badge-proxy'}`}>
                      {editingProfile.proxy.type === 'none' ? 'direct' : editingProfile.proxy.type}
                    </span>
                    {proxyPanelOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  </div>
                </div>

                {proxyPanelOpen && (
                  <div className="proxy-content-panel">
                    <div className="form-grid" style={{ marginBottom: 0 }}>
                      <div className="form-group">
                        <label className="form-label">Proxy Protocol Type</label>
                        <select 
                          className="form-input" 
                          value={editingProfile.proxy.type} 
                          onChange={(e) => handleFormInputChange('proxy', 'type', e.target.value)}
                        >
                          <option value="none">None (Direct Connection)</option>
                          <option value="http">HTTP (CONNECT Tunnel)</option>
                          <option value="socks4">SOCKS 4 Proxy</option>
                          <option value="socks5">SOCKS 5 Proxy</option>
                        </select>
                      </div>

                      {editingProfile.proxy.type !== 'none' && (
                        <>
                          <div className="form-group">
                            <label className="form-label">Proxy Host / IP *</label>
                            <input 
                              type="text" 
                              required
                              className="form-input" 
                              placeholder="proxy.company.com" 
                              value={editingProfile.proxy.host} 
                              onChange={(e) => handleFormInputChange('proxy', 'host', e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Proxy Port *</label>
                            <input 
                              type="number" 
                              required
                              className="form-input" 
                              placeholder="8080" 
                              value={editingProfile.proxy.port} 
                              onChange={(e) => handleFormInputChange('proxy', 'port', e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Proxy Username (Optional)</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              placeholder="user" 
                              value={editingProfile.proxy.username} 
                              onChange={(e) => handleFormInputChange('proxy', 'username', e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">Proxy Password (Optional)</label>
                            <input 
                              type="password" 
                              className="form-input" 
                              placeholder="••••••••••••" 
                              value={editingProfile.proxy.password} 
                              onChange={(e) => handleFormInputChange('proxy', 'password', e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {errorMessage && (
                  <div className="status-error" style={{ marginTop: '20px', marginBottom: '15px', width: '100%', maxWidth: 'none', alignItems: 'flex-start' }}>
                    <strong>Error details:</strong>
                    <p>{errorMessage}</p>
                  </div>
                )}

                {/* Form Buttons */}
                <div className="form-actions">
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => {
                      setEditingProfile(null);
                      setActiveTabId('welcome');
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button" 
                    className="btn-secondary"
                    style={{ border: '1px solid var(--panel-border-focus)' }}
                    onClick={handleSaveProfile}
                  >
                    Save to Profiles
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary"
                    disabled={connecting}
                  >
                    {connecting ? 'Connecting...' : 'Connect Now'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Active Terminals rendering */}
          {activeTerminals.map(tab => {
            const isTabActive = activeTabId === tab.id;
            return (
              <div 
                key={tab.id} 
                style={{ 
                  display: isTabActive ? 'block' : 'none',
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0 
                }}
              >
                <TerminalComponent 
                  sessionId={tab.sessionId} 
                  title={tab.title}
                  isActive={isTabActive}
                  onDisconnect={() => handleCloseTerminal(tab.id)} 
                  onReconnect={() => handleReconnectTab(tab.id)}
                />
              </div>
            );
          })}
        </div>
      </main>

      {/* Custom Toast System */}
      {toast && (
        <div className={`custom-toast toast-${toast.type}`}>
          <span style={{ fontSize: '16px' }}>{toast.type === 'success' ? '✓' : '✗'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Custom Modal Confirmation Dialog */}
      {modal && (
        <div className="custom-modal-overlay">
          <div className="custom-modal">
            <h3 className="custom-modal-title">{modal.title}</h3>
            <p className="custom-modal-body">{modal.message}</p>
            <div className="custom-modal-actions">
              {modal.showCancel && (
                <button className="btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }} onClick={modal.onCancel}>
                  Cancel
                </button>
              )}
              <button className="btn-primary" style={{ padding: '8px 20px', fontSize: '13px' }} onClick={modal.onConfirm}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
