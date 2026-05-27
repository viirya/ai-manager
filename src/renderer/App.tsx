import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import TabBar, { TabInfo } from './components/TabBar';
import SessionView from './components/SessionView';
import EmptyState from './components/EmptyState';
import NewSessionModal from './components/NewSessionModal';
import SettingsPanel from './components/SettingsPanel';
import AboutDialog from './components/AboutDialog';
import DialogueSetupModal from './components/DialogueSetupModal';
import DialogueView from './components/DialogueView';
import OverviewPanel from './components/OverviewPanel';
import { useSessions } from './hooks/useSessions';
import type { SessionInfo, SessionMeta } from '../shared/types';

interface LiveTab {
  sessionId: string;
  title: string;
  cwd: string;
  alreadySpawned?: boolean;
  type?: 'session' | 'dialogue'; // default: 'session'
  remote?: string; // 'user@host' if remote session
}

export default function App() {
  const { sessions, loading, remoteErrors, refresh, deleteSession, deleteRemoteSession } = useSessions();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [liveTabs, setLiveTabs] = useState<LiveTab[]>([]);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showDialogueSetup, setShowDialogueSetup] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [sessionMeta, setSessionMeta] = useState<Record<string, SessionMeta>>({});
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [showSidebar, setShowSidebar] = useState(true);
  const [dialogueSessions, setDialogueSessions] = useState<Set<string>>(new Set()); // sessions in active dialogues
  const searchRef = useRef<HTMLInputElement | null>(null);
  const resizingRef = useRef(false);

  // Restore tabs after sessions finish loading
  const tabsRestoredRef = useRef(false);
  useEffect(() => {
    if (loading || tabsRestoredRef.current) return;
    tabsRestoredRef.current = true;

    Promise.all([
      window.electronAPI.store.get('openTabs'),
      window.electronAPI.store.get('activeTabId'),
    ]).then(([tabsVal, activeVal]) => {
      if (!Array.isArray(tabsVal) || tabsVal.length === 0) return;
      const saved = tabsVal as Array<{ sessionId: string; title: string; cwd: string; remote?: string }>;
      // Keep only tabs whose session still exists locally.
      // Remote tabs are always kept — remote sessions load after this point.
      const localIds = new Set(sessions.filter(s => !s.remote).map(s => s.id));
      const toRestore = saved.filter(t => t.remote || localIds.has(t.sessionId));
      if (toRestore.length === 0) return;
      setLiveTabs(toRestore);
      const savedActive = typeof activeVal === 'string' ? activeVal : null;
      const active = toRestore.find(t => t.sessionId === savedActive) ?? toRestore[toRestore.length - 1];
      setActiveTabId(active.sessionId);
    });
  }, [loading, sessions]);

  // Load persisted state
  useEffect(() => {
    window.electronAPI.store.get('sessionMeta').then((val) => {
      if (val && typeof val === 'object') setSessionMeta(val as Record<string, SessionMeta>);
    });
    window.electronAPI.store.get('settings.sidebarWidth').then((val) => {
      if (typeof val === 'number' && val >= 200) setSidebarWidth(val);
    });
  }, []);

  // Listen for dialogue updates to track which sessions are in dialogues
  useEffect(() => {
    const unsub = window.electronAPI.dialogue.onUpdate((snapshot: any) => {
      if (snapshot.status === 'stopped') {
        setDialogueSessions((prev) => {
          const next = new Set(prev);
          for (const sid of snapshot.sessionIds) next.delete(sid);
          return next;
        });
      } else {
        setDialogueSessions((prev) => {
          const next = new Set(prev);
          for (const sid of snapshot.sessionIds) next.add(sid);
          return next;
        });
      }
    });
    return unsub;
  }, []);

  // Listen for menu events from main process
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(window.electronAPI.on('menu:newSession', () => setShowNewSessionModal(true)));
    unsubs.push(window.electronAPI.on('menu:closeTab', () => {
      if (activeTabId) handleCloseTab(activeTabId);
    }));
    unsubs.push(window.electronAPI.on('menu:switchTab', (index: number) => {
      if (liveTabs[index]) setActiveTabId(liveTabs[index].sessionId);
    }));
    unsubs.push(window.electronAPI.on('menu:prevTab', () => {
      if (liveTabs.length < 2 || !activeTabId) return;
      const idx = liveTabs.findIndex(t => t.sessionId === activeTabId);
      const prev = (idx - 1 + liveTabs.length) % liveTabs.length;
      setActiveTabId(liveTabs[prev].sessionId);
    }));
    unsubs.push(window.electronAPI.on('menu:nextTab', () => {
      if (liveTabs.length < 2 || !activeTabId) return;
      const idx = liveTabs.findIndex(t => t.sessionId === activeTabId);
      const next = (idx + 1) % liveTabs.length;
      setActiveTabId(liveTabs[next].sessionId);
    }));
    unsubs.push(window.electronAPI.on('menu:focusSearch', () => {
      setShowSidebar(true);
      setTimeout(() => searchRef.current?.focus(), 100);
    }));
    unsubs.push(window.electronAPI.on('menu:redrawTerminal', () => {
      window.dispatchEvent(new CustomEvent('redraw-terminal'));
    }));
    unsubs.push(window.electronAPI.on('menu:quoteSelection', () => {
      window.dispatchEvent(new CustomEvent('quote-terminal-selection'));
    }));
    unsubs.push(window.electronAPI.on('menu:toggleContext', () => {
      window.dispatchEvent(new CustomEvent('toggle-context-panel'));
    }));
    unsubs.push(window.electronAPI.on('menu:toggleSidebar', () => {
      setShowSidebar(s => {
        if (!s) refresh();
        return !s;
      });
    }));
    unsubs.push(window.electronAPI.on('menu:overview', () => setShowOverview(s => !s)));
    unsubs.push(window.electronAPI.on('menu:settings', () => setShowSettings(true)));
    unsubs.push(window.electronAPI.on('menu:about', () => setShowAbout(true)));
    unsubs.push(window.electronAPI.on('menu:toggleRaw', () => {
      window.dispatchEvent(new CustomEvent('toggle-raw-terminal'));
    }));
    return () => unsubs.forEach((u) => u());
  }, [activeTabId, liveTabs]);

  const updateMeta = useCallback((sessionId: string, update: Partial<SessionMeta>) => {
    setSessionMeta((prev) => {
      const next = { ...prev, [sessionId]: { ...prev[sessionId], ...update } };
      window.electronAPI.store.set('sessionMeta', next);
      return next;
    });
  }, []);

  // Persist open tabs and active tab whenever they change (exclude dialogue tabs).
  // Skip writes until restore has run — otherwise the initial empty liveTabs
  // would overwrite the stored tabs before we get a chance to read them back.
  useEffect(() => {
    if (!tabsRestoredRef.current) return;
    const toSave = liveTabs
      .filter(t => t.type !== 'dialogue')
      .map(({ sessionId, title, cwd, remote }) => ({ sessionId, title, cwd, remote }));
    window.electronAPI.store.set('openTabs', toSave);
  }, [liveTabs]);

  useEffect(() => {
    if (!tabsRestoredRef.current) return;
    window.electronAPI.store.set('activeTabId', activeTabId ?? null);
  }, [activeTabId]);

  const liveSessionIds = new Set(liveTabs.filter(t => t.type !== 'dialogue').map((t) => t.sessionId));

  const getTitle = useCallback(
    (session: SessionInfo) => sessionMeta[session.id]?.customTitle || session.title,
    [sessionMeta]
  );

  const handleSelect = useCallback(
    (session: SessionInfo) => {
      const existing = liveTabs.find((t) => t.sessionId === session.id);
      if (existing) {
        setActiveTabId(session.id);
      } else {
        setLiveTabs((prev) => [...prev, {
          sessionId: session.id,
          title: getTitle(session),
          cwd: session.cwd,
          remote: session.remote,
        }]);
        setActiveTabId(session.id);
      }
    },
    [liveTabs, getTitle]
  );

  const handleCloseTab = useCallback(
    (sessionId: string) => {
      const tab = liveTabs.find(t => t.sessionId === sessionId);
      if (tab?.type === 'dialogue') {
        // Stop dialogue if running
        window.electronAPI.dialogue.stop(sessionId);
      } else {
        window.electronAPI.pty.kill(sessionId);
      }
      setLiveTabs((prev) => {
        const next = prev.filter((t) => t.sessionId !== sessionId);
        if (activeTabId === sessionId) {
          setActiveTabId(next.length > 0 ? next[next.length - 1].sessionId : null);
        }
        return next;
      });
    },
    [activeTabId, liveTabs]
  );

  const handleDelete = useCallback(
    async (session: SessionInfo) => {
      const scrollEl = document.querySelector('[data-sidebar-list]')?.firstElementChild as HTMLElement | null;
      const scrollTop = scrollEl?.scrollTop ?? 0;

      if (liveSessionIds.has(session.id)) handleCloseTab(session.id);

      if (session.remote) {
        const result = await deleteRemoteSession(session.remote, session.filePath);
        if (!result.success) {
          alert(`Failed to delete remote session: ${result.error}`);
        }
      } else {
        await deleteSession(session.filePath);
      }

      requestAnimationFrame(() => {
        const el = document.querySelector('[data-sidebar-list]')?.firstElementChild as HTMLElement | null;
        if (el) el.scrollTop = scrollTop;
      });
    },
    [deleteSession, deleteRemoteSession, liveSessionIds, handleCloseTab]
  );

  const handleNewSessionConfirm = useCallback(
    async (cwd: string, title: string, remote?: string) => {
      setShowNewSessionModal(false);
      const result = remote
        ? await window.electronAPI.pty.spawnNewRemote(remote, cwd)
        : await window.electronAPI.pty.spawnNew(cwd);
      if (result.success && result.sessionId) {
        const tabTitle = title || (remote ? `New Session (${remote})` : 'New Session');
        setLiveTabs((prev) => [...prev, {
          sessionId: result.sessionId!,
          title: tabTitle,
          cwd: cwd || '~',
          alreadySpawned: true,
          remote,
        }]);
        setActiveTabId(result.sessionId);
        if (title) updateMeta(result.sessionId, { customTitle: title });
      } else {
        alert(`Failed to create session: ${result.error || 'Unknown error'}`);
      }
    },
    [updateMeta]
  );

  // --- Dialogue ---
  const handleDialogueConfirm = useCallback(
    async (config: any) => {
      setShowDialogueSetup(false);
      const result = await window.electronAPI.dialogue.start(config);
      if (result.success && result.dialogueId) {
        const labels = config.sessionLabels as Record<string, string>;
        const names = config.sessionIds.map((sid: string) => labels[sid] || sid.slice(0, 8));
        setLiveTabs((prev) => [...prev, {
          sessionId: result.dialogueId!,
          title: names.join(' ↔ '),
          cwd: '',
          type: 'dialogue',
        }]);
        setActiveTabId(result.dialogueId);
      } else {
        alert(`Failed to start dialogue: ${result.error || 'Unknown error'}`);
      }
    },
    []
  );

  const handleRename = useCallback(
    (sessionId: string, newTitle: string) => {
      updateMeta(sessionId, { customTitle: newTitle });
      setLiveTabs((prev) => prev.map((t) => (t.sessionId === sessionId ? { ...t, title: newTitle } : t)));
    },
    [updateMeta]
  );

  const handleTogglePin = useCallback(
    (sessionId: string) => updateMeta(sessionId, { pinned: !sessionMeta[sessionId]?.pinned }),
    [sessionMeta, updateMeta]
  );

  const handleToggleArchive = useCallback(
    (sessionId: string) => updateMeta(sessionId, { archived: !sessionMeta[sessionId]?.archived }),
    [sessionMeta, updateMeta]
  );

  const handleContextMenu = useCallback(
    async (session: SessionInfo) => {
      const meta = sessionMeta[session.id] || {};
      const action = await window.electronAPI.app.showContextMenu(session.id, {
        pinned: meta.pinned,
        archived: meta.archived,
      });
      switch (action) {
        case 'resume': handleSelect(session); break;
        case 'rename': {
          const newName = window.prompt('Rename session:', getTitle(session));
          if (newName?.trim()) handleRename(session.id, newName.trim());
          break;
        }
        case 'togglePin': handleTogglePin(session.id); break;
        case 'toggleArchive': handleToggleArchive(session.id); break;
        case 'copyId':
          try { await navigator.clipboard.writeText(session.id); }
          catch { (window as any).electronAPI?.clipboard?.writeText?.(session.id); }
          break;
        case 'delete': handleDelete(session); break;
      }
    },
    [sessionMeta, handleSelect, handleRename, handleTogglePin, handleToggleArchive, handleDelete, getTitle]
  );

  // --- Sidebar resize ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.max(200, Math.min(600, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      resizingRef.current = false;
      window.electronAPI.store.set('settings.sidebarWidth', sidebarWidth);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  // Build tab infos — dialogue tabs get a special icon
  const tabInfos: TabInfo[] = liveTabs.map((tab) => ({
    sessionId: tab.sessionId,
    title: (tab.type === 'dialogue' ? '↔ ' : '') + (sessionMeta[tab.sessionId]?.customTitle || tab.title),
    isLive: true,
    isWaiting: false,
  }));

  // Live sessions list for the dialogue setup modal
  const liveSessionList = liveTabs
    .filter(t => t.type !== 'dialogue')
    .map(t => ({
      sessionId: t.sessionId,
      title: sessionMeta[t.sessionId]?.customTitle || t.title,
    }));

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900">
      {/* Sidebar */}
      {showSidebar && (
        <>
          <Sidebar
            sessions={sessions}
            selectedId={activeTabId}
            liveSessions={liveSessionIds}
            sessionMeta={sessionMeta}
            dialogueSessions={dialogueSessions}
            width={sidebarWidth}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onNewSession={() => setShowNewSessionModal(true)}
            onRename={handleRename}
            onTogglePin={handleTogglePin}
            onToggleArchive={handleToggleArchive}
            onContextMenu={handleContextMenu}
            onOpenSettings={() => setShowSettings(true)}
            loading={loading}
            remoteErrors={remoteErrors}
            searchRef={searchRef}
          />
          <div
            onMouseDown={handleResizeStart}
            className="w-1 cursor-col-resize hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors flex-shrink-0"
          />
        </>
      )}

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Title bar */}
        <div className="drag-region h-10 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900 flex-shrink-0">
          <div className="no-drag flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(s => { if (!s) refresh(); return !s; })}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1"
              title={showSidebar ? 'Hide sidebar (Cmd+B)' : 'Show sidebar (Cmd+B)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            {activeTabId && (
              <>
                <h1 className="text-sm font-medium text-slate-200">
                  {sessionMeta[activeTabId]?.customTitle ||
                    liveTabs.find((t) => t.sessionId === activeTabId)?.title || ''}
                </h1>
                <span className="text-xs text-slate-400 font-mono">
                  {liveTabs.find((t) => t.sessionId === activeTabId)?.cwd || ''}
                </span>
              </>
            )}
          </div>
          <div className="no-drag flex items-center gap-2">
            {/* Start Dialogue button */}
            {liveSessionList.length >= 2 && (
              <button
                onClick={() => setShowDialogueSetup(true)}
                className="text-xs px-2 py-1 text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 rounded transition-colors"
                title="Start a dialogue between sessions"
              >
                ↔ Dialogue
              </button>
            )}
            <button
              onClick={refresh}
              className="text-xs px-2 py-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
              title="Refresh session list"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Tab bar */}
        {liveTabs.length > 0 && (
          <TabBar tabs={tabInfos} activeId={activeTabId} onSelect={setActiveTabId} onClose={handleCloseTab} />
        )}

        {/* Session/Dialogue views */}
        <div className="flex-1 overflow-hidden relative">
          {liveTabs.length === 0 ? (
            <EmptyState
              hasSessions={sessions.length > 0}
              onNewSession={() => setShowNewSessionModal(true)}
            />
          ) : (
            liveTabs.map((tab) => {
              const isActive = tab.sessionId === activeTabId;
              if (tab.type === 'dialogue') {
                return (
                  <div
                    key={tab.sessionId}
                    className="absolute inset-0"
                    style={{
                      visibility: isActive ? 'visible' : 'hidden',
                      zIndex: isActive ? 1 : 0,
                    }}
                  >
                    <DialogueView dialogueId={tab.sessionId} active={isActive} />
                  </div>
                );
              }
              return (
                <div
                  key={tab.sessionId}
                  className="absolute inset-0"
                  style={{
                    visibility: isActive ? 'visible' : 'hidden',
                    zIndex: isActive ? 1 : 0,
                  }}
                >
                  <SessionView
                    sessionId={tab.sessionId}
                    cwd={tab.cwd}
                    active={isActive}
                    alreadySpawned={tab.alreadySpawned}
                    remote={tab.remote}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modals */}
      <NewSessionModal
        isOpen={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        onConfirm={handleNewSessionConfirm}
      />
      <DialogueSetupModal
        isOpen={showDialogueSetup}
        liveSessions={liveSessionList}
        onClose={() => setShowDialogueSetup(false)}
        onConfirm={handleDialogueConfirm}
      />
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <AboutDialog isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <OverviewPanel
        isOpen={showOverview}
        liveSessions={liveTabs.filter(t => t.type !== 'dialogue').map(t => ({
          sessionId: t.sessionId,
          title: sessionMeta[t.sessionId]?.customTitle || t.title,
          cwd: t.cwd,
          remote: t.remote,
        }))}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={() => setShowOverview(false)}
      />
    </div>
  );
}
