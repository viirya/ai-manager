import React, { useState, useCallback, useEffect, useRef } from 'react';

interface RemoteHost {
  name: string;
  user: string;
  host: string;
}

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (cwd: string, title: string, remote?: string) => void;
}

export default function NewSessionModal({ isOpen, onClose, onConfirm }: NewSessionModalProps) {
  const [cwd, setCwd] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
  const [selectedHost, setSelectedHost] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      window.electronAPI.store.get('settings.defaultWorkingDirectory').then((val) => {
        if (val && typeof val === 'string') setCwd(val);
      });
      window.electronAPI.store.get('remoteHosts').then((val) => {
        if (Array.isArray(val)) {
          const hosts = val as RemoteHost[];
          setRemoteHosts(hosts);
          if (hosts.length > 0) {
            setSelectedHost(`${hosts[0].user}@${hosts[0].host}`);
          }
        }
      });
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setCwd('');
      setTitle('');
      setMode('local');
    }
  }, [isOpen]);

  const handleBrowse = useCallback(async () => {
    const dir = await window.electronAPI.app.openDirectory();
    if (dir) setCwd(dir);
  }, []);

  const handleConfirm = useCallback(() => {
    if (mode === 'remote') {
      onConfirm(cwd, title, selectedHost);
    } else {
      onConfirm(cwd, title);
    }
  }, [cwd, title, mode, selectedHost, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
      if (e.key === 'Escape') onClose();
    },
    [handleConfirm, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[480px] max-w-[90vw]">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-200">New Session</h2>
          <p className="text-sm text-slate-500 mt-1">
            Start a new Claude Code session
          </p>
        </div>

        <div className="px-6 py-4 space-y-4" onKeyDown={handleKeyDown}>
          {/* Local / Remote toggle */}
          {remoteHosts.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Location</label>
              <div className="flex gap-2">
                {(['local', 'remote'] as const).map((m) => (
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
            </div>
          )}

          {/* Remote host picker */}
          {mode === 'remote' && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Remote Host</label>
              <select
                value={selectedHost}
                onChange={(e) => setSelectedHost(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {remoteHosts.map((h) => {
                  const key = `${h.user}@${h.host}`;
                  return (
                    <option key={key} value={key}>
                      {h.name || key}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Working directory */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Working Directory {mode === 'remote' && <span className="text-slate-600">(remote path)</span>}
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={mode === 'remote' ? '/home/user/project' : '~/projects/my-app'}
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {mode === 'local' && (
                <button
                  onClick={handleBrowse}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  Browse
                </button>
              )}
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
