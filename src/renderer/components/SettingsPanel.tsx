import React, { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Section = 'general' | 'appearance' | 'sessions' | 'danger';

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [section, setSection] = useState<Section>('general');
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [detectedPath, setDetectedPath] = useState('');

  // Load settings on open
  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI.store.get('settings').then((val) => {
      if (val && typeof val === 'object') {
        setSettings({ ...DEFAULT_SETTINGS, ...(val as Partial<AppSettings>) });
      }
    });
    window.electronAPI.app.getClaudePath().then(setDetectedPath);
    setVerifyResult(null);
  }, [isOpen]);

  const save = useCallback(
    (key: keyof AppSettings, value: any) => {
      const next = { ...settings, [key]: value };
      setSettings(next);
      window.electronAPI.store.set('settings', next);
    },
    [settings]
  );

  const handleBrowseCwd = useCallback(async () => {
    const dir = await window.electronAPI.app.openDirectory();
    if (dir) save('defaultWorkingDirectory', dir);
  }, [save]);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyResult(null);
    const p = settings.claudeBinaryPath || detectedPath;
    const result = await window.electronAPI.app.verifyClaudeBinary(p);
    setVerifyResult(result);
    setVerifying(false);
  }, [settings.claudeBinaryPath, detectedPath]);

  const handleClearMeta = useCallback(async () => {
    if (confirm('Clear all custom session metadata (renames, pins, archives)? This cannot be undone.')) {
      await window.electronAPI.store.set('sessionMeta', {});
      alert('Session metadata cleared. Refresh the app to see changes.');
    }
  }, []);

  const handleResetSettings = useCallback(async () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      setSettings({ ...DEFAULT_SETTINGS });
      await window.electronAPI.store.set('settings', { ...DEFAULT_SETTINGS });
    }
  }, []);

  if (!isOpen) return null;

  const navItems: { key: Section; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'sessions', label: 'Session Defaults' },
    { key: 'danger', label: 'Danger Zone' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-200">Settings</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
          >
            Done
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Nav sidebar */}
          <div className="w-40 border-r border-slate-800 py-2 flex-shrink-0">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setSection(item.key)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  section === item.key
                    ? 'bg-slate-800 text-slate-200 font-medium'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {section === 'general' && (
              <>
                {/* Claude binary path */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Claude Binary Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.claudeBinaryPath}
                      onChange={(e) => save('claudeBinaryPath', e.target.value)}
                      placeholder={detectedPath || 'Auto-detect from $PATH'}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      onClick={handleVerify}
                      disabled={verifying}
                      className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                      {verifying ? '...' : 'Verify'}
                    </button>
                  </div>
                  {detectedPath && !settings.claudeBinaryPath && (
                    <p className="text-xs text-slate-600 mt-1">
                      Auto-detected: {detectedPath}
                    </p>
                  )}
                  {verifyResult && (
                    <p
                      className={`text-xs mt-1 ${
                        verifyResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'
                      }`}
                    >
                      {verifyResult}
                    </p>
                  )}
                </div>

                {/* Default working directory */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Default Working Directory
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.defaultWorkingDirectory}
                      onChange={(e) => save('defaultWorkingDirectory', e.target.value)}
                      placeholder="~ (home directory)"
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      onClick={handleBrowseCwd}
                      className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                    >
                      Browse
                    </button>
                  </div>
                </div>
              </>
            )}

            {section === 'appearance' && (
              <>
                {/* Theme */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Theme
                  </label>
                  <div className="flex gap-2">
                    {(['dark', 'light', 'system'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => save('theme', t)}
                        className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${
                          settings.theme === t
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Chat font size */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Chat Font Size
                  </label>
                  <div className="flex gap-2">
                    {(['small', 'medium', 'large'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => save('chatFontSize', s)}
                        className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${
                          settings.chatFontSize === s
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Terminal font size */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Terminal Font Size: {settings.terminalFontSize}px
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={20}
                    value={settings.terminalFontSize}
                    onChange={(e) => save('terminalFontSize', parseInt(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-600 mt-1">
                    <span>10px</span>
                    <span>20px</span>
                  </div>
                </div>
              </>
            )}

            {section === 'sessions' && (
              <>
                {/* Auto-scroll */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Auto-scroll Behavior
                  </label>
                  <div className="flex gap-2">
                    {([
                      { key: 'always', label: 'Always scroll' },
                      { key: 'pause-on-scroll-up', label: 'Pause when scrolled up' },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => save('autoScroll', key)}
                        className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                          settings.autoScroll === key
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Show raw by default */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-slate-300">
                      Show Raw Terminal by Default
                    </label>
                    <p className="text-xs text-slate-600 mt-0.5">
                      New sessions open with the raw terminal panel visible
                    </p>
                  </div>
                  <button
                    onClick={() => save('showRawByDefault', !settings.showRawByDefault)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      settings.showRawByDefault ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        settings.showRawByDefault ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </>
            )}

            {section === 'danger' && (
              <>
                <div className="border border-red-900/50 rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-red-400">
                        Clear All Custom Metadata
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Removes all custom session names, pins, and archives
                      </p>
                    </div>
                    <button
                      onClick={handleClearMeta}
                      className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900 border border-red-800 text-red-400 text-sm rounded-lg transition-colors"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="border-t border-red-900/30" />

                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-red-400">
                        Reset Settings to Defaults
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Restores all settings to their default values
                      </p>
                    </div>
                    <button
                      onClick={handleResetSettings}
                      className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900 border border-red-800 text-red-400 text-sm rounded-lg transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
