export interface SessionInfo {
  id: string;
  projectDir: string;
  cwd: string;
  title: string;
  firstMessage: string;
  lastActive: number; // epoch ms
  messageCount: number;
  status: 'archived' | 'live';
  filePath: string;
  remote?: string; // 'user@host' if remote, undefined if local
}

export interface RemoteHost {
  name: string;       // display name
  user: string;
  host: string;
  port: number;
  keyPath: string;    // path to SSH private key (empty = use default)
}

export interface SessionMessage {
  type: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface AppSettings {
  claudeBinaryPath: string;
  defaultWorkingDirectory: string;
  theme: 'dark' | 'light' | 'system';
  chatFontSize: 'small' | 'medium' | 'large';
  terminalFontSize: number;
  autoScroll: 'always' | 'pause-on-scroll-up';
  showRawByDefault: boolean;
  sidebarWidth: number;
  windowBounds: { x: number; y: number; width: number; height: number } | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  claudeBinaryPath: '',
  defaultWorkingDirectory: '',
  theme: 'dark',
  chatFontSize: 'medium',
  terminalFontSize: 13,
  autoScroll: 'pause-on-scroll-up',
  showRawByDefault: false,
  sidebarWidth: 320,
  windowBounds: null,
};

export interface PtySpawnResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface SessionMeta {
  customTitle?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface IElectronAPI {
  sessions: {
    list: () => Promise<SessionInfo[]>;
    listRemote: (hostKey: string) => Promise<SessionInfo[]>;
    read: (filePath: string) => Promise<SessionMessage[]>;
    delete: (filePath: string) => Promise<void>;
    deleteRemote: (hostKey: string, remoteFilePath: string) => Promise<{ success: boolean; error?: string }>;
  };
  pty: {
    spawn: (sessionId: string, cwd: string) => Promise<PtySpawnResult>;
    spawnNew: (cwd: string) => Promise<PtySpawnResult>;
    spawnRemote: (sessionId: string, hostKey: string, cwd?: string) => Promise<PtySpawnResult>;
    spawnNewRemote: (hostKey: string, cwd?: string) => Promise<PtySpawnResult>;
    write: (sessionId: string, data: string) => void;
    kill: (sessionId: string) => void;
    resize: (sessionId: string, cols: number, rows: number) => void;
    onData: (sessionId: string, callback: (data: string) => void) => () => void;
    onExit: (sessionId: string, callback: (code: number) => void) => () => void;
    isLive: (sessionId: string) => Promise<boolean>;
    getLiveSessions: () => Promise<string[]>;
  };
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  app: {
    getClaudePath: () => Promise<string>;
    openDirectory: () => Promise<string | null>;
    showContextMenu: (sessionId: string, meta: SessionMeta) => Promise<string | null>;
    verifyClaudeBinary: (binaryPath: string) => Promise<string>;
    getVersion: () => Promise<string>;
    getClaudeVersion: () => Promise<string>;
  };
  file: {
    read: (filePath: string) => Promise<{ content: string; exists: boolean; error?: string }>;
    write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
    delete: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  };
  dialogue: {
    start: (config: any) => Promise<{ success: boolean; dialogueId?: string; error?: string }>;
    pause: (dialogueId: string) => Promise<boolean>;
    resume: (dialogueId: string) => Promise<boolean>;
    stop: (dialogueId: string) => Promise<boolean>;
    list: () => Promise<any[]>;
    get: (dialogueId: string) => Promise<any | null>;
    isSessionInDialogue: (sessionId: string) => Promise<string | null>;
    onUpdate: (callback: (snapshot: any) => void) => () => void;
  };
  clipboard: {
    writeText: (text: string) => void;
  };
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
