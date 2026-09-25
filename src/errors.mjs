export class CutKitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CutKitError";
    this.code = code;
    this.details = details;
  }
}
export class SchemaValidationError extends CutKitError {
  constructor(errors) {
    super("SCHEMA_VALIDATION_FAILED", "Document failed schema validation", { errors });
    this.name = "SchemaValidationError";
  }
}
export class PatchError extends CutKitError {
  constructor(code, message, details = {}) {
    super(code, message, details);
    this.name = "PatchError";
  }
}
export class LockViolationError extends CutKitError {
  constructor(message, details = {}) {
    super("LOCK_VIOLATION", message, details);
    this.name = "LockViolationError";
  }
}
export class RevisionConflictError extends CutKitError {
  constructor(expected, current) {
    super("REVISION_CONFLICT", "Patch was based on a stale revision", {
      expectedRevision: expected,
      currentRevision: current
    });
    this.name = "RevisionConflictError";
  }
}
