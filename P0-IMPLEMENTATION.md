# CutKit A1 / P0 实现范围

本目录实现本地 CLI 垂直切片的第一层基础设施，只覆盖：

1. JSON Schema 文件与运行时校验。
2. UUIDv7 稳定对象 ID。
3. RFC 6902 风格 Patch，支持 `add/remove/replace/move/copy/test`。
4. 属性级锁和锁冲突。
5. `base_revision` 乐观并发和 `REVISION_CONFLICT`。
6. 不可变 revision history、事件日志和原子 JSON 写入。

## 不在 P0 范围

字幕、音频 QC、Remotion/HyperFrames、C2PA、OTIO、媒体摄取、渲染和 MCP。这些能力必须在 P0 契约稳定后接入。

## 核心规则

- `timelineId`、`revision`、`schemaVersion` 是不可修改的元数据。
- Patch 只能在指定 `baseRevision` 上提交；过期 Patch 返回 `REVISION_CONFLICT`。
- Patch 先在副本上执行；任一操作失败，当前 revision 不变。
- `test` 是前置条件，不是修改操作。
- 任何 Patch 都不能越过其他 actor 的路径锁。
- 同一个 actor 可以修改自己持有的锁路径。
- 锁支持绝对 JSON Pointer，或 `objectId + relativePath`。
- 每次成功 commit 生成新 revision、内容 hash 和事件。
- `timeline.json` 是当前便捷副本；`history/NNNNNN.json` 是不可变快照。

## 验收

```text
npm test
node src/cli.mjs init --project .tmp/project
node src/cli.mjs validate --project .tmp/project
node src/cli.mjs id --prefix clip
```

测试必须覆盖：

- Patch 原子性；
- JSON Pointer 转义和数组插入；
- `test` 失败不修改文档；
- `move` 不能移入自身子路径；
- 锁冲突；
- 同 actor 锁可写；
- stale revision 返回 `REVISION_CONFLICT`；
- 非法时间区间和重复 ID 被 Schema 拒绝；
- 历史快照与事件日志可追踪。
