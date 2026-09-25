import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { buildAss, validateCaptionSet } from "../src/captions.mjs";

function cue(startMs, endMs, content) {
  return {
    cueId: newId("cue"),
    textId: newId("text"),
    role: "dialogue",
    startMs,
    endMs,
    content,
    fontRole: "dialogue",
    lineBreakPolicy: "balance"
  };
}

test("ASS output contains stable text IDs and escaped newlines", () => {
  const first = cue(0, 1200, "Hello\nworld");
  const ass = buildAss([first]);
  assert.match(ass, /\[Events\]/);
  assert.match(ass, new RegExp(first.textId));
  assert.match(ass, /Hello\\Nworld/);
});

test("caption QC catches overlap and reading speed", () => {
  const report = validateCaptionSet([
    cue(0, 500, "This is far too fast for comfortable reading"),
    cue(400, 2000, "Overlaps")
  ], { maxCharsPerSecond: 10, strict: true });
  assert.equal(report.passed, false);
  assert.equal(report.checks.some((check) => check.code === "CAPTION_OVERLAP" && check.status === "fail"), true);
  assert.equal(report.checks.some((check) => check.code === "CAPTION_READING_SPEED" && check.status === "fail"), true);
});
