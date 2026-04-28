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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim() && password.trim(), [email, password]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await postJson<ApiOk>("/api/auth/login", { email, password });
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg items-center px-4 py-10">
      <div className="w-full rounded-xl border border-white/10 bg-black/30 p-6 backdrop-blur">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-white">Login</h1>
          <p className="mt-1 text-sm text-zinc-300">Sign in to access the configurator.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-zinc-200">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-500 focus:border-white/20"
              placeholder="you@company.com"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-200">Password</span>
            <div className="relative mt-1">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 pr-10 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-500 focus:border-white/20"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-zinc-300 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </label>

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit || loading}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-300">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-white underline underline-offset-4 hover:text-white/90">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}