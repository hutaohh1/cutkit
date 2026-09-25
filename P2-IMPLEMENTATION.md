# CutKit P2 实现状态

P2 已补齐来源治理、权利/同意、真实 C2PA 签名、OTIO/EDL/FCPXML 交换和外部编辑器 handoff。

## 已完成

### 1. Provenance / Rights / Consent

新增：

- `schemas/rights.schema.json`
- `schemas/consent.schema.json`
- `schemas/provenance.schema.json`
- `src/p2-schema.mjs`
- `src/provenance.mjs`

能力：

- `createProvenanceManifest()`
- `verifyProvenanceManifest()`
- `verifyProvenanceChain()`
- `evaluateReleasePolicy()`
- 来源 hash、generation、edits、previousManifestHash；
- rights / consent 引用；
- synthetic disclosure；
- 事实性角色禁止合成冒充；
- 发布前 policy QcReport；
- C2PA claim definition；
- provenance signature tamper detection。

### 2. 真实 C2PA 签名

新增：

- `src/c2pa.mjs`
- `@contentauth/c2pa-node@0.9.7`

能力：

- `signC2paAsset()`：真实嵌入 C2PA manifest；
- `verifyC2paAsset()`：读取并验证嵌入 manifest；
- `buildC2paManifestDefinition()`；
- `loadC2paSigningMaterial()`；
- ES256 LocalSigner；
- 自定义 `org.cutkit.provenance` assertion；
- `c2pa.created / edited / composite` intent 映射；
- `signingCredential.untrusted` 作为非关键 trust warning；
- signature/assertion/claimSignature 错误作为 critical failure。

Windows 使用 `@contentauth/c2pa-node@0.9.7`，因为 0.9.8 发布包缺少 Windows binary asset。

### 3. EDL / FCPXML / OTIO 交换

新增：

- `src/editor-exchange.mjs`
- `fast-xml-parser`

能力：

- `exportEdl()` / `importEdl()`
- `exportFcpxml()` / `importFcpxml()`
- `exportOtio()` / `importOtio()`
- 真正的 OTIO JSON 结构：
  `Timeline.1 / Track.1 / Clip.1 / TimeRange.1 / RationalTime.1 / ExternalReference.1`
- source range / timeline range 转换；
- timecode ↔ milliseconds；
- asset name ↔ assetId 映射；
- `roundTripLoss()` 交换损失报告：
  clip 数量、时长、速度、字幕、effects。

### 4. 外部编辑器 Handoff

新增：

- `schemas/editor-handoff.schema.json`
- `src/editor-handoff.mjs`

能力：

- `createHandoff()`
- `reimportHandoff()`
- payload hash；
- baseRevision 乐观并发；
- ownership/status；
- 外部编辑器回写后通过 RevisionEngine 提交；
- structured loss report。

### 5. CLI

```text
node src/cli.mjs provenance create --asset asset.json --output manifest.json
node src/cli.mjs provenance verify --manifest manifest.json
node src/cli.mjs provenance c2pa --manifest manifest.json --output c2pa.json
node src/cli.mjs c2pa sign --input asset.jpg --output signed.jpg --manifest manifest.json --certificate cert.pem --private-key key.pem --mime-type image/jpeg
node src/cli.mjs c2pa verify --input signed.jpg --mime-type image/jpeg
node src/cli.mjs rights check --asset asset.json --manifest manifest.json --rights rights.json --consent consent.json
node src/cli.mjs exchange export --format edl --timeline timeline.json --assets assets.json --output edit.edl
node src/cli.mjs exchange export --format fcpxml --timeline timeline.json --assets assets.json --output edit.fcpxml
node src/cli.mjs exchange export --format otio-json --timeline timeline.json --assets assets.json --output edit.otio.json
node src/cli.mjs handoff export --format edl --timeline timeline.json --assets assets.json --actor editor --manifest handoff.json --payload edit.edl
node src/cli.mjs handoff reimport --project ./project --manifest handoff.json --payload edit.edl --actor editor
```

## C2PA 生产要求

当前测试使用 C2PA 官方测试证书链。生产环境必须提供：

- 有效 CA 签发的 ES256 end-entity certificate；
- private key；
- 可选 TSA timestamp URL；
- trust anchors / allowed EKU policy；
- key custody、轮换和吊销策略。

CutKit 不把自签名证书当作生产可信凭证。

## 验收

```text
npm test
```

当前结果：

```text
33 tests passed
```

新增测试覆盖：

- 真实 `@contentauth/c2pa-node` sign / read / verify；
- provenance signature tamper detection；
- provenance chain；
- rights/consent policy；
- synthetic factual-role block；
- EDL round-trip；
- FCPXML round-trip；
- OTIO round-trip；
- handoff payload hash；
- handoff reimport through revision state。

