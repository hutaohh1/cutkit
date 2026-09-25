import { deepClone } from "./canonical-json.mjs";
import { LockViolationError, PatchError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { formatPointer, operationTouchPaths, parsePointer } from "./patch.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathsOverlap(left, right) {
  const a = parsePointer(left);
  const b = parsePointer(right);
  const shortest = Math.min(a.length, b.length);
  return a.slice(0, shortest).every((token, index) => token === b[index]);
}

function findObjectPathById(value, objectId, tokens = []) {
  if (isPlainObject(value)) {
    const ownsId = Object.entries(value).some(([key, child]) => (key === "id" || key === "object_id" || key.endsWith("Id")) && child === objectId);
    if (ownsId) return formatPointer(tokens);
    for (const [key, child] of Object.entries(value)) {
      const found = findObjectPathById(child, objectId, [...tokens, key]);
      if (found !== null) return found;
    }
  } else if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findObjectPathById(child, objectId, [...tokens, String(index)]);
      if (found !== null) return found;
    }
  }
  return null;
}

function resolveLockPath(lock, document) {
  if (typeof lock.path === "string") return lock.path;
  if (typeof lock.objectId !== "string") throw new PatchError("LOCK_TARGET_INVALID", "Lock requires path or objectId", { lock });
  const objectPath = findObjectPathById(document, lock.objectId);
  if (objectPath === null) throw new PatchError("LOCK_TARGET_INVALID", "Lock objectId was not found", { objectId: lock.objectId });
  const objectTokens = parsePointer(objectPath);
  const relativeTokens = typeof lock.relativePath === "string" ? parsePointer(lock.relativePath) : [];
  return formatPointer([...objectTokens, ...relativeTokens]);
}

export class LockManager {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.locks = new Map();
  }

  static fromJSON(records = [], options = {}) {
    const manager = new LockManager(options);
    for (const record of records) manager.locks.set(record.lockId, deepClone(record));
    return manager;
  }

  toJSON() {
    return [...this.locks.values()].map((lock) => deepClone(lock));
  }

  list() {
    this.#removeExpired();
    return [...this.locks.values()].map((lock) => deepClone(lock));
  }

  acquire({ actor, target, reason = "", ttlMs = 30 * 60 * 1000, document = {} }) {
    if (typeof actor !== "string" || actor.trim() === "") throw new PatchError("LOCK_TARGET_INVALID", "Lock actor is required");
    this.#removeExpired();
    const path = resolveLockPath(target, document);
    const overlapping = [...this.locks.values()].find((lock) => lock.actor !== actor && pathsOverlap(lock.path, path));
    if (overlapping) {
      throw new LockViolationError("Path is already locked by another actor", {
        path,
        conflictingLockId: overlapping.lockId,
        conflictingActor: overlapping.actor
      });
    }
    const lock = { lockId: newId("lock"), actor, path, reason, acquiredAt: this.now(), expiresAt: this.now() + ttlMs };
    this.locks.set(lock.lockId, lock);
    return deepClone(lock);
  }

  release(lockId, actor) {
    const lock = this.locks.get(lockId);
    if (!lock) throw new PatchError("LOCK_NOT_FOUND", "Lock does not exist", { lockId });
    if (lock.actor !== actor) throw new LockViolationError("Only the lock owner can release it", { lockId, actor });
    this.locks.delete(lockId);
  }

  assertPatchAllowed(document, operations, actor) {
    this.#removeExpired();
    const touchedPaths = operations.flatMap((operation) => operationTouchPaths(operation));
    for (const path of touchedPaths) {
      const conflict = [...this.locks.values()].find((lock) => lock.actor !== actor && pathsOverlap(lock.path, path));
      if (conflict) {
        throw new LockViolationError("Patch touches a path locked by another actor", {
          path,
          conflictingLockId: conflict.lockId,
          conflictingActor: conflict.actor
        });
      }
    }
  }

  #removeExpired() {
    const now = this.now();
    for (const [lockId, lock] of this.locks) if (lock.expiresAt <= now) this.locks.delete(lockId);
  }
}


