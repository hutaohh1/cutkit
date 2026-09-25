import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Builder, Context, LocalSigner, Reader } from "@contentauth/c2pa-node";
import { contentHash, deepClone } from "./canonical-json.mjs";
import { evaluateReleasePolicy } from "./provenance.mjs";
import { hashFile } from "./media.mjs";
import { CutKitError } from "./errors.mjs";

function bufferValue(value, name) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new CutKitError("C2PA_KEY_REQUIRED", `${name} must be a PEM string or Buffer`);
}

function intentFor(provenanceManifest) {
  if (provenanceManifest.disclosure === "ai_generated") {
    return { create: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" };
  }
  if (provenanceManifest.disclosure === "synthetic_procedural") {
    return { create: "http://cv.iptc.org/newscodes/digitalsourcetype/composite" };
  }
  return "edit";
}

export function buildC2paManifestDefinition(provenanceManifest, mimeType = "application/octet-stream") {
  return {
    vendor: "CutKit",
    claim_generator: "CutKit",
    claim_generator_info: [{ name: "CutKit", version: "0.1.0" }],
    title: provenanceManifest.assetId,
    format: mimeType,
    instance_id: provenanceManifest.manifestId,
    ingredients: [],
    assertions: [{
      label: "org.cutkit.provenance",
      data: deepClone(provenanceManifest)
    }],
    resources: { resources: {} }
  };
}

export async function signC2paAsset({
  inputPath,
  outputPath,
  provenanceManifest,
  certificate,
  privateKey,
  mimeType = "application/octet-stream",
  tsaUrl,
  verifyAfterSign = false,
  verifyInputHash = true,
  releasePolicy
}) {
  if (!inputPath || !outputPath) throw new CutKitError("C2PA_PATH_REQUIRED", "Input and output paths are required");
  if (verifyInputHash) {
    const actualHash = await hashFile(inputPath);
    if (actualHash !== provenanceManifest.contentHash) {
      throw new CutKitError("C2PA_ASSET_HASH_MISMATCH", "Provenance contentHash does not match the input asset", {
        expected: provenanceManifest.contentHash,
        actual: actualHash
      });
    }
  }
  if (releasePolicy && releasePolicy.required !== false) {
    const report = evaluateReleasePolicy({
      asset: releasePolicy.asset,
      manifest: provenanceManifest,
      rights: releasePolicy.rights ?? [],
      consents: releasePolicy.consents ?? [],
      useCase: releasePolicy.useCase ?? "edit"
    });
    if (!report.passed) {
      throw new CutKitError("RELEASE_POLICY_BLOCKED", "C2PA signing is blocked by release policy", { report });
    }
  }
  const definition = buildC2paManifestDefinition(provenanceManifest, mimeType);
  const context = new Context({
    verify: { verifyAfterSign, verifyTrust: false, verifyTimestampTrust: false },
    builder: { generateC2paArchive: false }
  });
  const builder = await Builder.withJsonAsync(definition, context);
  builder.setIntent(intentFor(provenanceManifest));
  const signer = LocalSigner.newSigner(bufferValue(certificate, "certificate"), bufferValue(privateKey, "privateKey"), "es256", tsaUrl);
  const input = { path: inputPath, mimeType };
  const output = { path: outputPath, mimeType };
  const manifestData = builder.sign(signer, input, output);
  const reader = await Reader.fromAsset({ path: outputPath, mimeType }, context);
  if (!reader) throw new CutKitError("C2PA_SIGN_FAILED", "Signed asset could not be read back");
  const manifestStore = reader.json();
  return {
    ok: true,
    outputPath,
    manifestDataHash: `sha256:${createHash("sha256").update(manifestData).digest("hex")}`,
    embedded: reader.isEmbedded(),
    manifestStore,
    activeManifest: reader.getActive(),
    validationStatus: manifestStore.validation_status ?? []
  };
}

export async function verifyC2paAsset({ inputPath, mimeType = "application/octet-stream", verifyTrust = false }) {
  const context = new Context({
    verify: { verifyAfterReading: true, verifyTrust, verifyTimestampTrust: false, remoteManifestFetch: false }
  });
  const reader = await Reader.fromAsset({ path: inputPath, mimeType }, context);
  if (!reader) throw new CutKitError("C2PA_MANIFEST_MISSING", "No C2PA manifest was found in the asset");
  const manifestStore = reader.json();
  const validationStatus = manifestStore.validation_status ?? [];
  const critical = validationStatus.filter((entry) => /^(signature|claimSignature|assertion)\./.test(entry.code ?? ""));
  return {
    ok: critical.length === 0,
    embedded: reader.isEmbedded(),
    activeLabel: reader.activeLabel(),
    activeManifest: reader.getActive(),
    manifestStore,
    validationStatus,
    criticalValidationStatus: critical
  };
}

export async function loadC2paSigningMaterial({ certificatePath, privateKeyPath, certificate, privateKey }) {
  return {
    certificate: certificate ?? await readFile(certificatePath, "utf8"),
    privateKey: privateKey ?? await readFile(privateKeyPath, "utf8")
  };
}

export function c2paInputHash(path, bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}



