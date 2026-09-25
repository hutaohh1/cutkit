import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { newId } from "./id.mjs";
import { CutKitError } from "./errors.mjs";
import { validateMediaAsset } from "./p1-schema.mjs";
import { resolveTool } from "./tool-paths.mjs";
import { runTool } from "./process.mjs";

export async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}

function parseRate(value) {
  if (typeof value !== "string" || !value.includes("/")) return Number(value) || 0;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

export function parseFfprobe(raw, { sourceUri, assetId = newId("asset"), sourceHash }) {
  const streams = Array.isArray(raw?.streams) ? raw.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(raw?.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  const asset = {
    schemaVersion: 1,
    assetId,
    sourceUri,
    sourceHash,
    mediaKind: audio && !video ? "audio" : "video",
    durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    fps: parseRate(video?.avg_frame_rate || video?.r_frame_rate) || 1,
    hasAudio: Boolean(audio),
    colorProfile: [video?.color_space, video?.color_transfer, video?.color_primaries].filter(Boolean).join("/") || "unknown",
    provenance: { kind: "real", capturedAt: null, ingestedAt: new Date().toISOString() }
  };
  validateMediaAsset(asset);
  return asset;
}

export async function probeMedia(sourceUri, options = {}) {
  if (typeof sourceUri !== "string" || !sourceUri) throw new CutKitError("MEDIA_INPUT_REQUIRED", "Media input is required");
  const ffprobePath = await resolveTool("ffprobe", options.ffprobePath);
  const sourceHash = options.sourceHash ?? await hashFile(sourceUri);
  let stdout;
  try {
    ({ stdout } = await runTool(ffprobePath, [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      sourceUri
    ], { maxBuffer: 10 * 1024 * 1024 }));
  } catch (error) {
    if (error.code === "DEPENDENCY_MISSING") throw error;
    throw new CutKitError("PROBE_FAILED", "ffprobe failed", {
      tool: ffprobePath,
      stderr: error.details?.stderr ?? ""
    });
  }
  return parseFfprobe(JSON.parse(stdout), {
    sourceUri,
    assetId: options.assetId ?? newId("asset"),
    sourceHash
  });
}
