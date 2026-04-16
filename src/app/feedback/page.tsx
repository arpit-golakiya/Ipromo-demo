"use client";

import { useMemo, useState } from "react";

type SubmitState = "idle" | "submitting" | "success" | "error";

export default function FeedbackPage() {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => message.trim().length >= 3 && state !== "submitting", [message, state]);

  const submit = async () => {
    if (!canSubmit) return;
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          path: typeof window !== "undefined" ? window.location.pathname : null,
        }),
      });
      const data: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to submit feedback");
      }
      setState("success");
      setMessage("");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Failed to submit feedback");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[900px] px-3 py-6 sm:px-4 md:px-6">
      <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-6">
        <h1 className="text-lg font-semibold text-white">Submit Feedback</h1>
        <p className="mt-1 text-sm text-zinc-300">
          What&rsquo;s one thing you&rsquo;d change or add to make this easier to use?
        </p>

        <div className="mt-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="Type your feedback…"
            className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none ring-blue-500/40 focus:ring-2"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              {message.trim().length < 3 ? "Please enter at least 3 characters." : "\u00A0"}
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-indigo-500"
            >
              {state === "submitting" ? "Submitting…" : "Submit"}
            </button>
          </div>

          {state === "success" ? (
            <p className="mt-3 text-sm text-emerald-300">Thanks — feedback submitted.</p>
          ) : null}
          {state === "error" ? (
            <p className="mt-3 text-sm text-red-300">{error ?? "Failed to submit feedback"}</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

