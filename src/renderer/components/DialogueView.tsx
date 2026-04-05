import React, { useState, useEffect, useRef, useCallback } from 'react';

interface DialogueTurn {
  sessionId: string;
  sessionLabel: string;
  text: string;
  timestamp: number;
  turnNumber: number;
}

interface DialogueSnapshot {
  id: string;
  mode: string;
  sessionIds: string[];
  sessionLabels: Record<string, string>;
  currentTurnIndex: number;
  maxTurns: number;
  turnCount: number;
  status: 'running' | 'paused' | 'stopped';
  transcript: DialogueTurn[];
  activeSessionId: string | null;
}

// Assign consistent colors to sessions
const SESSION_COLORS = [
  { border: 'border-blue-500', bg: 'bg-blue-500/10', label: 'text-blue-400' },
  { border: 'border-emerald-500', bg: 'bg-emerald-500/10', label: 'text-emerald-400' },
  { border: 'border-amber-500', bg: 'bg-amber-500/10', label: 'text-amber-400' },
  { border: 'border-purple-500', bg: 'bg-purple-500/10', label: 'text-purple-400' },
  { border: 'border-rose-500', bg: 'bg-rose-500/10', label: 'text-rose-400' },
];

interface DialogueViewProps {
  dialogueId: string;
  active: boolean;
}

export default function DialogueView({ dialogueId, active }: DialogueViewProps) {
  const [snapshot, setSnapshot] = useState<DialogueSnapshot | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Load initial state and subscribe to updates
  useEffect(() => {
    window.electronAPI.dialogue.get(dialogueId).then((s: DialogueSnapshot | null) => {
      if (s) setSnapshot(s);
    });

    const unsub = window.electronAPI.dialogue.onUpdate((s: DialogueSnapshot) => {
      if (s.id === dialogueId) setSnapshot(s);
    });

    return unsub;
  }, [dialogueId]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [snapshot?.transcript.length]);

  const handlePause = useCallback(() => {
    window.electronAPI.dialogue.pause(dialogueId);
  }, [dialogueId]);

  const handleResume = useCallback(() => {
    window.electronAPI.dialogue.resume(dialogueId);
  }, [dialogueId]);

  const handleStop = useCallback(() => {
    window.electronAPI.dialogue.stop(dialogueId);
  }, [dialogueId]);

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-full" style={{ display: active ? 'flex' : 'none' }}>
        <div className="text-slate-500 animate-pulse">Loading dialogue...</div>
      </div>
    );
  }

  // Map session IDs to color indices
  const colorMap: Record<string, number> = {};
  snapshot.sessionIds.forEach((sid, i) => {
    colorMap[sid] = i % SESSION_COLORS.length;
  });

  return (
    <div className="flex flex-col h-full" style={{ visibility: active ? 'visible' : 'hidden' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-200">
            Dialogue: {snapshot.sessionIds.map(sid => snapshot.sessionLabels[sid] || sid.slice(0, 8)).join(' ↔ ')}
          </span>
          <span className="text-xs text-slate-500">
            Turn {snapshot.turnCount} / {snapshot.maxTurns}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            snapshot.status === 'running' ? 'bg-green-500/20 text-green-400' :
            snapshot.status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
            'bg-slate-700 text-slate-400'
          }`}>
            {snapshot.status}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {snapshot.status === 'running' && (
            <button
              onClick={handlePause}
              className="text-xs px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/30 rounded-lg transition-colors"
            >
              Pause
            </button>
          )}
          {snapshot.status === 'paused' && (
            <button
              onClick={handleResume}
              className="text-xs px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 rounded-lg transition-colors"
            >
              Resume
            </button>
          )}
          {snapshot.status !== 'stopped' && (
            <button
              onClick={handleStop}
              className="text-xs px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg transition-colors"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Participant indicators */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/50 flex-shrink-0">
        {snapshot.sessionIds.map((sid) => {
          const color = SESSION_COLORS[colorMap[sid]];
          const isActive = sid === snapshot.activeSessionId;
          return (
            <div
              key={sid}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${color.border} ${color.bg} ${
                isActive ? 'ring-1 ring-offset-1 ring-offset-slate-900 ring-current' : 'opacity-60'
              }`}
            >
              {isActive && snapshot.status === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              )}
              <span className={color.label}>
                {snapshot.sessionLabels[sid] || sid.slice(0, 8)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {snapshot.transcript.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-500 text-sm animate-pulse">Waiting for first response...</div>
          </div>
        ) : (
          snapshot.transcript.map((turn, i) => {
            if (turn.sessionId === 'system') {
              return (
                <div key={i} className="text-center py-2">
                  <span className="text-xs text-slate-600 bg-slate-800/50 px-3 py-1 rounded-full">
                    {turn.text}
                  </span>
                </div>
              );
            }

            const color = SESSION_COLORS[colorMap[turn.sessionId] ?? 0];
            return (
              <div key={i} className={`rounded-lg border-l-2 ${color.border} ${color.bg} px-4 py-3`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium ${color.label}`}>
                    {turn.sessionLabel}
                  </span>
                  <span className="text-xs text-slate-600">
                    Turn {turn.turnNumber} &middot; {new Date(turn.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
                  {turn.text.length > 5000 ? turn.text.slice(0, 5000) + '\n\n[... truncated]' : turn.text}
                </div>
              </div>
            );
          })
        )}

        {/* Active session indicator */}
        {snapshot.status === 'running' && snapshot.activeSessionId && (
          <div className="flex items-center gap-2 text-sm text-slate-500 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            {snapshot.sessionLabels[snapshot.activeSessionId] || snapshot.activeSessionId} is thinking...
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>
    </div>
  );
}
