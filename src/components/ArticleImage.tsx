"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const BROKEN_KEY = "sift-broken-imgs";
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function getBrokenSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(BROKEN_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set();
}

function addBroken(src: string) {
  try {
    const set = getBrokenSet();
    set.add(src);
    sessionStorage.setItem(BROKEN_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

type Props = {
  src: string;
  className: string;
  loading?: "eager" | "lazy";
  fallback: React.ReactNode;
  children?: React.ReactNode;
};

export default function ArticleImage({
  src,
  className,
  loading,
  fallback,
  children,
}: Props) {
  const [failed, setFailed] = useState(false);

  useIsoLayoutEffect(() => {
    setFailed(getBrokenSet().has(src));
  }, [src]);

  if (failed) return <>{fallback}</>;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading={loading ?? "lazy"}
        className={className}
        onError={() => {
          addBroken(src);
          setFailed(true);
        }}
      />
      {children}
    </>
  );
}
