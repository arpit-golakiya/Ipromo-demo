import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Page not found</h1>
      <p className="text-sm text-zinc-400">The page you’re looking for doesn’t exist.</p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
      >
        Go home
      </Link>
    </main>
  );
}

