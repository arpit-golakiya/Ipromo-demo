"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ApiErr = { error: string };

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientError = useMemo(() => {
    if (!currentPassword.trim()) return "Current password is required";
    if (!newPassword.trim()) return "New password is required";
    if (newPassword.length < 6) return "New password must be at least 6 characters";
    if (currentPassword === newPassword) return "New password must be different";
    return null;
  }, [currentPassword, newPassword]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (clientError) {
      setError(clientError);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      const apiError =
        !res.ok && data && typeof data === "object" && typeof (data as ApiErr | null)?.error === "string"
          ? String((data as ApiErr | null)?.error)
          : null;

      if (!res.ok) throw new Error(apiError ?? "Failed to change password");

      setCurrentPassword("");
      setNewPassword("");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg items-center px-4 py-10">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Change password</h1>
          <p className="mt-1 text-sm text-slate-600">Enter your current password and choose a new one.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Current password</span>
            <div className="relative mt-1">
              <input
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:ring-2"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
              >
                {showCurrent ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-700">New password</span>
            <div className="relative mt-1">
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:ring-2"
                placeholder="At least 6 characters"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
              >
                {showNew ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Updating..." : "Change password"}
          </button>
        </form>
      </div>
    </main>
  );
}

