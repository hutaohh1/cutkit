# CutKit

> 面向开发者的完整教程请看 [TUTORIAL.md](TUTORIAL.md)。


CutKit 是一层可重放、可审计的视频生产编排系统。它坚持以下真相边界：

- 素材是证据，候选只是建议；
- `timeline.json` 是唯一执行真相；
- 渲染文件是可重建派生物；
- 评审输出结构化观察，修改必须经过确定性 Patch；
- 缺少真实素材时返回 `MISSING_REAL`，不会静默生成替代品。

## 已实现

### P0：编辑协议

- JSON 数据契约与运行时校验；
- UUIDv7 稳定对象 ID；
- RFC 6902 风格原子 Patch；
- 属性级锁与冲突检测；
- `baseRevision` 乐观并发；
- 不可变 revision history、事件日志、原子 JSON 写入。

### P1：真实媒体执行

- 项目内 FFmpeg / ffprobe；
- 媒体探测与 SHA-256；
- ASS / libass 字幕；
- EBU R128、峰值、削波、静音 QC；
- 多片段 FFmpeg 渲染；
- `editHash`、`renderHash` 和输出 hash。

### P2：真实性、交换与发布

- Provenance、Rights、Consent；
- 真实 C2PA 签名和验证；
- OTIO / EDL / FCPXML；
- 外部编辑器 handoff / re-import；
- Capability Registry 与 Release Gate。

### Application Workflow

`src/workflow.mjs` 是 CLI 共用的应用服务，已经实现方案书中的主闭环：

```text
Intent
  -> Asset Registry
  -> CandidateShot Index
  -> Timeline Compiler
  -> Gap & Policy Audit
  -> Immutable Timeline Revision
  -> Render Completion
  -> Structured Review
  -> Review Patch
  -> Approval
  -> Final Manifest
```

核心能力：

- 项目生命周期状态机和 append-only 事件；
- Intent / MaterialAsset / CandidateShot / Gap / Review / ForgeRequest Schema；
- 多维候选评分和确定性候选选择；
- `must_include` 覆盖证明；
- `MISSING_REAL`、权利缺口和禁止用途检查；
- 实拍 / Forge-A / Forge-B 有效屏幕占用比例；
- 画中画按面积折算，音频、黑场、Logo 等单列；
- Material Forge 两阶段门禁；
- Review 最多三轮，观察与 Patch 分离；
- 审批门禁和只读 Finalized 状态；
- `final/manifest.json` 汇总 revision、素材 hash 和审批链。

## 快速开始

```powershell
npm test
npm run check
node src/cli.mjs doctor
node src/cli.mjs help
```

### Workflow CLI

```powershell
node src/cli.mjs workflow init --project .tmp/demo --intent examples/workflow-intent.json
node src/cli.mjs workflow assets --project .tmp/demo --input examples/workflow-assets.json
node src/cli.mjs workflow candidates --project .tmp/demo --input examples/workflow-candidates.json
node src/cli.mjs workflow plan --project .tmp/demo
node src/cli.mjs workflow commit --project .tmp/demo
node src/cli.mjs workflow audit --project .tmp/demo
```

Workflow 会自动把项目素材转换为 Renderer MediaAsset，并生成确定性 RenderPlan：

```powershell
node src/cli.mjs workflow render-plan --project .tmp/demo --profile preview --output .tmp/demo/preview-plan.json
node src/cli.mjs render --plan .tmp/demo/preview-plan.json --output .tmp/demo/preview.mp4
```

渲染完成后登记结果并进入评审：

```powershell
node src/cli.mjs workflow render-complete --project .tmp/demo --output <out.mp4>
node src/cli.mjs workflow review --project .tmp/demo --input <review.json>
node src/cli.mjs workflow apply-review --project .tmp/demo --input <patch.json>
node src/cli.mjs workflow audit --project .tmp/demo
node src/cli.mjs workflow approve --project .tmp/demo --actor human:approver
node src/cli.mjs workflow finalize --project .tmp/demo --actor human:producer --rendered-file <out.mp4>
node src/cli.mjs workflow status --project .tmp/demo
```

`examples/` 中包含一套结构完整的 Intent、素材、候选、评审和 Patch 示例。

## 项目目录

```text
project/
  project.json
  intent.json
  assets.json
  candidates.json
  timeline.json
  timeline-draft.json
  history/
    000000.json
    approvals.jsonl
    events.jsonl
  gaps/
  reviews/
  patches/
  forge/
  reports/
  renders/
  final/
    manifest.json
```

`history/`、`reviews/`、`patches/`、`approvals.jsonl` 和事件日志按追加或不可变方式使用。Timeline 更新始终生成新 revision。

## 当前边界

- FFmpeg Renderer 支持 `cut` / `none` / `fade`，重叠 `xfade` 与多层 compositor 尚未开放；
- Remotion / HyperFrames 动画执行器仍是后续适配层；
- MCP 和 Web/Desktop UI 可直接调用 `src/workflow.mjs`，当前仓库只提供 CLI 入口；
- Forge-B 默认关闭，人物、地点、产品、证据、证词等事实性角色永远不能由合成素材替代；
- 跨机器 byte 级一致还需要固定编码器、容器、字体、ICC、硬件和时间戳策略。
