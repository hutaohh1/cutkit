import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CutKitError } from "./errors.mjs";

const execFileAsync = promisify(execFile);

export async function runTool(tool, args, options = {}) {
  try {
    return await execFileAsync(tool, args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new CutKitError("DEPENDENCY_MISSING", "Required media tool is not installed", { tool });
    }
    throw new CutKitError("TOOL_FAILED", "Media tool failed", {
      tool,
      args,
      exitCode: error.code,
      stdout: error.stdout?.toString?.() ?? "",
      stderr: error.stderr?.toString?.() ?? ""
    });
  }
}
