# CutKit 教程

这份教程面向第一次使用 CutKit 的开发者。目标是让你从零创建一个可审计的视频项目，生成时间线、渲染 MP4、检查质量，并追踪每一次修改。

## 1. CutKit 是什么

CutKit 是一层视频生产编排和治理工具，而不是拖拽式剪辑软件。

它负责：

- 登记视频、图片、音频素材；
- 保存素材 Hash、来源、授权和同意记录；
- 管理候选镜头和入出点；
- 编译 `timeline.json`；
- 使用项目内 FFmpeg 渲染视频；
- 处理字幕、音频响度和质量报告；
- 使用不可变 Revision 追踪修改；
- 把评审意见转换为确定性 Patch；
- 审批后生成 Final Manifest。

核心原则：

```text
素材是证据
候选是建议
timeline.json 是唯一执行真相
渲染文件只是派生物
评审产生结构化 Patch
```

## 2. 环境要求

- Node.js 22 或更高版本；
- Git；
- Windows、macOS 或 Linux；
- 约 500 MB 磁盘空间。

FFmpeg 和 ffprobe 由 npm 依赖提供，不需要单独安装。

检查 Node：

```bash
node --version
```

建议使用 Node 22 LTS 或更高版本。

## 3. 安装

```bash
git clone https://github.com/hutaohh1/cutkit.git
cd cutkit
npm install
npm test
npm run check
```

查看命令：

```bash
node src/cli.mjs help
```

如果希望把 `cutkit` 注册成全局命令：

```bash
npm link
cutkit help
```

Windows PowerShell 也可以直接运行：

```powershell
node src/cli.mjs help
```

## 4. 五分钟跑通示例

仓库中的 `examples/` 提供了一套结构完整的演示数据。

### 4.1 创建项目

```powershell
node src/cli.mjs workflow init `
  --project .tmp/demo `
  --intent examples/workflow-intent.json
```

### 4.2 登记素材

```powershell
node src/cli.mjs workflow assets `
  --project .tmp/demo `
  --input examples/workflow-assets.json
```

### 4.3 登记候选镜头

```powershell
node src/cli.mjs workflow candidates `
  --project .tmp/demo `
  --input examples/workflow-candidates.json
```

### 4.4 编译并提交 Timeline

```powershell
node src/cli.mjs workflow plan --project .tmp/demo
node src/cli.mjs workflow commit --project .tmp/demo
```

### 4.5 检查项目

```powershell
node src/cli.mjs workflow audit --project .tmp/demo
node src/cli.mjs workflow status --project .tmp/demo
```

示例中的素材地址和 Hash 是演示数据，因此适合验证流程，不适合直接渲染真实成片。

## 5. 制作真实视频

### 5.1 准备 Intent

Intent 描述你想要什么：

```json
{
  "schemaVersion": 1,
  "targetDurationMs": 45000,
  "durationToleranceMs": 2000,
  "aspectRatio": "16:9",
  "style": {
    "tone": "documentary",
    "pacing": "measured",
    "visualTreatment": "natural"
  },
  "structureTemplate": "hook_body_end",
  "mustInclude": [
    {
      "id": "mi_product",
      "type": "shot_role",
      "value": "product_detail",
      "blocking": true
    }
  ],
  "avoid": [],
  "materialPolicy": {
    "minRealScreenTimePercent": 80,
    "maxProceduralScreenTimePercent": 25,
    "maxGeneratedScreenTimePercent": 10,
    "maxSyntheticTotalPercent": 30,
    "allowSyntheticAboveLimit": false
  },
  "seed": 731922
}
```

字段说明：

- `targetDurationMs`：目标时长；
- `durationToleranceMs`：允许误差；
- `mustInclude`：必须出现在成片中的内容；
- `avoid`：禁止使用的内容或标签；
- `materialPolicy`：实拍、程序化素材、生成素材比例；
- `seed`：固定随机选择。

### 5.2 探测素材

```powershell
node src/cli.mjs probe --input sources/interview.mp4
```

输出会包含：

- `assetId`
- `sourceHash`
- `durationMs`
- `width / height`
- `fps`
- 是否有音频
- 来源信息

### 5.3 编写素材登记文件

```json
[
  {
    "assetId": "asset_...",
    "kind": "REAL",
    "synthetic": false,
    "uri": "sources/interview.mp4",
    "contentHash": "sha256:...",
    "roles": ["founder_interview"],
    "allowedRoles": [],
    "prohibitedRoles": [],
    "media": {
      "durationMs": 20000,
      "fps": 30,
      "width": 1920,
      "height": 1080,
      "hasAudio": true
    },
    "rights": {
      "status": "cleared",
      "license": "internal",
      "consentRefs": []
    },
    "provenance": {
      "source": "camera_card",
      "ingestedAt": "2026-09-25T10:00:00+08:00"
    }
  }
]
```

生成合法 ID：

```powershell
node src/cli.mjs id --prefix asset
```

### 5.4 编写候选镜头

```json
[
  {
    "candidateId": "cand_interview_001",
    "assetId": "asset_...",
    "sourceInMs": 0,
    "sourceOutMs": 15000,
    "recommendedInMs": 2000,
    "recommendedOutMs": 11000,
    "roles": ["founder_interview"],
    "tags": ["interview"],
    "scores": {
      "technical": 0.9,
      "relevance": 0.95,
      "continuity": 0.8,
      "safety": 1
    },
    "qualityFlags": [],
    "confidence": 0.9
  }
]
```

CutKit 不会只给一个模糊总分。它会分别保存技术质量、相关性、连续性和安全性。

## 6. 渲染真实视频

```powershell
node src/cli.mjs workflow render-plan `
  --project .tmp/demo `
  --profile preview `
  --output .tmp/demo/preview-plan.json

node src/cli.mjs render `
  --plan .tmp/demo/preview-plan.json `
  --output .tmp/demo/preview.mp4
```

默认发布策略要求素材、Provenance、Rights 和 Consent 文件。

内部草稿渲染可以显式使用：

```powershell
node src/cli.mjs render `
  --plan .tmp/demo/preview-plan.json `
  --output .tmp/demo/preview.mp4 `
  --allow-unverified-render
```

不要在正式发布中绕过 Release Gate。

最终渲染使用：

```powershell
node src/cli.mjs workflow render-plan --project .tmp/demo --profile final
```

## 7. 字幕

字幕 Cue 示例：

```json
[
  {
    "cueId": "cue_...",
    "textId": "text_...",
    "role": "dialogue",
    "startMs": 0,
    "endMs": 2500,
    "content": "欢迎使用 CutKit",
    "fontRole": "subtitle",
    "lineBreakPolicy": "manual"
  }
]
```

生成 ASS：

```powershell
node src/cli.mjs captions build `
  --input cues.json `
  --output subtitles.ass
```

检查字幕：

```powershell
node src/cli.mjs captions qc --input cues.json
```

检查内容包括：

- Cue Schema；
- 阅读速度；
- 单行长度；
- 字幕重叠。

字幕也可以直接写进 Timeline Clip 的 `captions` 字段，由 CutKit Renderer 使用 libass 烧录。

## 8. 音频质量检查

只生成检查计划：

```powershell
node src/cli.mjs qc audio --input video.mp4
```

执行真实检查：

```powershell
node src/cli.mjs qc audio --input video.mp4 --run
```

默认检查：

- EBU R128 响度；
- True Peak；
- 削波；
- 静音；
- 对白/音乐重叠。

## 9. 评审和修改

渲染后登记：

```powershell
node src/cli.mjs workflow render-complete `
  --project .tmp/demo `
  --output .tmp/demo/preview.mp4
```

提交结构化 Review：

```powershell
node src/cli.mjs workflow review `
  --project .tmp/demo `
  --input review.json
```

Review 记录“哪里有什么问题”；Patch 记录“如何修改”。

提交 Patch：

```powershell
node src/cli.mjs workflow apply-review `
  --project .tmp/demo `
  --input patch.json
```

Patch 必须声明 `baseRevision`。Revision 不匹配会返回：

```text
REVISION_CONFLICT
```

修改后重新检查：

```powershell
node src/cli.mjs workflow audit --project .tmp/demo
```

## 10. 审批和定稿

```powershell
node src/cli.mjs workflow approve `
  --project .tmp/demo `
  --actor human:approver

node src/cli.mjs workflow finalize `
  --project .tmp/demo `
  --actor human:producer `
  --rendered-file .tmp/demo/preview.mp4
```

最终清单位于：

```text
project/final/manifest.json
```

它记录：

- Project ID；
- Timeline Revision；
- Timeline Hash；
- 所有素材 Hash；
- 审批人；
- 渲染文件；
- Final Manifest Hash。

## 11. 项目目录

```text
project/
  project.json
  intent.json
  assets.json
  candidates.json
  timeline.json
  history/
  gaps/
  reviews/
  patches/
  forge/
  reports/
  renders/
  final/
```

重要规则：

- 原始 `sources/` 永不原地修改；
- Timeline 修改必须生成新 Revision；
- `history/`、Review、Patch、审批和事件日志按追加或不可变方式使用；
- JSON 文件使用原子写入；
- FINALIZED 项目只读。

## 12. Material Forge 政策

CutKit 缺少真实素材时优先返回：

```json
{
  "kind": "MISSING_REAL",
  "blocking": true,
  "policy": "REAL_REQUIRED"
}
```

它不会自动把真实人物、地点、产品、事件、证据或证词替换成生成内容。

Forge-A 只允许程序化辅助素材，例如：

- 图形；
- 粒子；
- 纹理；
- 转场；
- 动态字幕。

Forge-B 默认关闭，只允许非事实性辅助画面，并且需要明确审批。

## 13. 常见问题

### `npm install` 失败

确认 Node 版本：

```bash
node --version
```

然后重新安装：

```bash
npm ci
```

### 找不到 FFmpeg

运行：

```bash
node src/cli.mjs doctor
```

项目会使用：

```text
node_modules/ffmpeg-static
node_modules/ffprobe-static
```

### `SCHEMA_VALIDATION_FAILED`

查看命令输出中的 `details.errors`。常见原因：

- ID 不是 UUIDv7；
- `sourceOutMs <= sourceInMs`；
- 时间线引用了不存在的 Track；
- Cue 时间重叠；
- 素材 Hash 不是 `sha256:` 开头。

### `REVISION_CONFLICT`

Patch 基于旧 Revision。先读取当前 `timeline.json`，更新 Patch 的 `baseRevision`，再重新提交。

### `MISSING_REAL`

系统要求真实素材。不要直接生成替代品；应当：

1. 补充真实素材；
2. 修改 Intent；
3. 明确降低或改变叙事；
4. 由人工裁决是否允许辅助合成内容。

## 14. 推荐学习顺序

1. 跑通 `examples/`；
2. 阅读 `CutKit-ARCHITECTURE.md`；
3. 用一个真实短视频走完整流程；
4. 添加 Review 和 Patch；
5. 阅读 `P0-IMPLEMENTATION.md`、`P1-IMPLEMENTATION.md`、`P2-IMPLEMENTATION.md`；
6. 根据自己的业务扩展 Schema 和 Application Service。
