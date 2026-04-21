"use client";

import { useEffect, useState } from "react";
import HighlightedSummary from "./HighlightedSummary";

type Props = {
  articleId: string;
  initialSummary: string | null;
  initialTerms: string[];
  initialModel?: string | null;
};

export default function ArticleSummary({
  articleId,
  initialSummary,
  initialTerms,
  initialModel,
}: Props) {
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [terms, setTerms] = useState<string[]>(initialTerms);
  const [loading, setLoading] = useState(!initialSummary);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(initialModel ?? null);

  function retry() {
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/summary`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Couldn't generate summary.");
        } else {
          setSummary(data.summary);
          setTerms(Array.isArray(data.terms) ? data.terms : []);
          setModel(typeof data.model === "string" ? data.model : null);
        }
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    })();
  }

  useEffect(() => {
    if (initialSummary) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/articles/${articleId}/summary`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't generate summary.");
        } else {
          setSummary(data.summary);
          setTerms(Array.isArray(data.terms) ? data.terms : []);
          setModel(typeof data.model === "string" ? data.model : null);
        }
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, initialSummary]);

  return (
    <section className="mt-8 border-t border-white/10 pt-5">
      <h2 className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/60 sm:text-xs">
        <span className="h-px flex-none bg-white/25" style={{ width: 24 }} />
        The gist
      </h2>
      {loading && (
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-white/10" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/10" />
        </div>
      )}
      {error && !loading && (
        <div className="mt-3 flex items-start justify-between gap-3">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 rounded-md border border-white/15 px-3 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}
      {summary && !loading && (
        <div className="mt-3">
          <HighlightedSummary text={summary} terms={terms} />
          {model && model.startsWith("gemma-") && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-200/90">
              <span aria-hidden>⚠</span>
              Fallback model ({model}) — Gemini quota exhausted
            </p>
          )}
        </div>
      )}
    </section>
  );
}
