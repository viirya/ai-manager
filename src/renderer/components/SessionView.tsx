import React, { useState, useRef, useCallback, useEffect } from 'react';
import RawTerminal from './RawTerminal';
import { usePty, ChatMessage } from '../hooks/usePty';

// ANSI stripper for fallback display
function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P^_].*?\x1B\\/g, '')
    .replace(/\x1B[()#][A-Za-z0-9]/g, '')
    .replace(/\x1B[a-zA-Z]/g, '')
    .replace(/\x1B/g, '');
}

interface SessionViewProps {
  sessionId: string;
  cwd: string;
  active: boolean;
}

// --- Copy button ---
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback via electronAPI if available
      (window as any).electronAPI?.clipboard?.writeText?.(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover/bubble:opacity-100 absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-all"
      title="Copy to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// --- Tool call bubble (collapsible) ---
function ToolBubble({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-slate-700/50 bg-slate-850 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
        >
          <span className="text-amber-500 text-xs font-mono font-bold flex-shrink-0">
            {msg.toolName || 'Tool'}
          </span>
          <span className="text-xs text-slate-500 truncate flex-1">
            {msg.toolSummary || ''}
          </span>
          <span className="text-slate-600 text-xs flex-shrink-0">
            {expanded ? '[-]' : '[+]'}
          </span>
        </button>
        {expanded && (
          <div className="px-3 py-2 border-t border-slate-800 bg-slate-900/50 group/bubble relative">
            <CopyButton text={msg.text} />
            <pre className="text-xs text-slate-400 whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">
              {msg.text.length > 5000 ? msg.text.slice(0, 5000) + '\n\n[... truncated]' : msg.text}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Chat message bubble ---
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [showTime, setShowTime] = useState(false);

  if (msg.role === 'system') {
    return (
      <div className="text-center py-1">
        <span className="text-xs text-slate-600 bg-slate-800/50 px-3 py-1 rounded-full">
          {msg.text}
        </span>
      </div>
    );
  }

  if (msg.role === 'tool') {
    return <ToolBubble msg={msg} />;
  }

  const isUser = msg.role === 'user';
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setShowTime(true)}
      onMouseLeave={() => setShowTime(false)}
    >
      <div
        className={`group/bubble relative max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-800 text-slate-200 border border-slate-700'
        }`}
      >
        <CopyButton text={msg.text} />
        <div className="text-xs font-medium mb-1 opacity-60">
          {isUser ? 'You' : 'Claude'}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed font-mono">
          {msg.text.length > 3000 ? msg.text.slice(0, 3000) + '\n\n[... truncated]' : msg.text}
        </div>
        {/* Timestamp on hover */}
        {showTime && (
          <div
            className={`absolute -bottom-5 text-[10px] text-slate-600 whitespace-nowrap ${
              isUser ? 'right-0' : 'left-0'
            }`}
          >
            {new Date(msg.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Loading / typing indicator ---
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 mr-1">Claude</span>
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// --- Main SessionView ---
export default function SessionView({ sessionId, cwd, active }: SessionViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [inputText, setInputText] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);

  const {
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
  } = usePty({ sessionId, cwd });

  // Auto-scroll: only if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, rawOutput]);

  // Detect user scroll position
  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distFromBottom > 50;
  }, []);

  // Focus input when tab becomes active
  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !isLive) return;
    sendMessage(text);
    setInputText('');
    // Resume auto-scroll on send
    userScrolledUpRef.current = false;
    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [inputText, isLive, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      resize(cols, rows);
    },
    [resize]
  );

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  // Fallback cleaned output
  const cleanedOutput = stripAnsi(rawOutput)
    .replace(/\r/g, '')
    .replace(/\0/g, '')
    .replace(/\n{3,}/g, '\n\n');

  return (
    <div
      className="flex flex-col h-full"
      style={{ display: active ? 'flex' : 'none' }}
    >
      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-900/50 border-b border-red-800 text-red-300 text-sm flex items-center justify-between flex-shrink-0">
          <span>{error}</span>
          <button
            onClick={() => spawn()}
            className="text-xs px-2 py-1 bg-red-800 hover:bg-red-700 rounded"
          >
            Retry
          </button>
        </div>
      )}

      {/* Exit banner */}
      {exitCode !== null && (
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 text-slate-400 text-sm flex items-center justify-between flex-shrink-0">
          <span>Session exited (code {exitCode})</span>
          <button
            onClick={() => spawn()}
            className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
          >
            Respawn
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat panel */}
        <div
          className={`flex flex-col overflow-hidden ${
            showRaw ? 'w-1/2 border-r border-slate-800' : 'w-full'
          }`}
        >
          <div
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {messages.length > 0 ? (
              <>
                {messages.map((msg, i) => (
                  <ChatBubble key={i} msg={msg} />
                ))}
                {/* Typing indicator when Claude is responding */}
                {isLive && !isWaiting && <TypingIndicator />}
              </>
            ) : cleanedOutput ? (
              <div className="text-sm text-slate-300 font-mono whitespace-pre-wrap">
                {cleanedOutput.slice(-5000)}
              </div>
            ) : isLive ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-slate-500 text-sm animate-pulse">
                  Connecting to session...
                </div>
              </div>
            ) : null}

            {/* Scroll-to-bottom anchor */}
            <div ref={chatBottomRef} />
          </div>

          {/* Scroll-to-bottom button (when user scrolled up) */}
          {userScrolledUpRef.current && (
            <button
              onClick={() => {
                userScrolledUpRef.current = false;
                chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="absolute bottom-20 right-6 z-10 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-full shadow-lg transition-colors"
            >
              Scroll to bottom
            </button>
          )}
        </div>

        {/* Raw terminal panel */}
        {showRaw && (
          <div className="w-1/2 flex flex-col">
            <RawTerminal sessionId={sessionId} onResize={handleResize} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-slate-800 bg-slate-900 p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isLive
                  ? isWaiting
                    ? 'Type a message...'
                    : 'Claude is responding...'
                  : 'Session not connected'
              }
              disabled={!isLive}
              rows={1}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-none disabled:opacity-50"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!isLive || !inputText.trim()}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Send
          </button>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`px-3 py-2.5 text-sm rounded-lg transition-colors ${
              showRaw
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
            title="Toggle raw terminal"
          >
            {showRaw ? 'Hide Raw' : 'Raw'}
          </button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                isLive
                  ? isWaiting
                    ? 'bg-green-400'
                    : 'bg-yellow-400 animate-pulse'
                  : 'bg-slate-600'
              }`}
            />
            {isLive ? (isWaiting ? 'Ready' : 'Responding...') : 'Disconnected'}
          </span>
          {isLive && (
            <button
              onClick={kill}
              className="text-red-500 hover:text-red-400 transition-colors"
            >
              Kill
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
