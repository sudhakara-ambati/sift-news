"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Props = {
  variant?: "inline" | "full";
};

export default function SearchBar({ variant = "inline" }: Props) {
  const searchParams = useSearchParams();
  const hasActiveQuery = Boolean(searchParams.get("q")?.trim());

  const inputWidth =
    variant === "full"
      ? "w-full"
      : "w-60 lg:w-72";

  return (
    <form
      action="/search"
      method="get"
      role="search"
      className="flex w-full items-center gap-2"
    >
      <input
        type="search"
        name="q"
        placeholder="OpenAI, Sam Altman, ChatGPT"
        aria-label="Search news by comma-separated keywords"
        autoComplete="off"
        inputMode="search"
        enterKeyHint="search"
        className={`${inputWidth} rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-base text-white/90 placeholder:text-white/35 focus:border-white/35 focus:outline-none focus:ring-0 sm:text-xs`}
      />
      {hasActiveQuery ? (
        <Link
          href="/"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/5 text-xs font-semibold text-white/75 hover:border-white/30 hover:text-white"
          aria-label="Clear search and go back to feed"
          title="Back to feed"
        >
          X
        </Link>
      ) : null}
    </form>
  );
}
