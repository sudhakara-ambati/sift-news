"use client";

import { useMemo } from "react";
import TermTooltip from "./TermTooltip";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function HighlightedSummary({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}) {
  const nodes = useMemo(() => {
    if (terms.length === 0) return [text];

    const sorted = [...new Set(terms)]
      .filter((t) => t.trim().length > 1)
      .sort((a, b) => b.length - a.length);
    if (sorted.length === 0) return [text];

    const pattern = sorted.map(escapeRegex).join("|");
    const regex = new RegExp(`(${pattern})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, i) => {
      if (!part) return null;
      const matched = sorted.find(
        (t) => t.toLowerCase() === part.toLowerCase(),
      );
      if (matched) {
        return (
          <TermTooltip key={i} term={matched}>
            {part}
          </TermTooltip>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }, [text, terms]);

  return (
    <div className="whitespace-pre-wrap text-base leading-relaxed text-white/85">
      {nodes}
    </div>
  );
}
