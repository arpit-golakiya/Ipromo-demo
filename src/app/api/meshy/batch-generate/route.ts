import { NextRequest, NextResponse } from "next/server";
import { startMeshyTask } from "@/lib/meshy";

export const maxDuration = 300;

type BatchItemInput = {
  key: string;
  imageUrl: string;
  colorLabel?: string;
  colorHex?: string;
};

type BatchItemResult = {
  key: string;
  imageUrl: string;
  colorLabel?: string;
  colorHex?: string;
  taskId: string | null;
  error: string | null;
};

function isRetryableStartError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("502")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startTaskWithRetry(
  imageUrl: string,
  removeLogosFor3D: boolean,
): Promise<string> {
  let lastError = "Failed to start generation";
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await startMeshyTask({ imageUrl, removeLogosFor3D });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Failed to start generation";
      if (attempt >= maxAttempts || !isRetryableStartError(lastError)) break;
      await sleep(900 * attempt);
    }
  }

  throw new Error(lastError);
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      out[current] = await worker(items[current]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: NextRequest) {
  let body: {
    items?: BatchItemInput[];
    removeLogosFor3D?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Missing items in request body" }, { status: 400 });
  }

  try {
    const results = await runWithConcurrency(items, 3, async (item): Promise<BatchItemResult> => {
      if (!item.imageUrl || typeof item.imageUrl !== "string") {
        return {
          key: item.key,
          imageUrl: item.imageUrl,
          colorLabel: item.colorLabel,
          colorHex: item.colorHex,
          taskId: null,
          error: "Missing imageUrl",
        };
      }
      try {
        const taskId = await startTaskWithRetry(item.imageUrl, body.removeLogosFor3D === true);
        return {
          key: item.key,
          imageUrl: item.imageUrl,
          colorLabel: item.colorLabel,
          colorHex: item.colorHex,
          taskId,
          error: null,
        };
      } catch (err) {
        return {
          key: item.key,
          imageUrl: item.imageUrl,
          colorLabel: item.colorLabel,
          colorHex: item.colorHex,
          taskId: null,
          error: err instanceof Error ? err.message : "Failed to start generation",
        };
      }
    });

    return NextResponse.json({ items: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

