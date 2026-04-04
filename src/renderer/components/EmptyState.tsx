import React from 'react';

interface EmptyStateProps {
  hasSessions: boolean;
  onNewSession?: () => void;
}

export default function EmptyState({ hasSessions, onNewSession }: EmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-slate-900 h-full">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6 opacity-20">~</div>
        <h2 className="text-xl font-semibold text-slate-300 mb-2">
          {hasSessions ? 'Claude Code Manager' : 'Welcome to Claude Code Manager'}
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          {hasSessions
            ? 'Select a session from the sidebar to view its conversation, or create a new one.'
            : 'No Claude Code sessions found. Start your first session to get going.'}
        </p>

        {!hasSessions && onNewSession && (
          <button
            onClick={onNewSession}
            className="mt-6 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Start Your First Session
          </button>
        )}

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">Cmd+T</kbd>
            New session
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">Cmd+F</kbd>
            Search
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">Cmd+,</kbd>
            Settings
          </span>
        </div>
      </div>
    </div>
  );
}
