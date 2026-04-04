import { BrowserWindow } from 'electron';
import * as os from 'os';
import * as path from 'path';
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

let claudeBinaryPath: string | null = null;

export function detectClaudeBinary(): string {
  if (claudeBinaryPath) return claudeBinaryPath;
  try {
    // Use login shell to get full PATH
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

export function spawnSession(
  sessionId: string,
  cwd: string,
  window: BrowserWindow
): { success: boolean; error?: string } {
  // Kill existing PTY for this session if any
  killSession(sessionId);

  try {
    const claudePath = detectClaudeBinary();
    const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

    // Get shell environment for proper PATH
    let shellEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const envStr = execSync(`${shell} -ilc "env"`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      for (const line of envStr.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          shellEnv[line.slice(0, idx)] = line.slice(idx + 1);
        }
      }
    } catch {
      // Fall back to process.env
    }

    // Critical: unset ELECTRON_RUN_AS_NODE so claude isn't broken
    delete shellEnv['ELECTRON_RUN_AS_NODE'];

    const ptyProcess = pty.spawn(claudePath, ['--resume', sessionId], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workDir,
      env: shellEnv,
    });

    const instance: PtyInstance = {
      process: ptyProcess,
      sessionId,
      cwd: workDir,
    };

    livePtys.set(sessionId, instance);

    // Bridge PTY output to renderer
    ptyProcess.onData((data: string) => {
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:data:${sessionId}`, data);
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      livePtys.delete(sessionId);
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:exit:${sessionId}`, exitCode);
      }
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
  // For new sessions, we generate a temp ID for tracking.
  // The real session ID will come from claude's output.
  const tempId = `new-${Date.now()}`;

  try {
    const claudePath = detectClaudeBinary();
    const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

    let shellEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const envStr = execSync(`${shell} -ilc "env"`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      for (const line of envStr.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          shellEnv[line.slice(0, idx)] = line.slice(idx + 1);
        }
      }
    } catch {
      // Fall back
    }
    delete shellEnv['ELECTRON_RUN_AS_NODE'];

    const ptyProcess = pty.spawn(claudePath, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workDir,
      env: shellEnv,
    });

    const instance: PtyInstance = {
      process: ptyProcess,
      sessionId: tempId,
      cwd: workDir,
    };

    livePtys.set(tempId, instance);

    ptyProcess.onData((data: string) => {
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:data:${tempId}`, data);
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      livePtys.delete(tempId);
      if (!window.isDestroyed()) {
        window.webContents.send(`pty:exit:${tempId}`, exitCode);
      }
    });

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
