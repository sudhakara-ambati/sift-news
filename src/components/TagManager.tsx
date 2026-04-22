"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTag,
  deleteTag,
  generateQueryTerms,
  purgeTagArticles,
  updateTag,
} from "@/app/(app)/tags/actions";
import { refreshTagArticles } from "@/app/(app)/actions";

type TagRow = {
  id: string;
  name: string;
  queryTerms: string;
  articleCount: number;
};

export default function TagManager({ tags }: { tags: TagRow[] }) {
  const [visibleTags, addOptimisticTag] = useOptimistic<TagRow[], TagRow>(
    tags,
    (state, created) => {
      if (state.some((t) => t.id === created.id)) return state;
      return [...state, created].sort((a, b) => a.name.localeCompare(b.name));
    },
  );

  return (
    <div className="space-y-6">
      <NewTagForm onCreated={addOptimisticTag} />
      <div className="space-y-3">
        {visibleTags.length === 0 ? (
          <p className="rounded-lg border border-white/10 p-6 text-center text-sm text-white/60">
            No tags yet. Add one above.
          </p>
        ) : (
          visibleTags.map((tag) => <TagRow key={tag.id} tag={tag} />)
        )}
      </div>
    </div>
  );
}

function NewTagForm({ onCreated }: { onCreated: (tag: TagRow) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [queryTerms, setQueryTerms] = useState("");
  const [generating, setGenerating] = useState(false);
  const [postCreateStatus, setPostCreateStatus] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    const res = await generateQueryTerms(name);
    setGenerating(false);
    if (!res.ok) setError(res.error);
    else setQueryTerms(res.queryTerms);
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm text-white hover:border-white/30 hover:bg-white/10"
        >
          + Add tag
        </button>
        {postCreateStatus && (
          <p className="text-xs text-white/60">{postCreateStatus}</p>
        )}
      </div>
    );
  }

  return (
    <form
      action={(fd) => {
        setError(null);
        setPostCreateStatus(null);
        startTransition(async () => {
          const snapshotName = name.trim();
          const snapshotQuery = queryTerms.trim();
          const res = await createTag(fd);
          if (!res.ok) setError(res.error);
          else {
            setOpen(false);
            setName("");
            setQueryTerms("");
            onCreated({
              id: res.id,
              name: snapshotName,
              queryTerms: snapshotQuery,
              articleCount: 0,
            });

            // Fetch articles for the new tag without blocking tag creation UX.
            setPostCreateStatus("Tag added. Fetching articles…");
            void (async () => {
              const refreshed = await refreshTagArticles(res.id);
              if (refreshed.ok) {
                const attached =
                  "attached" in refreshed ? refreshed.attached ?? 0 : 0;
                const total = refreshed.inserted + attached;
                setPostCreateStatus(
                  total > 0 ? `Fetched +${total} new` : "No matches found yet",
                );
              } else {
                setPostCreateStatus(refreshed.error);
              }
              router.refresh();
              setTimeout(() => setPostCreateStatus(null), 5000);
            })();
          }
        });
      }}
      className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4"
    >
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">
          Name
        </label>
        <input
          name="name"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Israel-Iran war"
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-[16px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none sm:text-sm"
        />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="block text-xs uppercase tracking-wide text-white/60">
            Query terms
          </label>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !name.trim()}
            className="text-xs text-white/60 underline decoration-dotted underline-offset-2 hover:text-white disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate with AI"}
          </button>
        </div>
        <textarea
          name="queryTerms"
          required
          maxLength={500}
          rows={3}
          value={queryTerms}
          onChange={(e) => setQueryTerms(e.target.value)}
          placeholder={
            '"UK politics" OR Westminster OR "Downing Street"'
          }
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-[16px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none sm:text-xs"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <p className="text-xs text-white/50">
        Tip: after adding a tag, Sift fetches articles in the background. You
        can also use <span className="whitespace-nowrap">Refresh tag</span> in
        the header any time.
      </p>
      {postCreateStatus && (
        <p className="text-xs text-white/60">{postCreateStatus}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
        >
          {pending ? "Adding..." : "Add tag"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/70 hover:border-white/30 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function TagRow({ tag }: { tag: TagRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <EditTagForm tag={tag} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h3 className="text-base font-medium">{tag.name}</h3>
            <span className="text-xs text-white/40">
              {tag.articleCount} article
              {tag.articleCount === 1 ? "" : "s"}
            </span>
          </div>
          <code className="mt-2 block break-words font-mono text-xs text-white/60">
            {tag.queryTerms}
          </code>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-white/30 hover:text-white"
          >
            Edit
          </button>
          <PurgeButton tag={tag} />
          <DeleteButton tag={tag} />
        </div>
      </div>
    </div>
  );
}

function EditTagForm({
  tag,
  onDone,
}: {
  tag: TagRow;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(tag.name);
  const [queryTerms, setQueryTerms] = useState(tag.queryTerms);
  const [generating, setGenerating] = useState(false);

  async function handleRegenerate() {
    setError(null);
    setGenerating(true);
    const res = await generateQueryTerms(name);
    setGenerating(false);
    if (!res.ok) setError(res.error);
    else setQueryTerms(res.queryTerms);
  }

  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const res = await updateTag(tag.id, fd);
          if (!res.ok) setError(res.error);
          else onDone();
        });
      }}
      className="space-y-3 rounded-lg border border-white/20 bg-white/[0.04] p-4"
    >
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">
          Name
        </label>
        <input
          name="name"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-[16px] text-white focus:border-white/30 focus:outline-none sm:text-sm"
        />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="block text-xs uppercase tracking-wide text-white/60">
            Query terms
          </label>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={generating || !name.trim()}
            className="text-xs text-white/60 underline decoration-dotted underline-offset-2 hover:text-white disabled:opacity-40"
          >
            {generating ? "Regenerating…" : "Regenerate with AI"}
          </button>
        </div>
        <textarea
          name="queryTerms"
          required
          maxLength={500}
          rows={3}
          value={queryTerms}
          onChange={(e) => setQueryTerms(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-[16px] text-white focus:border-white/30 focus:outline-none sm:text-xs"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/70 hover:border-white/30 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PurgeButton({ tag }: { tag: TagRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await purgeTagArticles(tag.id);
              setConfirming(false);
            })
          }
          className="rounded-md bg-amber-500/80 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-500 disabled:opacity-50"
        >
          {pending ? "Purging..." : "Confirm purge"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-white/30 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Delete all articles currently tagged here, then refetch from scratch"
      className="rounded-md border border-amber-500/30 px-3 py-1.5 text-xs text-amber-300 hover:border-amber-500/60 hover:text-amber-200"
    >
      Purge & refetch
    </button>
  );
}

function DeleteButton({ tag }: { tag: TagRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:border-red-500/60 hover:text-red-200 disabled:opacity-50"
      >
        Delete
      </button>
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-black p-4 shadow-xl">
            <h3 className="text-sm font-semibold">Delete “{tag.name}”?</h3>
            <p className="mt-1 text-xs text-white/60">
              This removes the tag. Articles already fetched will stay in your
              feed.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="rounded-md border border-white/15 px-3 py-2 text-xs text-white/70 hover:border-white/30 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteTag(tag.id);
                    setConfirming(false);
                  })
                }
                className="rounded-md bg-red-500/80 px-3 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {pending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
