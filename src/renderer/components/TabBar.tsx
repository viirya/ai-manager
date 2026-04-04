import React from 'react';

export interface TabInfo {
  sessionId: string;
  title: string;
  isLive: boolean;
  isWaiting: boolean;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center bg-slate-950 border-b border-slate-800 overflow-x-auto no-drag">
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeId;
        return (
          <div
            key={tab.sessionId}
            onClick={() => onSelect(tab.sessionId)}
            className={`group flex items-center gap-2 px-4 py-2 cursor-pointer border-r border-slate-800 text-sm transition-colors min-w-0 max-w-[200px] ${
              isActive
                ? 'bg-slate-900 text-slate-200 border-b-2 border-b-indigo-500'
                : 'bg-slate-950 text-slate-500 hover:text-slate-300 hover:bg-slate-900/50'
            }`}
          >
            {/* Status dot */}
            <span
              className={`flex-shrink-0 w-2 h-2 rounded-full ${
                tab.isLive
                  ? tab.isWaiting
                    ? 'bg-green-400'
                    : 'bg-yellow-400 animate-pulse'
                  : 'bg-slate-600'
              }`}
            />

            {/* Title */}
            <span className="truncate flex-1">{tab.title}</span>

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.sessionId);
              }}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-all text-xs"
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}
