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
  // Alternate screen buffer active (e.g. Claude Code fullscreen TUI).
  // Scroll preservation must be suppressed while in alternate screen — it has
  // no scrollback and the diff-based redraws fight with our scrollTop restore.
  const altScreenRef = useRef(false);

  useEffect(() => {
    if (!termRef.current) return;

    const terminal = new Terminal({
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        cursorAccent: '#0f172a',
        selectionBackground: '#264f78',
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
      scrollback: 3000,
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

    // Track alternate screen buffer state via DEC private mode sequences.
    // \x1b[?1049h = enter alt screen (Claude Code fullscreen TUI)
    // \x1b[?1049l = leave alt screen
    // While in alt screen: no scrollback, no scroll preservation, hide the
    // scroll-down button.
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (params.length > 0 && params[0] === 1049) {
        altScreenRef.current = true;
        userScrolledUpRef.current = false;
        setShowScrollDown(false);
      }
      return false;
    });
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (params.length > 0 && params[0] === 1049) {
        altScreenRef.current = false;
      }
      return false;
    });

    // Find the viewport DOM element for scroll preservation
    // (xterm.js buffer API is unreliable when Claude Code redraws its TUI)
    const getViewport = () => termRef.current?.querySelector('.xterm-viewport') as HTMLElement | null;

    // Track scroll position via polling — use buffer API for detection
    // (DOM scrollHeight may not work with WebGL renderer)
    const scrollCheckInterval = setInterval(() => {
      if (altScreenRef.current) return;
      const buf = terminal.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      userScrolledUpRef.current = !atBottom;
      setShowScrollDown(!atBottom);
    }, 300);

    // Subscribe to PTY output — batch writes within the same animation frame to
    // reduce xterm.js/WebGL repaint frequency, especially in fullscreen TUI mode
    // where Claude Code sends many small escape sequences per redraw.
    //
    // In alt-screen mode skip scroll preservation entirely: the TUI manages its
    // own viewport and our scrollTop restore would corrupt the diff-based redraws.
    let pendingChunks: string[] = [];
    let rafPending = false;

    const flushWrites = () => {
      rafPending = false;
      if (pendingChunks.length === 0) return;
      const data = pendingChunks.join('');
      pendingChunks = [];

      if (userScrolledUpRef.current && !altScreenRef.current) {
        const vp = getViewport();
        const savedScrollTop = vp?.scrollTop ?? 0;
        terminal.write(data, () => {
          if (vp && userScrolledUpRef.current && !altScreenRef.current) {
            vp.scrollTop = savedScrollTop;
          }
        });
      } else {
        terminal.write(data);
      }
    };

    unsubRef.current = window.electronAPI.pty.onData(sessionId, (data: string) => {
      pendingChunks.push(data);
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(flushWrites);
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

    // Redraw: jiggle PTY size + send Ctrl+L to force a complete repaint
    const handleRedraw = () => {
      const cols = terminal.cols;
      const rows = terminal.rows;
      // First shrink to invalidate the layout
      window.electronAPI.pty.resize(sessionId, Math.max(1, cols - 2), rows);
      setTimeout(() => {
        // Restore size — app should redraw from the resize event
        window.electronAPI.pty.resize(sessionId, cols, rows);
      }, 80);
      setTimeout(() => {
        // Send Ctrl+L (form feed) as a backup redraw signal
        window.electronAPI.pty.write(sessionId, '\x0c');
      }, 200);
    };
    window.addEventListener('redraw-terminal', handleRedraw);

    // Reset scroll preservation when user submits input (so they see the response)
    const handleResetScroll = (e: Event) => {
      const targetId = (e as CustomEvent).detail;
      if (targetId !== sessionId) return;
      userScrolledUpRef.current = false;
      setShowScrollDown(false);
      requestAnimationFrame(() => {
        terminal.scrollToBottom();
      });
    };
    window.addEventListener('reset-terminal-scroll', handleResetScroll);

    // Quote selection: grab selected text and dispatch to input bar
    const handleQuoteSelection = () => {
      const selection = terminal.getSelection();
      if (selection) {
        const quoted = selection.split('\n').map((l: string) => `> ${l}`).join('\n');
        window.dispatchEvent(new CustomEvent('quote-selection', { detail: quoted }));
        terminal.clearSelection();
      }
    };
    window.addEventListener('quote-terminal-selection', handleQuoteSelection);

    // In alternate screen mode, xterm.js tries to scroll the viewport on wheel
    // events even though alt screen has no scrollback — this adds latency before
    // the event reaches the PTY. Intercept wheel events on the terminal element
    // and forward them directly as PTY input (up/down arrow sequences) so the
    // TUI app receives them with no xterm.js overhead.
    const handleWheel = (e: WheelEvent) => {
      if (!altScreenRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      // Each notch of scroll sends one arrow key; scale to deltaY magnitude.
      const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
      const seq = e.deltaY < 0 ? '\x1b[A' : '\x1b[B';
      for (let i = 0; i < lines; i++) {
        window.electronAPI.pty.write(sessionId, seq);
      }
    };
    termRef.current.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('redraw-terminal', handleRedraw);
      window.removeEventListener('quote-terminal-selection', handleQuoteSelection);
      window.removeEventListener('reset-terminal-scroll', handleResetScroll);
      clearInterval(scrollCheckInterval);
      resizeObserver.disconnect();
      termRef.current?.removeEventListener('wheel', handleWheel);
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
