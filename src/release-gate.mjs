import { CutKitError } from "./errors.mjs";
import { evaluateReleasePolicy } from "./provenance.mjs";

export function assertReleaseGate(input) {
  const report = evaluateReleasePolicy(input);
  if (!report.passed) {
    throw new CutKitError("RELEASE_POLICY_BLOCKED", "Release gate rejected the media package", { report });
  }
  return report;
}
