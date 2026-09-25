import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, commitProject, loadProject } from "../src/file-store.mjs";
import { newId } from "../src/id.mjs";

test("project store persists revision history and event log", async () => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-store-"));
  const { timeline } = await createProject(root);
  const clip = {
    clipId: newId("clip"),
    assetId: newId("asset"),
    trackId: timeline.tracks[0].trackId,
    kind: "video",
    sourceInMs: 0,
    sourceOutMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    speed: 1,
    opacity: 1
  };
  const result = await commitProject(root, {
    schemaVersion: 1,
    baseRevision: 0,
    actor: "tester",
    operations: [{ op: "add", path: "/clips/0", value: clip }]
  });
  assert.equal(result.revision, 1);
  const saved = await loadProject(root);
  assert.equal(saved.engine.currentRevision, 1);
  assert.equal(saved.engine.document.clips.length, 1);
  const history = JSON.parse(await readFile(join(root, "history", "000001.json"), "utf8"));
  assert.equal(history.revision, 1);
  const events = await readFile(join(root, "events.jsonl"), "utf8");
  assert.match(events, /timeline\.patch\.applied/);
});

test("persistent store rejects stale patch without changing timeline", async () => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-store-"));
  await createProject(root);
  const stale = {
    schemaVersion: 1,
    baseRevision: 9,
    actor: "tester",
    operations: [{ op: "add", path: "/clips/0", value: {} }]
  };
  await assert.rejects(() => commitProject(root, stale), (error) => error.code === "REVISION_CONFLICT");
  const saved = await loadProject(root);
  assert.equal(saved.engine.currentRevision, 0);
});
