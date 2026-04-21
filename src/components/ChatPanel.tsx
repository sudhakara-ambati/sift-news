"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  model?: string | null;
};

type Props = {
  articleId: string;
  initialMessages: Message[];
};

export default function ChatPanel({ articleId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, pending]);

  async function send(question: string) {
    setPending(true);
    setError(null);

    const tempUserId = `local-u-${Date.now()}`;
    const tempAssistantId = `local-a-${Date.now()}`;
    const now = new Date().toISOString();

    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: "user", content: question, createdAt: now },
      { id: tempAssistantId, role: "assistant", content: "", createdAt: now },
    ]);
    setInput("");

    try {
      const res = await fetch(`/api/articles/${articleId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong.");
        setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
        return;
      }

      const modelUsed = res.headers.get("x-ai-model");
      if (modelUsed) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantId ? { ...m, model: modelUsed } : m,
          ),
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assembled += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantId ? { ...m, content: assembled } : m,
          ),
        );
      }
    } catch (err) {
      console.error(err);
      setError("Network error. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = input.trim();
    if (!q || pending) return;
    send(q);
  }

  return (
    <section className="mt-8 border-t border-white/10 pt-5">
      <h2 className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/60 sm:text-xs">
        <span className="h-px flex-none bg-white/25" style={{ width: 24 }} />
        Ask a follow-up
      </h2>

      {messages.length > 0 || pending ? (
        <div className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              role={m.role}
              content={m.content || (m.role === "assistant" && pending ? "…" : "")}
              muted={m.role === "assistant" && pending && !m.content}
              model={m.model ?? null}
            />
          ))}
          <div ref={endRef} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-white/45">
          Ask anything about this article — context, background, what&apos;s
          implied, or what to read next.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const q = input.trim();
              if (q && !pending) send(q);
            }
          }}
          rows={1}
          placeholder="Ask a question…"
          disabled={pending}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 text-[16px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-50 sm:text-sm"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function MessageBubble({
  role,
  content,
  muted,
  model,
}: {
  role: string;
  content: string;
  muted?: boolean;
  model?: string | null;
}) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm text-black">
          {content}
        </div>
      </div>
    );
  }
  const isFallback = model?.startsWith("gemma-");
  return (
    <div className="flex flex-col items-start">
      <div
        className={`max-w-[85%] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/85 ${muted ? "animate-pulse text-white/40" : ""}`}
      >
        <div className="prose-chat">
          <ReactMarkdown
            components={{
              p: ({ children }) => (
                <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              strong: ({ children }) => (
                <strong className="font-semibold text-white">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-white/40 underline-offset-2 hover:decoration-white"
                >
                  {children}
                </a>
              ),
              code: ({ children }) => (
                <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">
                  {children}
                </code>
              ),
              h1: ({ children }) => (
                <h3 className="mb-1 text-sm font-semibold text-white">{children}</h3>
              ),
              h2: ({ children }) => (
                <h3 className="mb-1 text-sm font-semibold text-white">{children}</h3>
              ),
              h3: ({ children }) => (
                <h3 className="mb-1 text-sm font-semibold text-white">{children}</h3>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
      {isFallback && !muted && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200/90">
          <span aria-hidden>⚠</span>
          Fallback model — no web search
        </p>
      )}
    </div>
  );
}
