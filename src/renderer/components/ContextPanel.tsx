import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as pathLib from 'path';

interface ContextPanelProps {
  cwd: string;
  onClose: () => void;
}

export default function ContextPanel({ cwd, onClose }: ContextPanelProps) {
  const [content, setContent] = useState('');
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filePath = cwd ? `${cwd}/CLAUDE.md` : '';

  // Load CLAUDE.md on mount or when cwd changes
  useEffect(() => {
    if (!filePath) return;
    setError(null);
    setSaved(false);
    setDirty(false);
    window.electronAPI.file.read(filePath).then((result) => {
      setContent(result.content);
      setExists(result.exists);
      if (result.error) setError(result.error);
    });
  }, [filePath]);

  // Focus textarea on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    setSaving(true);
    setError(null);
    const result = await window.electronAPI.file.write(filePath, content);
    setSaving(false);
    if (result.success) {
      setExists(true);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(result.error || 'Failed to save');
    }
  }, [filePath, content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape to close
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose]
  );

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200">CLAUDE.md</span>
          {!exists && (
            <span className="text-xs text-amber-500">(new file)</span>
          )}
          {dirty && (
            <span className="text-xs text-slate-500">(unsaved)</span>
          )}
          {saved && (
            <span className="text-xs text-green-400">Saved</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {exists && (
            <button
              onClick={async () => {
                if (confirm('Delete CLAUDE.md? This cannot be undone.')) {
                  const result = await window.electronAPI.file.delete(filePath);
                  if (result.success) {
                    setContent('');
                    setExists(false);
                    setDirty(false);
                  } else {
                    setError(result.error || 'Failed to delete');
                  }
                }
              }}
              className="text-xs px-3 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
            >
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            x
          </button>
        </div>
      </div>

      {/* Path display */}
      <div className="px-4 py-1.5 text-xs text-slate-600 font-mono border-b border-slate-800/50 flex-shrink-0">
        {filePath}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-900/20 border-b border-red-900/30 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
          setSaved(false);
        }}
        onKeyDown={handleKeyDown}
        className="flex-1 w-full p-4 bg-slate-950 text-slate-200 text-sm font-mono leading-relaxed resize-none focus:outline-none placeholder-slate-600"
        placeholder="# CLAUDE.md&#10;&#10;Add project context, conventions, and instructions for Claude Code here."
        spellCheck={false}
      />

      {/* Footer hint */}
      <div className="px-4 py-1.5 border-t border-slate-800 text-xs text-slate-600 flex-shrink-0">
        Cmd+S to save &middot; Escape to close
      </div>
    </div>
  );
}
