"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";

type ApiOk = { user: { id: string; email: string; username: string } };
type ApiErr = { error: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((data as ApiErr | null)?.error ?? "Request failed");
  return data;
}

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => username.trim() && email.trim() && password.trim(),
    [username, email, password],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await postJson<ApiOk>("/api/auth/signup", { username, email, password });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg items-center px-4 py-10">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign up</h1>
          <p className="mt-1 text-sm text-slate-600">Create an account to start designing.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              type="text"
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:ring-2"
              placeholder="Your name"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-700">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:ring-2"
              placeholder="you@company.com"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-700">Password</span>
            <div className="relative mt-1">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:ring-2"
                placeholder="At least 6 characters"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
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
            disabled={!canSubmit || loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-blue-700 underline underline-offset-4 hover:text-blue-800">
            Login
          </Link>
        </p>
      </div>
    </main>
  );
}