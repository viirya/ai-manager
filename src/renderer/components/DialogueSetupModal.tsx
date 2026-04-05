import React, { useState, useCallback, useEffect } from 'react';

interface LiveSession {
  sessionId: string;
  title: string;
}

interface DialogueSetupModalProps {
  isOpen: boolean;
  liveSessions: LiveSession[];
  onClose: () => void;
  onConfirm: (config: {
    mode: 'pair' | 'pipeline' | 'broadcast';
    sessionIds: string[];
    sessionLabels: Record<string, string>;
    rolePrompts: Record<string, string>;
    maxTurns: number;
    stopKeyword: string;
    initialMessage: string;
  }) => void;
}

export default function DialogueSetupModal({
  isOpen,
  liveSessions,
  onClose,
  onConfirm,
}: DialogueSetupModalProps) {
  const [mode, setMode] = useState<'pair' | 'pipeline' | 'broadcast'>('pair');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rolePrompts, setRolePrompts] = useState<Record<string, string>>({});
  const [maxTurns, setMaxTurns] = useState(10);
  const [stopKeyword, setStopKeyword] = useState('');
  const [initialMessage, setInitialMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
      setRolePrompts({});
      setMaxTurns(10);
      setStopKeyword('');
      setInitialMessage('');
    }
  }, [isOpen]);

  const toggleSession = useCallback((sid: string) => {
    setSelectedIds((prev) =>
      prev.includes(sid) ? prev.filter((s) => s !== sid) : [...prev, sid]
    );
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedIds.length < 2) return;
    const labels: Record<string, string> = {};
    for (const s of liveSessions) {
      if (selectedIds.includes(s.sessionId)) {
        labels[s.sessionId] = s.title;
      }
    }
    onConfirm({
      mode,
      sessionIds: selectedIds,
      sessionLabels: labels,
      rolePrompts,
      maxTurns: Math.max(1, Math.min(50, maxTurns)),
      stopKeyword,
      initialMessage,
    });
  }, [mode, selectedIds, rolePrompts, maxTurns, stopKeyword, initialMessage, liveSessions, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[560px] max-w-[90vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-200">Start Dialogue</h2>
          <p className="text-sm text-slate-500 mt-1">
            Route responses between two or more live Claude Code sessions
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Mode</label>
            <div className="flex gap-2">
              {(['pair', 'pipeline', 'broadcast'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${
                    mode === m
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-1.5">
              {mode === 'pair' && 'Two sessions take turns responding to each other'}
              {mode === 'pipeline' && 'Responses flow through all sessions in order, then loop'}
              {mode === 'broadcast' && 'Each response is sent to the next session in round-robin'}
            </p>
          </div>

          {/* Session picker */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Sessions <span className="text-slate-600">({selectedIds.length} selected, min 2)</span>
            </label>
            {liveSessions.length < 2 ? (
              <p className="text-sm text-amber-400">
                Need at least 2 live sessions. Open more sessions first.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {liveSessions.map((s) => {
                  const checked = selectedIds.includes(s.sessionId);
                  const order = checked ? selectedIds.indexOf(s.sessionId) + 1 : null;
                  return (
                    <label
                      key={s.sessionId}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        checked ? 'bg-slate-800 border border-indigo-500/50' : 'bg-slate-800/50 border border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSession(s.sessionId)}
                        className="accent-indigo-500"
                      />
                      {order && (
                        <span className="text-xs bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center font-bold">
                          {order}
                        </span>
                      )}
                      <span className="text-sm text-slate-200 truncate">{s.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Role prompts */}
          {selectedIds.length >= 2 && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Role Prompts <span className="text-slate-600">(optional)</span>
              </label>
              <div className="space-y-2">
                {selectedIds.map((sid) => {
                  const session = liveSessions.find((s) => s.sessionId === sid);
                  return (
                    <div key={sid}>
                      <label className="text-xs text-slate-500 mb-0.5 block">{session?.title}</label>
                      <textarea
                        value={rolePrompts[sid] || ''}
                        onChange={(e) => setRolePrompts((p) => ({ ...p, [sid]: e.target.value }))}
                        placeholder="e.g. You are a code reviewer. Critique the code you receive."
                        rows={2}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Initial message */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Initial Message <span className="text-slate-600">(sent to first session to kick off)</span>
            </label>
            <textarea
              value={initialMessage}
              onChange={(e) => setInitialMessage(e.target.value)}
              placeholder="e.g. Write a Python function that sorts a list using merge sort."
              rows={3}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Settings row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Max Turns</label>
              <input
                type="number"
                value={maxTurns}
                onChange={(e) => setMaxTurns(parseInt(e.target.value) || 10)}
                min={1}
                max={50}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Stop Keyword <span className="text-slate-600">(optional)</span>
              </label>
              <input
                type="text"
                value={stopKeyword}
                onChange={(e) => setStopKeyword(e.target.value)}
                placeholder="e.g. DONE"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.length < 2 || !initialMessage.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Start Dialogue
          </button>
        </div>
      </div>
    </div>
  );
}
