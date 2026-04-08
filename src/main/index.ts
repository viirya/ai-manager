import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

app.setName('Claude Code Manager');
import { discoverSessions, readSessionMessages, deleteSession, findClaudeBinary } from './sessions';
import {
  spawnSession,
  spawnNewSession,
  writeToSession,
  killSession,
  resizeSession,
  isSessionLive,
  getLiveSessions,
  killAllSessions,
} from './pty';
import { DialogueManager } from './dialogue';
import type { DialogueConfig } from './dialogue';

let mainWindow: BrowserWindow | null = null;
const dialogueManager = new DialogueManager();

// electron-store setup (using v8 which is CJS compatible)
let store: any = null;
function getStoreSync() {
  if (!store) {
    const Store = require('electron-store');
    store = new Store({
      name: 'claude-code-manager',
      defaults: {
        sessionMeta: {} as Record<string, any>,
        settings: {
          claudeBinaryPath: '',
          defaultWorkingDirectory: '',
          theme: 'dark',
          chatFontSize: 'medium',
          terminalFontSize: 13,
          autoScroll: 'pause-on-scroll-up',
          showRawByDefault: false,
          sidebarWidth: 320,
          windowBounds: null,
        },
      },
    });
  }
  return store;
}
async function getStore() {
  return getStoreSync();
}

function getAppVersion(): string {
  try {
    const pkg = require(path.join(app.getAppPath(), 'package.json'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function getClaudeVersion(): string {
  try {
    const shellPath = process.env.SHELL || '/bin/zsh';
    return execSync(`${shellPath} -ilc "claude --version"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return 'Unknown';
  }
}

// =============================================
// Window creation with state persistence
// =============================================
function createWindow() {
  const s = getStoreSync();
  const saved = s.get('settings.windowBounds');
  const bounds = saved as { x?: number; y?: number; width?: number; height?: number } | null;

  mainWindow = new BrowserWindow({
    ...(bounds?.x !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    width: bounds?.width || 1200,
    height: bounds?.height || 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Save window bounds on move/resize
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      s.set('settings.windowBounds', b);
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
  if (isDev) {
    const port = process.env.VITE_PORT || '5173';
    mainWindow.loadURL(`http://localhost:${port}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  dialogueManager.setWindow(mainWindow);
}

// =============================================
// macOS App Menu
// =============================================
function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: 'Claude Code Manager',
            submenu: [
              {
                label: 'About Claude Code Manager',
                click: () => mainWindow?.webContents.send('menu:about'),
              },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,' as const,
                click: () => mainWindow?.webContents.send('menu:settings'),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),

    // Session menu
    {
      label: 'Session',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu:newSession'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:closeTab'),
        },
        { type: 'separator' },
        {
          label: 'Previous Tab',
          accelerator: 'Shift+CmdOrCtrl+[',
          click: () => mainWindow?.webContents.send('menu:prevTab'),
        },
        {
          label: 'Next Tab',
          accelerator: 'Shift+CmdOrCtrl+]',
          click: () => mainWindow?.webContents.send('menu:nextTab'),
        },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: `Tab ${n}`,
          accelerator: `CmdOrCtrl+${n}` as string,
          click: () => mainWindow?.webContents.send('menu:switchTab', n - 1),
          visible: false, // Hide from menu but keep accelerator
        })),
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
        { type: 'separator' as const },
        {
          label: 'Find in Sessions',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:focusSearch'),
        },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Context (CLAUDE.md)',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:toggleContext'),
        },
        {
          label: 'Redraw Terminal',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu:redrawTerminal'),
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggleSidebar'),
        },
        {
          label: 'Toggle Raw Terminal',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('menu:toggleRaw'),
        },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        ...(process.env.NODE_ENV !== 'production'
          ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]
          : []),
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// =============================================
// IPC Handlers
// =============================================
function setupIPC() {
  // === Session discovery IPC ===
  ipcMain.handle('sessions:list', async () => {
    return discoverSessions();
  });

  ipcMain.handle('sessions:read', async (_event, filePath: string) => {
    return readSessionMessages(filePath);
  });

  ipcMain.handle('sessions:delete', async (_event, filePath: string) => {
    deleteSession(filePath);
  });

  // === PTY IPC ===
  ipcMain.handle('pty:spawn', async (_event, sessionId: string, cwd: string) => {
    if (!mainWindow) return { success: false, error: 'No window' };
    return spawnSession(sessionId, cwd, mainWindow);
  });

  ipcMain.handle('pty:spawnNew', async (_event, cwd: string) => {
    if (!mainWindow) return { success: false, error: 'No window' };
    return spawnNewSession(cwd, mainWindow);
  });

  ipcMain.on('pty:write', (_event, sessionId: string, data: string) => {
    writeToSession(sessionId, data);
  });

  ipcMain.on('pty:kill', (_event, sessionId: string) => {
    killSession(sessionId);
  });

  ipcMain.on('pty:resize', (_event, sessionId: string, cols: number, rows: number) => {
    resizeSession(sessionId, cols, rows);
  });

  ipcMain.handle('pty:isLive', async (_event, sessionId: string) => {
    return isSessionLive(sessionId);
  });

  ipcMain.handle('pty:getLiveSessions', async () => {
    return getLiveSessions();
  });

  // === Store IPC ===
  ipcMain.handle('store:get', async (_event, key: string) => {
    const s = await getStore();
    return s.get(key);
  });

  ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
    const s = await getStore();
    s.set(key, value);
  });

  // === App IPC ===
  ipcMain.handle('app:getClaudePath', async () => {
    return findClaudeBinary();
  });

  ipcMain.handle('app:openDirectory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select working directory',
    });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'app:showContextMenu',
    async (_event, _sessionId: string, meta: { pinned?: boolean; archived?: boolean }) => {
      return new Promise<string | null>((resolve) => {
        const template = [
          { label: 'Resume', click: () => resolve('resume') },
          { label: 'Rename', click: () => resolve('rename') },
          { type: 'separator' as const },
          { label: meta.pinned ? 'Unpin' : 'Pin', click: () => resolve('togglePin') },
          { label: meta.archived ? 'Unarchive' : 'Archive', click: () => resolve('toggleArchive') },
          { type: 'separator' as const },
          { label: 'Copy Session ID', click: () => resolve('copyId') },
          { type: 'separator' as const },
          { label: 'Delete', click: () => resolve('delete') },
        ];
        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: mainWindow!, callback: () => resolve(null) });
      });
    }
  );

  ipcMain.handle('app:verifyClaudeBinary', async (_event, binaryPath: string) => {
    try {
      const shellPath = process.env.SHELL || '/bin/zsh';
      const version = execSync(`${shellPath} -ilc "${binaryPath} --version"`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      return version;
    } catch (err: any) {
      return `Error: ${err.message || 'Binary not found'}`;
    }
  });

  ipcMain.handle('app:getVersion', async () => {
    return getAppVersion();
  });

  ipcMain.handle('app:getClaudeVersion', async () => {
    return getClaudeVersion();
  });

  // === File IPC (for CLAUDE.md) ===
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        return { content: fs.readFileSync(filePath, 'utf-8'), exists: true };
      }
      return { content: '', exists: false };
    } catch (err: any) {
      return { content: '', exists: false, error: err.message };
    }
  });

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // === Dialogue IPC ===
  ipcMain.handle('dialogue:start', async (_event, config: DialogueConfig) => {
    return dialogueManager.startDialogue(config);
  });

  ipcMain.handle('dialogue:pause', async (_event, dialogueId: string) => {
    return dialogueManager.pauseDialogue(dialogueId);
  });

  ipcMain.handle('dialogue:resume', async (_event, dialogueId: string) => {
    return dialogueManager.resumeDialogue(dialogueId);
  });

  ipcMain.handle('dialogue:stop', async (_event, dialogueId: string) => {
    return dialogueManager.stopDialogue(dialogueId);
  });

  ipcMain.handle('dialogue:list', async () => {
    return dialogueManager.listDialogues();
  });

  ipcMain.handle('dialogue:get', async (_event, dialogueId: string) => {
    return dialogueManager.getDialogue(dialogueId);
  });

  ipcMain.handle('dialogue:isSessionInDialogue', async (_event, sessionId: string) => {
    return dialogueManager.isSessionInDialogue(sessionId);
  });
}

// =============================================
// App lifecycle
// =============================================
app.whenReady().then(() => {
  setupIPC();
  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  dialogueManager.destroy();
  killAllSessions();
});
