import { exec } from 'child_process';
import { promisify } from 'util';
import type { SessionInfo } from '../shared/types';

const execAsync = promisify(exec);

export interface RemoteHostConfig {
  name: string;
  user: string;
  host: string;
  port: number;
  keyPath: string;
}

function buildSshPrefix(host: RemoteHostConfig): string {
  const parts = [
    'ssh',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=5',
    '-o', 'ClearAllForwardings=yes',  // Don't compete with existing SSH port forwards
  ];
  if (host.port && host.port !== 22) parts.push('-p', String(host.port));
  if (host.keyPath) parts.push('-i', host.keyPath);
  parts.push(`${host.user}@${host.host}`);
  return parts.join(' ');
}

function hostKey(host: RemoteHostConfig): string {
  return `${host.user}@${host.host}`;
}

function parseRemoteJsonlFirstMessage(jsonlContent: string): {
  firstMessage: string;
  cwd: string;
  messageCount: number;
} {
  const result = { firstMessage: '', cwd: '', messageCount: 0 };
  const lines = jsonlContent.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'user' || obj.type === 'assistant') {
        result.messageCount++;
      }
      if (obj.type === 'user' && !result.firstMessage) {
        result.cwd = obj.cwd || '';
        const contentArr = obj.message?.content;
        if (Array.isArray(contentArr)) {
          for (const c of contentArr) {
            if (c.type === 'text' && c.text?.trim()) {
              let text = c.text.trim();
              text = text.replace(/<ide_[^>]*>[\s\S]*?<\/ide_[^>]*>/g, '').trim();
              if (text) {
                result.firstMessage = text.slice(0, 200);
                break;
              }
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  return result;
}

export async function discoverRemoteSessions(host: RemoteHostConfig): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  const sshCmd = buildSshPrefix(host);
  const hk = hostKey(host);

  try {
    // Single SSH call: list all session files, skip agent-*/compact-*, read first 20 lines of each
    const script = `
      find ~/.claude/projects -name "*.jsonl" -type f 2>/dev/null | grep -v -E '/(agent-|compact-)' | while read f; do
        echo "===FILE=== $f"
        head -20 "$f" 2>/dev/null
      done
    `;
    const { stdout } = await execAsync(
      `${sshCmd} '${script.replace(/'/g, "'\\''")}'`,
      { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
    );

    if (!stdout.trim()) return sessions;

    // Parse output: split by ===FILE=== markers
    const chunks = stdout.split('===FILE=== ').filter(Boolean);

    for (const chunk of chunks) {
      try {
        const newlineIdx = chunk.indexOf('\n');
        if (newlineIdx === -1) continue;
        const remoteFilePath = chunk.slice(0, newlineIdx).trim();
        const jsonlContent = chunk.slice(newlineIdx + 1);

        const fileName = remoteFilePath.split('/').pop() || '';
        const sessionUuid = fileName.replace('.jsonl', '');
        if (!sessionUuid) continue;
        // Skip internal sub-agent/compact sessions
        if (/^(agent-|compact-)/.test(sessionUuid)) continue;

        const { firstMessage, cwd, messageCount } = parseRemoteJsonlFirstMessage(jsonlContent);

        const pathParts = remoteFilePath.split('/');
        const projectsIdx = pathParts.indexOf('projects');
        const projectDir = projectsIdx >= 0 ? pathParts[projectsIdx + 1] || '' : '';

        let title = '';
        if (firstMessage) {
          const firstLine = firstMessage.split('\n')[0];
          title = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
        }
        if (!title && cwd) {
          title = cwd.split('/').pop() || '';
        }
        if (!title) {
          title = sessionUuid.slice(0, 8);
        }

        sessions.push({
          id: `${hk}:${sessionUuid}`,
          projectDir,
          cwd,
          title,
          firstMessage,
          lastActive: Date.now(), // no reliable mtime from this approach
          messageCount,
          status: 'archived' as const,
          filePath: remoteFilePath,
          remote: hk,
        });
      } catch {
        continue;
      }
    }
  } catch (err: any) {
    // Re-throw with context so the renderer can display the error
    throw new Error(`SSH to ${hk} failed: ${err.message}`);
  }

  sessions.sort((a, b) => b.lastActive - a.lastActive);
  return sessions;
}

export async function deleteRemoteSession(
  host: RemoteHostConfig,
  remoteFilePath: string
): Promise<{ success: boolean; error?: string }> {
  const sshCmd = buildSshPrefix(host);
  try {
    await execAsync(`${sshCmd} 'rm -f "${remoteFilePath}"'`, { timeout: 10000 });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Build SSH command args for spawning a remote Claude session in PTY
export function buildRemoteClaudeArgs(host: RemoteHostConfig, sessionUuid: string, cwd?: string): {
  command: string;
  args: string[];
} {
  const parts: string[] = ['-o', 'StrictHostKeyChecking=no', '-o', 'ClearAllForwardings=yes', '-t'];
  if (host.port && host.port !== 22) parts.push('-p', String(host.port));
  if (host.keyPath) parts.push('-i', host.keyPath);
  parts.push(`${host.user}@${host.host}`);
  // cd to session's working directory, then use login shell to run claude
  const resumeCmd = sessionUuid
    ? `claude --resume ${sessionUuid}`
    : `claude`;
  const cdCmd = cwd ? `cd ${cwd} 2>/dev/null; ` : '';
  parts.push(`${cdCmd}exec $SHELL -ilc '${resumeCmd}'`);
  return { command: 'ssh', args: parts };
}
