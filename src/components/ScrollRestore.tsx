"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PREFIX = "sift-scroll:";

export default function ScrollRestore() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = `${PREFIX}${pathname}?${searchParams?.toString() ?? ""}`;

    const saved = sessionStorage.getItem(key);
    if (saved) {
      const y = parseInt(saved, 10);
      if (!isNaN(y) && y > 0) {
        let attempts = 0;
        const tryScroll = () => {
          window.scrollTo(0, y);
          attempts++;
          const reached = Math.abs(window.scrollY - y) <= 2;
          const atBottom =
            window.scrollY + window.innerHeight >=
            document.documentElement.scrollHeight - 2;
          if (!reached && !atBottom && attempts < 10) {
            requestAnimationFrame(tryScroll);
          }
        };
        requestAnimationFrame(tryScroll);
      }
    }

    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        sessionStorage.setItem(key, String(window.scrollY));
        pending = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname, searchParams]);

  return null;
}
