#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { CutKitError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { commitProject, createProject, loadProject, persistEngine, updateLocks } from "./file-store.mjs";
import { buildAss, validateCaptionSet } from "./captions.mjs";
import { buildAudioQcPlan, evaluateAudioQc, runAudioQc } from "./audio-qc.mjs";
import { probeMedia } from "./media.mjs";
import { buildRenderPlan, FINAL_PROFILE, PREVIEW_PROFILE } from "./render-plan.mjs";
import { executeRender } from "./render-execute.mjs";
import { resolveTool } from "./tool-paths.mjs";
import { buildC2paCommand, buildC2paManifest, createProvenanceManifest, evaluateReleasePolicy, verifyProvenanceManifest } from "./provenance.mjs";
import { exportEdl, exportFcpxml, exportOtio, importEdl, importFcpxml, importOtio } from "./editor-exchange.mjs";
import { createHandoff, reimportHandoff } from "./editor-handoff.mjs";
import { loadC2paSigningMaterial, signC2paAsset, verifyC2paAsset } from "./c2pa.mjs";
import { assertReleaseGate } from "./release-gate.mjs";
import { assertTimelineCapabilities, validateCapabilityRegistry } from "./capability-registry.mjs";
import {
  analyzeProjectGaps,
  applyReviewPatch,
  approveProject,
  auditProject,
  commitTimelineDraft,
  compileTimelineFromCandidates,
  completeProjectRender,
  buildProjectRenderPlan,
  createWorkflowProject,
  evaluateForgeRequestGate,
  finalizeProject,
  registerProjectAssets,
  registerProjectCandidates,
  submitProjectReview,
  transitionProject,
  workflowStatus
} from "./workflow.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) result[key] = true;
    else {
      result[key] = value;
      index += 1;
    }
  }
  return result;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function checkTool(tool) {
  const resolved = await resolveTool(tool);
  try {
    const versionArgs = tool === "node" ? ["--version"] : ["-version"];
    const { stdout } = await execFileAsync(resolved, versionArgs, { maxBuffer: 1024 * 1024, windowsHide: true });
    return { tool, path: resolved, ok: true, version: stdout.split(/\r?\n/, 1)[0] };
  } catch (error) {
    return { tool, path: resolved, ok: false, code: error.code === "ENOENT" ? "DEPENDENCY_MISSING" : "TOOL_FAILED" };
  }
}

function profileByName(name) {
  return name === "final" ? FINAL_PROFILE : PREVIEW_PROFILE;
}

async function buildPlanFromArgs(args) {
  return buildRenderPlan({
    timeline: await readJson(args.timeline),
    assets: await readJson(args.assets),
    profile: profileByName(args.profile),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand] = args._;
  const project = resolve(args.project ?? ".");

  if (command === "help" || args.help === true || args.h === true) {
    print({
      commands: {
        init: "cutkit init --project <dir>",
        workflow: "cutkit workflow init|assets|candidates|plan|commit|gaps|audit|render-plan|render-complete|review|apply-review|forge|approve|finalize|status ...",
        validate: "cutkit validate --project <dir>",
        patch: "cutkit patch --project <dir> --patch <patch.json>",
        id: "cutkit id --prefix <snake_case>",
        lock: "cutkit lock acquire|release|list --project <dir>",
        doctor: "cutkit doctor",
        probe: "cutkit probe --input <media>",
        captions: "cutkit captions build --input <cues.json> --output <out.ass> | cutkit captions qc --input <cues.json>",
        qc: "cutkit qc audio --input <media> [--run] [--metrics <metrics.json>]",
        "build-render-plan": "cutkit build-render-plan --timeline <timeline.json> --assets <assets.json> --profile preview|final --output <plan.json>",
        render: "cutkit render --plan <plan.json> --output <out.mp4> [--dry-run] [--asset ... --manifest ... --rights ... --consent ...]",
        provenance: "cutkit provenance create|verify|c2pa ...",
        rights: "cutkit rights check --asset <asset.json> --manifest <manifest.json> ...",
        exchange: "cutkit exchange export|import --format edl|fcpxml|otio-json ...",
        handoff: "cutkit handoff export|reimport ...",
        c2pa: "cutkit c2pa sign --input <asset> --manifest <manifest> --asset <asset.json> --rights <rights.json> --consent <consent.json> --certificate <cert> --private-key <key> | verify ..."
      }
    });
    return;
  }


  if (command === "workflow") {
    const actor = args.actor ?? "human:operator";
    if (subcommand === "init") {
      const intent = args.intent ? await readJson(args.intent) : undefined;
      const created = await createWorkflowProject(project, {
        projectId: args["project-id"],
        intent,
        actor,
        fps: args.fps === undefined ? undefined : Number(args.fps),
        resolution: args.resolution ? String(args.resolution).split("x").map(Number) : undefined,
        audioSampleRate: args["sample-rate"] === undefined ? undefined : Number(args["sample-rate"])
      });
      print({ ok: true, projectId: created.meta.projectId, state: created.meta.state, revision: created.engine.currentRevision });
      return;
    }
    if (subcommand === "assets") {
      const state = await registerProjectAssets(project, await readJson(args.input), { actor });
      print({ ok: true, state: state.meta.state, assetCount: Object.keys(state.assets).length });
      return;
    }
    if (subcommand === "candidates") {
      const state = await registerProjectCandidates(project, await readJson(args.input), { actor });
      print({ ok: true, state: state.meta.state, candidateCount: state.candidates.length });
      return;
    }
    if (subcommand === "plan") {
      const result = await compileTimelineFromCandidates(project, {
        actor,
        output: args.output,
        targetDurationMs: args.duration === undefined ? undefined : Number(args.duration),
        minSafety: args["min-safety"] === undefined ? undefined : Number(args["min-safety"])
      });
      print({ ok: true, output: result.outputPath, revision: result.timeline.revision, durationMs: result.timeline.durationMs, candidateIds: result.candidateIds });
      return;
    }
    if (subcommand === "commit") {
      const result = await commitTimelineDraft(project, {
        actor,
        draftPath: args.draft,
        baseRevision: args["base-revision"] === undefined ? undefined : Number(args["base-revision"]),
        causeId: args["cause-id"]
      });
      print({ ok: true, revision: result.revision, hash: result.hash, changedPaths: result.changedPaths });
      return;
    }
    if (subcommand === "gaps") {
      print(await analyzeProjectGaps(project, { actor }));
      return;
    }
    if (subcommand === "audit") {
      const result = await auditProject(project, { actor });
      if (args.output) await writeJson(args.output, result.report);
      print({ ok: result.report.passed, report: result.report, output: args.output ? resolve(args.output) : result.reportPath, gapCount: result.gaps.gaps.length });
      return;
    }
    if (subcommand === "render-plan") {
      const result = await buildProjectRenderPlan(project, { actor, profile: args.profile ?? "preview", output: args.output });
      print({ ok: true, output: result.outputPath, planId: result.plan.planId, renderHash: result.plan.renderHash, revision: result.plan.revision });
      return;
    }
    if (subcommand === "render-complete") {
      print(await completeProjectRender(project, { actor, output: args.output, renderHash: args["render-hash"] }));
      return;
    }
    if (subcommand === "review") {
      print(await submitProjectReview(project, await readJson(args.input), { actor }));
      return;
    }
    if (subcommand === "apply-review") {
      const input = await readJson(args.input ?? args.patch);
      const result = await applyReviewPatch(project, { ...input, actor: input.actor ?? actor });
      print({ ok: true, revision: result.result.revision, patchId: result.patchRecord.patchId, patch: result.patchPath });
      return;
    }
    if (subcommand === "forge") {
      const gate = await evaluateForgeRequestGate(project, await readJson(args.input), {
        actor,
        artifact: args.artifact ? await readJson(args.artifact) : null
      });
      print(gate);
      return;
    }
    if (subcommand === "transition") {
      print(await transitionProject(project, args.state, { actor, causeId: args["cause-id"], reason: args.reason ?? "" }));
      return;
    }
    if (subcommand === "approve") {
      print(await approveProject(project, { actor, scope: args.scope }));
      return;
    }
    if (subcommand === "finalize") {
      print(await finalizeProject(project, { actor, renderedFile: args["rendered-file"] }));
      return;
    }
    if (subcommand === "status") {
      print(await workflowStatus(project));
      return;
    }
    throw new CutKitError("COMMAND_UNKNOWN", "Unknown workflow command", { command, subcommand });
  }

  if (command === "id") {
    print({ id: newId(args.prefix ?? "object") });
    return;
  }
  if (command === "init") {
    print(await createProject(project, args["project-id"]));
    return;
  }
  if (command === "validate") {
    const { engine } = await loadProject(project);
    print({ ok: true, revision: engine.currentRevision, timelineId: engine.document.timelineId });
    return;
  }
  if (command === "patch") {
    print(await commitProject(project, await readJson(args.patch)));
    return;
  }
  if (command === "lock" && subcommand === "list") {
    const { engine } = await loadProject(project);
    print({ locks: engine.lockManager.list() });
    return;
  }
  if (command === "lock" && subcommand === "acquire") {
    print(await updateLocks(project, (locks, document) => locks.acquire({
      actor: args.actor,
      target: args.path ? { path: args.path } : { objectId: args["object-id"], relativePath: args["relative-path"] },
      reason: args.reason ?? "",
      ttlMs: Number(args["ttl-ms"] ?? 30 * 60 * 1000),
      document
    })));
    return;
  }
  if (command === "lock" && subcommand === "release") {
    print(await updateLocks(project, (locks) => {
      locks.release(args["lock-id"], args.actor);
      return { released: args["lock-id"] };
    }));
    return;
  }
  if (command === "doctor") {
    print({ tools: await Promise.all([checkTool("node"), checkTool("ffmpeg"), checkTool("ffprobe")]) });
    return;
  }
  if (command === "probe") {
    print(await probeMedia(args.input, { ffprobePath: args.ffprobe }));
    return;
  }
  if (command === "captions" && subcommand === "build") {
    const cues = await readJson(args.input);
    const style = args.style ? await readJson(args.style) : {};
    const ass = buildAss(cues, style);
    await writeFile(resolve(args.output), ass, "utf8");
    print({ ok: true, output: resolve(args.output), cueCount: cues.length });
    return;
  }
  if (command === "captions" && subcommand === "qc") {
    print(validateCaptionSet(await readJson(args.input), args.policy ? await readJson(args.policy) : {}));
    return;
  }
  if (command === "qc" && subcommand === "audio") {
    const policy = args.policy ? await readJson(args.policy) : {};
    if (args.run === true) {
      print(await runAudioQc(args.input, { policy }));
      return;
    }
    const metrics = args.metrics ? await readJson(args.metrics) : await readJson(args.input);
    print({ plan: buildAudioQcPlan(args.input ?? "audio.wav", { policy }), report: evaluateAudioQc(metrics, policy) });
    return;
  }
  if (command === "build-render-plan") {
    if (args.registry) {
      const registry = await readJson(args.registry);
      validateCapabilityRegistry(registry);
      assertTimelineCapabilities(await readJson(args.timeline), registry);
    }
    const plan = await buildPlanFromArgs(args);
    await writeJson(args.output, plan);
    print({ ok: true, output: resolve(args.output), planId: plan.planId, renderHash: plan.renderHash });
    return;
  }
  if (command === "render") {
    const plan = args.plan ? await readJson(args.plan) : await buildPlanFromArgs(args);
    if (args["dry-run"] !== true && args["allow-unverified-render"] !== true) {
      if (!args.asset || !args.manifest || !args.rights || !args.consent) throw new CutKitError("RELEASE_POLICY_REQUIRED", "Real render requires --asset, --manifest, --rights, and --consent");
      assertReleaseGate({ asset: await readJson(args.asset), manifest: await readJson(args.manifest), rights: await readJson(args.rights), consents: await readJson(args.consent), useCase: args["use-case"] ?? "edit" });
    }
    const result = await executeRender(plan, {
      outputPath: args.output ?? plan.outputs?.[0]?.path,
      workDir: args["work-dir"] ?? project,
      dryRun: args["dry-run"] === true,
      ffmpegPath: args.ffmpeg
    });
    print(result);
    return;
  }
  if (command === "c2pa" && subcommand === "sign") {
    if (!args.asset || !args.rights || !args.consent) {
      throw new CutKitError("RELEASE_POLICY_REQUIRED", "C2PA signing requires --asset, --rights, and --consent release records");
    }
    const releasePolicy = {
      required: true,
      asset: await readJson(args.asset),
      rights: await readJson(args.rights),
      consents: await readJson(args.consent),
      useCase: args["use-case"] ?? "edit"
    };
    const material = await loadC2paSigningMaterial({
      certificatePath: args.certificate,
      privateKeyPath: args["private-key"]
    });
    const result = await signC2paAsset({
      inputPath: args.input,
      outputPath: args.output,
      provenanceManifest: await readJson(args.manifest),
      certificate: material.certificate,
      privateKey: material.privateKey,
      mimeType: args["mime-type"] ?? "application/octet-stream",
      tsaUrl: args["tsa-url"],
      verifyAfterSign: args["verify-after-sign"] === true,
      releasePolicy
    });
    print(result);
    return;
  }
  if (command === "c2pa" && subcommand === "verify") {
    print(await verifyC2paAsset({
      inputPath: args.input,
      mimeType: args["mime-type"] ?? "application/octet-stream",
      verifyTrust: args["verify-trust"] === true
    }));
    return;
  }
  if (command === "provenance" && subcommand === "create") {
    const asset = await readJson(args.asset);
    const manifest = createProvenanceManifest({
      asset,
      source: args.source ? await readJson(args.source) : { kind: "registered" },
      generation: args.generation ? await readJson(args.generation) : { kind: "capture" },
      rightsIds: args.rights ? [JSON.parse(await readFile(resolve(args.rights), "utf8")).rightsId] : [],
      consentIds: args.consent ? [JSON.parse(await readFile(resolve(args.consent), "utf8")).consentId] : [],
      disclosure: args.disclosure ?? "none",
      edits: args.edits ? await readJson(args.edits) : []
    });
    await writeJson(args.output, manifest);
    print({ ok: true, output: resolve(args.output), manifestId: manifest.manifestId });
    return;
  }
  if (command === "provenance" && subcommand === "verify") {
    const manifest = await readJson(args.manifest);
    print({ ok: verifyProvenanceManifest(manifest), manifestId: manifest.manifestId });
    return;
  }
  if (command === "provenance" && subcommand === "c2pa") {
    const manifest = await readJson(args.manifest);
    const c2pa = buildC2paManifest(manifest);
    if (args.output) await writeJson(args.output, c2pa);
    print({ ok: true, output: args.output ? resolve(args.output) : null, command: buildC2paCommand({ inputPath: args.input ?? "", outputPath: args["c2pa-output"] ?? "", manifestPath: args.output ?? "" }) });
    return;
  }
  if (command === "rights" && subcommand === "check") {
    print(evaluateReleasePolicy({
      asset: await readJson(args.asset),
      manifest: await readJson(args.manifest),
      rights: args.rights ? await readJson(args.rights) : [],
      consents: args.consent ? await readJson(args.consent) : [],
      useCase: args["use-case"] ?? "edit"
    }));
    return;
  }
  if (command === "exchange" && subcommand === "export") {
    const timeline = await readJson(args.timeline);
    const assets = await readJson(args.assets);
    let payload;
    if (args.format === "edl") payload = exportEdl(timeline, assets, { fps: Number(args.fps ?? 30), title: args.title });
    else if (args.format === "fcpxml") payload = exportFcpxml(timeline, assets, { fps: Number(args.fps ?? 30), title: args.title });
    else if (args.format === "otio-json") payload = `${JSON.stringify(exportOtio(timeline, assets), null, 2)}\n`;
    else throw new CutKitError("EXCHANGE_FORMAT_UNSUPPORTED", "Format must be edl, fcpxml, or otio-json");
    await writeFile(resolve(args.output), payload, "utf8");
    print({ ok: true, format: args.format, output: resolve(args.output), bytes: Buffer.byteLength(payload) });
    return;
  }
  if (command === "exchange" && subcommand === "import") {
    const payload = await readFile(resolve(args.input), "utf8");
    let timeline;
    if (args.format === "edl") timeline = importEdl(payload, { fps: Number(args.fps ?? 30), assetIdByName: args["asset-map"] ? await readJson(args["asset-map"]) : {} });
    else if (args.format === "fcpxml") timeline = importFcpxml(payload, { assetIdByName: args["asset-map"] ? await readJson(args["asset-map"]) : {} });
    else if (args.format === "otio-json") timeline = importOtio(JSON.parse(payload), { assetIdByName: args["asset-map"] ? await readJson(args["asset-map"]) : {} });
    else throw new CutKitError("EXCHANGE_FORMAT_UNSUPPORTED", "Format must be edl, fcpxml, or otio-json");
    await writeJson(args.output, timeline);
    print({ ok: true, output: resolve(args.output), revision: timeline.revision, clips: timeline.clips.length });
    return;
  }
  if (command === "handoff" && subcommand === "export") {
    const result = createHandoff({
      timeline: await readJson(args.timeline),
      assets: await readJson(args.assets),
      format: args.format,
      actor: args.actor,
      locks: args.locks ? await readJson(args.locks) : [],
      options: { fps: Number(args.fps ?? 30), title: args.title }
    });
    await writeJson(args.manifest, result.manifest);
    await writeFile(resolve(args.payload), result.payload, "utf8");
    print({ ok: true, manifest: resolve(args.manifest), payload: resolve(args.payload), handoffId: result.manifest.handoffId });
    return;
  }
  if (command === "handoff" && subcommand === "reimport") {
    const { meta, engine } = await loadProject(project);
    const result = reimportHandoff({
      manifest: await readJson(args.manifest),
      payload: await readFile(resolve(args.payload), "utf8"),
      engine,
      actor: args.actor,
      expectedBaseRevision: args["base-revision"] === undefined ? undefined : Number(args["base-revision"]),
      assets: args.assets ? await readJson(args.assets) : {}
    });
    await persistEngine(project, meta, engine, result.result);
    print({ ok: true, revision: result.result.revision, losses: result.losses, manifest: result.manifest });
    return;
  }
  throw new CutKitError("COMMAND_UNKNOWN", "Unknown command", { command, subcommand });
}

main().catch((error) => {
  const output = error instanceof CutKitError
    ? { ok: false, code: error.code, message: error.message, details: error.details }
    : { ok: false, code: "UNEXPECTED_ERROR", message: error.message };
  process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = 1;
});








