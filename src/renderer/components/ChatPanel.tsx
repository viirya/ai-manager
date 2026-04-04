import React, { useEffect, useRef } from 'react';
import type { SessionMessage } from '../../shared/types';

// Simple ANSI/tag stripping for display
function cleanText(text: string): string {
  return text
    // Strip ANSI escape codes
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    // Strip IDE metadata tags
    .replace(/<ide_[^>]*>[\s\S]*?<\/ide_[^>]*>/g, '')
    // Strip system-reminder tags
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim();
}

interface ChatPanelProps {
  messages: SessionMessage[];
  loading: boolean;
  sessionTitle: string;
}

export default function ChatPanel({ messages, loading, sessionTitle }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-slate-500">Loading conversation...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-600 text-center">
          <div className="text-4xl mb-4">💬</div>
          <div className="text-lg font-medium text-slate-400">No messages yet</div>
          <div className="text-sm mt-1">Select a session to view its conversation</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="text-xs text-slate-600 text-center pb-2 border-b border-slate-800">
        Session: {sessionTitle}
      </div>

      {messages.map((msg, i) => {
        const cleaned = cleanText(msg.text);
        if (!cleaned) return null;

        const isUser = msg.type === 'user';
        return (
          <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 ${
                isUser
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-200 border border-slate-700'
              }`}
            >
              <div className="text-xs font-medium mb-1 opacity-70">
                {isUser ? 'You' : 'Claude'}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                {cleaned.length > 2000 ? cleaned.slice(0, 2000) + '\n\n[... truncated]' : cleaned}
              </div>
              {msg.timestamp && (
                <div className="text-xs opacity-40 mt-2">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
