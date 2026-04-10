import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionInfo, SessionMessage } from '../shared/types';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

interface JsonlLine {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  cwd?: string;
  timestamp?: string;
  sessionId?: string;
  [key: string]: unknown;
}

function parseJsonlLine(line: string): JsonlLine | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractFirstUserMessage(filePath: string): {
  firstMessage: string;
  cwd: string;
  timestamp: string;
  messageCount: number;
} {
  const result = { firstMessage: '', cwd: '', timestamp: '', messageCount: 0 };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      const obj = parseJsonlLine(line);
      if (!obj) continue;

      if (obj.type === 'user' || obj.type === 'assistant') {
        result.messageCount++;
      }

      if (obj.type === 'user' && !result.firstMessage) {
        result.cwd = obj.cwd || '';
        result.timestamp = obj.timestamp || '';

        const contentArr = obj.message?.content;
        if (Array.isArray(contentArr)) {
          for (const c of contentArr) {
            if (c.type === 'text' && c.text?.trim()) {
              // Strip IDE metadata tags for cleaner titles
              let text = c.text.trim();
              text = text.replace(/<ide_[^>]*>.*?<\/ide_[^>]*>/gs, '').trim();
              if (text) {
                result.firstMessage = text.slice(0, 200);
                break;
              }
            }
          }
        }
      }
    }
  } catch {
    // File read error — return defaults
  }

  return result;
}

function projectDirToPath(encodedDir: string): string {
  // The encoded dir name starts with '-' and replaces path separators with '-'
  // But we can't reliably decode it back since hyphens in dir names are ambiguous
  // Instead we rely on the cwd from the session data
  return encodedDir;
}

export function discoverSessions(): SessionInfo[] {
  const sessions: SessionInfo[] = [];

  if (!fs.existsSync(PROJECTS_DIR)) return sessions;

  const projectDirs = fs.readdirSync(PROJECTS_DIR);

  for (const projDir of projectDirs) {
    const projPath = path.join(PROJECTS_DIR, projDir);
    if (!fs.statSync(projPath).isDirectory()) continue;

    const files = fs.readdirSync(projPath);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '');
      // Skip internal sub-agent/compact sessions
      if (/^(agent-|compact-)/.test(sessionId)) continue;

      const filePath = path.join(projPath, file);
      const stat = fs.statSync(filePath);

      const { firstMessage, cwd, messageCount } = extractFirstUserMessage(filePath);

      // Generate title: first message truncated, or directory basename
      let title = '';
      if (firstMessage) {
        // Take first line, truncate
        const firstLine = firstMessage.split('\n')[0];
        title = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
      }
      if (!title && cwd) {
        title = path.basename(cwd);
      }
      if (!title) {
        title = sessionId.slice(0, 8);
      }

      sessions.push({
        id: sessionId,
        projectDir: projDir,
        cwd: cwd || projectDirToPath(projDir),
        title,
        firstMessage,
        lastActive: stat.mtimeMs,
        messageCount,
        status: 'archived', // Will be updated when PTY management is added
        filePath,
      });
    }
  }

  // Sort by last active, newest first
  sessions.sort((a, b) => b.lastActive - a.lastActive);

  return sessions;
}

export function readSessionMessages(filePath: string): SessionMessage[] {
  const messages: SessionMessage[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      const obj = parseJsonlLine(line);
      if (!obj) continue;

      if (obj.type === 'user' || obj.type === 'assistant') {
        const contentArr = obj.message?.content;
        let text = '';
        if (Array.isArray(contentArr)) {
          const textParts: string[] = [];
          for (const c of contentArr) {
            if (c.type === 'text' && c.text) {
              textParts.push(c.text);
            }
          }
          text = textParts.join('\n');
        }

        if (text.trim()) {
          messages.push({
            type: obj.type as 'user' | 'assistant',
            text: text.trim(),
            timestamp: obj.timestamp || '',
          });
        }
      }
    }
  } catch {
    // File read error
  }

  return messages;
}

export function deleteSession(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function findClaudeBinary(): string {
  const { execSync } = require('child_process');
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    return 'claude'; // fallback
  }
}
