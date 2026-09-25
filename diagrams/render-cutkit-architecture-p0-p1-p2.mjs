import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const W = 1800;
const H = 2980;
const out = [];

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function panel(x, y, width, height, title) {
  out.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#111827" stroke="#334155" stroke-width="2"/>`);
  out.push(`<text x="${x + 24}" y="${y + 38}" fill="#94a3b8" font-size="24" font-weight="500">${esc(title)}</text>`);
}

function card(x, y, width, height, title, lines, kind = "flow") {
  const palette = {
    goal: ["#172033", "#64748b", "#f8fafc"],
    data: ["#102a36", "#38bdf8", "#e0f2fe"],
    p0: ["#123326", "#34d399", "#dcfce7"],
    p1: ["#173b24", "#4ade80", "#dcfce7"],
    p2: ["#3a2418", "#fb923c", "#ffedd5"],
    layer: ["#172033", "#818cf8", "#e0e7ff"],
    flow: ["#20252d", "#64748b", "#f8fafc"],
    warn: ["#401c24", "#f43f5e", "#ffe4e6"],
    gate: ["#3a2418", "#f97316", "#ffedd5"],
    ret: ["#26233b", "#a78bfa", "#ede9fe"]
  }[kind];
  out.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${palette[0]}" stroke="${palette[1]}" stroke-width="${kind === "p1" ? 3 : 2}"/>`);
  out.push(`<text x="${x + width / 2}" y="${y + 31}" text-anchor="middle" fill="${palette[2]}" font-size="22" font-weight="500">${esc(title)}</text>`);
  lines.forEach((line, index) => {
    out.push(`<text x="${x + width / 2}" y="${y + 62 + index * 28}" text-anchor="middle" fill="#cbd5e1" font-size="18">${esc(line)}</text>`);
  });
}

function arrow(points, label = "") {
  const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
  out.push(`<path d="${d}" fill="none" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>`);
  if (label) {
    const mid = points[Math.floor(points.length / 2)];
    out.push(`<text x="${mid[0] + 8}" y="${mid[1] - 8}" fill="#94a3b8" font-size="16">${esc(label)}</text>`);
  }
}

function line(points, color = "#475569", dash = "") {
  const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
  out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`);
}

out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>`);
out.push(`<rect width="${W}" height="${H}" fill="#0b0f14"/>`);
out.push(`<text x="60" y="72" fill="#f8fafc" font-size="42" font-weight="500">CutKit v2.0 P0 / P1 / P2 完整架构总图</text>`);
out.push(`<text x="60" y="108" fill="#94a3b8" font-size="21">面向 Codex 的本地优先剪辑引擎 · 五层架构 · 制作闭环 · 来源治理与编辑器交换</text>`);

panel(60, 140, 1680, 180, "一、目标与硬约束");
card(100, 198, 760, 92, "A1 本地 CLI 垂直切片", ["P0 编辑协议 · P1 真实媒体执行 · P2 来源治理与交换"], "goal");
card(920, 198, 760, 92, "产品硬约束", ["timeline.json 唯一执行真相 · 原片只读 · 不默认上传 · C2PA 可验证"], "goal");

panel(60, 350, 1680, 260, "二、核心数据");
card(95, 425, 370, 145, "capability registry", ["documented / verified / missing", "native_editable / source_rebuildable"], "data");
card(495, 425, 370, 145, "timeline.json", ["源区间 ≠ 时间线区间", "speed / time_map / audio_policy"], "data");
card(895, 425, 370, 145, "intent.json", ["目标 / 风格 / must_include", "avoid / 结构模板 / seed"], "data");
card(1295, 425, 370, 145, "history / events", ["不可变 revision 快照", "因果审计"], "data");

panel(60, 650, 1680, 520, "三、P0 编辑协议与 P1 真实媒体执行");
panel(95, 715, 780, 415, "P0 已实现");
card(125, 775, 340, 82, "JSON Schema", ["timeline / patch / lock / project"], "p0");
card(505, 775, 340, 82, "UUIDv7 稳定 ID", ["timeline / track / clip / asset / lock"], "p0");
card(125, 875, 340, 82, "RFC 6902 Patch", ["add / remove / replace / move / copy / test"], "p0");
card(505, 875, 340, 82, "属性级锁", ["路径锁 + objectId 锁 · TTL"], "p0");
card(125, 975, 340, 82, "乐观并发", ["base_revision · REVISION_CONFLICT"], "p0");
card(505, 975, 340, 82, "原子写入", ["history / events / timeline.json"], "p0");

panel(925, 715, 780, 415, "P1 已实现");
card(955, 775, 340, 82, "ffprobe 媒体探测", ["SHA-256 / duration / fps / audio"], "p1");
card(1335, 775, 340, 82, "Caption → ASS → libass", ["重叠 / 阅读速度 / 行长 QC"], "p1");
card(955, 875, 340, 82, "真实音频 QC", ["ebur128 / astats / volume / silence"], "p1");
card(1335, 875, 340, 82, "真实 FFmpeg Render", ["trim / speed / fade / concat"], "p1");
card(955, 975, 720, 82, "RenderPlan + renderHash + outputHash", ["editHash / render manifest / 真实 MP4 输出"], "p1");

panel(60, 1210, 1680, 820, "四、五层架构与制作闭环");
panel(95, 1280, 430, 690, "五层架构");
card(125, 1340, 370, 88, "L1 入口层", ["Skill + CLI / MCP · 同构同错误码"], "layer");
card(125, 1455, 370, 88, "L2 CutKit Core", ["Application Service · 状态 / 权限 / 校验"], "layer");
card(125, 1570, 370, 88, "L3 Registry", ["Effects / Motion / Text / Audio / Assets"], "layer");
card(125, 1685, 370, 88, "L4 Render Plan", ["媒体处理 + 局部动画 + Render 三路径"], "layer");
card(125, 1800, 370, 88, "L5 Review & Delivery", ["试片 → Patch → 批准 → 终稿"], "layer");

panel(565, 1280, 1140, 690, "制作闭环");
card(605, 1340, 230, 64, "需求与素材", [""], "flow");
card(605, 1430, 230, 64, "doctor", ["环境 / 权限 / 能力"], "flow");
card(605, 1520, 230, 64, "素材登记", ["按需分析"], "flow");
card(605, 1610, 230, 64, "候选库", ["叙事 / 声音 / 连续性"], "flow");
card(605, 1700, 230, 64, "叙事计划", ["speech / music / action"], "flow");
card(605, 1810, 230, 78, "素材覆盖 Gate", ["通过 / 缺失"], "gate");
card(875, 1810, 300, 78, "缺口码", ["MISSING_REAL / VOICEOVER", "MISSING_MUSIC / STYLE_ASSET"], "warn");
card(1210, 1700, 230, 64, "Timeline Build", ["timeline.json"], "flow");
card(1210, 1610, 230, 64, "工程校验", ["权限 / 契约"], "flow");
card(1210, 1520, 230, 64, "Preview", ["revision + style"], "flow");
card(1210, 1430, 230, 64, "实际视听评审", ["工程 / 视听 / 人确认"], "flow");
card(920, 1340, 230, 64, "问题单 + Patch", ["定位 / 证据 / 锁"], "flow");
card(1450, 1340, 210, 64, "批准快照", ["revision + deps"], "flow");
card(1450, 1430, 210, 64, "终稿交付", [""], "flow");

panel(60, 2070, 1680, 230, "五、返回层对照");
card(95, 2140, 245, 105, "字体缺字 / 换行", ["→ 字体排版"], "ret");
card(365, 2140, 245, 105, "表达不清", ["→ 叙事计划"], "ret");
card(635, 2140, 245, 105, "导出崩溃", ["→ 渲染与环境诊断"], "ret");
card(905, 2140, 245, 105, "选错 / 重复", ["→ 候选与组剪"], "ret");
card(1175, 2140, 245, 105, "bad_cut", ["→ 时间线"], "ret");
card(1445, 2140, 245, 105, "BGM 压人声", ["→ 自动化混音"], "ret");

panel(60, 2340, 1680, 360, "六、创作能力、来源治理与编辑器交换");
card(100, 2410, 380, 220, "概念拆分", ["Effect / Transition / Motion", "Overlay / Compositing / Audio"], "flow");
card(520, 2410, 380, 220, "Provenance / Rights / Consent", ["source hash · generation · edits", "rights / consent / disclosure"], "p2");
card(940, 2410, 380, 220, "C2PA sign / verify", ["ES256 LocalSigner", "org.cutkit.provenance", "trust warning / critical failure"], "p2");
card(1360, 2410, 340, 220, "OTIO / EDL / FCPXML + Handoff", ["Timeline.1 / Track.1 / Clip.1", "payload hash · baseRevision", "round-trip loss report"], "p2");

panel(60, 2740, 1680, 180, "七、后续优先级与生产化");
card(110, 2805, 720, 85, "P1 收尾", ["xfade / 多层 compositor · Remotion / HyperFrames"], "p1");
card(970, 2805, 720, 85, "P2 生产化", ["TSA / key custody / trust anchors · golden exchange fixtures"], "p2");

arrow([[880, 290], [880, 350]]);
arrow([[1280, 290], [1280, 350]]);
arrow([[280, 570], [280, 650]]);
arrow([[680, 570], [680, 650]]);
arrow([[1080, 570], [1080, 650]]);
arrow([[1480, 570], [1480, 650]]);
arrow([[315, 1505], [315, 1570]]);
arrow([[315, 1658], [315, 1685]]);
arrow([[315, 1773], [315, 1800]]);
arrow([[720, 1404], [720, 1430]]);
arrow([[720, 1494], [720, 1520]]);
arrow([[720, 1584], [720, 1610]]);
arrow([[720, 1674], [720, 1700]]);
arrow([[720, 1764], [720, 1810]], "缺失");
arrow([[835, 1848], [875, 1848]]);
arrow([[1175, 1848], [1210, 1732]], "通过");
arrow([[1325, 1700], [1325, 1674]]);
arrow([[1325, 1610], [1325, 1584]]);
arrow([[1325, 1520], [1325, 1494]]);
arrow([[1325, 1430], [1215, 1372]], "需修改");
arrow([[1150, 1372], [1210, 1700]], "base_revision + Patch");
arrow([[1325, 1430], [1450, 1372]], "通过");
arrow([[1555, 1404], [1555, 1430]]);
line([[315, 1888], [315, 1980]], "#34d399");
line([[1325, 1494], [1325, 1225], [420, 1225]], "#64748b", "8 8");
line([[1050, 2200], [1050, 2260], [530, 2260], [530, 2410]], "#a78bfa");
arrow([[1325, 2035], [1325, 2140]]);
arrow([[485, 1130], [485, 1210]]);
arrow([[1315, 1130], [1315, 1210]]);
out.push(`</svg>`);
const svg = out.join("\n");
await writeFile("D:/项目3/cutkit-v2-architecture-p0-p1-p2.svg", svg, "utf8");
const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 3600 },
  background: "#0b0f14",
  font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI, Microsoft YaHei, sans-serif" }
}).render().asPng();
await writeFile("D:/项目3/cutkit-v2-architecture-p0-p1-p2.png", png);
console.log(JSON.stringify({ svg: "D:/项目3/cutkit-v2-architecture-p0-p1-p2.svg", png: "D:/项目3/cutkit-v2-architecture-p0-p1-p2.png", width: 3600, height: 5960 }));



