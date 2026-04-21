"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  term: string;
  children: React.ReactNode;
};

type Cached = {
  definition?: string;
  source?: string;
  error?: string;
};

const cache = new Map<string, Cached>();

let activeCloser: (() => void) | null = null;

export default function TermTooltip({ term, children }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Cached | null>(cache.get(term) ?? null);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose(delay = 150) {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), delay);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !popRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      cancelClose();
    };
  }, []);

  function ensureLoaded() {
    if (state || loading) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/define?term=${encodeURIComponent(term)}`,
        );
        const data = await res.json();
        const next: Cached = res.ok
          ? { definition: data.definition, source: data.source }
          : { error: data.error ?? "Couldn't load definition." };
        cache.set(term, next);
        setState(next);
      } catch {
        const next = { error: "Network error." };
        cache.set(term, next);
        setState(next);
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleOpen() {
    cancelClose();
    if (open) return;
    if (activeCloser && activeCloser !== doClose) activeCloser();
    activeCloser = doClose;
    setOpen(true);
    ensureLoaded();
  }

  function doClose() {
    cancelClose();
    setOpen(false);
    if (activeCloser === doClose) activeCloser = null;
  }

  return (
    <span
      className="relative inline"
      onMouseEnter={cancelClose}
      onMouseLeave={() => scheduleClose()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? doClose() : handleOpen())}
        onMouseEnter={handleOpen}
        onFocus={handleOpen}
        onBlur={() => scheduleClose(250)}
        className="cursor-help border-b border-dotted border-white/40 text-inherit hover:border-white/80 hover:text-white"
      >
        {children}
      </button>
      {open && (
        <div
          ref={popRef}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={() => scheduleClose()}
          className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[85vw] rounded-md border border-white/15 bg-neutral-900 p-3 text-sm leading-relaxed text-white/90 shadow-xl"
        >
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">
            {term}
          </div>
          {loading && !state && (
            <div className="space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-white/10" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-white/10" />
            </div>
          )}
          {state?.definition && (
            <>
              <p className="whitespace-pre-wrap text-sm">{state.definition}</p>
              {state.source && (
                <p className="mt-2 text-[10px] uppercase tracking-wide text-white/40">
                  via {state.source}
                </p>
              )}
            </>
          )}
          {state?.error && (
            <p className="text-sm text-red-300">{state.error}</p>
          )}
        </div>
      )}
    </span>
  );
}
