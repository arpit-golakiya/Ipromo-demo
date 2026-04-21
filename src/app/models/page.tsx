import { headers } from "next/headers";
import AllProductsClient, { type LibraryProduct } from "./AllProductsClient";

type LibraryResponse = {
  products?: LibraryProduct[];
  nextCursor?: string | null;
};

async function getOriginFromHeaders(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    "localhost:3000";

  const normalizedHost = host.startsWith("http") ? new URL(host).host : host;
  return `${proto}://${normalizedHost}`;
}

export default async function ModelsPage() {
  const origin = await getOriginFromHeaders();
  const url = new URL("/api/library", origin);
  url.searchParams.set("q", "");
  url.searchParams.set("pageSize", "12");

  const res = await fetch(url.toString(), {
    // Cache on the server between requests to avoid cold-start spikes.
    next: { revalidate: 60 },
  });

  const data: LibraryResponse = await res.json().catch(() => ({}));
  const initialProducts = Array.isArray(data.products) ? data.products : [];
  const initialNextCursor = typeof data.nextCursor === "string" ? data.nextCursor : null;

  return <AllProductsClient initialProducts={initialProducts} initialNextCursor={initialNextCursor} />;
}

