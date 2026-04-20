import React, { useState, useEffect, useCallback, useRef } from 'react';

interface LiveSessionInfo {
  sessionId: string;
  title: string;
  cwd: string;
  remote?: string;
}

interface OverviewPanelProps {
  isOpen: boolean;
  liveSessions: LiveSessionInfo[];
  activeTabId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

// Strip ANSI for preview text
function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P^_].*?\x1B\\/g, '')
    .replace(/\x1B[()#][A-Za-z0-9]/g, '')
    .replace(/\x1B[a-zA-Z]/g, '')
    .replace(/\x1B/g, '')
    .replace(/\r/g, '');
}

function cleanPreview(str: string): string {
  return stripAnsi(str)
    // Box drawing, spinners, decorations
    .replace(/[╭╮╰╯│├┤┬┴┼─═║╔╗╚╝╠╣╦╩╬▐▛▜▟▙█▌░▒▓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✶✻✽✳✢✦✧⏺⏵·•◆◇●○]/g, '')
    // Claude Code UI lines
    .replace(/^.*auto\s*mode\s*on.*$/gm, '')
    .replace(/^.*shift\+?tab\s*to\s*cycle.*$/gm, '')
    .replace(/^.*esc\s*to\s*interrupt.*$/gm, '')
    .replace(/^.*Orchestrating.*$/gm, '')
    .replace(/^.*running st(art|op) hook.*$/gm, '')
    .replace(/^.*Recent activity.*$/gm, '')
    .replace(/^.*Model:.*$/gm, '')
    .replace(/^.*Context:.*$/gm, '')
    .replace(/^.*Cost:.*$/gm, '')
    .replace(/^.*Tip:.*$/gm, '')
    .replace(/^.*IDE extension install failed.*$/gm, '')
    .replace(/automodeon/g, '')
    .replace(/esctointerrupt/g, '')
    // Prompt chars alone
    .replace(/^[❯>]\s*$/gm, '')
    // Lines of only whitespace/special chars
    .replace(/^[\s─╭╰│┤├]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function OverviewPanel({
  isOpen,
  liveSessions,
  activeTabId,
  onSelect,
  onClose,
}: OverviewPanelProps) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const buffersRef = useRef<Record<string, string>>({});

  const sessionIdKey = liveSessions.map((s) => s.sessionId).join(',');

  // Always subscribe to PTY data so buffers accumulate even when panel is closed
  useEffect(() => {
    const ids = sessionIdKey.split(',').filter(Boolean);
    if (ids.length === 0) return;

    const unsubs: (() => void)[] = [];
    for (const id of ids) {
      if (!buffersRef.current[id]) buffersRef.current[id] = '';
      const unsub = window.electronAPI.pty.onData(id, (data: string) => {
        buffersRef.current[id] = (buffersRef.current[id] + data).slice(-2000);
      });
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [sessionIdKey]);

  // Update preview text only when panel is open
  useEffect(() => {
    if (!isOpen) return;

    // Immediate update on open
    const updatePreviews = () => {
      const ids = sessionIdKey.split(',').filter(Boolean);
      const next: Record<string, string> = {};
      for (const id of ids) {
        const buf = buffersRef.current[id] || '';
        const cleaned = cleanPreview(buf);
        const lines = cleaned.split('\n').filter(Boolean);
        next[id] = lines.slice(-6).join('\n');
      }
      setPreviews((prev) => ({ ...prev, ...next }));
    };

    updatePreviews();
    const interval = setInterval(updatePreviews, 500);

    return () => clearInterval(interval);
  }, [isOpen, sessionIdKey]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      onSelect(sessionId);
      onClose();
    },
    [onSelect, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  if (!isOpen) return null;

  const filtered = search.trim()
    ? liveSessions.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          s.cwd.toLowerCase().includes(search.toLowerCase())
      )
    : liveSessions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[800px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Session Overview</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {liveSessions.length} live session{liveSessions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
          >
            Done
          </button>
        </div>

        {/* Search */}
        {liveSessions.length > 3 && (
          <div className="px-6 py-3 border-b border-slate-800/50 flex-shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter sessions..."
              autoFocus
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Session grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              {search ? 'No matching sessions' : 'No live sessions'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((s) => {
                const isActive = s.sessionId === activeTabId;
                const preview = previews[s.sessionId] || '';
                return (
                  <button
                    key={s.sessionId}
                    onClick={() => handleSelect(s.sessionId)}
                    className={`text-left p-4 rounded-lg border transition-colors hover:bg-slate-800 ${
                      isActive
                        ? 'border-indigo-500 bg-slate-800/50'
                        : 'border-slate-700 bg-slate-850'
                    }`}
                  >
                    {/* Title */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {s.title}
                      </span>
                      {isActive && (
                        <span className="text-xs text-indigo-400 flex-shrink-0">active</span>
                      )}
                    </div>

                    {/* Path */}
                    <div className="text-xs text-slate-500 truncate mb-2">
                      {s.remote && (
                        <span className="text-cyan-500 mr-1">[{s.remote}]</span>
                      )}
                      {s.cwd}
                    </div>

                    {/* Preview */}
                    <div className="bg-slate-950 rounded px-3 py-2 h-24 overflow-hidden">
                      <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                        {preview || 'Waiting for output...'}
                      </pre>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-6 py-2 border-t border-slate-800 text-xs text-slate-600 flex-shrink-0">
          Click a session to switch &middot; Cmd+O to toggle &middot; Escape to close
        </div>
      </div>
    </div>
  );
}
