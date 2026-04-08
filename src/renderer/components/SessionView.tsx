import React, { useState, useRef, useCallback, useEffect } from 'react';
import RawTerminal from './RawTerminal';
import { usePty } from '../hooks/usePty';

interface SessionViewProps {
  sessionId: string;
  cwd: string;
  active: boolean;
  alreadySpawned?: boolean;
}

export default function SessionView({ sessionId, cwd, active, alreadySpawned }: SessionViewProps) {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    isLive,
    isWaiting,
    error,
    exitCode,
    sendMessage,
    kill,
    resize,
    spawn,
  } = usePty({ sessionId, cwd, skipSpawn: alreadySpawned });

  // Focus input when tab becomes active
  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef(''); // saves current input when starting to browse history

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !isLive) return;
    inputHistoryRef.current.push(text);
    historyIndexRef.current = -1;
    sendMessage(text);
    setInputText('');
  }, [inputText, isLive, sendMessage]);

  const composingRef = useRef(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (composingRef.current) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Arrow Up: browse input history, save current input on first press
      if (e.key === 'ArrowUp' && inputHistoryRef.current.length > 0) {
        e.preventDefault();
        const history = inputHistoryRef.current;
        if (historyIndexRef.current === -1) {
          savedInputRef.current = (e.target as HTMLTextAreaElement).value;
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        }
        setInputText(history[historyIndexRef.current]);
      }
      // Arrow Down: only when browsing history
      if (e.key === 'ArrowDown' && historyIndexRef.current !== -1) {
        e.preventDefault();
        const history = inputHistoryRef.current;
        if (historyIndexRef.current < history.length - 1) {
          historyIndexRef.current++;
          setInputText(history[historyIndexRef.current]);
        } else {
          // Back to the saved input
          historyIndexRef.current = -1;
          setInputText(savedInputRef.current);
          savedInputRef.current = '';
        }
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

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  return (
    <div className="flex flex-col h-full">
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

      {/* Terminal — full width, primary view */}
      <div className="flex-1 overflow-hidden">
        <RawTerminal sessionId={sessionId} active={active} onResize={handleResize} />
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
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
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
