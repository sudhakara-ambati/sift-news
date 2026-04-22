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

    const canonicalByLower = new Map(sorted.map((t) => [t.toLowerCase(), t]));
    const pattern = sorted
      .map((t) => escapeRegex(t).replace(/\s+/g, "\\s+"))
      .join("|");
    const regex = new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, "gi");

    const out: React.ReactNode[] = [];
    let key = 0;
    let last = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const leading = match[1] ?? "";
      const matchedText = match[2] ?? "";
      const leadingStart = match.index;
      const termStart = leadingStart + leading.length;
      const termEnd = termStart + matchedText.length;

      if (leadingStart > last) {
        out.push(<span key={key++}>{text.slice(last, leadingStart)}</span>);
      }
      if (leading) {
        out.push(<span key={key++}>{leading}</span>);
      }

      const canonical = canonicalByLower.get(matchedText.toLowerCase()) ?? matchedText;
      out.push(
        <TermTooltip key={key++} term={canonical}>
          {text.slice(termStart, termEnd)}
        </TermTooltip>,
      );
      last = termEnd;
    }

    if (last < text.length) {
      out.push(<span key={key++}>{text.slice(last)}</span>);
    }

    return out.length > 0 ? out : [text];
  }, [text, terms]);

  return (
    <div className="whitespace-pre-wrap text-base leading-relaxed text-white/85">
      {nodes}
    </div>
  );
}
