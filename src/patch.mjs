import { deepClone, deepEqual } from "./canonical-json.mjs";
import { PatchError } from "./errors.mjs";

export function parsePointer(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new PatchError("PATCH_PATH_INVALID", "JSON Pointer must be empty or start with /", { pointer });
  }
  return pointer.slice(1).split("/").map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatPointer(tokens) {
  return tokens.length === 0 ? "" : `/${tokens.map((token) => String(token).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function assertObjectOrArray(value, path) {
  if (!value || typeof value !== "object") throw new PatchError("PATCH_PATH_INVALID", "Path parent must be an object or array", { path });
}

function parseArrayIndex(token, path, allowEnd = false) {
  if (!/^(0|[1-9][0-9]*)$/.test(token) && !(allowEnd && token === "-")) {
    throw new PatchError("PATCH_PATH_INVALID", "Invalid array index", { path, token });
  }
  return token === "-" ? null : Number(token);
}

function resolveParent(root, tokens, path) {
  if (tokens.length === 0) return { parent: null, key: null };
  let parent = root;
  for (const token of tokens.slice(0, -1)) {
    assertObjectOrArray(parent, path);
    if (Array.isArray(parent)) {
      const index = parseArrayIndex(token, path);
      if (index === null || index < 0 || index >= parent.length) throw new PatchError("PATCH_TARGET_MISSING", "Array parent does not exist", { path, token });
      parent = parent[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(parent, token)) throw new PatchError("PATCH_TARGET_MISSING", "Object parent does not exist", { path, token });
      parent = parent[token];
    }
  }
  return { parent, key: tokens.at(-1) };
}

function getAt(root, path) {
  const tokens = parsePointer(path);
  if (tokens.length === 0) return { exists: true, value: root };
  const { parent, key } = resolveParent(root, tokens, path);
  if (Array.isArray(parent)) {
    const index = parseArrayIndex(key, path);
    if (index === null || index < 0 || index >= parent.length) return { exists: false };
    return { exists: true, value: parent[index] };
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) return { exists: false };
  return { exists: true, value: parent[key] };
}

function addAt(root, path, value) {
  const tokens = parsePointer(path);
  if (tokens.length === 0) throw new PatchError("PATCH_ROOT_NOT_SUPPORTED", "Root replacement is not supported", { path });
  const { parent, key } = resolveParent(root, tokens, path);
  if (Array.isArray(parent)) {
    const rawIndex = parseArrayIndex(key, path, true);
    const index = rawIndex === null ? parent.length : rawIndex;
    if (index < 0 || index > parent.length) throw new PatchError("PATCH_TARGET_MISSING", "Array insertion index is out of range", { path, index });
    parent.splice(index, 0, deepClone(value));
    return;
  }
  parent[key] = deepClone(value);
}

function replaceAt(root, path, value) {
  const tokens = parsePointer(path);
  if (tokens.length === 0) throw new PatchError("PATCH_ROOT_NOT_SUPPORTED", "Root replacement is not supported", { path });
  const { parent, key } = resolveParent(root, tokens, path);
  if (Array.isArray(parent)) {
    const index = parseArrayIndex(key, path);
    if (index === null || index < 0 || index >= parent.length) throw new PatchError("PATCH_TARGET_MISSING", "Array target does not exist", { path });
    parent[index] = deepClone(value);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new PatchError("PATCH_TARGET_MISSING", "Object target does not exist", { path });
  parent[key] = deepClone(value);
}

function removeAt(root, path) {
  const tokens = parsePointer(path);
  if (tokens.length === 0) throw new PatchError("PATCH_ROOT_NOT_SUPPORTED", "Root removal is not supported", { path });
  const { parent, key } = resolveParent(root, tokens, path);
  if (Array.isArray(parent)) {
    const index = parseArrayIndex(key, path);
    if (index === null || index < 0 || index >= parent.length) throw new PatchError("PATCH_TARGET_MISSING", "Array target does not exist", { path });
    parent.splice(index, 1);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new PatchError("PATCH_TARGET_MISSING", "Object target does not exist", { path });
  delete parent[key];
}

function isPrefix(prefix, path) {
  const left = parsePointer(prefix);
  const right = parsePointer(path);
  return left.length <= right.length && left.every((token, index) => token === right[index]);
}

function validateOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new PatchError("PATCH_INVALID", "Patch operation must be an object");
  const { op, path } = operation;
  if (!["add", "remove", "replace", "move", "copy", "test"].includes(op)) throw new PatchError("PATCH_INVALID", "Unsupported patch operation", { op });
  if (typeof path !== "string") throw new PatchError("PATCH_PATH_INVALID", "Patch operation requires a path", { op });
  parsePointer(path);
  if (op === "move" || op === "copy") {
    if (typeof operation.from !== "string") throw new PatchError("PATCH_PATH_INVALID", `${op} requires from`, { op });
    parsePointer(operation.from);
    if (op === "move" && (isPrefix(operation.from, path) || isPrefix(path, operation.from))) {
      throw new PatchError("PATCH_INVALID", "Cannot move a value into its own descendant", { from: operation.from, path });
    }
  }
  if (["add", "replace", "test"].includes(op) && !("value" in operation)) throw new PatchError("PATCH_INVALID", `${op} requires value`, { op });
}

export function operationTouchPaths(operation) {
  validateOperation(operation);
  const paths = [];
  if (operation.op !== "test") paths.push(operation.path);
  if (operation.op === "move" || operation.op === "copy") paths.push(operation.from);
  return paths;
}

export function applyPatch(document, operations) {
  if (!Array.isArray(operations)) throw new PatchError("PATCH_INVALID", "Patch operations must be an array");
  const next = deepClone(document);
  const touchedPaths = [];
  for (const operation of operations) {
    validateOperation(operation);
    touchedPaths.push(...operationTouchPaths(operation));
    if (operation.op === "test") {
      const target = getAt(next, operation.path);
      if (!target.exists || !deepEqual(target.value, operation.value)) {
        throw new PatchError("PATCH_TEST_FAILED", "Patch test precondition failed", { path: operation.path, expected: operation.value });
      }
    } else if (operation.op === "add") addAt(next, operation.path, operation.value);
    else if (operation.op === "replace") replaceAt(next, operation.path, operation.value);
    else if (operation.op === "remove") removeAt(next, operation.path);
    else if (operation.op === "move") {
      const source = getAt(next, operation.from);
      if (!source.exists) throw new PatchError("PATCH_TARGET_MISSING", "Move source does not exist", { from: operation.from });
      const value = deepClone(source.value);
      removeAt(next, operation.from);
      addAt(next, operation.path, value);
    } else if (operation.op === "copy") {
      const source = getAt(next, operation.from);
      if (!source.exists) throw new PatchError("PATCH_TARGET_MISSING", "Copy source does not exist", { from: operation.from });
      addAt(next, operation.path, source.value);
    }
  }
  return { document: next, changedPaths: [...new Set(touchedPaths)] };
}
