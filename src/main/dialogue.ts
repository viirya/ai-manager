import { BrowserWindow } from 'electron';
import { onPtyData, onPtyExit, writeToSession, isSessionLive } from './pty';

// =============================================
// Types
// =============================================

export type DialogueMode = 'pair' | 'pipeline' | 'broadcast';
export type DialogueStatus = 'running' | 'paused' | 'stopped';

export interface DialogueTurn {
  sessionId: string;
  sessionLabel: string;
  text: string;
  timestamp: number;
  turnNumber: number;
}

export interface DialogueConfig {
  mode: DialogueMode;
  sessionIds: string[];
  sessionLabels: Record<string, string>; // sessionId -> display name
  rolePrompts: Record<string, string>;   // sessionId -> initial prompt (optional)
  maxTurns: number;
  stopKeyword: string;                    // empty = no keyword stop
  initialMessage: string;                 // first message to send to first session
}

export interface DialogueState {
  id: string;
  mode: DialogueMode;
  sessionIds: string[];
  sessionLabels: Record<string, string>;
  currentTurnIndex: number;     // index into sessionIds for current speaker
  maxTurns: number;
  turnCount: number;
  status: DialogueStatus;
  transcript: DialogueTurn[];
  stopKeyword: string;
  activeSessionId: string | null; // which session is currently "thinking"
}

// Serializable snapshot for the renderer
export interface DialogueSnapshot {
  id: string;
  mode: DialogueMode;
  sessionIds: string[];
  sessionLabels: Record<string, string>;
  currentTurnIndex: number;
  maxTurns: number;
  turnCount: number;
  status: DialogueStatus;
  transcript: DialogueTurn[];
  activeSessionId: string | null;
}

// =============================================
// ANSI stripper for extracting clean text
// =============================================

function stripAnsi(str: string): string {
  return str
    // CSI sequences: ESC [ (params) (intermediate) final — covers ?, >, <, = prefixes
    .replace(/\x1B\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    // OSC sequences: ESC ] ... BEL or ESC ] ... ST
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    // DCS/PM/APC: ESC P ... ST, ESC ^ ... ST, ESC _ ... ST
    .replace(/\x1B[P^_].*?\x1B\\/g, '')
    // Charset selects: ESC ( X, ESC ) X, ESC # X
    .replace(/\x1B[()#][A-Za-z0-9]/g, '')
    // Single-char escapes: ESC followed by one char
    .replace(/\x1B[a-zA-Z]/g, '')
    // Any remaining bare ESC
    .replace(/\x1B/g, '')
    // Carriage returns, null bytes
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '')
    // Backspace-overwrite sequences
    .replace(/.\x08/g, '');
}

// Remove Claude Code UI artifacts from cleaned text
function stripClaudeUI(str: string): string {
  return str
    // Box drawing characters
    .replace(/[╭╮╰╯│├┤┬┴┼─═║╔╗╚╝╠╣╦╩╬▐▛▜▟▙█▌░▒▓]/g, '')
    // Spinner / braille characters
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '')
    // Claude Code thinking/response decorations
    .replace(/[✶✻✽✳✢✦✧⏺·•◦◆◇●○◐◑⚡★☆⬤⬡⊛⊕⊗⊙]/g, '')
    // Claude Code status/UI lines
    .replace(/^.*auto mode on.*$/gm, '')
    .replace(/^.*shift\+tab to cycle.*$/gm, '')
    .replace(/^.*esc to interrupt.*$/gm, '')
    .replace(/^.*Recent activity.*$/gm, '')
    .replace(/^.*Session resumed.*$/gm, '')
    .replace(/^.*Resuming session.*$/gm, '')
    .replace(/^.*Claude Code.*$/gm, '')
    .replace(/^.*Model:.*$/gm, '')
    .replace(/^.*Context:.*$/gm, '')
    .replace(/^.*Cost:.*$/gm, '')
    .replace(/^.*Tip:.*$/gm, '')
    .replace(/^.*Type \/help.*$/gm, '')
    .replace(/^.*IDE extension install failed.*$/gm, '')
    .replace(/^.*to interrupt.*$/gm, '')
    .replace(/^.*auto\s*mode\s*on.*$/gm, '')
    .replace(/^.*shift\s*\+?\s*tab\s*to\s*cycle.*$/gm, '')
    .replace(/^.*Orchestrating.*$/gm, '')
    .replace(/^.*running stop hook.*$/gm, '')
    .replace(/^.*running start hook.*$/gm, '')
    .replace(/^.*⏵.*$/gm, '')
    // Common UI fragments that survive ANSI stripping with spaces eaten
    .replace(/automodeon/g, '')
    .replace(/esctointerrupt/g, '')
    .replace(/shift\+?tabtocycle/g, '')
    // Prompt characters on their own line
    .replace(/^[❯>]\s*$/gm, '')
    // Lines that are only whitespace or special chars
    .replace(/^[\s│─╭╰┤├·✶✻✽✳✢⏺]*$/gm, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// =============================================
// DialogueManager
// =============================================

export class DialogueManager {
  private dialogues = new Map<string, DialogueState>();
  private outputBuffers = new Map<string, string>();  // sessionId -> accumulated output since last send
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private collectingOutput = new Set<string>(); // sessions currently collecting response output
  private unsubData: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private window: BrowserWindow | null = null;
  private nextId = 1;

  // Sessions currently participating in any dialogue
  private sessionToDialogue = new Map<string, string>(); // sessionId -> dialogueId

  constructor() {
    // Subscribe to PTY events
    this.unsubData = onPtyData((sessionId, data) => {
      this.handlePtyData(sessionId, data);
    });
    this.unsubExit = onPtyExit((sessionId, _exitCode) => {
      this.handlePtyExit(sessionId);
    });
  }

  setWindow(win: BrowserWindow) {
    this.window = win;
  }

  destroy() {
    if (this.unsubData) this.unsubData();
    if (this.unsubExit) this.unsubExit();
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
  }

  // ---- Public API ----

  startDialogue(config: DialogueConfig): { success: boolean; dialogueId?: string; error?: string } {
    // Validate
    if (config.sessionIds.length < 2) {
      return { success: false, error: 'Need at least 2 sessions' };
    }
    for (const sid of config.sessionIds) {
      if (!isSessionLive(sid)) {
        return { success: false, error: `Session ${sid} is not live` };
      }
      if (this.sessionToDialogue.has(sid)) {
        return { success: false, error: `Session ${config.sessionLabels[sid] || sid} is already in a dialogue` };
      }
    }

    const id = `dialogue-${this.nextId++}`;
    const state: DialogueState = {
      id,
      mode: config.mode,
      sessionIds: config.sessionIds,
      sessionLabels: config.sessionLabels,
      currentTurnIndex: 0,
      maxTurns: config.maxTurns || 10,
      turnCount: 0,
      status: 'running',
      transcript: [],
      stopKeyword: config.stopKeyword || '',
      activeSessionId: null,
    };

    this.dialogues.set(id, state);
    for (const sid of config.sessionIds) {
      this.sessionToDialogue.set(sid, id);
      this.outputBuffers.set(sid, '');
    }

    // Send role prompts first, then kick off the dialogue
    this.sendRolePrompts(id, config.rolePrompts, config.initialMessage);

    return { success: true, dialogueId: id };
  }

  pauseDialogue(dialogueId: string): boolean {
    const state = this.dialogues.get(dialogueId);
    if (!state || state.status !== 'running') return false;
    state.status = 'paused';
    this.emitUpdate(dialogueId);
    return true;
  }

  resumeDialogue(dialogueId: string): boolean {
    const state = this.dialogues.get(dialogueId);
    if (!state || state.status !== 'paused') return false;
    state.status = 'running';
    this.emitUpdate(dialogueId);
    // Re-trigger routing if there's buffered output
    const currentSid = state.sessionIds[state.currentTurnIndex];
    const buffer = this.outputBuffers.get(currentSid) || '';
    if (buffer.trim()) {
      this.routeOutput(dialogueId);
    }
    return true;
  }

  stopDialogue(dialogueId: string): boolean {
    const state = this.dialogues.get(dialogueId);
    if (!state) return false;
    state.status = 'stopped';
    state.activeSessionId = null;
    // Clean up
    for (const sid of state.sessionIds) {
      this.sessionToDialogue.delete(sid);
      this.outputBuffers.delete(sid);
      this.collectingOutput.delete(sid);
      const timer = this.idleTimers.get(sid);
      if (timer) { clearTimeout(timer); this.idleTimers.delete(sid); }
    }
    this.emitUpdate(dialogueId);
    return true;
  }

  listDialogues(): DialogueSnapshot[] {
    return Array.from(this.dialogues.values()).map(s => this.toSnapshot(s));
  }

  getDialogue(dialogueId: string): DialogueSnapshot | null {
    const state = this.dialogues.get(dialogueId);
    return state ? this.toSnapshot(state) : null;
  }

  isSessionInDialogue(sessionId: string): string | null {
    return this.sessionToDialogue.get(sessionId) || null;
  }

  // ---- Internal ----

  private async sendRolePrompts(dialogueId: string, rolePrompts: Record<string, string>, initialMessage: string) {
    const state = this.dialogues.get(dialogueId);
    if (!state) return;

    // Send role prompts sequentially (wait for each to be "idle" before next)
    for (const sid of state.sessionIds) {
      const prompt = rolePrompts[sid];
      if (prompt && prompt.trim()) {
        writeToSession(sid, prompt.trim() + '\r');
        await this.waitForIdle(sid, 8000);
        this.outputBuffers.set(sid, '');
      }
    }

    // Now start the actual dialogue: send initial message to the first session
    const firstSid = state.sessionIds[0];
    state.activeSessionId = firstSid;
    state.currentTurnIndex = 0;
    this.emitUpdate(dialogueId);

    if (initialMessage.trim()) {
      this.sendAndCollect(firstSid, initialMessage.trim());
    }
  }

  // Send input to a session and start collecting output after a delay
  // to skip the PTY echo of the input text and Claude Code UI elements
  private sendAndCollect(sessionId: string, text: string) {
    this.collectingOutput.delete(sessionId);
    this.outputBuffers.set(sessionId, '');
    writeToSession(sessionId, text + '\r');

    // Wait 1.5s for input echo + Claude Code UI to settle, then start collecting
    setTimeout(() => {
      this.outputBuffers.set(sessionId, '');
      this.collectingOutput.add(sessionId);
    }, 1500);
  }

  private waitForIdle(sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const existing = this.idleTimers.get(sessionId);
      if (existing) clearTimeout(existing);

      let resolved = false;
      const idleHandler = () => {
        if (!resolved) { resolved = true; resolve(); }
      };

      // Set a temporary idle detection
      this.idleTimers.set(sessionId, setTimeout(idleHandler, 800));

      // Also set a hard timeout
      setTimeout(() => {
        if (!resolved) { resolved = true; resolve(); }
      }, timeoutMs);
    });
  }

  private handlePtyData(sessionId: string, data: string) {
    const dialogueId = this.sessionToDialogue.get(sessionId);
    if (!dialogueId) return;

    const state = this.dialogues.get(dialogueId);
    if (!state || state.status !== 'running') return;

    // Only accumulate output for the currently active session
    if (sessionId !== state.activeSessionId) return;

    // Only accumulate if we're past the input-echo phase
    if (!this.collectingOutput.has(sessionId)) return;

    // Accumulate output
    const buf = (this.outputBuffers.get(sessionId) || '') + data;
    this.outputBuffers.set(sessionId, buf);

    // Reset idle timer
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    // Check if output looks like Claude finished (prompt char at end of cleaned output)
    const cleaned = stripAnsi(buf);
    const hasPrompt = /[❯>]\s*$/.test(cleaned.trimEnd());

    // Use shorter timeout if we see a prompt (Claude is done), longer otherwise
    // Claude can pause mid-response, so we need a generous timeout
    const timeout = hasPrompt ? 1000 : 3000;

    this.idleTimers.set(sessionId, setTimeout(() => {
      this.idleTimers.delete(sessionId);
      this.routeOutput(dialogueId);
    }, timeout));
  }

  private handlePtyExit(sessionId: string) {
    const dialogueId = this.sessionToDialogue.get(sessionId);
    if (!dialogueId) return;

    const state = this.dialogues.get(dialogueId);
    if (!state) return;

    // A session died — stop the dialogue
    const label = state.sessionLabels[sessionId] || sessionId;
    state.transcript.push({
      sessionId,
      sessionLabel: label,
      text: `[Session "${label}" exited unexpectedly]`,
      timestamp: Date.now(),
      turnNumber: state.turnCount,
    });
    this.stopDialogue(dialogueId);
  }

  private routeOutput(dialogueId: string) {
    const state = this.dialogues.get(dialogueId);
    if (!state || state.status !== 'running') return;

    const currentSid = state.activeSessionId;
    if (!currentSid) return;

    const rawOutput = this.outputBuffers.get(currentSid) || '';
    const cleanedOutput = stripClaudeUI(stripAnsi(rawOutput));

    if (!cleanedOutput) return;

    // Record turn in transcript
    const label = state.sessionLabels[currentSid] || currentSid;
    state.turnCount++;
    state.transcript.push({
      sessionId: currentSid,
      sessionLabel: label,
      text: cleanedOutput,
      timestamp: Date.now(),
      turnNumber: state.turnCount,
    });

    // Check stop conditions
    if (state.turnCount >= state.maxTurns) {
      state.transcript.push({
        sessionId: 'system',
        sessionLabel: 'System',
        text: `Dialogue stopped: reached max turns (${state.maxTurns})`,
        timestamp: Date.now(),
        turnNumber: state.turnCount,
      });
      this.stopDialogue(dialogueId);
      return;
    }

    if (state.stopKeyword && cleanedOutput.toLowerCase().includes(state.stopKeyword.toLowerCase())) {
      state.transcript.push({
        sessionId: 'system',
        sessionLabel: 'System',
        text: `Dialogue stopped: stop keyword "${state.stopKeyword}" detected`,
        timestamp: Date.now(),
        turnNumber: state.turnCount,
      });
      this.stopDialogue(dialogueId);
      return;
    }

    // Determine next session
    let nextIndex: number;
    if (state.mode === 'pair') {
      // Ping-pong between two sessions
      nextIndex = (state.currentTurnIndex + 1) % state.sessionIds.length;
    } else if (state.mode === 'pipeline') {
      // Round-robin through all sessions
      nextIndex = (state.currentTurnIndex + 1) % state.sessionIds.length;
    } else {
      // broadcast: send to all other sessions, wait for first to respond
      // For simplicity, treat like pipeline
      nextIndex = (state.currentTurnIndex + 1) % state.sessionIds.length;
    }

    const nextSid = state.sessionIds[nextIndex];

    // Check next session is still alive
    if (!isSessionLive(nextSid)) {
      const nextLabel = state.sessionLabels[nextSid] || nextSid;
      state.transcript.push({
        sessionId: 'system',
        sessionLabel: 'System',
        text: `Dialogue stopped: session "${nextLabel}" is no longer live`,
        timestamp: Date.now(),
        turnNumber: state.turnCount,
      });
      this.stopDialogue(dialogueId);
      return;
    }

    // Route output to next session
    state.currentTurnIndex = nextIndex;
    state.activeSessionId = nextSid;
    this.collectingOutput.delete(currentSid);

    // Format the message with attribution and send
    const attribution = `[Session "${label}" says]:\n${cleanedOutput}`;
    this.sendAndCollect(nextSid, attribution);

    this.emitUpdate(dialogueId);
  }

  private emitUpdate(dialogueId: string) {
    const state = this.dialogues.get(dialogueId);
    if (!state || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('dialogue:update', this.toSnapshot(state));
  }

  private toSnapshot(state: DialogueState): DialogueSnapshot {
    return {
      id: state.id,
      mode: state.mode,
      sessionIds: state.sessionIds,
      sessionLabels: state.sessionLabels,
      currentTurnIndex: state.currentTurnIndex,
      maxTurns: state.maxTurns,
      turnCount: state.turnCount,
      status: state.status,
      transcript: [...state.transcript],
      activeSessionId: state.activeSessionId,
    };
  }
}
