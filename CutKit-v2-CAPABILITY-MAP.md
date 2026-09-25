# CutKit v2 能力补齐图

> 依据：用户提供的 `CutKit v2.0 完整架构总图`。该图是架构内容，不是额外的操作指令。
>
> 目标：在 v2 的五层架构、制作闭环和创作能力注册表之上，明确下一步应补的 **公共 Skill、项目专属 Skill、运行库和基础设施**。

---

## 1. 结论先行

CutKit v2 已经把“产品约束、时间语义、锁、补丁、渲染路径、能力状态、可编辑性”放到了架构层。下一步不是继续堆通用剪辑 skill，而是补四类能力：

1. **编辑协议层**：OTIO/EDL/FCPXML 交换、JSON Patch、乐观锁、Schema 版本迁移。
2. **媒体执行层**：FFmpeg/libass、响度与 QC、色彩管理、字幕、音频策略。
3. **视觉合成层**：HTML/CSS/SVG/Canvas、Remotion/HyperFrames、Shader Worker、确定性渲染。
4. **真实性治理层**：C2PA/Content Credentials、来源/授权/同意、生成内容披露和可追溯性。

通用公共 Skill 只能覆盖其中一部分。`master_timeline`、对象锁、`design.json`、能力注册表和 `doctor` 必须由 CutKit 自己维护，不能交给外部编辑器或通用 skill 决定。

---

## 2. 已安装的基础 Skill

以下能力已经安装，可作为 v2 的底座：

| 能力 | Skill | 用途 | 备注 |
|---|---|---|---|
| 架构边界 | `vasilyu1983/ai-agents-public@software-architecture-design` | 模块化单体、服务边界、一致性、可靠性、ADR | 已安装 |
| 媒体处理 | `digitalsamba/claude-code-video-toolkit@ffmpeg` | FFmpeg/ffprobe、裁切、转码、音频、代理和渲染 | 已安装，需本机 FFmpeg |
| 工具协议 | `github/awesome-copilot@typescript-mcp-server-generator` | TypeScript MCP SDK v2、CLI/MCP 工具、Schema 和错误模型 | 已安装，需 Node.js 20+ |

它们分别对应 v2 的 L1/L2/L4，但还不能替代项目专属的时间线协议和能力注册表。

---

## 3. 推荐补装的公共 Skill

### 3.1 字幕、字体和可读性

**[Public]** `josiahsiegel/claude-plugin-marketplace@ffmpeg-captions-subtitles`  
来源：https://skills.sh/josiahsiegel/claude-plugin-marketplace/ffmpeg-captions-subtitles  
最适合：ASS/SRT 字幕、libass 烧录、字体替换、字幕安全区和字幕渲染。  
注意事项：404 次安装；依赖 FFmpeg 7.1/8.x 和 libass；需要固定字体包和字体 hash。  
安装：`npx -y skills@latest add "josiahsiegel/claude-plugin-marketplace@ffmpeg-captions-subtitles" -g -y`

它补的是 v2 中 `字幕：事件→ASS→libass`、`字体角色 + font-lock + 字形/渲染检查`。

### 3.2 Remotion/HyperFrames 动态图形

**[Public]** `haidrrrry/claude-remotion-skill@remotion-motion-graphics`  
来源：https://skills.sh/haidrrrry/claude-remotion-skill/remotion-motion-graphics  
最适合：HTML/CSS/React 动态标题、图表、贴纸、局部动画和 Remotion 渲染。  
注意事项：455 次安装；需要 Node.js、React、Remotion 和 Chromium；应固定 Remotion/Chromium 版本。  
安装：`npx -y skills@latest add "haidrrrry/claude-remotion-skill@remotion-motion-graphics" -g -y`

它补的是 `程序化 MG（HTML/SVG/Canvas）` 和 Render 三路径中的局部动画预渲染。

### 3.3 动画设计原则

**[Public]** `dylantarre/animation-principles@video-motion-graphics`  
来源：https://skills.sh/dylantarre/animation-principles/video-motion-graphics  
最适合：标题、转场、图表、解释性视频和广播级 motion graphics 的节奏、缓动、构图和层次。  
注意事项：2000 次安装；偏设计方法，不负责实际渲染；不要把 After Effects 工程当成唯一真相。  
安装：`npx -y skills@latest add "dylantarre/animation-principles@video-motion-graphics" -g -y`

它适合与 `design.json` 配合，负责“为什么这样动”，而不是决定时间线数据结构。

### 3.4 媒体来源、授权与披露

**[Public]** `calesthio/generative-media-skills@media-provenance-rights`  
来源：https://skills.sh/calesthio/generative-media-skills/media-provenance-rights  
最适合：生成媒体的来源、授权、同意、披露和发布治理；补足 v2 的 provenance/权利检查。  
注意事项：80 次安装，采用率偏低；必须审阅其规则是否符合你的合规要求；不能替代法律意见。  
安装：`npx -y skills@latest add "calesthio/generative-media-skills@media-provenance-rights" -g -y`

它比泛化的“AI 真伪识别”更贴近 CutKit 的 `原片只读 / 来源 / 权利 / 同意 / 披露` 需求。

### 3.5 JSON Schema 契约

**[Public]** `zaggino/z-schema@writing-json-schemas`  
来源：https://skills.sh/zaggino/z-schema/writing-json-schemas  
最适合：`design.json`、`capability.json`、`timeline.json`、Patch 和工具输入输出 Schema。  
注意事项：245 次安装；它偏 Schema 编写，不提供乐观锁和 Patch 执行语义。  
安装：`npx -y skills@latest add "zaggino/z-schema@writing-json-schemas" -g -y`

对 v2 来说，建议使用 **JSON Schema 2020-12 + AJV** 作为跨语言契约；TypeScript 内部可由 Zod 4 生成或校验。

---

## 4. 当前不建议直接安装的候选

### 4.1 云端或封闭编辑器 Skill

- `heygen-com/skills@video-edit`
- `layerai/skills@layer-video-timeline`
- `editframe/skills@composition`

这些 Skill 可能提供成熟的视频合成 API，但会把时间线、素材或渲染交给外部服务，与 v2 的“本地优先、原片只读、`master_timeline` 唯一权威、默认不上传”冲突。可以把它们当参考，不应当成为 L4 的核心执行器。

### 4.2 水印去除 Skill

`guillaumemeyer/watermarks-remover@remove-ai-marks` 与 v2 的 provenance/披露目标相反，不应进入 CutKit 能力注册表。

### 4.3 泛化真伪识别 Skill

`useosint/skills@is-this-photo-real` 适合调查式图片核验，但不是 C2PA、授权、同意和发布治理系统。它可以作为外部核验工具，不应承担 `media_provenance` 的主职责。

---

## 5. 公共 Skill 覆盖不到、必须由 CutKit 自己实现的部分

### 5.1 `master_timeline` 与编辑协议

没有搜到能完整覆盖 OTIO、锁、Patch 和版本迁移的公共 Skill。需要自己实现或封装：

- `master_timeline.json` 的规范化 JSON 结构；
- `schema_version`、`revision`、`base_revision`；
- `clip_id / asset_id / text_id / effect_id` 稳定对象 ID；
- 属性级锁：字幕角色、字体、动作、样式、时间区间锁；
- `REVISION_CONFLICT`、`LOCK_VIOLATION`；
- Patch 的 dry-run、预览、应用、回滚和审计。

推荐采用：

```text
RFC 6902 JSON Patch
+ test 前置条件
+ base_revision / expected_hash
+ append-only history
```

不要只用 `replace` 和自由文本补丁。

### 5.2 能力注册表与 `doctor`

没有找到足够贴合 v2 的公共 Skill。需要项目自己的 `capability registry`：

```json
{
  "capabilityId": "effect.blur.v1",
  "kind": "effect",
  "status": "verified",
  "implementation": "ffmpeg:gblur",
  "inputSchema": "schemas/effect.blur.v1.json",
  "timeContract": "source_range",
  "audioPolicy": "preserve",
  "fallback": "effect.none",
  "testVectors": ["tests/effect.blur.v1/*"],
  "renderer": "ffmpeg",
  "version": "1.0.0"
}
```

`doctor` 不能只读 `supported: true`，而应运行小样本探测：

- 工具二进制是否可用；
- 编码器/滤镜是否存在；
- 字体和字形是否可渲染；
- alpha、色彩空间、帧率是否可处理；
- GPU/Shader Worker 是否可用；
- fallback 是否真的可执行；
- 测试样片是否通过。

### 5.3 时间语义与 OTIO 交换

建议把 OTIO 作为**交换格式和外部适配层**，不要让它替代 CutKit 的主真相：

```text
CutKit master_timeline
  ├─ export/import OTIO
  ├─ export/import EDL
  ├─ export/import FCPXML
  └─ export/import AAF（按需）
```

需要补充的库/工具：

- `OpenTimelineIO` Python 包；
- OTIO adapter/插件；
- `MediaInfo`、`ffprobe` 元数据映射；
- 明确源区间、时间线区间、变速 `time_map` 和过渡区间的转换规则。

### 5.4 Render Plan 与确定性渲染

v2 已经提出三条 Render 路径，但还需要实现统一的 `render-manifest.json`：

```text
editHash
renderHash
rendererVersion
ffmpegBuild
chromiumVersion
fontHash
shaderHash
colorProfile
audioPolicy
outputHash
```

需要：

- FFmpeg full build：libx264/libx265、AAC/Opus、libass、`ebur128`、`loudnorm`、`sidechaincompress`；
- Remotion 或 HyperFrames；
- 固定版本 Chromium/Playwright；
- `resvg`、Skia/Canvas 或 WebGL Shader Worker；
- `glslangValidator`/`SPIRV-Cross` 校验 Shader；
- 字体包、ICC profile 和色彩转换配置；
- `blackdetect`、`freezedetect`、`signalstats`、`libvmaf` 或 pHash/SSIM 做试片回归。

### 5.5 音频与字幕 QA

除了音频编辑 Skill，还需要独立的 QC 规则：

- EBU R128 / `ebur128` 响度；
- 对白、音乐、旁白、环境声、SFX 分轨；
- sidechain ducking；
- 峰值、静音、爆音和削波检测；
- 字幕行宽、阅读速度、最小字号、安全区、对比度；
- 字体缺字和 fallback 字形检查。

### 5.6 Provenance / Rights / Consent

建议使用 C2PA/Content Credentials 或 `c2patool` 写入和读取：

- 原始素材 hash；
- 捕获时间、设备和来源；
- 授权/同意引用；
- 生成模型和参数；
- 编辑操作摘要；
- `synthetic`、`AI-assisted`、`AI-generated` 披露级别；
- 发布版本的签名和验证结果。

同时保留 CutKit 自己的 provenance manifest，避免被某一家 C2PA 实现绑死。

---

## 6. 需要准备的非 Skill 依赖

### 6.1 运行时

| 层 | 必需组件 | 用途 |
|---|---|---|
| Core | Node.js 20+ 或 Python 3.11+ | CLI、MCP、任务编排 |
| Contract | JSON Schema 2020-12、AJV、Zod 4 | 工具和文件契约 |
| History | SQLite WAL 或 append-only JSONL | registry、锁、事件、审计 |
| Identity | ULID/UUIDv7、SHA-256/BLAKE3 | 稳定 ID、内容 hash、render hash |
| Interchange | OpenTimelineIO | EDL/FCPXML/AAF 交换 |
| Media | FFmpeg、ffprobe、MediaInfo、ExifTool | 探测、转码、QC、元数据 |
| Captions | libass、HarfBuzz、fontconfig | ASS 字幕和字体 |
| Audio | FFmpeg、EBU R128、librosa/aubio | 响度、节奏、声音事件 |
| Visual | Remotion/HyperFrames、Chromium、Canvas/SVG/WebGL | 程序化 MG 和局部合成 |
| Provenance | c2patool/C2PA、XMP | 来源、授权、披露 |
| Tests | Vitest/pytest、Playwright、golden frames、pHash/VMAF | 回归和视觉 QA |

### 6.2 项目专属 Skill

建议最终创建一个自己的 `cutkit-v2-orchestrator` Skill，内容只放项目规则：

- `master_timeline` Schema；
- `design.json` Schema；
- `capability registry` 和 `doctor`；
- `base_revision`、锁、Patch、回滚；
- `MISSING_*` 缺口码和返回层对应；
- 禁止 AI 生成视频/数字人/配乐；
- `native_editable / source_rebuildable / baked_media / unsupported` 可编辑性等级；
- 试片、审批、终稿和 handed_off 状态机。

公共 Skill 负责“怎么做字幕、怎么做动画、怎么调 FFmpeg”，项目 Skill 负责“什么可以进入 CutKit、以什么权限进入、失败后回哪一层”。

---

## 7. 推荐的补齐顺序

### P0：先把编辑协议做成可验证的

1. JSON Schema 2020-12；
2. 稳定对象 ID；
3. `base_revision` + JSON Patch；
4. 属性级锁；
5. dry-run / conflict / rollback；
6. `timeline`、`design`、`capability` 的 golden tests。

### P1：补齐媒体执行

1. FFmpeg/libass 字幕；
2. EBU R128 音频和分轨；
3. `ffprobe`/MediaInfo 元数据；
4. black/freeze/peak/QC；
5. 字体和字形检查。

### P1：补齐视觉渲染

1. Remotion/HyperFrames；
2. HTML/CSS/SVG/Canvas；
3. Shader Worker；
4. 固定 Chromium 和字体；
5. `render-manifest.json` 和视觉回归。

### P2：补齐真实性治理

1. provenance manifest；
2. C2PA/Content Credentials；
3. 授权/同意/披露；
4. `synthetic` 与事实性角色禁用规则。

### P2：补齐交换和审阅

1. OTIO 导入导出；
2. EDL/FCPXML 适配器；
3. 外部编辑器 handed_off/re-entry；
4. Review 观察 → Patch → revision 的完整追踪。

---

## 8. 本次公共搜索覆盖的关键词

已使用公共注册中心搜索：

- `opentimelineio timeline editing`
- `otio video edit`
- `video quality control loudness`
- `ffmpeg audio qc`
- `libass subtitles caption`
- `ass captions video`
- `shader compositing webgl canvas`
- `motion graphics svg`
- `json schema patch concurrency`
- `versioned api contracts`
- `media provenance ai safety`
- `content authenticity c2pa`
- `video interchange edl fcpxml`
- `aaf otio adapter`
- `plugin capability registry`
- `feature registry doctor`
- `optimistic locking json patch`
- `revision conflict audit`
- `video color management`
- `playwright chromium video render`

结论：公共 Skill 可以补字幕、动画、FFmpeg、Schema 和部分 provenance；**OTIO/锁/Patch/registry/doctor/确定性渲染契约没有高质量的通用公共 Skill，应由 CutKit v2 自己实现或封装。**
