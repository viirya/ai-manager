import { BrowserWindow } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';

// node-pty must be required (not imported) for native module compat
const pty = require('node-pty');

interface PtyInstance {
  process: any; // IPty from node-pty
  sessionId: string;
  cwd: string;
}

const livePtys = new Map<string, PtyInstance>();

// Subscriber system: allows DialogueManager to listen to PTY events in main process
type PtyDataCallback = (sessionId: string, data: string) => void;
type PtyExitCallback = (sessionId: string, exitCode: number) => void;
const dataSubscribers = new Set<PtyDataCallback>();
const exitSubscribers = new Set<PtyExitCallback>();

export function onPtyData(cb: PtyDataCallback): () => void {
  dataSubscribers.add(cb);
  return () => { dataSubscribers.delete(cb); };
}

export function onPtyExit(cb: PtyExitCallback): () => void {
  exitSubscribers.add(cb);
  return () => { exitSubscribers.delete(cb); };
}

let claudeBinaryPath: string | null = null;

export function detectClaudeBinary(): string {
  if (claudeBinaryPath) return claudeBinaryPath;
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    claudeBinaryPath = execSync(`${shell} -ilc "which claude"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return claudeBinaryPath;
  } catch {
    throw new Error(
      'Claude binary not found in PATH. Install Claude Code or configure the path in Settings.'
    );
  }
}

// Build a clean env for PTY spawning:
// - Start from process.env
// - Remove ELECTRON_RUN_AS_NODE (breaks claude)
// - Ensure PATH includes the directory containing claude and node
function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env['ELECTRON_RUN_AS_NODE'];

  // Ensure the claude binary's directory and node's directory are in PATH
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const shellPath = execSync(`${shell} -ilc "echo \\$PATH"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (shellPath) {
      env['PATH'] = shellPath;
    }
  } catch {
    // Fall back to process.env PATH
  }

  return env;
}

// Spawn a PTY running claude with given args
function spawnClaudePty(
  args: string[],
  cwd: string,
  window: BrowserWindow,
  sessionId: string,
): any {
  const claudePath = detectClaudeBinary();
  // Walk up to find the nearest existing ancestor — handles deleted worktrees
  // where the session's cwd no longer exists but a parent (the repo root) does.
  let workDir = os.homedir();
  if (cwd) {
    let dir = cwd;
    while (dir && dir !== path.dirname(dir)) {
      if (fs.existsSync(dir)) { workDir = dir; break; }
      dir = path.dirname(dir);
    }
  }
  const env = buildPtyEnv();

  // Spawn the user's login shell, then exec claude inside it.
  // This ensures nvm/pyenv/etc. are initialized and "node" is available.
  const shell = process.env.SHELL || '/bin/zsh';
  const claudeCmd = [claudePath, ...args].map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');

  const ptyProcess = pty.spawn(shell, ['-il', '-c', claudeCmd], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: workDir,
    env,
  });

  const instance: PtyInstance = {
    process: ptyProcess,
    sessionId,
    cwd: workDir,
  };

  livePtys.set(sessionId, instance);

  ptyProcess.onData((data: string) => {
    if (!window.isDestroyed()) {
      window.webContents.send(`pty:data:${sessionId}`, data);
    }
    // Notify main-process subscribers (DialogueManager etc.)
    for (const cb of dataSubscribers) cb(sessionId, data);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    livePtys.delete(sessionId);
    if (!window.isDestroyed()) {
      window.webContents.send(`pty:exit:${sessionId}`, exitCode);
    }
    for (const cb of exitSubscribers) cb(sessionId, exitCode);
  });

  return ptyProcess;
}

export function spawnSession(
  sessionId: string,
  cwd: string,
  window: BrowserWindow
): { success: boolean; error?: string } {
  killSession(sessionId);

  try {
    spawnClaudePty(['--resume', sessionId], cwd, window, sessionId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export function spawnRemoteSession(
  sessionId: string,
  sshCommand: string,
  sshArgs: string[],
  window: BrowserWindow
): { success: boolean; error?: string } {
  killSession(sessionId);

  try {
    const env = buildPtyEnv();
    const ptyProcess = pty.spawn(sshCommand, sshArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
      env,
    });

    const instance: PtyInstance = {
      process: ptyProcess,
      sessionId,
      cwd: '~',
    };

    livePtys.set(sessionId, instance);

    ptyProcess.onData((data: string) => {
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:data:${sessionId}`, data);
      }
      for (const cb of dataSubscribers) cb(sessionId, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      livePtys.delete(sessionId);
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:exit:${sessionId}`, exitCode);
      }
      for (const cb of exitSubscribers) cb(sessionId, exitCode);
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export function spawnNewSession(
  cwd: string,
  window: BrowserWindow
): { success: boolean; sessionId?: string; error?: string } {
  const tempId = `new-${Date.now()}`;

  try {
    spawnClaudePty([], cwd, window, tempId);
    return { success: true, sessionId: tempId };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export function writeToSession(sessionId: string, data: string): void {
  const instance = livePtys.get(sessionId);
  if (instance) {
    instance.process.write(data);
  }
}

export function killSession(sessionId: string): void {
  const instance = livePtys.get(sessionId);
  if (instance) {
    try {
      instance.process.kill();
    } catch {
      // Already dead
    }
    livePtys.delete(sessionId);
  }
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const instance = livePtys.get(sessionId);
  if (instance) {
    try {
      instance.process.resize(cols, rows);
    } catch {
      // Ignore resize errors
    }
  }
}

export function isSessionLive(sessionId: string): boolean {
  return livePtys.has(sessionId);
}

export function getLiveSessions(): string[] {
  return Array.from(livePtys.keys());
}

export function killAllSessions(): void {
  for (const [id] of livePtys) {
    killSession(id);
  }
}
