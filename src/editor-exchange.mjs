import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { contentHash, deepClone } from "./canonical-json.mjs";
import { CutKitError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { validateTimeline } from "./schema.mjs";

function msToTimecode(milliseconds, fps) {
  const totalFrames = Math.max(0, Math.round((milliseconds / 1000) * fps));
  const framesPerSecond = Math.round(fps);
  const frames = totalFrames % framesPerSecond;
  const totalSeconds = Math.floor(totalFrames / framesPerSecond);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, "0")).join(":");
}

function timecodeToMs(value, fps) {
  const match = /^(\d+):(\d+):(\d+):(\d+)$/.exec(value ?? "");
  if (!match) throw new CutKitError("EDL_TIMECODE_INVALID", "EDL timecode is invalid", { value });
  const [, hours, minutes, seconds, frames] = match.map(Number);
  return Math.round((((hours * 60 + minutes) * 60 + seconds) * 1000) + (frames / fps) * 1000);
}

function assetName(asset, assetId) {
  if (!asset) return assetId;
  const uri = asset.sourceUri ?? "";
  return uri.split(/[\\/]/).pop() || assetId;
}

function normalizedAssets(assets) {
  return assets && !Array.isArray(assets) ? assets : Object.fromEntries((assets ?? []).map((asset) => [asset.assetId, asset]));
}

export function exportEdl(timeline, assets, options = {}) {
  validateTimeline(timeline);
  const assetMap = normalizedAssets(assets);
  const fps = options.fps ?? 30;
  const title = options.title ?? "CutKit";
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME"];
  const clips = [...timeline.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
  clips.forEach((clip, index) => {
    const name = assetName(assetMap[clip.assetId], clip.assetId);
    lines.push(`${String(index + 1).padStart(3, "0")}  ${name} V C ${msToTimecode(clip.sourceInMs, fps)} ${msToTimecode(clip.sourceOutMs, fps)} ${msToTimecode(clip.timelineStartMs, fps)} ${msToTimecode(clip.timelineEndMs, fps)}`);
    lines.push(`* FROM CLIP NAME: ${name}`);
  });
  return `${lines.join("\n")}\n`;
}

export function importEdl(text, options = {}) {
  if (typeof text !== "string") throw new CutKitError("EDL_INPUT_INVALID", "EDL input must be text");
  const fps = options.fps ?? 30;
  const assetIdByName = options.assetIdByName ?? {};
  const trackId = options.trackId ?? newId("track");
  const clips = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\d{3}\s+(\S+)\s+V\s+C\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line.trim());
    if (!match) continue;
    const [, reel, sourceIn, sourceOut, timelineStart, timelineEnd] = match;
    clips.push({
      clipId: newId("clip"),
      assetId: assetIdByName[reel] ?? options.defaultAssetId ?? newId("asset"),
      trackId,
      kind: "video",
      sourceInMs: timecodeToMs(sourceIn, fps),
      sourceOutMs: timecodeToMs(sourceOut, fps),
      timelineStartMs: timecodeToMs(timelineStart, fps),
      timelineEndMs: timecodeToMs(timelineEnd, fps),
      speed: 1,
      opacity: 1
    });
  }
  const timeline = {
    schemaVersion: 1,
    timelineId: options.timelineId ?? newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips
  };
  validateTimeline(timeline);
  return timeline;
}

export function exportFcpxml(timeline, assets, options = {}) {
  validateTimeline(timeline);
  const assetMap = normalizedAssets(assets);
  const fps = options.fps ?? 30;
  const formatId = "r1";
  const assetRows = [...new Set(timeline.clips.map((clip) => clip.assetId))].map((assetId, index) => ({
    "@id": `r${index + 2}`,
    "@name": assetName(assetMap[assetId], assetId),
    "@start": "0s",
    "@duration": `${Math.max(1, assetMap[assetId]?.durationMs ?? 1000) / 1000}s`,
    "@hasVideo": "1",
    "@hasAudio": assetMap[assetId]?.hasAudio ? "1" : "0"
  }));
  const assetIdToResource = Object.fromEntries(assetRows.map((row, index) => [timeline.clips.find((clip) => `r${index + 2}` === row["@id"])?.assetId, row["@id"]]));
  for (const clip of timeline.clips) {
    const resource = assetRows.find((row) => row["@name"] === assetName(assetMap[clip.assetId], clip.assetId));
    if (resource) assetIdToResource[clip.assetId] = resource["@id"];
  }
  const xmlObject = {
    fcpxml: {
      "@version": "1.10",
      resources: {
        format: { "@id": formatId, "@name": `CutKit ${fps}p`, "@frameDuration": `1/${fps}s`, "@width": "1920", "@height": "1080" },
        asset: assetRows
      },
      library: {
        event: {
          "@name": options.title ?? "CutKit",
          project: {
            "@name": options.title ?? "CutKit",
            sequence: {
              "@format": formatId,
              "@duration": `${Math.max(...timeline.clips.map((clip) => clip.timelineEndMs), 0) / 1000}s`,
              spine: {
                assetClip: timeline.clips.map((clip) => ({
                  "@ref": assetIdToResource[clip.assetId],
                  "@name": assetName(assetMap[clip.assetId], clip.assetId),
                  "@offset": `${clip.timelineStartMs / 1000}s`,
                  "@start": `${clip.sourceInMs / 1000}s`,
                  "@duration": `${(clip.sourceOutMs - clip.sourceInMs) / 1000}s`
                }))
              }
            }
          }
        }
      }
    }
  };
  return new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true }).build(xmlObject);
}

export function importFcpxml(xml, options = {}) {
  if (typeof xml !== "string") throw new CutKitError("FCPXML_INPUT_INVALID", "FCPXML input must be XML text");
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
  const project = parsed?.fcpxml?.library?.event?.project;
  const spine = project?.sequence?.spine;
  const assetClips = Array.isArray(spine?.assetClip) ? spine.assetClip : spine?.assetClip ? [spine.assetClip] : [];
  const trackId = options.trackId ?? newId("track");
  const clips = assetClips.map((entry) => {
    const offset = String(entry["@offset"] ?? "0s");
    const start = String(entry["@start"] ?? "0s");
    const duration = String(entry["@duration"] ?? "0s");
    const seconds = (value) => Math.round(parseFloat(value) * 1000);
    const timelineStartMs = seconds(offset);
    const sourceInMs = seconds(start);
    const durationMs = seconds(duration);
    return {
      clipId: newId("clip"),
      assetId: options.assetIdByName?.[entry["@name"]] ?? options.defaultAssetId ?? newId("asset"),
      trackId,
      kind: "video",
      sourceInMs,
      sourceOutMs: sourceInMs + durationMs,
      timelineStartMs,
      timelineEndMs: timelineStartMs + durationMs,
      speed: 1,
      opacity: 1
    };
  });
  const timeline = {
    schemaVersion: 1,
    timelineId: options.timelineId ?? newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips
  };
  validateTimeline(timeline);
  return timeline;
}

export function exportOtio(timeline, assets, options = {}) {
  validateTimeline(timeline);
  const assetMap = normalizedAssets(assets);
  const fps = options.fps ?? 30;
  const rate = fps;
  const rationalTime = (valueMs) => ({
    OTIO_SCHEMA: "RationalTime.1",
    value: Math.round((valueMs / 1000) * rate),
    rate
  });
  const timeRange = (startMs, endMs) => ({
    OTIO_SCHEMA: "TimeRange.1",
    start: rationalTime(startMs),
    duration: rationalTime(endMs - startMs)
  });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: options.title ?? "CutKit",
    global_start_time: rationalTime(0),
    tracks: timeline.tracks.map((track) => ({
      OTIO_SCHEMA: "Track.1",
      name: track.role,
      kind: track.kind === "audio" ? "Audio" : "Video",
      children: timeline.clips
        .filter((clip) => clip.trackId === track.trackId)
        .sort((left, right) => left.timelineStartMs - right.timelineStartMs)
        .map((clip) => ({
          OTIO_SCHEMA: "Clip.1",
          name: assetName(assetMap[clip.assetId], clip.assetId),
          source_range: timeRange(clip.sourceInMs, clip.sourceOutMs),
          media_references: [{
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: assetMap[clip.assetId]?.sourceUri ?? null,
            available_range: timeRange(0, assetMap[clip.assetId]?.durationMs ?? clip.sourceOutMs),
            metadata: {
              cutkit: {
                assetId: clip.assetId,
                clipId: clip.clipId,
                timelineRange: { startMs: clip.timelineStartMs, endMs: clip.timelineEndMs },
                speed: clip.speed,
                opacity: clip.opacity
              }
            }
          }]
        }))
    })),
    metadata: {
      cutkit: {
        timelineId: timeline.timelineId,
        revision: timeline.revision
      }
    },
    exportedAt: options.now?.() ?? Date.now()
  };
}

function rationalTimeMs(value, fallback = 0) {
  if (typeof value === "number") return Math.round((value / 30) * 1000);
  if (value && typeof value === "object") {
    const rate = Number(value.rate ?? 30);
    return Math.round((Number(value.value ?? 0) / rate) * 1000);
  }
  return fallback;
}

function timeRangeMs(range) {
  if (!range) return { startMs: 0, endMs: 0 };
  const startMs = rationalTimeMs(range.start, 0);
  const durationMs = rationalTimeMs(range.duration, 0);
  return { startMs, endMs: startMs + durationMs };
}

export function importOtio(document, options = {}) {
  if (!document || document.OTIO_SCHEMA !== "Timeline.1") throw new CutKitError("OTIO_INPUT_INVALID", "OTIO document must use Timeline.1");
  const sourceTrack = document.tracks?.[0] ?? {};
  const children = Array.isArray(sourceTrack.children) ? sourceTrack.children : sourceTrack.clips ?? [];
  const trackId = options.trackId ?? newId("track");
  const clips = children.map((clip, index) => {
    const metadata = clip.media_references?.[0]?.metadata?.cutkit ?? {};
    const sourceRange = timeRangeMs(clip.source_range);
    const timelineRange = metadata.timelineRange ?? sourceRange;
    const mediaReference = clip.media_references?.[0] ?? {};
    return {
      clipId: options.clipIdByName?.[metadata.clipId ?? clip.clipId] ?? metadata.clipId ?? clip.clipId ?? newId("clip"),
      assetId: options.assetIdByName?.[metadata.assetId ?? mediaReference.target_url] ?? metadata.assetId ?? options.defaultAssetId ?? newId("asset"),
      trackId,
      kind: sourceTrack.kind === "Audio" ? "audio" : "video",
      sourceInMs: sourceRange.startMs,
      sourceOutMs: sourceRange.endMs,
      timelineStartMs: timelineRange.startMs ?? sourceRange.startMs,
      timelineEndMs: timelineRange.endMs ?? sourceRange.endMs,
      speed: metadata.speed ?? 1,
      opacity: metadata.opacity ?? 1
    };
  });
  const timeline = {
    schemaVersion: 1,
    timelineId: options.timelineId ?? document.metadata?.cutkit?.timelineId ?? newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: sourceTrack.kind === "Audio" ? "audio" : "video", role: sourceTrack.name ?? "primary" }],
    clips
  };
  validateTimeline(timeline);
  return timeline;
}

export function roundTripLoss(original, imported) {
  const originalDuration = Math.max(0, ...original.clips.map((clip) => clip.timelineEndMs));
  const importedDuration = Math.max(0, ...imported.clips.map((clip) => clip.timelineEndMs));
  const originalSpeeds = original.clips.map((clip) => clip.speed);
  const importedSpeeds = imported.clips.map((clip) => clip.speed);
  const originalCaptions = original.clips.reduce((sum, clip) => sum + (clip.captions?.length ?? 0), 0);
  const importedCaptions = imported.clips.reduce((sum, clip) => sum + (clip.captions?.length ?? 0), 0);
  const unsupportedEffects = original.clips.flatMap((clip) => clip.effects ?? []).filter((effect) => effect?.type && !["cut", "fade"].includes(effect.type)).map((effect) => effect.type);
  const warnings = [];
  if (original.clips.length !== imported.clips.length) warnings.push("clip_count_changed");
  if (Math.abs(originalDuration - importedDuration) > 1) warnings.push("duration_changed");
  if (originalSpeeds.some((speed, index) => speed !== importedSpeeds[index])) warnings.push("speed_changed");
  if (originalCaptions !== importedCaptions) warnings.push("captions_changed");
  if (unsupportedEffects.length > 0) warnings.push("unsupported_effects");
  return {
    hasLoss: warnings.length > 0,
    clipCountOriginal: original.clips.length,
    clipCountImported: imported.clips.length,
    durationDeltaMs: importedDuration - originalDuration,
    speedChanges: originalSpeeds.some((speed, index) => speed !== importedSpeeds[index]),
    captionsOriginal: originalCaptions,
    captionsImported: importedCaptions,
    unsupportedEffects,
    warnings
  };
}
