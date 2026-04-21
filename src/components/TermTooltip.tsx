"use client";

import { useEffect, useState } from "react";

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
const REQUEST_TIMEOUT_MS = 22000;
const MAX_REQUEST_ATTEMPTS = 2;

export default function TermTooltip({ term, children }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Cached | null>(cache.get(term) ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
  }, [open]);

  async function fetchDefinition(termToFetch: string): Promise<Cached> {
    let lastFailure: Cached = { error: "Definition unavailable." };

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/define?term=${encodeURIComponent(termToFetch)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
          if (res.status === 401 || res.status === 403) {
            return { error: "Session expired. Refresh and sign in again." };
          }
          lastFailure = {
            error: "Definition service returned an unexpected response.",
          };
          continue;
        }

        const data = (await res.json()) as {
          definition?: string;
          source?: string;
          error?: string;
        };

        if (!res.ok) {
          lastFailure = {
            error:
              typeof data.error === "string"
                ? data.error
                : `Couldn't load definition (${res.status}).`,
          };
          // Retry only on transient backend failures.
          if (res.status >= 500 && attempt < MAX_REQUEST_ATTEMPTS) {
            continue;
          }
          return lastFailure;
        }

        if (typeof data.definition !== "string" || data.definition.trim().length === 0) {
          lastFailure = { error: "Definition unavailable." };
          continue;
        }

        return {
          definition: data.definition,
          source: typeof data.source === "string" ? data.source : undefined,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          lastFailure = {
            error:
              "Definition lookup is taking too long. Please tap Retry.",
          };
        } else {
          lastFailure = { error: "Network error. Check connection and try again." };
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return lastFailure;
  }

  function ensureLoaded() {
    const cached = cache.get(term);
    if (cached?.definition) {
      setState(cached);
      return;
    }
    if (loading) return;
    setLoading(true);

    const existing = inflight.get(term);
    const pending =
      existing ??
      fetchDefinition(term);

    inflight.set(term, pending);
    void pending
      .then((next) => {
        cache.set(term, next);
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
    setState(cache.get(term) ?? null);
    setOpen(true);
    ensureLoaded();
  }

  function closeDialog() {
    setOpen(false);
  }

  function retryLookup() {
    cache.delete(term);
    setState(null);
    ensureLoaded();
  }

  return (
    <span className="inline">
      <button
        type="button"
        onClick={handleOpen}
        className="cursor-help border-b border-dotted border-white/40 text-inherit hover:border-white/80 hover:text-white"
      >
        {children}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            aria-label="Close definition"
            onClick={closeDialog}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Definition for ${term}`}
            className="relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-white/15 bg-neutral-950 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white/80">
                {term}
              </h3>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Close"
                className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
              >
                X
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              {loading && !state && (
                <div className="space-y-2">
                  <div className="h-3 w-full animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-11/12 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-white/10" />
                </div>
              )}

              {state?.definition && (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90 sm:text-[15px]">
                    {state.definition}
                  </p>
                  {state.source && (
                    <p className="mt-3 text-[10px] uppercase tracking-wide text-white/45">
                      via {state.source}
                    </p>
                  )}
                </>
              )}

              {state?.error && (
                <div className="space-y-3">
                  <p className="text-sm text-red-300">{state.error}</p>
                  <button
                    type="button"
                    onClick={retryLookup}
                    className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:border-white/30 hover:text-white"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
