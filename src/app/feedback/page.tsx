"use client";

import { useEffect, useMemo, useState } from "react";

const QUESTION = "What's one thing you'd change or add to make this easier to use?";

export default function FeedbackPage() {
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => answer.trim().length > 0 && status !== "submitting", [answer, status]);

  useEffect(() => {
    if (status !== "success") return;
    const t = window.setTimeout(() => setStatus("idle"), 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          v: 1,
          question: QUESTION,
          answer: answer.trim(),
          meta: {
            pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to submit feedback");
      }

      setStatus("success");
      setAnswer("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-10 sm:px-4 md:px-6">
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-white">
        Feedback
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Help us improve the configurator.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <div className="text-sm font-medium text-zinc-200">{QUESTION}</div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={5}
            placeholder="Type your answer…"
            className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-zinc-500 focus:border-indigo-500/60 focus:outline-none"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex cursor-pointer items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "submitting" ? "Submitting…" : "Submit"}
          </button>

          {status === "success" ? (
            <span className="text-sm text-emerald-300">Thanks — received.</span>
          ) : null}
          {status === "error" ? (
            <span className="text-sm text-rose-300">
              {error ?? "Something went wrong."}
            </span>
          ) : null}
        </div>
      </form>
    </main>
  );
}