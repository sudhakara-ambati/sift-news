"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function BackToFeed() {
  const [href, setHref] = useState("/");

  useEffect(() => {
    const saved = sessionStorage.getItem("sift-feed-return");
    if (saved && saved.startsWith("/")) setHref(saved);
  }, []);

  return (
    <Link
      href={href}
      className="mb-5 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-white/50 hover:text-white/80"
    >
      <span aria-hidden>←</span> Feed
    </Link>
  );
}
