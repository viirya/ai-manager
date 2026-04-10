import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { List } from 'react-window';
import type { SessionInfo, SessionMeta } from '../../shared/types';

function formatTimeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

function getWorkingDirShort(cwd: string): string {
  if (!cwd) return '';
  const parts = cwd.split('/');
  return parts.slice(-2).join('/');
}

// Inline rename input
function InlineRename({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value.trim()) onSave(value.trim()); else onCancel(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (value.trim()) onSave(value.trim()); else onCancel(); }
        if (e.key === 'Escape') onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full px-1 py-0 bg-slate-700 border border-indigo-500 rounded text-sm text-slate-200 focus:outline-none"
    />
  );
}

export interface SidebarProps {
  sessions: SessionInfo[];
  selectedId: string | null;
  liveSessions: Set<string>;
  sessionMeta: Record<string, SessionMeta>;
  dialogueSessions: Set<string>;
  width: number;
  onSelect: (session: SessionInfo) => void;
  onDelete: (session: SessionInfo) => void;
  onNewSession: () => void;
  onRename: (sessionId: string, newTitle: string) => void;
  onTogglePin: (sessionId: string) => void;
  onToggleArchive: (sessionId: string) => void;
  onContextMenu: (session: SessionInfo) => void;
  onOpenSettings: () => void;
  loading: boolean;
  remoteErrors?: string[];
  searchRef?: React.RefObject<HTMLInputElement | null>;
}

export default function Sidebar({
  sessions,
  selectedId,
  liveSessions,
  sessionMeta,
  dialogueSessions,
  width,
  onSelect,
  onDelete,
  onNewSession,
  onRename,
  onContextMenu,
  onOpenSettings,
  loading,
  remoteErrors,
  searchRef,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  const getTitle = useCallback(
    (session: SessionInfo) => sessionMeta[session.id]?.customTitle || session.title,
    [sessionMeta]
  );

  const filtered = useMemo(() => {
    let list = sessions;
    if (!showArchived) list = list.filter((s) => !sessionMeta[s.id]?.archived);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          getTitle(s).toLowerCase().includes(q) ||
          s.cwd.toLowerCase().includes(q) ||
          s.firstMessage.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const aPinned = sessionMeta[a.id]?.pinned ? 1 : 0;
      const bPinned = sessionMeta[b.id]?.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.lastActive - a.lastActive;
    });
  }, [sessions, search, sessionMeta, showArchived, getTitle]);

  const archivedCount = useMemo(
    () => sessions.filter((s) => sessionMeta[s.id]?.archived).length,
    [sessions, sessionMeta]
  );

  // Measure available height for virtualized list
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setListHeight(entry.contentRect.height);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const ROW_HEIGHT = 72;

  // react-window v2 uses rowComponent (a named component receiving {index, style, ...rowProps})
  const SessionRow = React.memo(function SessionRow({
    index,
    style,
    data,
  }: {
    index: number;
    style: React.CSSProperties;
    data: {
      filtered: SessionInfo[];
      liveSessions: Set<string>;
      sessionMeta: Record<string, SessionMeta>;
      selectedId: string | null;
      renamingId: string | null;
      confirmDelete: string | null;
      getTitle: (s: SessionInfo) => string;
      onSelect: (s: SessionInfo) => void;
      onContextMenu: (s: SessionInfo) => void;
      onRename: (id: string, val: string) => void;
      onDelete: (s: SessionInfo) => void;
      setRenamingId: (id: string | null) => void;
      setConfirmDelete: (id: string | null) => void;
      dialogueSessions: Set<string>;
    };
  }) {
    const session = data.filtered[index];
    if (!session) return null;
    const isLive = data.liveSessions.has(session.id);
    const meta = data.sessionMeta[session.id] || {};
    const title = data.getTitle(session);

    return (
      <div
        style={style}
        onClick={() => data.onSelect(session)}
        onContextMenu={(e) => { e.preventDefault(); data.onContextMenu(session); }}
        className={`session-item no-drag group cursor-pointer px-3 py-2 border-b border-slate-800/50 hover:bg-slate-800/50 ${
          data.selectedId === session.id ? 'bg-slate-800 border-l-2 border-l-indigo-500' : ''
        } ${meta.archived ? 'opacity-50' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {meta.pinned && <span className="flex-shrink-0 text-xs text-amber-500">*</span>}
              {isLive && <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400" title="Live" />}
              {data.dialogueSessions.has(session.id) && <span className="flex-shrink-0 text-xs text-indigo-400" title="In dialogue">↔</span>}
              {data.renamingId === session.id ? (
                <InlineRename
                  initialValue={title}
                  onSave={(val) => { data.onRename(session.id, val); data.setRenamingId(null); }}
                  onCancel={() => data.setRenamingId(null)}
                />
              ) : (
                <div
                  className="text-sm font-medium text-slate-200 truncate"
                  onDoubleClick={(e) => { e.stopPropagation(); data.setRenamingId(session.id); }}
                  title="Double-click to rename"
                >
                  {title}
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              {session.remote && (
                <span className="text-cyan-500 mr-1" title={`Remote: ${session.remote}`}>[{session.remote}]</span>
              )}
              {getWorkingDirShort(session.cwd)}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-600">{formatTimeAgo(session.lastActive)}</span>
              <span className="text-xs text-slate-600">{session.messageCount} msgs</span>
            </div>
          </div>
          <div className="flex-shrink-0">
            {data.confirmDelete === session.id ? (
              <div className="flex gap-1">
                <button onClick={(e) => { e.stopPropagation(); data.onDelete(session); data.setConfirmDelete(null); }}
                  className="text-xs px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded">Yes</button>
                <button onClick={(e) => { e.stopPropagation(); data.setConfirmDelete(null); }}
                  className="text-xs px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded">No</button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); data.setConfirmDelete(session.id); }}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs p-1 transition-opacity"
              >x</button>
            )}
          </div>
        </div>
      </div>
    );
  });

  const rowData = useMemo(() => ({
    filtered,
    liveSessions,
    sessionMeta,
    selectedId,
    renamingId,
    confirmDelete,
    getTitle,
    onSelect,
    onContextMenu,
    onRename,
    onDelete,
    setRenamingId,
    setConfirmDelete,
    dialogueSessions,
  }), [filtered, liveSessions, sessionMeta, selectedId, renamingId, confirmDelete, getTitle, onSelect, onContextMenu, onRename, onDelete, dialogueSessions]);

  return (
    <div
      className="flex-shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col h-full"
      style={{ width }}
    >
      {/* Title bar */}
      <div className="drag-region h-10 flex items-center border-b border-slate-800" style={{ paddingLeft: 78 }}>
        <span className="text-sm font-semibold text-slate-400 no-drag">
          Claude Code Manager
        </span>
      </div>

      {/* New Session */}
      <div className="p-3">
        <button
          onClick={onNewSession}
          className="no-drag w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-lg leading-none">+</span>
          New Session
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <input
            ref={searchRef as React.RefObject<HTMLInputElement>}
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="no-drag w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 pr-8"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* Archived toggle */}
      {archivedCount > 0 && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="no-drag text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            {showArchived ? `Hide ${archivedCount} archived` : `Show ${archivedCount} archived`}
          </button>
        </div>
      )}

      {/* Session list (virtualized) */}
      <div ref={listContainerRef} data-sidebar-list className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-sm text-slate-500">Loading sessions...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 px-3">
            <p className="text-sm text-slate-500">
              {search ? 'No sessions match your search' : 'No sessions found'}
            </p>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <List
            height={listHeight}
            rowCount={filtered.length}
            rowHeight={ROW_HEIGHT}
            width="100%"
            overscanRowCount={5}
            rowComponent={SessionRow}
            rowProps={{ data: rowData }}
          />
        )}
      </div>

      {/* Remote errors */}
      {remoteErrors && remoteErrors.length > 0 && (
        <div className="px-3 py-1.5 border-t border-red-900/30 bg-red-900/10">
          {remoteErrors.map((err, i) => (
            <div key={i} className="text-xs text-red-400 truncate" title={err}>{err}</div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-800 flex items-center justify-between">
        <span className="text-xs text-slate-600">
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
          {liveSessions.size > 0 && (
            <span className="ml-2 text-green-500">{liveSessions.size} live</span>
          )}
        </span>
        <button
          onClick={onOpenSettings}
          className="no-drag text-slate-600 hover:text-slate-400 transition-colors p-1"
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
