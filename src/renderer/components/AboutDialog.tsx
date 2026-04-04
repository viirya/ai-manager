import React, { useState, useEffect } from 'react';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
  const [appVersion, setAppVersion] = useState('');
  const [claudeVersion, setClaudeVersion] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI.app.getVersion().then(setAppVersion);
    window.electronAPI.app.getClaudeVersion().then(setClaudeVersion);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[360px] text-center p-8">
        <div className="text-4xl mb-4 opacity-30">~</div>
        <h2 className="text-lg font-bold text-slate-200">Claude Code Manager</h2>
        <p className="text-sm text-slate-500 mt-1">v{appVersion}</p>

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between px-4">
            <span className="text-slate-500">Claude Code</span>
            <span className="text-slate-300 font-mono text-xs">{claudeVersion || '...'}</span>
          </div>
          <div className="flex justify-between px-4">
            <span className="text-slate-500">Electron</span>
            <span className="text-slate-300 font-mono text-xs">{process.versions?.electron || 'N/A'}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-6 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
