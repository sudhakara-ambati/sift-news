"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  refreshArticles,
  refreshTagArticles,
} from "@/app/(app)/actions";

export default function RefreshButton() {
  const searchParams = useSearchParams();
  const activeTagId = searchParams.get("tag");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function run(which: "tag" | "all") {
    setStatus(null);
    startTransition(async () => {
      const res =
        which === "tag" && activeTagId
          ? await refreshTagArticles(activeTagId)
          : await refreshArticles();
      if (res.ok) {
        setStatus(res.inserted > 0 ? `+${res.inserted} new` : "Up to date");
      } else {
        setStatus(res.error);
      }
      setTimeout(() => setStatus(null), 4000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {status && <span className="text-xs text-white/60">{status}</span>}
      {activeTagId && (
        <button
          type="button"
          onClick={() => run("tag")}
          disabled={pending}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          title="Fetch latest articles for the active tag"
        >
          {pending ? "…" : "Refresh tag"}
        </button>
      )}
      <button
        type="button"
        onClick={() => run("all")}
        disabled={pending}
        className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        title="Fetch latest articles across all sources and tags"
      >
        {pending ? "Refreshing…" : "Refresh all"}
      </button>
    </div>
  );
}
