import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface RawTerminalProps {
  sessionId: string;
  active?: boolean;
  onResize?: (cols: number, rows: number) => void;
}

export default function RawTerminal({ sessionId, active, onResize }: RawTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    if (!termRef.current) return;

    const terminal = new Terminal({
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        cursorAccent: '#0f172a',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termRef.current);

    // WebGL renderer for better text alignment and selection
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    // Fit after a tick so the container has dimensions
    requestAnimationFrame(() => {
      fitAddon.fit();
      if (onResize) {
        onResize(terminal.cols, terminal.rows);
      }
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Forward keyboard input to PTY
    terminal.onData((data: string) => {
      window.electronAPI.pty.write(sessionId, data);
    });

    // Track scroll position via polling xterm.js buffer API
    // (DOM scroll events are unreliable with WebGL renderer)
    const scrollCheckInterval = setInterval(() => {
      const buf = terminal.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      userScrolledUpRef.current = !atBottom;
      setShowScrollDown(!atBottom);
    }, 300);

    // Subscribe to PTY output — preserve scroll if user scrolled up
    unsubRef.current = window.electronAPI.pty.onData(sessionId, (data: string) => {
      if (userScrolledUpRef.current) {
        const savedY = terminal.buffer.active.viewportY;
        terminal.write(data);
        terminal.scrollToLine(savedY);
      } else {
        terminal.write(data);
      }
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
      if (onResize) {
        onResize(terminal.cols, terminal.rows);
      }
    };
    window.addEventListener('resize', handleResize);

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(termRef.current);

    // Redraw: jiggle PTY size to force the app to repaint
    const handleRedraw = () => {
      const cols = terminal.cols;
      const rows = terminal.rows;
      window.electronAPI.pty.resize(sessionId, cols - 1, rows);
      setTimeout(() => {
        window.electronAPI.pty.resize(sessionId, cols, rows);
      }, 50);
    };
    window.addEventListener('redraw-terminal', handleRedraw);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('redraw-terminal', handleRedraw);
      clearInterval(scrollCheckInterval);
      resizeObserver.disconnect();
      if (unsubRef.current) unsubRef.current();
      terminal.dispose();
    };
  }, [sessionId, onResize]);

  // Refit when this tab becomes active (container goes from display:none to visible)
  useEffect(() => {
    if (!active || !fitAddonRef.current || !terminalRef.current) return;

    const doFit = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        if (onResize) {
          onResize(terminalRef.current.cols, terminalRef.current.rows);
        }
      }
    };

    // display:none → block needs time for browser to complete layout.
    // Fire fit at multiple timings to be safe.
    const t1 = setTimeout(doFit, 0);
    const t2 = setTimeout(doFit, 50);
    const t3 = setTimeout(doFit, 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [active, onResize]);

  const scrollToBottom = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollToBottom();
      userScrolledUpRef.current = false;
      setShowScrollDown(false);
    }
  }, []);

  return (
    <div className="relative h-full w-full bg-slate-950">
      <div
        ref={termRef}
        className="h-full w-full"
        style={{ padding: '4px' }}
      />
      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-full shadow-lg transition-colors"
          style={{ zIndex: 20 }}
          title="Scroll to bottom"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );
}
