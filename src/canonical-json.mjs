import { createHash } from "node:crypto";
export function canonicalize(value) {
  return JSON.stringify(sortValue(value));
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}
export function contentHash(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}
export function deepClone(value) {
  return structuredClone(value);
}
export function deepEqual(left, right) {
  return canonicalize(left) === canonicalize(right);
}
