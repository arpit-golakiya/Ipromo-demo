import {
  cleanProductImageBufferToDataUrl,
  loadImageBufferFromUrl,
} from "@/lib/cleanProductImageFor3d";

const RODIN_BASE = (
  process.env.HYPER3D_API_BASE || "https://api.hyper3d.com/api/v2"
).replace(/\/$/, "");

export type Hyper3dJobRefV1 = {
  v: 1;
  taskUuid: string;
  subscriptionKey: string;
};

export type Hyper3dTaskStatus = {
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  progress: number;
  modelUrl: string | null;
  error: string | null;
};

function normalizeBearerKey(raw: string | undefined): string {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (/^Bearer\s+/i.test(s)) s = s.replace(/^Bearer\s+/i, "").trim();
  return s;
}

function requireHyper3dApiKey(): string {
  const apiKey = normalizeBearerKey(process.env.HYPER3D_API_KEY);
  if (!apiKey) {
    throw new Error("HYPER3D_API_KEY is not configured on the server");
  }
  return apiKey;
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function encodeHyper3dJobRef(ref: Hyper3dJobRefV1): string {
  return Buffer.from(JSON.stringify(ref), "utf8").toString("base64url");
}

export function decodeHyper3dJobRef(token: string): Hyper3dJobRefV1 | null {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const o = JSON.parse(raw) as Hyper3dJobRefV1;
    if (o?.v !== 1 || typeof o.taskUuid !== "string" || typeof o.subscriptionKey !== "string") {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

/** Rodin `task_uuid` only (e.g. from Supabase preload after a completed job). */
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

type ImagePart = { buffer: Buffer; filename: string; contentType: string };

async function resolveImageUrlsToParts(
  imageUrls: string[],
  removeLogosFor3D: boolean,
): Promise<ImagePart[]> {
  const unique = [...new Set(imageUrls.map((u) => u.trim()).filter(Boolean))].slice(0, 5);
  if (unique.length === 0) {
    throw new Error("At least one image URL is required");
  }

  const parts: ImagePart[] = [];
  for (let i = 0; i < unique.length; i += 1) {
    const url = unique[i];
    let buffer: Buffer;
    let contentType: string;
    try {
      const loaded = await loadImageBufferFromUrl(url);
      buffer = loaded.buffer;
      contentType = loaded.contentType;
    } catch (e) {
      throw new Error(`Failed to load image ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (removeLogosFor3D) {
      try {
        const dataUrl = await cleanProductImageBufferToDataUrl(buffer, contentType, url);
        const again = await loadImageBufferFromUrl(dataUrl);
        buffer = again.buffer;
        contentType = again.contentType;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown cleanup error";
        console.warn(`[hyper3d] Cleanup fallback to original image ${i + 1}: ${message}`);
      }
    }

    const ext =
      contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    parts.push({
      buffer,
      filename: `view-${i + 1}.${ext}`,
      contentType: contentType.startsWith("image/") ? contentType : `image/${ext}`,
    });
  }
  return parts;
}

/**
 * POST /api/v2/rodin — multipart (official Hyper3D Rodin).
 * https://developer.hyper3d.ai/api-specification/rodin-generation
 */
/** Fixed Rodin settings (aligned with product default: high quality, concat multi-view, no HighPack). */
async function submitRodinGeneration(parts: ImagePart[]): Promise<Hyper3dJobRefV1> {
  const apiKey = requireHyper3dApiKey();
  const form = new FormData();
  for (const p of parts) {
    const blob = new Blob([new Uint8Array(p.buffer)], { type: p.contentType });
    form.append("images", blob, p.filename);
  }
  form.append("tier", "Regular");
  form.append("quality", "high");
  form.append("geometry_file_format", "glb");
  form.append("material", "PBR");
  if (parts.length > 1) {
    form.append("condition_mode", "concat");
  }

  const res = await fetch(`${RODIN_BASE}/rodin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      JSON.stringify(data);
    throw new Error(`Rodin submit failed (${res.status}): ${msg}`);
  }
  if (data.error) {
    throw new Error(`Rodin error: ${String(data.error)}`);
  }

  const taskUuid = typeof data.uuid === "string" ? data.uuid : "";
  const jobs = data.jobs as { subscription_key?: string } | undefined;
  const subscriptionKey =
    jobs && typeof jobs.subscription_key === "string" ? jobs.subscription_key : "";
  if (!taskUuid || !subscriptionKey) {
    throw new Error(`Unexpected Rodin response: ${JSON.stringify(data)}`);
  }

  return { v: 1, taskUuid, subscriptionKey };
}

async function fetchRodinStatus(subscriptionKey: string): Promise<Record<string, unknown>> {
  const apiKey = requireHyper3dApiKey();
  const res = await fetch(`${RODIN_BASE}/status`, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ subscription_key: subscriptionKey }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      JSON.stringify(data);
    throw new Error(`Rodin status failed (${res.status}): ${msg}`);
  }
  if (data.error) {
    throw new Error(`Rodin status error: ${String(data.error)}`);
  }
  return data;
}

export async function fetchRodinGlbDownloadUrl(taskUuid: string): Promise<string> {
  const apiKey = requireHyper3dApiKey();
  const res = await fetch(`${RODIN_BASE}/download`, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ task_uuid: taskUuid }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (typeof data.message === "string" && data.message) ||
      (typeof data.error === "string" && data.error) ||
      JSON.stringify(data);
    throw new Error(`Rodin download failed (${res.status}): ${msg}`);
  }
  if (data.error) {
    throw new Error(`Rodin download error: ${String(data.error)}`);
  }
  const list = data.list as Array<{ name?: string; url?: string }> | undefined;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`No files in download list: ${JSON.stringify(data)}`);
  }
  const glb =
    list.find((item) => /\.glb$/i.test(item.name || "")) || list[0];
  if (!glb?.url || typeof glb.url !== "string") {
    throw new Error(`No GLB URL in download list: ${JSON.stringify(data)}`);
  }
  return glb.url;
}

function normalizeJobStatuses(
  jobs: Array<{ status?: string; progress?: number }>,
): Hyper3dTaskStatus {
  if (jobs.length === 0) {
    return {
      status: "IN_PROGRESS",
      progress: 5,
      modelUrl: null,
      error: null,
    };
  }

  const failed = jobs.find((j) => {
    const s = String(j.status || "").toLowerCase();
    return s === "failed" || s === "error";
  });
  if (failed) {
    return {
      status: "FAILED",
      progress: 0,
      modelUrl: null,
      error: "Rodin job failed",
    };
  }

  const allDone = jobs.every((j) => {
    const s = String(j.status || "").toLowerCase();
    return s === "done" || s === "completed" || s === "success";
  });

  if (allDone) {
    return {
      status: "SUCCEEDED",
      progress: 100,
      modelUrl: null,
      error: null,
    };
  }

  const nums = jobs
    .map((j) => (typeof j.progress === "number" && Number.isFinite(j.progress) ? j.progress : null))
    .filter((n): n is number => n != null);
  const progress =
    nums.length > 0
      ? Math.min(99, Math.round(nums.reduce((a, b) => a + b, 0) / nums.length))
      : 35;

  return {
    status: "IN_PROGRESS",
    progress,
    modelUrl: null,
    error: null,
  };
}

export async function getHyper3dTaskStatus(taskToken: string): Promise<Hyper3dTaskStatus> {
  const ref = decodeHyper3dJobRef(taskToken);
  if (ref) {
    const payload = await fetchRodinStatus(ref.subscriptionKey);
    const jobs = (payload.jobs as Array<{ status?: string; progress?: number }>) || [];
    const base = normalizeJobStatuses(jobs);
    if (base.status === "SUCCEEDED") {
      try {
        const modelUrl = await fetchRodinGlbDownloadUrl(ref.taskUuid);
        return { ...base, modelUrl };
      } catch {
        return {
          status: "IN_PROGRESS",
          progress: Math.max(base.progress, 90),
          modelUrl: null,
          error: null,
        };
      }
    }
    return base;
  }

  if (looksLikeUuid(taskToken)) {
    try {
      const modelUrl = await fetchRodinGlbDownloadUrl(taskToken.trim());
      return {
        status: "SUCCEEDED",
        progress: 100,
        modelUrl,
        error: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download not ready";
      return {
        status: "IN_PROGRESS",
        progress: 50,
        modelUrl: null,
        error: msg.includes("404") || msg.toLowerCase().includes("not ready") ? null : msg,
      };
    }
  }

  return {
    status: "FAILED",
    progress: 0,
    modelUrl: null,
    error: "Invalid Hyper3D job reference",
  };
}

export type StartRodinTaskOptions = {
  imageUrls: string[];
  removeLogosFor3D?: boolean;
};

/**
 * Starts a Rodin image-to-3D job. Returns an opaque token (base64url JSON)
 * used with status + model routes until the job completes; after that,
 * `taskUuid` alone is enough for `/download`.
 *
 * Rodin parameters are fixed: quality `high`, multi-image `concat`, no HighPack (4K).
 */
export async function startRodinTask(options: StartRodinTaskOptions): Promise<string> {
  const parts = await resolveImageUrlsToParts(
    options.imageUrls,
    options.removeLogosFor3D === true,
  );
  const ref = await submitRodinGeneration(parts);
  return encodeHyper3dJobRef(ref);
}
