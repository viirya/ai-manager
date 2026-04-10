import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, SessionMessage } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remoteErrors, setRemoteErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load local sessions first — show immediately
      const local = await window.electronAPI.sessions.list();
      setSessions(local);
      setLoading(false);

      // Then load remote sessions in background and append
      const hosts = (await window.electronAPI.store.get('remoteHosts')) as
        Array<{ user: string; host: string }> | null;

      setRemoteErrors([]);
      if (hosts && hosts.length > 0) {
        const remoteResults = await Promise.allSettled(
          hosts.map((h) => window.electronAPI.sessions.listRemote(`${h.user}@${h.host}`))
        );
        let remote: SessionInfo[] = [];
        const errors: string[] = [];
        for (const result of remoteResults) {
          if (result.status === 'fulfilled') {
            remote = remote.concat(result.value);
          } else {
            errors.push(result.reason?.message || 'Unknown remote error');
          }
        }
        if (errors.length > 0) setRemoteErrors(errors);
        setSessions((prev) => {
          const localOnly = prev.filter((s) => !s.remote);
          return [...localOnly, ...remote];
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteSession = useCallback(async (filePath: string) => {
    await window.electronAPI.sessions.delete(filePath);
    await refresh();
  }, [refresh]);

  const deleteRemoteSession = useCallback(async (hostKey: string, remoteFilePath: string) => {
    const result = await window.electronAPI.sessions.deleteRemote(hostKey, remoteFilePath);
    if (result.success) {
      // Remove from local state immediately
      setSessions((prev) => prev.filter((s) => !(s.remote === hostKey && s.filePath === remoteFilePath)));
    }
    return result;
  }, []);

  return { sessions, loading, error, remoteErrors, refresh, deleteSession, deleteRemoteSession };
}

export function useSessionMessages(filePath: string | null) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setMessages([]);
      return;
    }

    setLoading(true);
    window.electronAPI.sessions.read(filePath).then((msgs) => {
      setMessages(msgs);
      setLoading(false);
    }).catch(() => {
      setMessages([]);
      setLoading(false);
    });
  }, [filePath]);

  return { messages, loading };
}
