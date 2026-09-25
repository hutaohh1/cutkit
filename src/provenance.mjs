import { contentHash, deepClone } from "./canonical-json.mjs";
import { CutKitError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { validateConsentRecord, validateProvenanceManifest, validateRightsRecord } from "./p2-schema.mjs";
import { validateQcReport } from "./p1-schema.mjs";

function baseManifest({ asset, source, generation, rightsIds, consentIds, disclosure, edits, previousManifestHash, now }) {
  return {
    schemaVersion: 1,
    manifestId: newId("manifest"),
    assetId: asset.assetId,
    contentHash: asset.sourceHash,
    source: deepClone(source),
    generation: deepClone(generation),
    rightsIds: [...rightsIds],
    consentIds: [...consentIds],
    disclosure,
    edits: deepClone(edits),
    previousManifestHash,
    createdAt: now()
  };
}

function withoutHashes(manifest) {
  const copy = deepClone(manifest);
  delete copy.integrityHash;
  delete copy.manifestHash;
  return copy;
}

export function createProvenanceManifest({
  asset,
  source = {},
  generation = {},
  rightsIds = [],
  consentIds = [],
  disclosure = "none",
  edits = [],
  previousManifestHash = null,
  now = () => Date.now()
}) {
  if (!asset?.assetId || !asset?.sourceHash) throw new CutKitError("ASSET_REQUIRED", "Asset ID and source hash are required");
  const unsigned = baseManifest({ asset, source, generation, rightsIds, consentIds, disclosure, edits, previousManifestHash, now });
  const integrityHash = contentHash(unsigned);
  const manifest = { ...unsigned, integrityHash };
  manifest.manifestHash = contentHash(manifest);
  validateProvenanceManifest(manifest);
  return manifest;
}

export function verifyProvenanceManifest(manifest) {
  validateProvenanceManifest(manifest);
  const expectedIntegrity = contentHash(withoutHashes(manifest));
  if (manifest.integrityHash !== expectedIntegrity) {
    throw new CutKitError("PROVENANCE_INTEGRITY_INVALID", "Provenance manifest integrity hash does not match its contents", {
      manifestId: manifest.manifestId
    });
  }
  const expectedManifest = contentHash({ ...deepClone(manifest), manifestHash: undefined });
  if (manifest.manifestHash !== expectedManifest) {
    throw new CutKitError("PROVENANCE_MANIFEST_HASH_INVALID", "Provenance manifest hash does not match its contents", {
      manifestId: manifest.manifestId
    });
  }
  return true;
}

export function verifyProvenanceChain(manifests) {
  if (!Array.isArray(manifests)) throw new CutKitError("PROVENANCE_CHAIN_INVALID", "Provenance chain must be an array");
  let previousHash = null;
  for (const manifest of manifests) {
    verifyProvenanceManifest(manifest);
    if (manifest.previousManifestHash !== previousHash) {
      throw new CutKitError("PROVENANCE_CHAIN_BROKEN", "Provenance chain has a missing or incorrect previous hash", {
        manifestId: manifest.manifestId
      });
    }
    previousHash = manifest.manifestHash;
  }
  return true;
}

export function evaluateReleasePolicy({ asset, manifest, rights = [], consents = [], useCase = "edit", now = Date.now() }) {
  const checks = [];
  const add = (code, status, value, threshold, message) => checks.push({ code, status, value, threshold, message });
  add("ASSET_PRESENT", asset?.assetId ? "pass" : "fail", asset?.assetId ?? null, "assetId", "Asset must be registered");
  add("SOURCE_HASH_PRESENT", asset?.sourceHash?.startsWith("sha256:") ? "pass" : "fail", asset?.sourceHash ?? null, "sha256", "Source hash is required");
  add("PROVENANCE_PRESENT", manifest ? "pass" : "fail", manifest?.manifestId ?? null, "manifestId", "Provenance manifest is required");
  if (manifest) {
    try {
      verifyProvenanceManifest(manifest);
      add("PROVENANCE_INTEGRITY", "pass", manifest.integrityHash, "valid", "Provenance integrity");
    } catch {
      add("PROVENANCE_INTEGRITY", "fail", manifest.integrityHash ?? null, "valid", "Provenance integrity");
    }
    add("PROVENANCE_ASSET_MATCH", manifest.assetId === asset?.assetId ? "pass" : "fail", manifest.assetId, asset?.assetId, "Manifest asset must match");
  }
  const rightList = Array.isArray(rights) ? rights : [rights].filter(Boolean);
  const consentList = Array.isArray(consents) ? consents : [consents].filter(Boolean);
  const matchingRights = rightList.filter((record) => record.assetId === asset?.assetId);
  const inWindow = (record) => (record.validFrom === undefined || record.validFrom <= now) && (record.validUntil === undefined || record.validUntil >= now);
  const allowedRight = matchingRights.find((record) => (record.usage === useCase || (record.usage === "publish" && useCase === "edit")) && inWindow(record));
  add("RIGHTS_ALLOWED", allowedRight ? "pass" : "fail", allowedRight?.rightsId ?? null, useCase, "A matching rights record is required");
  const needsConsent = asset?.provenance?.kind !== "real" || (asset?.provenance?.subjects ?? []).length > 0;
  const validConsent = consentList.find((record) => record.assetId === asset?.assetId && record.status === "granted" && record.scope.includes(useCase) && (!record.expiresAt || record.expiresAt > now));
  add("CONSENT_GRANTED", !needsConsent || validConsent ? "pass" : "fail", validConsent?.consentId ?? null, "granted", "Subject consent is required when applicable");
  const synthetic = asset?.provenance?.kind && asset.provenance.kind !== "real";
  const roles = asset?.provenance?.roles ?? [];
  const factual = roles.some((role) => ["person", "voice", "place", "product", "evidence", "testimony"].includes(role));
  add("SYNTHETIC_FACTUAL_BLOCK", synthetic && factual ? "fail" : "pass", { synthetic, factual }, false, "Synthetic media cannot impersonate factual roles");
  add("SYNTHETIC_DISCLOSURE", !synthetic || ["ai_assisted", "ai_generated", "synthetic_procedural"].includes(manifest?.disclosure) ? "pass" : "fail", manifest?.disclosure ?? null, "disclosure", "Synthetic media must be disclosed");
  const report = {
    schemaVersion: 1,
    reportId: newId("report"),
    target: "render",
    checks,
    passed: checks.every((check) => check.status !== "fail")
  };
  validateQcReport(report);
  return report;
}

export function buildC2paManifest(provenanceManifest) {
  verifyProvenanceManifest(provenanceManifest);
  return {
    claim_version: "1.0",
    claim_generator: "CutKit",
    format: "application/octet-stream",
    title: provenanceManifest.assetId,
    assertions: [
      { label: "c2pa.actions", data: { actions: provenanceManifest.edits } },
      { label: "c2pa.hash.data", data: { hash: provenanceManifest.contentHash } },
      { label: "org.cutkit.provenance", data: deepClone(provenanceManifest) }
    ],
    ingredients: []
  };
}

export function buildC2paCommand({ inputPath, outputPath, manifestPath, tool = "c2patool" }) {
  return {
    tool,
    args: ["sign", "--input", inputPath, "--output", outputPath, "--manifest", manifestPath],
    note: "Use the installed C2PA SDK/tool version to verify this command adapter before production use"
  };
}
