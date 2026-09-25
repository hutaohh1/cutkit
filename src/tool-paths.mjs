export async function resolveTool(tool, override) {
  if (override) return override;
  try {
    if (tool === "ffmpeg") {
      const module = await import("ffmpeg-static");
      return module.default;
    }
    if (tool === "ffprobe") {
      const module = await import("ffprobe-static");
      return module.default.path;
    }
  } catch {
    return tool;
  }
  return tool;
}
