import { contentHash, deepClone } from "./canonical-json.mjs";
import { CutKitError } from "./errors.mjs";
import { newId } from "./id.mjs";

export function validateCapabilityRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new CutKitError("CAPABILITY_REGISTRY_INVALID", "Capability registry must be an object");
  }
  const entries = Object.values(registry);
  for (const entry of entries) {
    if (!entry?.capabilityId || !entry?.kind || !entry?.status || !entry?.renderer) {
      throw new CutKitError("CAPABILITY_ENTRY_INVALID", "Capability entry is missing required fields", { entry });
    }
    if (!["documented", "verified", "missing", "blocked", "failed", "unknown"].includes(entry.status)) {
      throw new CutKitError("CAPABILITY_STATUS_INVALID", "Capability status is invalid", { entry });
    }
    if (entry.fallback && !registry[entry.fallback]) {
      throw new CutKitError("CAPABILITY_FALLBACK_MISSING", "Capability fallback is not registered", { capabilityId: entry.capabilityId, fallback: entry.fallback });
    }
  }
  return true;
}

export function assertTimelineCapabilities(timeline, registry) {
  validateCapabilityRegistry(registry);
  const referenced = [];
  for (const clip of timeline.clips ?? []) {
    for (const effect of clip.effects ?? []) {
      referenced.push({ clipId: clip.clipId, capabilityId: effect.capabilityId ?? effect.type, effect });
    }
    for (const transition of [clip.transitionIn, clip.transitionOut]) {
      if (transition?.capabilityId) referenced.push({ clipId: clip.clipId, capabilityId: transition.capabilityId, effect: transition });
    }
  }
  const failures = referenced.filter((item) => {
    const capability = registry[item.capabilityId];
    return !capability || capability.status !== "verified";
  });
  if (failures.length > 0) {
    throw new CutKitError("CAPABILITY_NOT_VERIFIED", "Timeline references missing or unverified capabilities", { failures });
  }
  return {
    ok: true,
    referenced: referenced.map((item) => item.capabilityId),
    registryHash: contentHash(deepClone(registry))
  };
}

export function createCapability(entry) {
  return {
    ...deepClone(entry),
    capabilityId: entry.capabilityId ?? newId("capability"),
    status: entry.status ?? "documented",
    version: entry.version ?? "0.0.0",
    testVectors: entry.testVectors ?? []
  };
}
