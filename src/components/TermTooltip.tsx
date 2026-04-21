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
const inflight = new Map<string, Promise<Cached>>();
const REQUEST_TIMEOUT_MS = 7000;

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
    if (state?.definition || loading) return;
    setLoading(true);

    const existing = inflight.get(term);
    const pending =
      existing ??
      (async (): Promise<Cached> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const res = await fetch(`/api/define?term=${encodeURIComponent(term)}`, {
            signal: controller.signal,
            headers: { accept: "application/json" },
          });

          const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
          if (!contentType.includes("application/json")) {
            if (res.status === 401 || res.status === 403) {
              return { error: "Session expired. Refresh and sign in again." };
            }
            return { error: "Definition service returned an unexpected response." };
          }

          const data = (await res.json()) as {
            definition?: string;
            source?: string;
            error?: string;
          };

          if (!res.ok) {
            return {
              error:
                typeof data.error === "string"
                  ? data.error
                  : `Couldn't load definition (${res.status}).`,
            };
          }

          if (typeof data.definition !== "string" || data.definition.trim().length === 0) {
            return { error: "Definition unavailable." };
          }

          return {
            definition: data.definition,
            source: typeof data.source === "string" ? data.source : undefined,
          };
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { error: "Request timed out. Try again." };
          }
          return { error: "Network error. Check connection and try again." };
        } finally {
          clearTimeout(timer);
        }
      })();

    inflight.set(term, pending);
    void pending
      .then((next) => {
        if (next.definition) {
          cache.set(term, next);
        }
        setState(next);
      })
      .finally(() => {
        setLoading(false);
        if (inflight.get(term) === pending) {
          inflight.delete(term);
        }
      });
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
