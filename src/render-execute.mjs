import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deepClone } from "./canonical-json.mjs";
import { CutKitError } from "./errors.mjs";
import { buildAss } from "./captions.mjs";
import { hashFile } from "./media.mjs";
import { runTool } from "./process.mjs";
import { resolveTool } from "./tool-paths.mjs";

async function readToolVersion(toolPath) {
  const result = await runTool(toolPath, ["-version"], { maxBuffer: 1024 * 1024 });
  return (result.stdout || result.stderr).split(/\\r?\\n/, 1)[0];
}
import { createRenderManifest } from "./render-plan.mjs";

function seconds(milliseconds) {
  return (milliseconds / 1000).toFixed(3);
}

function sourcePath(sourceUri) {
  if (typeof sourceUri !== "string" || !sourceUri) {
    throw new CutKitError("ASSET_SOURCE_MISSING", "Render asset has no source URI");
  }
  return sourceUri.startsWith("file://") ? fileURLToPath(new URL(sourceUri)) : sourceUri;
}

function tempoFilter(speed) {
  if (speed === 1) return [];
  const ratio = Math.max(0.5, Math.min(2, speed));
  return [`atempo=${ratio.toFixed(6)}`];
}

function assertRenderable(timeline) {
  const clips = [...timeline.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
  let cursor = 0;
  for (const clip of clips) {
    const transitionIn = clip.transitionIn?.type ?? "cut";
    const transitionOut = clip.transitionOut?.type ?? "cut";
    if (!["cut", "none", "fade"].includes(transitionIn) || !["cut", "none", "fade"].includes(transitionOut)) {
      throw new CutKitError("UNSUPPORTED_TRANSITION", "P1 renderer currently supports cut, none, and fade transitions", {
        clipId: clip.clipId,
        transitionIn,
        transitionOut
      });
    }
    if (clip.timelineStartMs < cursor) {
      throw new CutKitError("RENDER_CONSTRAINT_FAILED", "Overlapping clips require a transition compositor", {
        clipId: clip.clipId,
        timelineStartMs: clip.timelineStartMs,
        cursor
      });
    }
    cursor = clip.timelineEndMs;
  }
  return clips;
}

function clipDurationMs(clip) {
  return clip.timelineEndMs - clip.timelineStartMs;
}

function clipSourceDurationMs(clip) {
  return clip.sourceOutMs - clip.sourceInMs;
}

function makeSegment(index, clip, asset, profile) {
  const outputDuration = clipDurationMs(clip);
  const sourceDuration = clipSourceDurationMs(clip);
  const expectedOutputDuration = sourceDuration / clip.speed;
  if (Math.abs(expectedOutputDuration - outputDuration) > 2) {
    throw new CutKitError("TIME_RANGE_INVALID", "Clip speed does not match source and timeline duration", {
      clipId: clip.clipId,
      sourceDurationMs: sourceDuration,
      timelineDurationMs: outputDuration,
      speed: clip.speed
    });
  }
  const source = sourcePath(asset.sourceUri);
  const inputArgs = ["-ss", seconds(clip.sourceInMs), "-t", seconds(sourceDuration), "-i", source];
  const width = profile.width;
  const height = profile.height;
  const fps = profile.fps;
  const pixelFormat = profile.pixelFormat;
  const videoFilters = [
    `trim=duration=${seconds(sourceDuration)}`,
    `setpts=PTS-STARTPTS`,
    `setpts=PTS/${clip.speed}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${fps}`
  ];
  const fadeInMs = clip.transitionIn?.type === "fade" ? Number(clip.transitionIn.durationMs ?? 0) : 0;
  const fadeOutMs = clip.transitionOut?.type === "fade" ? Number(clip.transitionOut.durationMs ?? 0) : 0;
  if (fadeInMs > 0) videoFilters.push(`fade=t=in:st=0:d=${seconds(fadeInMs)}`);
  if (fadeOutMs > 0) videoFilters.push(`fade=t=out:st=${seconds(Math.max(0, outputDuration - fadeOutMs))}:d=${seconds(fadeOutMs)}`);
  if (typeof clip.opacity === "number" && clip.opacity < 1) {
    videoFilters.push("format=rgba", `colorchannelmixer=aa=${clip.opacity}`, `format=${pixelFormat}`);
  } else {
    videoFilters.push(`format=${pixelFormat}`);
  }
  const audioFilters = [
    `atrim=duration=${seconds(sourceDuration)}`,
    "asetpts=PTS-STARTPTS",
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    `volume=${clip.audioPolicy?.gainDb ?? 0}dB`,
    ...(fadeInMs > 0 ? [`afade=t=in:st=0:d=${seconds(fadeInMs)}`] : []),
    ...(fadeOutMs > 0 ? [`afade=t=out:st=${seconds(Math.max(0, outputDuration - fadeOutMs))}:d=${seconds(fadeOutMs)}`] : []),
    ...tempoFilter(clip.speed)
  ];
  const filters = [
    `[${index}:v]${videoFilters.join(",")}[v${index}]`,
    asset.hasAudio
      ? `[${index}:a]${audioFilters.join(",")}[a${index}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(outputDuration)},asetpts=PTS-STARTPTS[a${index}]`
  ];
  return { inputArgs, filters, labels: `[v${index}][a${index}]`, clip, asset };
}

function gapSegment(index, startMs, endMs, profile) {
  const durationMs = endMs - startMs;
  const duration = seconds(durationMs);
  return {
    inputArgs: [],
    filters: [
      `color=c=black:s=${profile.width}x${profile.height}:r=${profile.fps}:d=${duration}[v${index}]`,
      `anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`
    ],
    labels: `[v${index}][a${index}]`
  };
}

export function buildFfmpegRenderCommand(plan, options = {}) {
  const graph = plan.renderGraph;
  if (!graph?.timeline || !graph?.assets) {
    throw new CutKitError("RENDER_GRAPH_MISSING", "Render plan must contain renderGraph.timeline and renderGraph.assets");
  }
  const outputPath = resolve(options.outputPath ?? plan.outputs?.[0]?.path ?? "output.mp4");
  const workDir = resolve(options.workDir ?? dirname(outputPath));
  const profile = plan.profile;
  const clips = assertRenderable(graph.timeline);
  if (clips.length === 0) throw new CutKitError("RENDER_EMPTY_TIMELINE", "Timeline has no clips to render");
  const inputs = [];
  const filters = [];
  const labels = [];
  let cursor = 0;
  let inputIndex = 0;
  for (const clip of clips) {
    if (clip.timelineStartMs > cursor) {
      const gap = gapSegment(labels.length, cursor, clip.timelineStartMs, profile);
      filters.push(...gap.filters);
      labels.push(gap.labels);
    }
    const asset = graph.assets[clip.assetId];
    if (!asset) throw new CutKitError("ASSET_NOT_FOUND", "Timeline references an asset missing from renderGraph.assets", { assetId: clip.assetId });
    const segment = makeSegment(inputIndex, clip, asset, profile);
    inputs.push(...segment.inputArgs);
    filters.push(...segment.filters);
    labels.push(segment.labels);
    inputIndex += 1;
    cursor = clip.timelineEndMs;
  }
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=1[vc][ac]`);
  let videoLabel = "[vc]";
  if (options.captionsFile) {
    filters.push(`${videoLabel}subtitles=filename=${options.captionsFile}[vout]`);
    videoLabel = "[vout]";
  }
  const args = [
    "-hide_banner",
    "-y",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", videoLabel,
    "-map", "[ac]",
    "-c:v", profile.videoCodec,
    "-pix_fmt", profile.pixelFormat,
    "-crf", String(profile.crf ?? 23),
    "-c:a", profile.audioCodec,
    "-ar", "48000",
    "-movflags", "+faststart",
    outputPath
  ];
  return { args, outputPath, workDir, clipCount: clips.length };
}

function collectCaptions(timeline) {
  return [...timeline.clips]
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs)
    .flatMap((clip) => clip.captions ?? []);
}

export async function executeRender(plan, options = {}) {
  const graph = plan.renderGraph;
  if (!graph?.timeline) throw new CutKitError("RENDER_GRAPH_MISSING", "Render plan is missing renderGraph.timeline");
  const outputPath = resolve(options.outputPath ?? plan.outputs?.[0]?.path ?? "output.mp4");
  const workDir = resolve(options.workDir ?? dirname(outputPath));
  await mkdir(workDir, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  const captions = collectCaptions(graph.timeline);
  let captionsFile;
  if (captions.length > 0) {
    captionsFile = `captions-${plan.planId}.ass`;
    await writeFile(resolve(workDir, captionsFile), buildAss(captions), "utf8");
  }
  const command = buildFfmpegRenderCommand(plan, { outputPath, workDir, captionsFile });
  const ffmpegPath = await resolveTool("ffmpeg", options.ffmpegPath);
  const ffprobePath = await resolveTool("ffprobe", options.ffprobePath);
  const [ffmpegVersion, ffprobeVersion] = await Promise.all([readToolVersion(ffmpegPath), readToolVersion(ffprobePath)]);
  const environment = { ...(options.environment ?? {}), ffmpegVersion, ffprobeVersion };
  if (options.dryRun === true) {
    return {
      ok: true,
      status: "DRY_RUN",
      output: outputPath,
      command: { tool: ffmpegPath, args: command.args },
      manifest: createRenderManifest(plan, { environment, commandArgs: command.args.slice(0, -1) })
    };
  }
  await runTool(ffmpegPath, command.args, { cwd: workDir });
  const outputHash = await hashFile(outputPath);
  const manifest = createRenderManifest(plan, { environment, commandArgs: command.args.slice(0, -1) });
  manifest.outputHashes[plan.outputs?.[0]?.outputId ?? "output"] = outputHash;
  return {
    ok: true,
    status: "RENDERED",
    output: outputPath,
    outputHash,
    manifest,
    command: { tool: ffmpegPath, args: command.args }
  };
}



