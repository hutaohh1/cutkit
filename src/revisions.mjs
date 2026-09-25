import { contentHash, deepClone } from "./canonical-json.mjs";
import { PatchError, RevisionConflictError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { applyPatch } from "./patch.mjs";
import { LockManager } from "./locks.mjs";
import { validatePatchEnvelope, validateTimeline } from "./schema.mjs";

const PROTECTED_PATHS = new Set(["/schemaVersion", "/revision", "/timelineId"]);

function assertProtectedPaths(operations) {
  for (const operation of operations) {
    if (operation.op === "test") continue;
    for (const path of [operation.path, operation.from]) {
      if (typeof path === "string" && PROTECTED_PATHS.has(path)) {
        throw new PatchError("PATCH_IMMUTABLE_FIELD", "Patch cannot modify immutable timeline metadata", { path });
      }
    }
  }
}

export class RevisionEngine {
  constructor(initialDocument, { lockManager = new LockManager(), now = () => Date.now() } = {}) {
    validateTimeline(initialDocument);
    this.document = deepClone(initialDocument);
    this.lockManager = lockManager;
    this.now = now;
    this.history = [{ revision: this.document.revision, hash: contentHash(this.document), document: deepClone(this.document) }];
    this.events = [];
  }

  get currentRevision() {
    return this.document.revision;
  }

  snapshot() {
    return {
      revision: this.currentRevision,
      hash: contentHash(this.document),
      document: deepClone(this.document),
      history: this.history.map((entry) => deepClone(entry)),
      events: this.events.map((event) => deepClone(event)),
      locks: this.lockManager.toJSON()
    };
  }

  dryRun({ baseRevision, operations, actor, schemaVersion = 1 }) {
    validatePatchEnvelope({ schemaVersion, baseRevision, operations, actor });
    if (baseRevision !== this.currentRevision) throw new RevisionConflictError(baseRevision, this.currentRevision);
    assertProtectedPaths(operations);
    this.lockManager.assertPatchAllowed(this.document, operations, actor);
    const result = applyPatch(this.document, operations);
    const candidate = result.document;
    candidate.revision = this.currentRevision + 1;
    validateTimeline(candidate);
    return { revision: candidate.revision, document: candidate, hash: contentHash(candidate), changedPaths: result.changedPaths };
  }

  commit(input) {
    const plan = this.dryRun(input);
    const previousRevision = this.currentRevision;
    this.document = deepClone(plan.document);
    this.history.push({ revision: plan.revision, hash: plan.hash, document: deepClone(plan.document) });
    const event = {
      eventId: newId("event"),
      operationId: input.operationId ?? newId("operation"),
      type: "timeline.patch.applied",
      actor: input.actor,
      previousRevision,
      revision: plan.revision,
      changedPaths: plan.changedPaths,
      operationId: input.operationId ?? null,
      causeId: input.causeId ?? null,
      reviewId: input.reviewId ?? null,
      patchId: input.patchId ?? null,
      at: this.now()
    };
    this.events.push(event);
    return { ...plan, event: deepClone(event) };
  }
}


