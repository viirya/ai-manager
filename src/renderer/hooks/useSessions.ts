import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, SessionMessage } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await window.electronAPI.sessions.list();
      setSessions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
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

  return { sessions, loading, error, refresh, deleteSession };
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
