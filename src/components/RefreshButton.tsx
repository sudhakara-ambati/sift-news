"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  refreshArticles,
  refreshTagArticles,
} from "@/app/(app)/actions";

const REFRESH_TAG_TIMEOUT_MS = 90_000;
const REFRESH_ALL_TIMEOUT_MS = 240_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("refresh-timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function RefreshButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTagId = searchParams.get("tag");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  function showStatus(message: string) {
    setStatus(message);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setStatus(null), 4000);
  }

  async function run(which: "tag" | "all") {
    if (pending) return;
    setPending(true);
    setStatus(null);
    try {
      const res = await withTimeout(
        which === "tag" && activeTagId
          ? refreshTagArticles(activeTagId)
          : refreshArticles(),
        which === "all" ? REFRESH_ALL_TIMEOUT_MS : REFRESH_TAG_TIMEOUT_MS,
      );

      if (res.ok) {
        showStatus(res.inserted > 0 ? `+${res.inserted} new` : "Up to date");
        router.refresh();
      } else {
        showStatus(res.error);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "refresh-timeout") {
        showStatus("Refresh is taking longer than expected. Please try again.");
      } else {
        showStatus("Refresh failed. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status && <span className="text-xs text-white/60">{status}</span>}
      {activeTagId && (
        <button
          type="button"
          onClick={() => void run("tag")}
          disabled={pending}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
          title="Fetch latest articles for the active tag"
        >
          {pending ? "…" : "Refresh tag"}
        </button>
      )}
      <button
        type="button"
        onClick={() => void run("all")}
        disabled={pending}
        className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
        title="Fetch latest articles across all sources and tags"
      >
        {pending ? "Refreshing…" : "Refresh all"}
      </button>
    </div>
  );
}
