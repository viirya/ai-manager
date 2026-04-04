import React, { useState, useCallback, useEffect, useRef } from 'react';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (cwd: string, title: string) => void;
}

export default function NewSessionModal({ isOpen, onClose, onConfirm }: NewSessionModalProps) {
  const [cwd, setCwd] = useState('');
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the cwd input when modal opens
  useEffect(() => {
    if (isOpen) {
      // Load default working directory
      window.electronAPI.store.get('settings.defaultWorkingDirectory').then((val) => {
        if (val && typeof val === 'string') {
          setCwd(val);
        }
      });
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setCwd('');
      setTitle('');
    }
  }, [isOpen]);

  const handleBrowse = useCallback(async () => {
    const dir = await window.electronAPI.app.openDirectory();
    if (dir) {
      setCwd(dir);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(cwd, title);
  }, [cwd, title, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleConfirm, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[480px] max-w-[90vw]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-200">New Session</h2>
          <p className="text-sm text-slate-500 mt-1">
            Start a new Claude Code session in a working directory
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4" onKeyDown={handleKeyDown}>
          {/* Working directory */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Working Directory
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="~/projects/my-app"
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <button
                onClick={handleBrowse}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
              >
                Browse
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Leave empty to use home directory
            </p>
          </div>

          {/* Session title */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Session Name <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-generated from first message"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Create Session
          </button>
        </div>
      </div>
    </div>
  );
}
