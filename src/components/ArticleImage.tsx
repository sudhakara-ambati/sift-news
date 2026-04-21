"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    // Reset error state when src changes so images can recover from transient failures.
    setFailed(false);
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
        onError={() => setFailed(true)}
      />
      {children}
    </>
  );
}
