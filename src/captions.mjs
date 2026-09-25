import { newId } from "./id.mjs";
import { validateCaptionCue, validateQcReport } from "./p1-schema.mjs";

const DEFAULTS = {
  maxCharsPerSecond: 20,
  maxLineLength: 42,
  strict: false
};

export function formatAssTime(milliseconds) {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(content) {
  return content.replace(/\r?\n/g, "\\N").replace(/\r/g, "\\N");
}

export function buildAss(cues, options = {}) {
  const fontSize = options.fontSize ?? 42;
  const playResX = options.playResX ?? options.width ?? 1920;
  const playResY = options.playResY ?? options.height ?? 1080;
  const fontName = options.fontName ?? "Arial";
  const primaryColour = options.primaryColour ?? "&H00FFFFFF";
  const outlineColour = options.outlineColour ?? "&H00000000";
  const marginV = options.marginV ?? 40;
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`,
    `Style: Default,${fontName},${fontSize},${primaryColour},&H000000FF,${outlineColour},&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  for (const cue of cues) {
    validateCaptionCue(cue);
    lines.push(`Dialogue: 0,${formatAssTime(cue.startMs)},${formatAssTime(cue.endMs)},Default,${cue.textId},0,0,0,,${assEscape(cue.content)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function validateCaptionSet(cues, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const checks = [];
  const add = (code, status, value, threshold, message) => checks.push({ code, status, value, threshold, message });
  if (!Array.isArray(cues)) {
    add("CAPTION_SET_INVALID", "fail", null, null, "Caption cues must be an array");
    return finishReport(checks);
  }
  for (const cue of cues) {
    try {
      validateCaptionCue(cue);
    } catch (error) {
      add("CAPTION_SCHEMA_INVALID", "fail", cue?.cueId ?? null, null, error.message);
      continue;
    }
    const durationSeconds = Math.max(0.001, (cue.endMs - cue.startMs) / 1000);
    const charsPerSecond = cue.content.length / durationSeconds;
    add(
      "CAPTION_READING_SPEED",
      charsPerSecond > config.maxCharsPerSecond ? (config.strict ? "fail" : "warn") : "pass",
      Number(charsPerSecond.toFixed(2)),
      config.maxCharsPerSecond,
      `Cue ${cue.cueId} reading speed`
    );
    const longestLine = Math.max(...cue.content.split(/\r?\n/).map((line) => line.length), 0);
    add(
      "CAPTION_LINE_LENGTH",
      longestLine > config.maxLineLength ? (config.strict ? "fail" : "warn") : "pass",
      longestLine,
      config.maxLineLength,
      `Cue ${cue.cueId} longest line`
    );
  }
  const groups = new Map();
  for (const cue of cues) {
    const group = cue.captionTrack ?? cue.role;
    const list = groups.get(group) ?? [];
    list.push(cue);
    groups.set(group, list);
  }
  for (const [group, list] of groups) {
    const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      add(
        "CAPTION_OVERLAP",
        current.startMs < previous.endMs ? "fail" : "pass",
        current.startMs - previous.endMs,
        0,
        `Caption track ${group} overlap`
      );
    }
  }
  return finishReport(checks);
}

function finishReport(checks) {
  const report = {
    schemaVersion: 1,
    reportId: newId("report"),
    target: "caption",
    checks,
    passed: checks.every((check) => check.status !== "fail")
  };
  validateQcReport(report);
  return report;
}

