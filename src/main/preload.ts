const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    read: (filePath: string) => ipcRenderer.invoke('sessions:read', filePath),
    delete: (filePath: string) => ipcRenderer.invoke('sessions:delete', filePath),
  },
  pty: {
    spawn: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke('pty:spawn', sessionId, cwd),
    spawnNew: (cwd: string) =>
      ipcRenderer.invoke('pty:spawnNew', cwd),
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('pty:write', sessionId, data),
    kill: (sessionId: string) =>
      ipcRenderer.send('pty:kill', sessionId),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('pty:resize', sessionId, cols, rows),
    onData: (sessionId: string, callback: (data: string) => void) => {
      const channel = `pty:data:${sessionId}`;
      const handler = (_event: any, data: string) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
    onExit: (sessionId: string, callback: (code: number) => void) => {
      const channel = `pty:exit:${sessionId}`;
      const handler = (_event: any, code: number) => callback(code);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
    isLive: (sessionId: string) =>
      ipcRenderer.invoke('pty:isLive', sessionId),
    getLiveSessions: () =>
      ipcRenderer.invoke('pty:getLiveSessions'),
  },
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  app: {
    getClaudePath: () => ipcRenderer.invoke('app:getClaudePath'),
    openDirectory: () => ipcRenderer.invoke('app:openDirectory'),
    showContextMenu: (sessionId: string, meta: { pinned?: boolean; archived?: boolean }) =>
      ipcRenderer.invoke('app:showContextMenu', sessionId, meta),
    verifyClaudeBinary: (binaryPath: string) =>
      ipcRenderer.invoke('app:verifyClaudeBinary', binaryPath),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getClaudeVersion: () => ipcRenderer.invoke('app:getClaudeVersion'),
  },
  dialogue: {
    start: (config: any) => ipcRenderer.invoke('dialogue:start', config),
    pause: (dialogueId: string) => ipcRenderer.invoke('dialogue:pause', dialogueId),
    resume: (dialogueId: string) => ipcRenderer.invoke('dialogue:resume', dialogueId),
    stop: (dialogueId: string) => ipcRenderer.invoke('dialogue:stop', dialogueId),
    list: () => ipcRenderer.invoke('dialogue:list'),
    get: (dialogueId: string) => ipcRenderer.invoke('dialogue:get', dialogueId),
    isSessionInDialogue: (sessionId: string) => ipcRenderer.invoke('dialogue:isSessionInDialogue', sessionId),
    onUpdate: (callback: (snapshot: any) => void) => {
      const handler = (_event: any, snapshot: any) => callback(snapshot);
      ipcRenderer.on('dialogue:update', handler);
      return () => { ipcRenderer.removeListener('dialogue:update', handler); };
    },
  },
  clipboard: {
    writeText: (text: string) => clipboard.writeText(text),
  },
  // Generic listener for menu events from main process
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },
});
