import { randomBytes } from "node:crypto";
import { PatchError } from "./errors.mjs";
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_RE = /^[a-z][a-z0-9_]*_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function uuidv7(now = Date.now()) {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((timestamp >> BigInt(8 * (5 - index))) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function newId(prefix) {
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) {
    throw new PatchError("ID_INVALID", "ID prefix must be snake_case", { prefix });
  }
  return `${prefix}_${uuidv7()}`;
}
export function isUuidV7(value) {
  return typeof value === "string" && UUID_V7_RE.test(value);
}
export function isStableId(value, prefix) {
  if (typeof value !== "string" || !ID_RE.test(value)) return false;
  return prefix ? value.startsWith(`${prefix}_`) : true;
}

