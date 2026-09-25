import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { buildC2paManifest, createProvenanceManifest, evaluateReleasePolicy, verifyProvenanceChain, verifyProvenanceManifest } from "../src/provenance.mjs";
import { validateConsentRecord, validateRightsRecord } from "../src/p2-schema.mjs";

function fixture(overrides = {}) {
  const assetId = newId("asset");
  const asset = {
    assetId,
    sourceHash: "sha256:abc",
    provenance: { kind: "real", subjects: [], roles: ["product"], ...(overrides.provenance ?? {}) }
  };
  const rights = {
    rightsId: newId("rights"),
    assetId,
    license: "internal-review",
    usage: "edit",
    territory: "worldwide",
    allowedUses: ["edit"],
    prohibitedUses: ["impersonation"],
    proofRefs: []
  };
  const consent = {
    consentId: newId("consent"),
    assetId,
    subjectType: "none",
    subjectRef: "not-applicable",
    status: "not_required",
    scope: ["edit"]
  };
  validateRightsRecord(rights);
  validateConsentRecord(consent);
  return { asset, rights, consent };
}

test("provenance manifest signs and verifies its contents", () => {
  const { asset } = fixture();
  const manifest = createProvenanceManifest({ asset, source: { kind: "camera" }, disclosure: "none" });
  assert.equal(verifyProvenanceManifest(manifest), true);
  const tampered = structuredClone(manifest);
  tampered.edits.push({ action: "trim" });
  assert.throws(() => verifyProvenanceManifest(tampered), (error) => error.code === "PROVENANCE_INTEGRITY_INVALID");
});

test("release policy passes real media with rights and blocks synthetic factual roles", () => {
  const real = fixture();
  const manifest = createProvenanceManifest({ asset: real.asset, rightsIds: [real.rights.rightsId], consentIds: [real.consent.consentId] });
  const report = evaluateReleasePolicy({
    asset: real.asset,
    manifest,
    rights: [real.rights],
    consents: [real.consent],
    useCase: "edit"
  });
  assert.equal(report.passed, true);

  const synthetic = fixture({ provenance: { kind: "synthetic_generated", roles: ["product"] } });
  const syntheticManifest = createProvenanceManifest({
    asset: synthetic.asset,
    rightsIds: [synthetic.rights.rightsId],
    consentIds: [synthetic.consent.consentId],
    disclosure: "ai_generated"
  });
  const blocked = evaluateReleasePolicy({
    asset: synthetic.asset,
    manifest: syntheticManifest,
    rights: [synthetic.rights],
    consents: [synthetic.consent],
    useCase: "edit"
  });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.checks.find((check) => check.code === "SYNTHETIC_FACTUAL_BLOCK").status, "fail");
});

test("provenance chain and C2PA manifest preserve hashes", () => {
  const first = fixture();
  const m1 = createProvenanceManifest({ asset: first.asset, previousManifestHash: null, now: () => 1 });
  const m2 = createProvenanceManifest({
    asset: first.asset,
    previousManifestHash: m1.manifestHash,
    edits: [{ action: "crop" }],
    now: () => 2
  });
  assert.equal(verifyProvenanceChain([m1, m2]), true);
  const c2pa = buildC2paManifest(m2);
  assert.equal(c2pa.claim_generator, "CutKit");
  assert.equal(c2pa.assertions.some((assertion) => assertion.label === "org.cutkit.provenance"), true);
});


