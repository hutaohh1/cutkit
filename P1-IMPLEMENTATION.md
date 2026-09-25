# CutKit P1 实现状态

P1 已接入真实 FFmpeg/ffprobe 媒体执行。FFmpeg 6.1.1 与 ffprobe 4.0.2 由项目依赖提供，不需要依赖系统 PATH。

## 已完成

### 1. P1 Schema 与数据模型

- `schemas/media.schema.json`
- `schemas/caption.schema.json`
- `schemas/audio-policy.schema.json`
- `schemas/render-profile.schema.json`
- `schemas/render-plan.schema.json`
- `schemas/qc-report.schema.json`
- `src/p1-schema.mjs`

Timeline 支持：

```text
sourceUri / sourceHash
audioPolicy
captions
effects
transitionIn / transitionOut
renderRole / styleRef
```

### 2. 真实媒体探测

`src/media.mjs`：

- 文件 SHA-256；
- 真实 ffprobe JSON 解析；
- duration / fps / width / height；
- audio stream；
- color profile；
- provenance；
- `DEPENDENCY_MISSING` / `PROBE_FAILED`。

### 3. 字幕与 libass

`src/captions.mjs`：

- Caption Cue 校验；
- ASS 生成；
- caption track 重叠、阅读速度、行长 QC；
- 真实 FFmpeg `subtitles` / libass 烧录。

### 4. 真实音频 QC

`src/audio-qc.mjs`：

- `ebur128`；
- `astats`；
- `volumedetect`；
- `silencedetect`；
- 真实指标解析；
- loudness / true peak / clipping / silence / overlap QcReport。

### 5. 真实 FFmpeg 渲染

`src/render-plan.mjs` 与 `src/render-execute.mjs`：

- `PREVIEW_PROFILE` / `FINAL_PROFILE`；
- `buildRenderPlan()`；
- `buildFfmpegRenderCommand()`；
- `executeRender()`；
- 多片段 concat；
- 时间线空隙自动补黑帧与静音；
- source trim / speed / scale / pad / fps；
- audio gain / atempo；
- fade in / fade out；
- opacity；
- ASS 字幕烧录；
- 输出 MP4；
- `editHash` / `renderHash` / output hash；
- `DEPENDENCY_MISSING` / `TIME_RANGE_INVALID` / `UNSUPPORTED_TRANSITION`。

当前 P1 Renderer 支持：

```text
cut
none
fade
```

重叠转场暂不支持，避免静默生成错误时间线。

### 6. 项目内 FFmpeg / ffprobe

```json
{
  "ffmpeg-static": "^5.3.0",
  "ffprobe-static": "^3.1.0"
}
```

`src/tool-paths.mjs` 自动解析项目内二进制，`src/process.mjs` 统一执行和错误映射。

## CLI

```text
node src/cli.mjs doctor
node src/cli.mjs probe --input <media>
node src/cli.mjs captions build --input <cues.json> --output <out.ass>
node src/cli.mjs captions qc --input <cues.json>
node src/cli.mjs qc audio --input <media> --run
node src/cli.mjs build-render-plan --timeline <timeline.json> --assets <assets.json> --profile preview --output <plan.json>
node src/cli.mjs render --plan <plan.json> --output <out.mp4> --asset asset.json --manifest manifest.json --rights rights.json --consent consent.json
node src/cli.mjs render --plan <plan.json> --output <out.mp4> --asset asset.json --manifest manifest.json --rights rights.json --consent consent.json --dry-run
```

## 真实执行验收

测试会使用项目内 FFmpeg 生成真实 MP4，再用 CutKit 渲染和 ffprobe 回读。

```text
npm test
```

当前结果：

```text
26 tests passed
```

真实集成测试覆盖：

1. 生成含视频和音频的源 MP4；
2. ffprobe 登记真实 MediaAsset；
3. 构建 RenderPlan；
4. FFmpeg 渲染真实输出 MP4；
5. ffprobe 回读时长和音轨；
6. 运行真实音频 QC；
7. libass 烧录字幕；
8. 再次 ffprobe 验证字幕成片。

## 当前边界

- 重叠镜头的 `xfade` / 多层 compositor 尚未实现；
- Remotion/HyperFrames 局部动画执行器仍是 P1 后续适配层；
- `byte` 级跨机器一致仍需固定容器、编码器参数、CPU/GPU 和时间戳策略；
- 真实项目还需加入固定 golden media fixtures。

