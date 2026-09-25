import { mkdir, readFile, rename, copyFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LockManager } from "./locks.mjs";
import { RevisionEngine } from "./revisions.mjs";
import { newId } from "./id.mjs";
import { CutKitError } from "./errors.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  const backup = `${path}.bak`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await copyFile(path, backup);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rename(temp, path);
}

export async function createProject(root, projectId = newId("project")) {
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 0,
    tracks: [
      { trackId: newId("track"), kind: "video", role: "primary" },
      { trackId: newId("track"), kind: "audio", role: "primary" }
    ],
    clips: []
  };
  await mkdir(root, { recursive: true });
  await writeJsonAtomic(join(root, "project.json"), {
    schemaVersion: 1,
    projectId,
    state: "DRAFT",
    timelineRevision: 0,
    timelineFile: "timeline.json",
    lockFile: "locks.json",
    eventLog: "events.jsonl",
    historyDir: "history"
  });
  await writeJsonAtomic(join(root, "timeline.json"), timeline);
  await writeJsonAtomic(join(root, "locks.json"), { schemaVersion: 1, locks: [] });
  await mkdir(join(root, "history"), { recursive: true });
  await writeJsonAtomic(join(root, "history", "000000.json"), timeline);
  await writeFile(join(root, "events.jsonl"), "", "utf8");
  return { projectId, timeline };
}

export async function loadProject(root) {
  const meta = await readJson(join(root, "project.json"));
  const timeline = await readJson(join(root, meta.timelineFile));
  const lockState = await readJson(join(root, meta.lockFile));
  const lockManager = LockManager.fromJSON(lockState.locks ?? []);
  const engine = new RevisionEngine(timeline, { lockManager });
  return { meta, engine };
}

export async function commitProject(root, input) {
  const { meta, engine } = await loadProject(root);
  const result = engine.commit(input);
  await writeJsonAtomic(join(root, meta.timelineFile), engine.document);
  await writeJsonAtomic(join(root, meta.lockFile), { schemaVersion: 1, locks: engine.lockManager.toJSON() });
  await writeJsonAtomic(join(root, meta.historyDir, `${String(result.revision).padStart(6, "0")}.json`), result.document);
  await appendFile(join(root, meta.eventLog), `${JSON.stringify(result.event)}\n`, "utf8");
  return result;
}

export async function persistEngine(root, meta, engine, result) {
  await writeJsonAtomic(join(root, meta.timelineFile), engine.document);
  await writeJsonAtomic(join(root, meta.lockFile), {
    schemaVersion: 1,
    locks: engine.lockManager.toJSON()
  });
  await writeJsonAtomic(join(root, meta.historyDir, `${String(result.revision).padStart(6, "0")}.json`), result.document);
  await appendFile(join(root, meta.eventLog), `${JSON.stringify(result.event)}\n`, "utf8");
  return result;
}
export async function updateLocks(root, mutate) {
  const { meta, engine } = await loadProject(root);
  const result = mutate(engine.lockManager, engine.document);
  await writeJsonAtomic(join(root, meta.lockFile), { schemaVersion: 1, locks: engine.lockManager.toJSON() });
  return result;
}

export function requireProjectRoot(root) {
  if (typeof root !== "string" || root.trim() === "") throw new CutKitError("PROJECT_PATH_REQUIRED", "Project path is required");
}


