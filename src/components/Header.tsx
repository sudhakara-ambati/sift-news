import { Suspense } from "react";
import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";
import RefreshButton from "@/components/RefreshButton";
import SearchBar from "@/components/SearchBar";

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex items-baseline gap-5 sm:gap-6">
          <Link
            href="/"
            className="font-serif text-xl font-bold tracking-tight text-white"
          >
            Sift
          </Link>
          <nav className="flex gap-4 text-xs uppercase tracking-wider text-white/55 sm:text-[13px]">
            <Link href="/" className="hover:text-white">
              Feed
            </Link>
            <Link href="/tags" className="hover:text-white">
              Tags
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <SearchBar />
          <Suspense fallback={null}>
            <RefreshButton />
          </Suspense>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
