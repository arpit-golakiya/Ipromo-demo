import {
  cleanProductImageBufferToMeshyDataUrl,
  loadImageBufferFromUrl,
} from "@/lib/cleanProductImageFor3d";

type StartMeshyTaskOptions = {
  imageUrl: string;
  removeLogosFor3D?: boolean;
};

export type MeshyTaskStatus = {
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  progress: number;
  modelUrl: string | null;
  error: string | null;
};

function requireMeshyApiKey(): string {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    throw new Error("Meshy API key not configured on the server");
  }
  return apiKey;
}

export async function startMeshyTask(options: StartMeshyTaskOptions): Promise<string> {
  const apiKey = requireMeshyApiKey();
  let meshyImageUrl = options.imageUrl;

  if (options.removeLogosFor3D) {
    try {
      const { buffer, contentType } = await loadImageBufferFromUrl(options.imageUrl);
      meshyImageUrl = await cleanProductImageBufferToMeshyDataUrl(
        buffer,
        contentType,
        options.imageUrl,
      );
    } catch (err) {
      // Fail-safe: if OpenAI cleanup fails, continue with the original image.
      const message = err instanceof Error ? err.message : "Unknown cleanup error";
      console.warn(`[meshy] Cleanup fallback to original image: ${message}`);
      meshyImageUrl = options.imageUrl;
    }
  }

  const res = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: meshyImageUrl,
      enable_pbr: true,
      should_remesh: true,
      should_texture: true,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message ?? `Meshy API returned ${res.status}`);
  }

  const taskId: string = data.result ?? data.id;
  if (!taskId) {
    throw new Error("Unexpected response from Meshy — no task ID returned");
  }

  return taskId;
}

export async function getMeshyTaskStatus(taskId: string): Promise<MeshyTaskStatus> {
  const apiKey = requireMeshyApiKey();
  const res = await fetch(
    `https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message ?? `Meshy API returned ${res.status}`);
  }

  return {
    status: data.status,
    progress: typeof data.progress === "number" ? data.progress : 0,
    modelUrl: data.model_urls?.glb ?? null,
    error: data.task_error?.message || null,
  };
}

