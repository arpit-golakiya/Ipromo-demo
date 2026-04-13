import { NextRequest, NextResponse } from "next/server";
import { getHyper3dTaskStatus } from "@/lib/hyper3d";

type BatchStatusItemInput = {
  key: string;
  taskId: string;
};

export async function POST(req: NextRequest) {
  let body: { items?: BatchStatusItemInput[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Missing items in request body" }, { status: 400 });
  }

  try {
    const statuses = await Promise.all(
      items.map(async (item) => {
        try {
          const status = await getHyper3dTaskStatus(item.taskId);
          return {
            key: item.key,
            taskId: item.taskId,
            ...status,
          };
        } catch (err) {
          return {
            key: item.key,
            taskId: item.taskId,
            status: "FAILED" as const,
            progress: 0,
            modelUrl: null,
            error: err instanceof Error ? err.message : "Status check failed",
          };
        }
      }),
    );

    return NextResponse.json({ items: statuses });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
