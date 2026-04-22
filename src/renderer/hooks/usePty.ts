import { useState, useEffect, useRef, useCallback } from 'react';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  text: string;
  timestamp: number;
  toolName?: string;   // For role:'tool' — e.g. "Read", "Bash", "Edit"
  toolSummary?: string; // One-line summary for collapsed view
}

// Robust ANSI stripper covering CSI, OSC, DCS, escape sequences
function stripAnsi(str: string): string {
  return str
    // CSI sequences: ESC [ ... letter
    .replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    // OSC sequences: ESC ] ... BEL or ESC ] ... ST
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    // DCS/PM/APC: ESC P ... ST, ESC ^ ... ST, ESC _ ... ST
    .replace(/\x1B[P^_].*?\x1B\\/g, '')
    // Single-char escapes: ESC followed by a single char
    .replace(/\x1B[()#][A-Za-z0-9]/g, '')
    .replace(/\x1B[a-zA-Z]/g, '')
    // Stray ESC
    .replace(/\x1B/g, '');
}

function cleanForChat(str: string): string {
  let cleaned = stripAnsi(str);
  cleaned = cleaned.replace(/\r\n?/g, '\n');
  cleaned = cleaned.replace(/\0/g, '');
  // Remove backspace-overwrite sequences
  cleaned = cleaned.replace(/.\x08/g, '');
  // Collapse triple+ blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

// Detect tool-use blocks from Claude Code output
// Common patterns: "Read(file.ts)", "Bash(command)", "Edit(file.ts)"
// Also: "⠋ Reading file...", "⠋ Running command..."
const TOOL_PATTERNS = [
  // Tool invocation lines: "Read file.ts" or "Bash ls -la" etc.
  /^(Read|Write|Edit|Bash|Glob|Grep|TodoWrite|Agent|WebSearch|WebFetch)\s*\(?(.+?)?\)?$/,
  // Spinner lines indicating tool execution
  /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+(Reading|Writing|Editing|Running|Searching|Fetching|Executing)\s+(.+)/,
];

function detectToolName(line: string): { name: string; summary: string } | null {
  for (const pattern of TOOL_PATTERNS) {
    const m = line.trim().match(pattern);
    if (m) {
      return { name: m[1], summary: m[2] || m[1] };
    }
  }
  return null;
}

// Detect if a line is a Claude Code UI boundary
function isBoundaryLine(line: string): 'prompt' | 'system' | 'separator' | null {
  const trimmed = line.trim();
  // Prompt indicators
  if (/^[❯>]\s/.test(trimmed)) return 'prompt';
  // Box drawing separators
  if (/^[╭╰├]─/.test(trimmed) || /^─{3,}/.test(trimmed)) return 'separator';
  // System/status lines
  if (/^(Session resumed|Resuming session|Claude Code|Tip:|Type |\/help)/.test(trimmed)) return 'system';
  if (/^(Model:|Context:|Cost:)/.test(trimmed)) return 'system';
  return null;
}

interface UsePtyOptions {
  sessionId: string;
  cwd: string;
  autoSpawn?: boolean;
  skipSpawn?: boolean; // If true, PTY already exists — just subscribe, don't spawn
  remote?: string;     // 'user@host' — use SSH to spawn
}

export function usePty({ sessionId, cwd, autoSpawn = true, skipSpawn = false, remote }: UsePtyOptions) {
  const [rawOutput, setRawOutput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const rawOutputRef = useRef('');
  const rawBufferRef = useRef(''); // Buffer for incomplete ANSI sequences
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentMessagesRef = useRef<string[]>([]); // For echo suppression
  const unsubDataRef = useRef<(() => void) | null>(null);
  const unsubExitRef = useRef<(() => void) | null>(null);

  // Parse accumulated output into chat messages
  const parseOutput = useCallback((fullOutput: string) => {
    const cleaned = cleanForChat(fullOutput);
    if (!cleaned) return;

    const msgs: ChatMessage[] = [];
    const lines = cleaned.split('\n');
    let currentRole: MessageRole = 'assistant';
    let currentText = '';
    let currentToolName: string | undefined;
    let currentToolSummary: string | undefined;
    const sentSet = new Set(sentMessagesRef.current.map((s) => s.trim()));

    const flushCurrent = () => {
      const text = currentText.trim();
      if (!text) return;

      // Echo suppression: if this block matches a sent message, skip it
      if (currentRole === 'assistant') {
        const firstLine = text.split('\n')[0].trim();
        if (sentSet.has(firstLine) || sentSet.has(text)) {
          currentText = '';
          currentToolName = undefined;
          currentToolSummary = undefined;
          return;
        }
      }

      msgs.push({
        role: currentRole,
        text,
        timestamp: Date.now(),
        toolName: currentToolName,
        toolSummary: currentToolSummary,
      });
      currentText = '';
      currentToolName = undefined;
      currentToolSummary = undefined;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const boundary = isBoundaryLine(line);

      if (boundary === 'system') {
        flushCurrent();
        msgs.push({ role: 'system', text: line.trim(), timestamp: Date.now() });
        currentRole = 'assistant';
        continue;
      }

      if (boundary === 'prompt') {
        flushCurrent();
        // The text after the prompt char is the user's echoed input
        const inputText = line.replace(/^[❯>]\s*/, '').trim();
        if (inputText && !sentSet.has(inputText)) {
          // Only show if we didn't already capture it as a sent message
          msgs.push({ role: 'user', text: inputText, timestamp: Date.now() });
        }
        currentRole = 'assistant';
        continue;
      }

      if (boundary === 'separator') {
        flushCurrent();
        currentRole = 'assistant';
        continue;
      }

      // Detect tool invocations
      const tool = detectToolName(line);
      if (tool) {
        flushCurrent();
        currentRole = 'tool';
        currentToolName = tool.name;
        currentToolSummary = tool.summary;
        currentText = line + '\n';
        continue;
      }

      // If we're in a tool block and hit an empty line, might be end of tool output
      if (currentRole === 'tool' && line.trim() === '' && currentText.trim()) {
        // Peek ahead: if next line starts a new section, flush
        const next = lines[i + 1]?.trim() || '';
        if (next === '' || isBoundaryLine(next) || detectToolName(next)) {
          flushCurrent();
          currentRole = 'assistant';
          continue;
        }
      }

      currentText += line + '\n';
    }

    flushCurrent();
    setMessages(msgs);
  }, []);

  // Subscribe to PTY data/exit events (shared between spawn and subscribeOnly)
  const subscribe = useCallback(() => {
    // Unsubscribe previous if any
    if (unsubDataRef.current) unsubDataRef.current();
    if (unsubExitRef.current) unsubExitRef.current();

    unsubDataRef.current = window.electronAPI.pty.onData(sessionId, (data: string) => {
      // Buffer incomplete ANSI sequences
      let buffered = rawBufferRef.current + data;

      const lastEsc = buffered.lastIndexOf('\x1B');
      if (lastEsc >= 0 && lastEsc > buffered.length - 10) {
        const tail = buffered.slice(lastEsc);
        const isComplete =
          /^\x1B\[[0-9;]*[a-zA-Z]/.test(tail) ||
          /^\x1B\].*?(\x07|\x1B\\)/.test(tail) ||
          /^\x1B[a-zA-Z]/.test(tail);
        if (!isComplete && tail.length < 20) {
          rawBufferRef.current = tail;
          buffered = buffered.slice(0, lastEsc);
        } else {
          rawBufferRef.current = '';
        }
      } else {
        rawBufferRef.current = '';
      }

      rawOutputRef.current += buffered;
      setRawOutput(rawOutputRef.current);

      setIsWaiting(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setIsWaiting(true);
        parseOutput(rawOutputRef.current);
      }, 500);
    });

    unsubExitRef.current = window.electronAPI.pty.onExit(sessionId, (code: number) => {
      setIsLive(false);
      setExitCode(code);
      setIsWaiting(false);
      parseOutput(rawOutputRef.current);
    });
  }, [sessionId, parseOutput]);

  // Spawn PTY then subscribe
  const spawn = useCallback(async () => {
    setError(null);
    setExitCode(null);
    rawOutputRef.current = '';
    rawBufferRef.current = '';
    setRawOutput('');
    setMessages([]);
    sentMessagesRef.current = [];

    const result = remote
      ? await window.electronAPI.pty.spawnRemote(sessionId, remote, cwd)
      : await window.electronAPI.pty.spawn(sessionId, cwd);
    if (!result.success) {
      setError(result.error || 'Failed to spawn PTY');
      return false;
    }

    setIsLive(true);
    setIsWaiting(false);
    subscribe();
    return true;
  }, [sessionId, cwd, remote, subscribe]);

  // On mount: spawn or just subscribe if PTY already exists
  useEffect(() => {
    if (skipSpawn) {
      // PTY already spawned externally (e.g. new session) — just subscribe
      setIsLive(true);
      setIsWaiting(false);
      subscribe();
    } else if (autoSpawn) {
      spawn();
    }

    return () => {
      if (unsubDataRef.current) unsubDataRef.current();
      if (unsubExitRef.current) unsubExitRef.current();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [autoSpawn, skipSpawn, spawn, subscribe]);

  // Send message to PTY
  const sendMessage = useCallback(
    (text: string) => {
      if (!isLive) return;
      sentMessagesRef.current.push(text.trim());
      // Keep only last 20 for echo suppression
      if (sentMessagesRef.current.length > 20) {
        sentMessagesRef.current = sentMessagesRef.current.slice(-20);
      }
      // Use bracketed paste mode so Claude Code receives the entire text as
      // a single paste, preventing long text from being split or dropped.
      // Send Enter separately with a delay so Claude Code finishes processing the paste.
      window.electronAPI.pty.write(sessionId, '\x1b[200~' + text + '\x1b[201~');
      setTimeout(() => {
        window.electronAPI.pty.write(sessionId, '\r');
      }, 100);
      setIsWaiting(false);
    },
    [sessionId, isLive]
  );

  const kill = useCallback(() => {
    window.electronAPI.pty.kill(sessionId);
    setIsLive(false);
  }, [sessionId]);

  const resize = useCallback(
    (cols: number, rows: number) => {
      window.electronAPI.pty.resize(sessionId, cols, rows);
    },
    [sessionId]
  );

  return {
    rawOutput,
    messages,
    isLive,
    isWaiting,
    error,
    exitCode,
    sendMessage,
    kill,
    resize,
    spawn,
  };
}
