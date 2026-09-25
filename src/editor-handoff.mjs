import { contentHash, deepClone } from "./canonical-json.mjs";
import { CutKitError, RevisionConflictError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { validateHandoffManifest } from "./p2-schema.mjs";
import { exportEdl, exportFcpxml, exportOtio, importEdl, importFcpxml, importOtio, roundTripLoss } from "./editor-exchange.mjs";

function payloadFor(format, timeline, assets, options) {
  if (format === "edl") return exportEdl(timeline, assets, options);
  if (format === "fcpxml") return exportFcpxml(timeline, assets, options);
  if (format === "otio-json") return JSON.stringify(exportOtio(timeline, assets, options), null, 2);
  throw new CutKitError("HANDOFF_FORMAT_UNSUPPORTED", "Unsupported editor handoff format", { format });
}

function parsePayload(format, payload, options) {
  if (format === "edl") return importEdl(payload, options);
  if (format === "fcpxml") return importFcpxml(payload, options);
  if (format === "otio-json") return importOtio(JSON.parse(payload), options);
  throw new CutKitError("HANDOFF_FORMAT_UNSUPPORTED", "Unsupported editor handoff format", { format });
}

export function createHandoff({ timeline, assets, format, actor, locks = [], options = {} }) {
  const payload = payloadFor(format, timeline, assets, options);
  const manifest = {
    schemaVersion: 1,
    handoffId: newId("handoff"),
    timelineId: timeline.timelineId,
    baseRevision: timeline.revision,
    format,
    actor,
    payloadHash: contentHash(payload),
    locks: deepClone(locks),
    ownership: "external_editor",
    status: "handed_off",
    createdAt: options.now?.() ?? Date.now()
  };
  validateHandoffManifest(manifest);
  return { manifest, payload };
}

export function reimportHandoff({ manifest, payload, engine, actor, expectedBaseRevision, assets = {}, options = {} }) {
  validateHandoffManifest(manifest);
  if (contentHash(payload) !== manifest.payloadHash) throw new CutKitError("HANDOFF_PAYLOAD_HASH_MISMATCH", "Handoff payload hash does not match manifest");
  if (manifest.status === "closed") throw new CutKitError("HANDOFF_CLOSED", "Handoff is already closed");
  const baseRevision = expectedBaseRevision ?? manifest.baseRevision;
  if (baseRevision !== engine.currentRevision) throw new RevisionConflictError(baseRevision, engine.currentRevision);
  const imported = parsePayload(manifest.format, payload, {
    ...options,
    timelineId: manifest.timelineId,
    trackId: options.trackId ?? engine.document.tracks?.[0]?.trackId,
    assetIdByName: options.assetIdByName ?? Object.fromEntries(Object.entries(assets).flatMap(([assetId, asset]) => {
      const name = String(asset.sourceUri ?? "").split(/[\\\\/]/).pop();
      return [[asset.sourceUri, assetId], [name, assetId]];
    }))
  });
  const losses = roundTripLoss(engine.document, imported);
  if (losses.hasLoss && options.allowLoss !== true) {
    throw new CutKitError("HANDOFF_LOSS_NOT_ALLOWED", "External editor round-trip would lose timeline data", { losses });
  }
  const operations = [
    { op: "test", path: "/revision", value: baseRevision },
    { op: "test", path: "/timelineId", value: manifest.timelineId },
    { op: "replace", path: "/tracks", value: imported.tracks },
    { op: "replace", path: "/clips", value: imported.clips }
  ];
  const result = engine.commit({ baseRevision, actor, operations });
  const closedManifest = { ...manifest, status: "reimported", ownership: "cutkit", reimportedAt: options.now?.() ?? Date.now() };
  validateHandoffManifest(closedManifest);
  return { manifest: closedManifest, imported, losses, result };
}


