import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "../src/id.mjs";
import { createProvenanceManifest } from "../src/provenance.mjs";
import { signC2paAsset, verifyC2paAsset } from "../src/c2pa.mjs";
import { hashFile } from "../src/media.mjs";
import { runTool } from "../src/process.mjs";
import { resolveTool } from "../src/tool-paths.mjs";

test("signs and verifies a real asset with @contentauth/c2pa-node", async () => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-c2pa-"));
  const input = join(root, "input.jpg");
  const output = join(root, "signed.jpg");
  const ffmpeg = await resolveTool("ffmpeg");
  await runTool(ffmpeg, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1",
    "-frames:v", "1",
    input
  ]);
  const sourceHash = await hashFile(input);
  const asset = {
    assetId: newId("asset"),
    sourceHash,
    provenance: { kind: "real", subjects: [], roles: ["product"] }
  };
  const provenanceManifest = createProvenanceManifest({
    asset,
    source: { kind: "test-fixture" },
    generation: { kind: "capture" },
    disclosure: "none",
    edits: [{ action: "c2pa.opened" }]
  });
  const certificate = await readFile("D:/项目3/test/fixtures/certs/es256.pub", "utf8");
  const privateKey = await readFile("D:/项目3/test/fixtures/certs/es256.pem", "utf8");
  const signed = await signC2paAsset({
    inputPath: input,
    outputPath: output,
    provenanceManifest,
    certificate,
    privateKey,
    mimeType: "image/jpeg"
  });
  assert.equal(signed.ok, true);
  assert.equal(signed.embedded, true);
  const verified = await verifyC2paAsset({ inputPath: output, mimeType: "image/jpeg" });
  assert.equal(verified.ok, true);
  assert.equal(verified.embedded, true);
  assert.equal(verified.activeManifest?.title, asset.assetId);
  await writeFile(join(root, "c2pa.json"), JSON.stringify(verified.manifestStore, null, 2), "utf8");
});






