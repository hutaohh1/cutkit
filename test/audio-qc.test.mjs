import test from "node:test";
import assert from "node:assert/strict";
import { buildAudioQcPlan, evaluateAudioQc, parseAudioQcOutput } from "../src/audio-qc.mjs";

test("audio QC plan targets loudness, stats, volume, and silence", () => {
  const plan = buildAudioQcPlan("voice.wav");
  assert.deepEqual(plan.commands.map((command) => command.name), ["ebur128", "astats", "volumedetect", "silencedetect"]);
  assert.match(plan.commands[0].args.join(" "), /ebur128/);
});

test("audio QC evaluates loudness, peak, clipping, silence, and overlap", () => {
  const report = evaluateAudioQc({
    integratedLufs: -16,
    truePeakDbtp: -2,
    clippingPercent: 0,
    silencePercent: 1,
    dialogueMusicOverlapPercent: 5
  });
  assert.equal(report.passed, true);
  const failed = evaluateAudioQc({
    integratedLufs: -5,
    truePeakDbtp: 0,
    clippingPercent: 2,
    silencePercent: 10,
    dialogueMusicOverlapPercent: 50
  });
  assert.equal(failed.passed, false);
  assert.equal(failed.checks.filter((check) => check.status === "fail").length >= 3, true);
});



test("audio QC parses FFmpeg diagnostics when stdout is empty", () => {
  const metrics = parseAudioQcOutput({
    ebur128: { stdout: "", stderr: "Integrated loudness:\n I: -18.4 LUFS\n True peak:\n Peak: -1.7 dBFS" },
    silencedetect: { stdout: "", stderr: "silence_duration: 0.5\nsilence_duration: 1.5" }
  }, { durationMs: 10000, clippingPercent: 0 });
  assert.equal(metrics.integratedLufs, -18.4);
  assert.equal(metrics.truePeakDbtp, -1.7);
  assert.equal(metrics.silencePercent, 20);
});