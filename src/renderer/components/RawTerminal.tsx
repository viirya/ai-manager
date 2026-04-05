import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termRef.current);

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

    // Track if user has scrolled up
    let userScrolledUp = false;
    terminal.onScroll(() => {
      const viewport = termRef.current?.querySelector('.xterm-viewport');
      if (viewport) {
        const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        userScrolledUp = distFromBottom > 50;
      }
    });

    // Subscribe to PTY output — preserve scroll if user scrolled up
    unsubRef.current = window.electronAPI.pty.onData(sessionId, (data: string) => {
      if (userScrolledUp) {
        const viewport = termRef.current?.querySelector('.xterm-viewport');
        const scrollTop = viewport?.scrollTop ?? 0;
        terminal.write(data);
        if (viewport) viewport.scrollTop = scrollTop;
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

    return () => {
      window.removeEventListener('resize', handleResize);
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

  return (
    <div
      ref={termRef}
      className="h-full w-full bg-slate-950"
      style={{ padding: '4px' }}
    />
  );
}
