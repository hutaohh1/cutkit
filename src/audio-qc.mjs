import { newId } from "./id.mjs";
import { validateAudioPolicy, validateQcReport } from "./p1-schema.mjs";
import { CutKitError } from "./errors.mjs";
import { resolveTool } from "./tool-paths.mjs";
import { runTool } from "./process.mjs";
import { probeMedia } from "./media.mjs";

const DEFAULT_POLICY = {
  role: "dialogue",
  gainDb: 0,
  targetLoudnessLufs: -16,
  truePeakDbtp: -1,
  maxClippingPercent: 0,
  maxSilencePercent: 5,
  maxDialogueMusicOverlapPercent: 20
};

export function buildAudioQcPlan(input, options = {}) {
  if (typeof input !== "string" || !input) throw new CutKitError("AUDIO_INPUT_REQUIRED", "Audio input is required");
  const policy = { ...DEFAULT_POLICY, ...(options.policy ?? {}) };
  validateAudioPolicy(policy);
  return {
    schemaVersion: 1,
    tool: "ffmpeg",
    input,
    commands: [
      { name: "ebur128", args: ["-hide_banner", "-nostats", "-i", input, "-map", "a:0", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"] },
      { name: "astats", args: ["-hide_banner", "-nostats", "-i", input, "-map", "a:0", "-af", "astats=metadata=1:reset=0", "-f", "null", "-"] },
      { name: "volumedetect", args: ["-hide_banner", "-nostats", "-i", input, "-map", "a:0", "-af", "volumedetect", "-f", "null", "-"] },
      { name: "silencedetect", args: ["-hide_banner", "-nostats", "-i", input, "-map", "a:0", "-af", "silencedetect=noise=-50dB:d=0.2", "-f", "null", "-"] }
    ],
    policy
  };
}

export function evaluateAudioQc(metrics, policyInput = {}) {
  const policy = { ...DEFAULT_POLICY, ...policyInput };
  validateAudioPolicy(policy);
  if (!metrics || typeof metrics !== "object") throw new CutKitError("AUDIO_METRICS_REQUIRED", "Audio metrics are required");
  for (const field of ["integratedLufs", "truePeakDbtp", "clippingPercent", "silencePercent", "dialogueMusicOverlapPercent"]) {
    if (metrics[field] !== null && typeof metrics[field] !== "number") throw new CutKitError("AUDIO_METRICS_INVALID", `Metric must be numeric or null: ${field}`, { field });
  }
  const checks = [];
  const add = (code, status, value, threshold, message) => checks.push({ code, status, value, threshold, message });
  add("LOUDNESS_TARGET", metrics.integratedLufs <= policy.targetLoudnessLufs + 1 && metrics.integratedLufs >= policy.targetLoudnessLufs - 1 ? "pass" : "fail", metrics.integratedLufs, policy.targetLoudnessLufs, "Integrated loudness");
  add("TRUE_PEAK", metrics.truePeakDbtp <= policy.truePeakDbtp ? "pass" : "fail", metrics.truePeakDbtp, policy.truePeakDbtp, "True peak");
  add("CLIPPING", metrics.clippingPercent === null ? "warn" : metrics.clippingPercent <= policy.maxClippingPercent ? "pass" : "fail", metrics.clippingPercent, policy.maxClippingPercent, "Clipping");
  add("SILENCE", metrics.silencePercent <= policy.maxSilencePercent ? "pass" : "warn", metrics.silencePercent, policy.maxSilencePercent, "Silence");
  add("DUCKING_OVERLAP", metrics.dialogueMusicOverlapPercent === null ? "warn" : metrics.dialogueMusicOverlapPercent <= policy.maxDialogueMusicOverlapPercent ? "pass" : "warn", metrics.dialogueMusicOverlapPercent, policy.maxDialogueMusicOverlapPercent, "Dialogue/music overlap");
  const report = { schemaVersion: 1, reportId: newId("report"), target: "audio", checks, passed: checks.every((check) => check.status !== "fail") };
  validateQcReport(report);
  return report;
}

export function parseAudioQcOutput(outputs, options = {}) {
  const text = Object.values(outputs).flatMap((value) => [value.stdout, value.stderr]).filter(Boolean).join("\n");
  const integratedMatch = text.match(/I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/);
  const peakMatch = text.match(/Peak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/) || text.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s+dB/);
  const silenceMatches = [...text.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g)];
  const durationSeconds = Number(options.durationMs ?? 0) / 1000;
  const silenceSeconds = silenceMatches.reduce((sum, match) => sum + Number(match[1]), 0);
  const clippingPercent = options.clippingPercent ?? null;
  return {
    integratedLufs: integratedMatch ? Number(integratedMatch[1]) : -70,
    truePeakDbtp: peakMatch ? Number(peakMatch[1]) : -70,
    clippingPercent,
    silencePercent: durationSeconds > 0 ? Math.min(100, (silenceSeconds / durationSeconds) * 100) : 0,
    dialogueMusicOverlapPercent: options.dialogueMusicOverlapPercent ?? null,
  };
}

export async function runAudioQc(input, options = {}) {
  const plan = buildAudioQcPlan(input, { policy: options.policy });
  const ffmpegPath = await resolveTool("ffmpeg", options.ffmpegPath);
  const outputs = {};
  for (const command of plan.commands) {
    const result = await runTool(ffmpegPath, command.args, { cwd: options.cwd });
    outputs[command.name] = { stdout: result.stdout, stderr: result.stderr };
  }
  let durationMs = options.durationMs;
  if (!Number.isFinite(durationMs)) {
    const asset = await probeMedia(input, { ffprobePath: options.ffprobePath });
    durationMs = asset.durationMs;
  }
  const metrics = parseAudioQcOutput(outputs, {
    durationMs,
    dialogueMusicOverlapPercent: options.dialogueMusicOverlapPercent ?? null,
    clippingPercent: options.clippingPercent ?? null
  });
  return { plan, outputs, metrics, report: evaluateAudioQc(metrics, plan.policy) };
}


