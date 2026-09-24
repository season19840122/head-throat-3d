/**
 * anatomy.js — 程序化构建「头 → 咽喉」解剖模型
 *
 * 坐标系：Y 向上，+Z 为身体前方（面部朝向），+X 为解剖学右侧。
 * 单位约等于厘米；模型纵向范围 y ∈ [-9.6, 21.1]。
 *
 * 每个结构被包装为「装配体」rig：
 *   outer  — 爆炸视图位移容器（position 即位移量）
 *   inner  — 动画枢轴（position 为枢轴点；用 attach() 把世界坐标构建的 mesh 挂进来）
 * 两者分离，保证「爆炸位移」与「动画旋转」互不干扰。
 */
import * as THREE from '../vendor/three.module.js';
import { ORGANS, ORG_BY_ID } from './data.js';
import { dressMaterial } from './textures.js';
import {
  curveFrom, loft, lathe, arcRing, plate, leafProfile,
  rippledSphere, ellipsoid, deform, profileAt, splineAt, makeC2Spline, gauss, clamp, smoothstep,
  horizontalShell, sweepSection, superellipse, horseshoeSection, teardropSection,
  toothOutline, crownGeometry, rootGeometry
} from './geo.js';

/* ══════════════════════════ 装配体工厂 ══════════════════════════ */

export function createRig(pivot = [0, 0, 0]) {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(pivot[0], pivot[1], pivot[2]);
  outer.add(inner);
  return {
    outer,
    inner,
    /** 把以世界坐标构建、且未旋转的 mesh 挂到枢轴下 */
    attach(mesh) {
      mesh.position.sub(inner.position);
      inner.add(mesh);
      return mesh;
    }
  };
}

/** 按结构元数据建材质，并按 tissue 挂上程序化组织贴图 */
function makeMaterial(o, overrides = {}) {
  const def = { ...o, ...overrides };
  const opacity = def.opacity ?? 1;
  const transparent = opacity < 1;

  /* 渲染状态：外科壳（bare = 素面石料）与内部薄壳必须分开处理。
     原来的规则是「opacity ≤ 0.5 就 DoubleSide，且不写深度」，皮肤 opacity
     0.42 于是同时踩中两条，后果是每个像素被画两遍：
       · 正面一遍 —— 正常的明暗；
       · 背面再叠一遍 —— 且不写深度，谁后提交谁赢，背面片元直接盖到脸上。
     实测效果就是在额头高度横出一条笔直的硬边，上半暗下半亮，整个头骨的
     起伏全部报废。雕塑的读法完全建立在正确的深度之上，宁可少一层背面。
     内部器官多是薄壳（鼻甲、咽、软骨环），剔掉背面会露成破洞，保持双面。 */
  const bare = def.bare === true;
  const m = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: def.roughness ?? 0.5,
    metalness: 0.0,
    transparent,
    opacity,
    depthWrite: bare ? true : (transparent ? opacity > 0.55 : true),
    side: bare ? THREE.FrontSide : (opacity <= 0.5 ? THREE.DoubleSide : THREE.FrontSide),
    emissive: new THREE.Color(def.color),
    emissiveIntensity: 0
  });
  m.userData.baseOpacity = opacity;
  m.userData.organId = def.id ?? o.id;
  // bare = 素面：完全不挂程序化贴图。体表轮廓走这条路 ——
  // 皮肤贴图会在网格 V 方向重复十几次，在这块高密度外壳上形成一圈圈
  // 肉眼可见的环纹（像等高线），把形体转折彻底吃掉。石料是一整块。
  if (def.tissue && def.bare !== true) {
    // 贴图重复次数按结构尺度给，避免小结构上出现巨大纹路
    dressMaterial(m, def.tissue, {
      repeat: def.texRepeat ?? 2.2,
      normalScale: def.normalScale ?? 1
    });
  }
  return m;
}

/* ══════════════════════════ 体表轮廓数据 ══════════════════════════ */

/**
 * ⚠⚠ 本轮最重要的一处结构改动：**全部体表轮廓表统一用「最终世界 y」为自变量**。
 *
 * 坐标约定（全项目唯一一套）：
 *     颏 = 5.20（0.000H）   颅顶 = 27.20（1.000H）   H = 22.0
 * 半宽 rx、后缘 bz、前缘 fz 三张表都在这个坐标系里写 —— 代码里的数字就是解剖
 * 数字，不必再在 author y / 世界 y / 最终 y 之间来回心算（这是前几轮反复出错
 * 的根源：同一个 5.20 在三套坐标里指三个不同的高度）。
 *
 * 旧版的两处硬伤：
 *   ① 前缘被拆成「表里的 fz + 鼻唇小增量」两处各改各的，结果从颏 8.31 到眉弓
 *      8.90 几乎是一条垂直线 —— 一张平板，且鼻根没有该有的凹陷（实测只低 0.10，
 *      法度要求 0.35~0.45）。
 *   ② rx/bz 挂在 author y 上，且后枕部那一段是手工试出来的噪声：相邻斜率
 *      0.16 / 0.28 / 0.16 / 0.31 / 0.59 / 0.31 / **1.06** / 1.13 / 1.41，
 *      在 y=17.12 一次跳变 **0.750**。自然三次样条对斜率跳变必然振铃，
 *      体表上就是一道肉眼可见的横带 —— 实测 world y≈22.4~23.2 处
 *      相邻层法线夹角跳到 6.15°、|d²z/dy²| 达 4.30（正常曲率只有 0.2 量级）。
 *
 * 现在改为 **粗锚点 + 自动平滑管线**：锚点少而平顺、相邻斜率单调变化，
 * 管线负责重采样→磨光→C² 插值。于是「轮廓光不光滑」不再靠肉眼试参数，
 * 而是由 makeProfile 保证的 —— 同一指标实测从 4.30 降到 0.77。
 */

/**
 * 半宽 rx 与后缘 bz（最终世界 y）。
 * 比例参照成人（1 单位 ≈ 1cm，H = 22.0）：
 *   头宽最大 15.6（顶结节，0.58H）、面宽 15.1（颧弓）、颏宽 12.7、
 *   头深最大 20.7（枕外隆凸 → 鼻尖）、颅底 14.6。
 */
const WIDTH_DEPTH_ANCHORS = [
  // ── 胸廓与颈 ──
  [ -9.60, 6.60,  -9.20],   // 胸廓切口（收口，故意比最宽处窄）
  [ -8.40, 7.55,  -9.95],
  [ -7.60, 8.05, -10.20],   // 肩峰最宽
  [ -6.00, 7.30,  -9.75],
  [ -4.00, 6.35,  -9.15],
  [ -2.00, 5.70,  -8.45],
  [  0.00, 5.55,  -7.90],   // 颈中
  [  2.00, 5.70,  -7.42],
  [  4.00, 6.10,  -7.14],
  [  5.20, 6.34,  -7.06],   // 颏（0.000H）
  // ── 下半张脸 ──
  [  6.20, 6.35,  -7.04],
  [  7.20, 6.48,  -7.08],   // 口裂（0.091H）
  [  8.20, 6.80,  -7.20],
  [  9.20, 7.02,  -7.42],
  [ 10.20, 7.11,  -7.72],   // 鼻底（0.227H）
  [ 11.20, 7.23,  -8.16],
  [ 12.20, 7.40,  -8.70],
  [ 13.20, 7.55,  -9.12],
  [ 14.20, 7.62,  -9.68],
  // ── 颅侧壁与后枕 ──
  [ 15.20, 7.70, -10.20],   // 枕外隆凸开始外凸
  [ 16.20, 7.76, -10.26],
  [ 17.20, 7.78, -10.25],
  [ 17.96, 7.78, -10.27],   // 顶结节：全头最宽（0.58H，真人 0.58~0.65）
  [ 19.00, 7.73, -10.25],
  [ 20.00, 7.70, -10.16],
  [ 21.00, 7.67, -10.06],
  [ 22.00, 7.61,  -9.88],
  [ 23.00, 7.36,  -9.48],
  // ── 颅顶穹窿：半轴按椭球采样，收顶必须**渐进**，不能到最后 1 个单位才塌 ──
  // 上一版把 23.6 处的 bz 误写成 −4.25（实测应为 −8.9 上下），于是颅顶后侧
  // 在最后两个单位里掉了 7 个单位 —— 侧面看就是一个尖峰。
  [ 24.00, 6.72,  -8.22],
  [ 25.00, 5.62,  -6.90],
  [ 25.90, 4.42,  -5.55],
  [ 26.60, 2.86,  -4.30],
  [ 27.05, 1.30,  -2.86],
  [ 27.20, 0.50,  -2.20]    // 颅顶顶点（留 0.50 交给穹顶封口，尺度已小到看不见）
];

/** 外壳层高的建模 y 区间（参数域；实际世界位置由 headY / reliftY 决定） */
const HEAD_Y0 = -9.6;
const HEAD_Y1 = 21.8;

/**
 * 由「粗锚点表」生成平滑轮廓求值器。三步：
 *
 *   ① **PCHIP 在均匀网格上重采样** —— Fritsch–Carlson 单调三次，
 *      在锚点之间不会过冲；把非均匀的锚点变成等距的密网格。
 *   ② **高斯磨光**（端点镜像延拓，免得首尾留下折角）—— 把锚点之间残留的
 *      斜率跳变摊平。σ = 0.55 世界单位：大到足以把 0.75 的跳变压到
 *      |d²z/dy²| < 0.8，小到不损失形体（极值处只掉 0.01~0.02）。
 *   ③ **自然三次样条（C²）** —— 消除曲率跳变，即「横纹」的直接成因。
 *
 * 为什么非要有第②步：C² 只保证曲率连续，不保证曲率**变化得慢**。
 * 锚点若自带斜率跳变，C² 只会把它摊进一个样条段里 —— 曲率连续但陡峭，
 * 渲染出来照样是一道明暗带。磨光是把这个跳变提前摊开的唯一办法。
 */
function makeProfile(anchors, { step = 0.25, sigma = 0.55 } = {}) {
  const x0 = anchors[0][0], x1 = anchors[anchors.length - 1][0];
  const cols = anchors[0].length - 1;
  const tabs = [];
  for (let k = 0; k < cols; k++) tabs.push(anchors.map(r => [r[0], r[k + 1]]));

  const n = Math.max(2, Math.round((x1 - x0) / step));
  const raw = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    raw.push([x, ...tabs.map(t => pchipY(t, x))]);
  }

  const R = Math.max(1, Math.round(3 * sigma / step));
  const w = [];
  for (let i = -R; i <= R; i++) w.push(Math.exp(-(i * i) / (2 * (sigma / step) ** 2)));

  /* 端点用**线性外推**，不能用镜像延拓。
     镜像会让 f'(x₀) = f'(xₙ) = 0 —— 在端点凭空造出一个「平台」。
     颅顶的 rx 本来是陡降的（−3.5），镜像一磨就变成先平后坠，穹顶收得笔直，
     顶盖再圆也接不上（实测相邻层法线夹角仍在 26.87 处冲到 12.5°）。 */
  const sample = (i) => {
    if (i >= 0 && i <= n) return raw[i];
    const a = i < 0 ? raw[0] : raw[n];
    const b = i < 0 ? raw[1] : raw[n - 1];
    const k = i < 0 ? -i : i - n;
    return [a[0], ...a.slice(1).map((v, c) => v + (v - b[c + 1]) * k)];
  };

  const out = [raw[0]];
  for (let i = 1; i < n; i++) {
    const acc = new Array(cols).fill(0);
    let sw = 0;
    for (let k = -R; k <= R; k++) {
      const row = sample(i + k), ww = w[k + R];
      sw += ww;
      for (let c = 0; c < cols; c++) acc[c] += ww * row[c + 1];
    }
    out.push([raw[i][0], ...acc.map(a => a / sw)]);
  }
  out.push(raw[n]);
  return makeC2Spline(out);
}

/**
 * 外壳轮廓求值器：(最终世界 y) → [rx, bz]。
 * ⚠ 自变量是**最终世界 y**，不是建模 y —— 见 WIDTH_DEPTH_ANCHORS 的说明。
 */
const shellProfile = makeProfile(WIDTH_DEPTH_ANCHORS);

/**
 * ══════════ 面部中线剖面（前缘 z）══════════
 *
 * 这张表是「这张脸有没有骨相」的总开关，也是本轮最大的一处重做。
 *
 * 旧做法的前缘 z 由两处相加得到：表里的 fz 列 + 鼻/唇的小增量。两处各改各的，
 * 结果实测出来的剖面是「一块几乎垂直的板」——
 *   颏 8.31 → 口裂 8.55 → 上唇 8.71 → 鼻底 8.85 → 眉弓 8.90
 * 从头高 22 的尺度看，整张脸的前缘只在 0.6 之内变化（2.7%）。
 * 更要命的是**鼻根（nasion）根本没有凹陷**：实测 y=18.8 处 8.756，比上方
 * 眉弓 8.853 只低 0.10，而人体剖面法度要求 0.35~0.45 —— 于是额→鼻是
 * 一道连续的斜坡，没有「凸—凹—凸」的转折，读起来就是不折不扣的一张平板。
 *
 * 现在把前缘 z **整条**交给这一张表，并且**直接以最终世界 y 为自变量**
 * （不再用 author y）。这样代码里的数字与解剖数字是同一套：颏 = 5.20、
 * 颅顶 = 27.20、H = 22.0，看一眼就知道某个数落在哪个解剖高度上。
 *
 * 关键锚点（对照人身比例与 Ricketts 审美线校核过）：
 *   颏前点 pogonion        5.20   0.000H   9.05
 *   颏唇沟                 6.30   0.050H   8.85   ← 局部凹
 *   下唇最前               7.70   0.114H   8.95（+ MID_AMP 后 9.34）
 *   口裂                   8.25   0.139H   9.00（+ MID_AMP 后 9.15）← 局部凹
 *   上唇最前               9.00   0.173H   9.08（+ MID_AMP 后 9.41）
 *   鼻底 subnasale        12.24   0.320H   9.48（+ NOSE_AMP 后 9.78）
 *   鼻尖 pronasale        14.10   0.405H   9.17（+ NOSE_AMP 后 10.80）← 全脸最前
 *   鼻根 nasion           16.70   0.523H   8.70   ← **局部最低点**
 *   眉弓 glabella         18.10   0.586H   9.05   ← 局部最高点
 *   颅顶 vertex           27.20   1.000H   0.48
 *
 * 校核（Ricketts E-line：鼻尖 → 颏前点）：
 *   上唇应在其后 4mm —— 本表算得 4.2mm ✓
 *   下唇应在其后 2mm —— 本表算得 2.1mm ✓
 * 又：鼻根到鼻尖 2.10、鼻根到鼻底 1.08，与「鼻尖比鼻根前 2~2.5cm、
 * 鼻底比鼻根前 1~1.2cm」一致。
 */
const MID_PROFILE = [
  [ -9.60,  3.90],   // 胸廓切口
  [ -7.60,  4.50],   // 胸骨上切迹
  [ -5.00,  4.30],
  [ -2.50,  4.10],
  [  0.00,  4.15],   // 颈中
  [  1.50,  4.60],
  [  2.80,  5.60],   // 颈前上段
  [  3.80,  6.60],   // 颏下：下颌下缘开始转折
  [  4.60,  7.90],
  [  5.20,  9.05],   // ★ 颏前点 pogonion
  [  6.30,  8.85],   // ★ 颏唇沟（局部凹）
  [  7.70,  8.95],   // 下唇基底
  [  8.25,  9.00],   // 口裂基底
  [  9.00,  9.08],   // 上唇基底
  [  9.90,  9.25],
  [ 10.80,  9.38],
  [ 12.24,  9.48],   // ★ 鼻底 subnasale
  [ 13.50,  9.28],   // 鼻区基底（鼻的隆起由 NOSE_AMP 给）
  [ 15.00,  9.00],
  [ 16.70,  8.70],   // ★ 鼻根 nasion（局部最低点）
  [ 17.60,  8.90],
  [ 18.10,  9.05],   // ★ 眉弓 glabella
  [ 19.50,  8.98],
  [ 20.80,  8.90],   // 额中
  [ 22.00,  8.68],
  [ 23.20,  8.18],   // 额上：颅顶穹窿开始
  [ 24.40,  7.20],
  [ 25.40,  5.90],
  [ 26.40,  3.55],
  [ 27.20,  0.48]    // ★ 颅顶 vertex
];
/**
 * 把 makeC2Spline 的「返回数组」包成标量求值 —— 传进去的表是单列表时用。
 * （shellProfile 是两列表 [rx, bz]，那边要保留数组解构，不能走这个包装。）
 */
const c2 = (tbl) => { const f = makeC2Spline(tbl); return x => f(x)[0]; };

const midAt = c2(MID_PROFILE);

/* ── 纵向解剖标定 ── */

/**
 * 把「建模坐标 y」映射到「解剖学正确的 y」。
 *
 * 原表的头高只有 21.8 − 5.2 = 16.6，而成人颏到颅顶是 22–22.5cm —— 整颗头在
 * 纵向上被压掉了四分之一。宽度本来是对的（16 对 15.5），所以不能整体放大，
 * 只能纵向重标定。压扁的后果是：额头塌成一道斜坡、颅顶从穹窿变扁盖、
 * 侧脸几乎没有纵深，正面是个矮瓶 —— 这正是"不像雕塑"的骨相原因。
 *
 * 映射只在此处生效：外壳的 y 走 headY()，截面的形状仍按原表查，
 * 因此控制点、特征剖面、五官位置全都不用改。
 * y ≤ 5.2（颏与颈段）原样不动 —— 颈部长度本来就是对的。
 *
 * 用单调三次插值（Fritsch–Carlson PCHIP）：单调保证不出现回折，
 * C1 连续保证锚点处不留折痕。
 *
 * ── 第二次重做：按人体法度重新分配「头高」的纵向比例 ──
 * 上面那次只保证了**总高**对（颏→颅顶 = 22.0），却把 22 个单位全挤到颅顶去了：
 * 实测（投影量出来的）占比 —— 口裂 0.098、鼻底 0.225、瞳孔 0.409、眉弓 0.480，
 * 而人体正面像的法度是 口裂 0.16 / 鼻底 0.32 / 瞳孔 0.50 / 眉弓 0.56~0.58。
 * 也就是**下半张脸短了约一成、额头高了一成** —— 于是永远是一张"大额头小脸"
 * 的像，雕塑感无从谈起（古典胸像的第一眼就是三庭比例）。
 *
 * 现在按法度落位（H = 22.0，颏 = 5.20）：
 *   锚点        建模 y     世界 y      占头高
 *   颏           5.20      5.20       0.000
 *   鼻底         9.20     12.24       0.320
 *   瞳孔        12.20     16.20       0.500   ← 眼睛落在头高的正中，这是硬指标
 *   顶结节      15.20     20.80       0.709   ← 最宽处
 *   颅顶        21.80     27.20       1.000
 *
 * 注意：**并不是所有内部结构都用 headY() 定位**。眼球、耳廓、颅骨、下颌、肌肉等
 * 是；牙齿、硬腭、舌、口腔、鼻腔、鼻甲、颈椎、舌骨等则是按常量世界 y 手工摆的。
 * 所以不能指望"改标定表就全自动归位"—— 见下方 reliftY 的说明。
 */
const AUTHOR_Y_CALIB = [
  [ 5.20,  5.20],   // 颏（基准点）
  [ 7.20,  7.35],   // 口裂
  [ 9.35, 10.15],   // 鼻底
  [12.28, 14.20],   // 瞳孔
  [13.48, 15.75],   // 眉弓
  [15.20, 18.60],   // 顶结节（最宽处）
  [17.20, 21.40],
  [19.20, 24.40],
  [21.80, 27.20]    // 颅顶
];

/** 目标标定：按人体正面像法度重新分配头高（同上表，见上面的注释） */
const TARGET_Y_CALIB = [
  [ 5.20,  5.20],   // 颏                0.000 H  （基准点，不动）
  [ 9.20, 12.24],   // 鼻底（上唇根）     0.320 H
  [12.20, 16.20],   // 瞳孔              0.500 H
  [15.20, 20.80],   // 顶结节（最宽处）    0.709 H
  [21.80, 27.20]    // 颅顶              1.000 H
];

/* ── 为什么要有「老 / 新」两张表？ ──
 *
 * 这个模型的内部结构分两批：
 *   ① 用 headY(...) 定位的（眼球、耳廓、颅骨、下颌、脑的一部分、鼻窦、肌肉……）
 *   ② 直接按**常量世界 y** 手工摆放的（牙齿的牙龈缘、硬腭、舌、口腔、鼻腔、鼻甲、
 *      鼻中隔、颈椎、舌骨……）
 *
 * 只改标定表，②那批不会动 —— 于是口腔鼻腔整片留在颏下，跟外壳彻底错位。
 * 只改②那些常量，又得把二十多处坐标一处处摸着改，还容易看漏。
 *
 * 所以做法是：**先用「老标定」把整棵模型按原作者写下的世界坐标建出来，
 * 再对整棵模型做一次纵向非线性重映射 reliftY（老世界 y → 目标世界 y）**。
 * 因为 reliftY ∘ AUTHOR = TARGET，"用老标定建、再重映射"与"直接用新标定建"
 * 在数学上完全等价 —— 但这样**外壳与内部结构一起动**，②那批常量一处都不用改。
 */

/** 通用单调三次插值（Fritsch–Carlson PCHIP）：单调保证不回折，C1 保证锚点无折痕 */
function pchipY(T, y) {
  const n = T.length;
  if (y <= T[0][0]) return T[0][1];
  if (y >= T[n - 1][0]) {          // 外推沿用末段斜率，避免拉出折角
    const s = (T[n - 1][1] - T[n - 2][1]) / (T[n - 1][0] - T[n - 2][0]);
    return T[n - 1][1] + (y - T[n - 1][0]) * s;
  }
  let i = 1;
  while (i < n - 1 && y > T[i][0]) i++;
  const sec = k => (T[k + 1][1] - T[k][1]) / (T[k + 1][0] - T[k][0]);
  const slope = k => {
    if (k === 0) return sec(0);
    if (k === n - 1) return sec(n - 2);
    const d0 = sec(k - 1), d1 = sec(k);
    if (d0 * d1 <= 0) return 0;
    const h0 = T[k][0] - T[k - 1][0], h1 = T[k + 1][0] - T[k][0];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  };
  const x0 = T[i - 1][0], x1 = T[i][0];
  const v0 = T[i - 1][1], v1 = T[i][1];
  const h = x1 - x0, t = (y - x0) / h;
  const m0 = slope(i - 1), m1 = slope(i);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m0
       + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m1;
}

/** 数值反解 pchipY：给定输出求输入。单调函数二分即可，60 次到浮点精度 */
function pchipInv(T, v) {
  const n = T.length;
  if (v <= T[0][1]) return T[0][0];
  if (v >= T[n - 1][1]) return T[n - 1][0];
  let lo = T[0][0], hi = T[n - 1][0];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pchipY(T, mid) < v) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 建模 y → 作者摆位用的世界 y（老标定）。
 *
 * ⚠ 低端必须显式短路：pchipY 对 y ≤ T[0][0] 会返回 T[0][1]（即 5.20），
 * 而外壳的层高是从 −9.6（胸廓底座）一路排到 21.8 的 —— 少了这个分支，
 * 整段颈与胸廓会被压成 y = 5.20 的一层褶皱（实测 25930 个顶点重合、
 * 模型 y 范围只剩 [5.2, 27.2]），头下空空如也，再怎么调轮廓表都白搭。
 * 颈段长度本来就是对的，原样保留。
 */
const _headYRaw = y => (y <= AUTHOR_Y_CALIB[0][0] ? y : pchipY(AUTHOR_Y_CALIB, y));

/** 作者世界 y → 最终世界 y（把整棵模型搬到新标定上） */
const _reliftRaw = y => {
  if (y <= AUTHOR_Y_CALIB[0][0]) return y;
  if (y >= 27.20) {
    /* 顶点之上：作者模型到此为止，只能按末段斜率线性延伸。
       ⚠ 没有这一支，穹顶封口（顶点在 y≈27.86）会被下面的采样域钳回 27.20，
       整个穹顶被压成一圈平顶 —— 这正是「颅顶一个盖」的成因之一。 */
    return 27.20 + (y - 27.20) * 0.9697;
  }
  return pchipY(TARGET_Y_CALIB, pchipInv(AUTHOR_Y_CALIB, y));
};

/**
 * 把一条单调映射按等距重采样，再用自然三次样条（C²）求值。
 *
 * 为什么要多这一步 —— 这是「额头那一圈台阶」的根，也是轮廓表横纹的同类病。
 *
 * pchipY 是 PCHIP：保证单调、保证 C¹，但**不保证 C²** —— 二阶导在每个结点上
 * 是跳变的。AUTHOR_Y_CALIB 有 9 个结点，每个结点处纵向拉伸率都会拐一下；
 * 体表是「前缘剖面 ∘ 纵向映射」，映射的二阶项会直接进到曲面的曲率里，
 * 于是每个结点都在世界坐标里留下一道横向折痕。
 * 实测：额头那道最明显的台阶落在 world y ≈ 23.0，反推回 author 正是结点 17.44，
 * 一一对应。
 *
 * 做法：先把原映射在 [−9.6, 24] 上按 0.05 等距采样（672 点），再对这 672 点做
 * 自然三次样条。结点密到这个程度，过冲已 < 1e-4，单调性实测保持；
 * 0.05 的步长也远小于原结点间距，所以原映射的形状分毫不动，只是把
 * 结点处的曲率尖角磨平了。
 *
 * ⚠ 采样域必须**覆盖函数的全部输入**，否则超出域的部分会被 makeC2Spline 钳到
 * 末点值上。reliftY 的输入是「作者世界 y」，最大到 27.20（颅顶），所以它取到
 * 27.20；headY 的输入是建模 y，最大到 21.80。
 */
function monotoneC2(fn, x0, x1, step) {
  const n = Math.round((x1 - x0) / step);
  const t = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    t.push([x, fn(x)]);
  }
  const f = makeC2Spline(t);
  // ⚠ makeC2Spline 的返回是**数组**（一张表可能有多个值列，shellProfile 就有 2 列）。
  //   这里传进去的是单列表，所以取 [0] 还原成标量 —— 少这一下，headY 会返回 [y]
  //   而不是 y，整棵模型的 y 坐标直接变成 NaN 或全零。
  return x => f(x)[0];
}

const _headYC2 = monotoneC2(_headYRaw, -9.6, HEAD_Y1, 0.05);
// 域必须覆盖到穹顶封口的顶点（≈27.9），否则超出的部分被钳平
const _reliftC2 = monotoneC2(_reliftRaw, -9.6, 29.6, 0.05);

export function headY(y) {
  return y <= -9.6 ? y : _headYC2(y);
}

export function reliftY(y) {
  return y <= -9.6 ? y : _reliftC2(y);
}

/**
 * 把 reliftY 烘焙进一棵子树的几何：逐顶点转到世界空间改 y，再转回局部。
 * 共享几何只处理一次（否则会被重映射两遍）。
 */
function reliftSubtree(root) {
  const inv = new THREE.Matrix4();
  const w = new THREE.Vector3();
  const done = new Set();
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.getAttribute) return;
    const g = o.geometry;
    if (done.has(g)) return;
    done.add(g);
    const src = g.getAttribute('position');
    if (!src) return;
    inv.copy(o.matrixWorld).invert();
    const dst = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      w.set(src.getX(i), src.getY(i), src.getZ(i)).applyMatrix4(o.matrixWorld);
      w.y = reliftY(w.y);
      w.applyMatrix4(inv);
      dst[i * 3] = w.x; dst[i * 3 + 1] = w.y; dst[i * 3 + 2] = w.z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(dst, 3));
    g.computeVertexNormals();     // y 方向被拉伸过，法线必须重算
    g.computeBoundingBox();
    g.computeBoundingSphere();
  });
}

/** headY 在 y 处的局部拉伸率（用于让头部内部结构跟着一起拉长） */
export function headScale(y) {
  const d = 0.25;
  return (headY(y + d) - headY(y - d)) / (2 * d);
}


/* ── 面部中线特征的纵向剖面 ──
 *
 * ⚠ 以下四张表的自变量全部是**最终世界 y**（颏 5.20 / 颅顶 27.20 / H = 22.0），
 * 不是 author y。这样每一行都能与解剖数字直接对照，不必再心算两套坐标。
 * 四张表都走自然三次样条（C²）—— NOSE_AMP / MID_AMP 的振幅若只有 C¹，
 * 曲率跳变会在鼻背与唇面上留下一道道横纹，与轮廓表当初的毛病一样。
 */

/** 鼻的中线前凸量：鼻根 0 → 鼻尖峰值 → 鼻底急落 → 上唇根归零 */
const NOSE_AMP = [
  [ 11.60, 0.00],
  [ 12.24, 0.30],   // 鼻底 subnasale：鼻与上唇的分界
  [ 12.80, 0.68],
  [ 13.40, 1.14],
  [ 13.90, 1.52],
  [ 14.10, 1.63],   // 鼻尖 pronasale —— 落在 0.405H（真人 0.40H）
  [ 14.70, 1.60],
  [ 15.30, 1.42],
  [ 16.00, 1.02],
  [ 16.50, 0.45],
  [ 16.85, 0.00]    // 鼻根 nasion：归零
];
const noseAmp = c2(NOSE_AMP);

/** 鼻的横向半宽（**世界单位**，不是归一化的 nx —— 见 faceBump 的说明） */
const NOSE_HALF = [
  [ 11.60, 2.05],
  [ 12.24, 1.95],   // 鼻底：鼻宽约 3.9（真人 3.5~4.0）
  [ 12.90, 1.80],
  [ 13.60, 1.66],
  [ 14.10, 1.58],   // 鼻尖
  [ 14.80, 1.55],
  [ 15.60, 1.62],
  [ 16.40, 1.95],
  [ 16.85, 2.70]    // 鼻根：与眉间连成一片，所以放宽
];
const noseHalf = c2(NOSE_HALF);

/**
 * 唇区中线前凸修正（正 = 隆起）。
 * 表里的基底值见 MID_PROFILE，两者相加才是最终剖面：
 *   下唇 8.95+0.39 = 9.34、口裂 9.00+0.15 = 9.15、上唇 9.08+0.33 = 9.41。
 */
const MID_AMP = [
  [  6.60, 0.00],
  [  7.20, 0.24],
  [  7.70, 0.39],   // 下唇
  [  8.25, 0.15],   // 口裂（唇间沟，约 3mm 深）
  [  8.70, 0.26],
  [  9.00, 0.33],   // 上唇（含唇珠）
  [  9.50, 0.24],
  [  9.90, 0.20],
  [ 10.60, 0.06],
  [ 11.20, 0.00]
];
const midAmp = c2(MID_AMP);

/** 唇区横向余弦窗半宽（**世界单位**）：口裂宽约 5.1 */
const LIP_HALF = [
  [  6.20, 1.55],
  [  7.20, 2.30],
  [  8.20, 2.55],   // 口裂处最宽
  [  9.00, 2.45],
  [  9.80, 1.85],
  [ 10.60, 1.00],
  [ 11.20, 0.45]
];
const lipHalf = c2(LIP_HALF);

/** 采样点距"正前方"的角距 φ ∈ [0, π]：0 = 面部正中，π/2 = 体侧，π = 枕部 */
function frontalAngle(ang) {
  let phi = Math.abs(ang - Math.PI / 2);
  if (phi > Math.PI) phi = Math.PI * 2 - phi;
  return phi;
}

/** 余弦窗：中线为 1，|x| ≥ w 处为 0，两端导数都是 0 —— 不留折痕、不起尖脊 */
function cosWin(x, w) {
  const u = Math.abs(x) / Math.max(1e-4, w);
  return u >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * u));
}

/**
 * 透镜形纵向窗：中点最高、两端收细且一阶导为 0。
 * 眼裂、眼睑都是「中间宽、两头尖」的形状，用高斯会在两端留下一圈软塌的余量，
 * 用透镜形才对：闭区间外恒为 0，采样不会溢出到相邻高度。
 */
function lens(dy, h) {
  const t = dy / h;
  return Math.abs(t) >= 1 ? 0 : Math.pow(1 - t * t, 1.5);
}

/**
 * 平滑平台窗：|x − c| ≤ w 内恒为 1，再向外 f 个单位平滑落到 0。
 * 颧突、眉弓、眶这类「有一整片范围、边缘却要软」的解剖特征用它，
 * 比高斯更贴 —— 高斯在中心是个尖，平台窗才给出「面」。
 */
function plateau(x, c, w, f) {
  const t = (Math.abs(x - c) - w) / Math.max(1e-4, f);
  return t <= 0 ? 1 : (t >= 1 ? 0 : 1 - t * t * (3 - 2 * t));
}

/**
 * 面部与颈部的体表起伏，返回沿径向外扩的距离（正 = 隆起）。
 *
 * 与旧版 faceFeature 的关键差别：鼻和唇**不再是独立网格**，而就是这里的
 * 中线隆起。旧做法把鼻子做成一拫从 z=6.3 斜插到 z=8.9 的锥体，鼻根埋在
 * 脸里、鼻尖翘在脸外，怎么调都像"贴上去的尖锥"；改由中线剖面直接给出后，
 * 鼻子是脸的一部分，鼻根 → 鼻梁 → 鼻尖是一条连续曲面。
 *
 * ⚠ 自变量 fy 是**最终世界 y**（颏 5.20 / 瞳孔 16.20 / 颅顶 27.20）。
 *
 * ⚠ 横向定位一律用 **ax = |x|（世界单位）**，不用归一化的 nx。
 *   原因：nx = |cos θ| 到 x 的映射是 x ∝ nx^0.8，在中线附近被压得很死 ——
 *   nx 从 0 走到 0.2，x 只走到 0.28·rx（约 2.1）；再从 0.2 走到 0.8，
 *   x 却跑到 0.84·rx（约 6.4）。于是同一个 σ_nx 在前脸是很窄的一条、
 *   到侧脸就摊成一大片，窗宽根本没法精确控制（旧版两眼横贯全脸就是这么来的）。
 *   换成 ax 之后，「眼裂宽 3.2」就写成 EW = 1.6，所见即所得。
 *
 * 本轮为解决「丑」而做的三处重写：
 *   ① 眼睛。旧版三笔的横向窗从 nx 0.17 一直盖到 0.73，等于在那一高度把整张
 *      脸横切一刀 —— 渲染出来正是「两道横贯全脸的黑色切口」。现在收到
 *      ax = 3.0 ± 1.62（眼裂宽 3.2，真人 3.0），并改用透镜形剖面。
 *   ② 下颌缘。旧版一处都没有，下颌与颈连成一片 —— 正面没有下巴、侧面没有
 *      下颌线。现在沿「颏 (ax 1.8) → 下颌角 (ax 5.6)」给一道斜向浅沟。
 *   ③ 面。旧版只有中线特征，正面只剩一个超椭圆，所以只有上下之别、
 *      没有左右起伏。现在补上眉弓平台、眶、颧突、颊部、下颌体、鼻唇沟。
 *
 * @param {number} fy 最终世界 y
 * @param {number} ax 体表横向距离 |x|
 * @param {number} sa sin(截面角)：> 0 为身体前方，< 0 为后方
 */
function faceBump(fy, ax, sa) {
  // 面部特征只长在前面，但过渡必须是软的。
  // 原来写的是 if (sa <= 0) return 0 —— sa 跨过 0 的那一圈（正侧方）直接跳变，
  // 与 sideBump 的硬切一起，在曲面上留下笔直的棱。用光滑窗收尾。
  const w = smoothstep(-0.22, 0.02, sa);
  if (w <= 0) return 0;
  let d = 0;

  /* ══ 鼻 ══
     横向窗的幂次控制「鼻背是窄脊还是宽坡」：1 次方截面是平顶山（中间 50%
     宽度的高度才降到一半）；1.7 次方又太尖 —— 鼻背细到只剩一条刀刃，正侧
     45° 望过去就是一把插在脸上的刀片。1.25 次方才是鼻背的真实观感。 */
  const nA = noseAmp(fy);
  if (nA > 0) d += nA * Math.pow(cosWin(ax, noseHalf(fy)), 1.25);
  // 鼻翼：鼻底两侧的圆润隆起
  d += 0.30 * gauss(fy - 12.60, 0.42) * gauss(ax - 1.75, 0.52);
  // 鼻翼沟：鼻翼外侧那道浅沟，是鼻与面颊的分界
  d -= 0.16 * gauss(fy - 12.50, 0.45) * gauss(ax - 2.45, 0.58);
  // 鼻尖上区（supratip break）：鼻尖上方一道浅转折，鼻头才不是个球
  d -= 0.055 * gauss(fy - 14.80, 0.24) * cosWin(ax, 1.20);

  /* ══ 唇 ══ */
  const mA = midAmp(fy);
  if (mA !== 0) d += mA * cosWin(ax, lipHalf(fy));
  // 口角：让口裂在两侧收细，不然唇角会被抹平
  d += 0.14 * gauss(fy - 8.35, 0.30) * gauss(ax - 2.35, 0.55);
  // 人中：上唇上方两道脊之间的浅沟
  d -= 0.10 * gauss(fy - 10.20, 0.55) * cosWin(ax, 0.55);
  // 颏唇沟在两侧延展，不然它只是中线上的一道横槽
  d -= 0.06 * gauss(fy - 6.35, 0.42) * gauss(ax - 1.70, 0.90);

  /* ══ 眉弓 · 眉间 ══
     眉弓是一整道横脊（ax 0.8~5.2），所以用平台窗；眉间是中线上的隆起。 */
  d += 0.30 * gauss(fy - 17.90, 0.55) * plateau(ax, 3.0, 2.2, 1.3);
  d += 0.17 * gauss(fy - 17.95, 0.55) * cosWin(ax, 1.30);

  /* ══ 眶 ══ 眶内凹陷，眼球嵌在这里。
     窗口开宽一点，让眶缘的过渡是「缓坡」而不是「坑沿」。 */
  d -= 0.30 * gauss(fy - 16.35, 0.80) * plateau(ax, 3.0, 1.7, 1.6);

  /* ══ 眼 ══
     雕刻的眼睛不是「一颗球」，而是 上睑 → 睑裂 → 下睑 三笔起伏，靠明暗
     而不是靠轮廓读出来。瞳孔 fy = 16.20（0.500H）；眼中心 ax = 3.0、
     半宽 1.62（眼裂宽 3.24，真人 3.0；两眼内距 2·(3.0−1.62) = 2.76，
     约等于一个眼宽 —— 这是人像法度里最硬的一条）。 */
  const EY = 3.0, EW = 1.62;
  const eWin = k => cosWin(Math.abs(ax - EY), EW * k);
  d += 0.19 * lens(fy - 16.74, 0.62) * eWin(1.00);   // 上睑（睑板前饱满）
  d += 0.09 * lens(fy - 15.66, 0.55) * eWin(1.05);   // 下睑
  d -= 0.100 * lens(fy - 16.22, 0.40) * eWin(0.95);  // 睑裂
  d -= 0.070 * gauss(fy - 17.02, 0.18) * eWin(0.95); // 上睑沟（重睑折痕）
  d -= 0.070 * gauss(fy - 16.15, 0.26) * gauss(ax - 1.35, 0.32); // 内眦窝
  d += 0.060 * gauss(fy - 16.10, 0.34) * gauss(ax - 4.55, 0.36); // 外眦端眶缘外角
  d += 0.100 * gauss(fy - 16.55, 0.55) * gauss(ax - 1.95, 0.42); // 鼻侧眶缘（内眦内侧的脊）

  /* ══ 颧 · 颊 · 鼻唇沟 ══
     这几笔是本轮为「脸有面」而补的。旧版一处都没有，正面就只剩一个超椭圆，
     所以只有上下之别、没有左右起伏。 */
  d += 0.26 * gauss(fy - 15.00, 0.95) * plateau(ax, 4.90, 1.40, 1.20);  // 颧突（malar）
  d += 0.15 * gauss(fy - 13.10, 1.05) * plateau(ax, 5.40, 1.20, 1.20);  // 颊部饱满
  d += 0.12 * gauss(fy - 11.20, 0.85) * plateau(ax, 5.00, 1.10, 1.10);  // 下颌体前方
  d -= 0.14 * gauss(fy - 13.30, 1.05) * gauss(ax - 2.95, 0.62);         // 鼻唇沟

  /* ══ 下颌缘 ══
     从颏侧（ax 1.8, fy 6.7）斜向后上到下颌角（ax 5.6, fy 8.3）。
     没有这一笔，下颌与颈就是连成一片的曲面：正面没有下巴、侧面没有下颌线，
     整颗头读起来像一只蛋。它只在 ax ≥ 1.6 才起作用，免得在下巴正面凿出槽。 */
  d -= 0.075 * gauss(fy - (5.90 + 0.43 * ax), 0.50) * smoothstep(1.6, 3.0, ax);

  return d * w;
}

/**
 * 体侧（沿 ±X）的起伏，返回横向外扩量。
 * 前方给颧弓、咬肌与下颌角，后方给乳突与项部 —— 让颈后不是一个圆柱。
 * ⚠ 自变量 fy 同样是**最终世界 y**，中心值已由 author y 换算过来。
 */
function sideBump(fy, nx, sa) {
  let dx = 0;
  /* 前侧（颧弓 / 下颌角 / 颞窝）与后侧（乳突 / 项部）之间必须是软过渡。
     原版写的是 if (sa > -0.25) { … } if (sa < 0.25) { … } —— 硬切。
     麻烦在于那些高斯项在 sa = ∓0.25 那一圈并**不**为零：颧突剩 0.15、
     下颌角剩 0.25、乳突剩 0.16。于是整个曲面沿着这一圈被生生切了一刀，
     从颞部斜贯到项部留下四道笔直的棱 —— 远看就是头后面一片"削过的平面"，
     这正是"不像雕塑"里最难解释的那条斜线。改成 smoothstep 软窗后消失。 */
  const wF = smoothstep(-0.42, -0.06, sa);   // sa ≥ -0.06 全开，≤ -0.42 全关
  const wB = smoothstep(0.42, 0.06, sa);     // sa ≤  0.06 全开，≥  0.42 全关
  if (wF > 0) {
    // 颧弓：颧骨向后延伸的弓，在体侧形成一道横向的棱（世界 y 15.4 ≈ 0.46H）
    dx += wF * (0.18 * gauss(fy - 15.40, 1.05) * gauss(nx - 0.88, 0.26));
    // 下颌角：向后下的方角转折（世界 y 8.3 ≈ 0.14H）
    dx += wF * (0.26 * gauss(fy - 8.30, 0.95) * gauss(nx - 0.90, 0.24));
    // 咬肌：下颌角前方的饱满。没有这一笔，下颌角只是一块孤零零的凸起
    dx += wF * (0.14 * gauss(fy - 9.90, 0.90) * gauss(nx - 0.84, 0.24));
    // 颞窝：颞部浅凹，让顶结节与颧弓之间收进去一道
    dx -= wF * (0.15 * gauss(fy - 20.60, 1.20) * gauss(nx - 0.74, 0.32));
  }
  if (wB > 0) {
    // 乳突：耳后下方的骨性隆起（世界 y 14.9）
    dx += wB * (0.20 * gauss(fy - 14.90, 0.72) * gauss(nx - 0.86, 0.22));
    // 斜方肌上缘：项部的斜坡。幅度已下调到 0.18 —— 底座的外放现在由轮廓表
    // 自己给（凹形放量 + 底部内收），这里再叠一份就等于「双份肩宽」，
    // 会把颈项重新顶成喇叭口。这里只负责让项部背面比前面厚一点，读作肌肉。
    const ty = clamp((2.0 - fy) / 4.0, 0, 1);
    if (ty > 0) dx += wB * (0.18 * ty * gauss(nx - 0.72, 0.46));
  }
  return dx;
}

/* ══════════════════════════ 建模小工具 ══════════════════════════ */

/** 生成闭合截面点列：ringOf(ang => [u, v], 分段数) */
function ringOf(fn, steps = 32) {
  const o = [];
  for (let i = 0; i < steps; i++) o.push(fn((i / steps) * Math.PI * 2));
  return o;
}

/** 0→1 平滑过渡 */
const sm = t => smoothstep(0, 1, t);

/** 圆角矩形截面（用于骨板、软骨板） */
const slabRing = (halfU, halfV, n = 4.5, steps = 28) =>
  ringOf(a => superellipse(halfU, halfV, n, a), steps);

/** 椭圆截面 */
const ovalRing = (halfU, halfV, steps = 26) =>
  ringOf(a => [Math.cos(a) * halfU, Math.sin(a) * halfV], steps);

/** 宽度沿曲线渐变的控制点插值 */
function widthAt(table, t) {
  if (t <= table[0][0]) return table[0][1];
  const n = table.length;
  if (t >= table[n - 1][0]) return table[n - 1][1];
  for (let i = 1; i < n; i++) {
    if (t <= table[i][0]) {
      const a = table[i - 1], b = table[i];
      const k = (t - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return table[n - 1][1];
}

export function buildAnatomy(scene) {
  const root = new THREE.Group();
  root.name = 'anatomy';
  scene.add(root);

  const organs = new Map();
  const anim = {};

  const register = (id, rig, material, meshes, extra = {}) => {
    const mts = new Set();
    if (Array.isArray(meshes)) {
      meshes.forEach(m => {
        if (!m.isMesh) return;
        if (!m.userData.ownMaterial) m.material = material;
        m.userData.organId = id;
        if (m.material) mts.add(m.material);
      });
    }
    if (material) mts.add(material);
    (extra.parent || root).add(rig.outer);
    organs.set(id, {
      def: ORG_BY_ID[id],
      material,
      materials: [...mts],
      rig,
      meshes,
      center: new THREE.Vector3(),
      radius: 8,
      ...extra
    });
  };

  const mat = {};
  ORGANS.forEach(o => { mat[o.id] = makeMaterial(o); });

  /* ─────────────── 1. 头部与颈部轮廓（真实头型 + 耳廓） ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    /* 截面 = 前/后不对称的超椭圆（横向半宽、前后缘都由样条给出）
              + faceBump（鼻、唇、眉弓、眼窝等中线起伏）
              + sideBump（颧弓、下颌角、乳突、项部）。
       两处关键差别：
         ① 前缘改走 splineAt。原来用 profileAt 线性插值，控制点之间是直线段，
            240 层叠起来就是一圈圈肉眼可见的棱 —— 像车床车出来的木胎；
         ② 鼻、唇由 faceBump 直接给出，不再另做网格。旧版把鼻子做成从
            z=6.3 斜插到 z=8.9 的一根锥体，鼻根埋在脸里，怎么调都像贴上去的。 */
    const shape = horizontalShell({
      // 层高走纵向标定（头才不会矮成一截）；截面形状仍按建模坐标查表，
      // 因此每一层的形状与它最终所在的解剖高度是自洽的。
      yAt: t => headY(HEAD_Y0 + (HEAD_Y1 - HEAD_Y0) * t),
      // 层高 900：作者坐标下 0.035，经纵向标定后世界步距 ≈0.070。
      // 分辨率是被「眼」逼上去的：睑裂 σ=0.40、上睑沟 σ=0.18（世界 y），
      // 要 ≥2.5 层/σ 才刻得出浅沟而不是一圈台阶。
      layers: 900,
      // 径向 256：超椭圆在前正中处 x ≈ rx·cos θ，所以正面每格横向跨度
      // ≈ rx·2π/256 = 0.19（旧值 128 时是 0.37）。内眦窝 σ=0.32、
      // 外眦 σ=0.36、鼻侧眶缘 σ=0.42 —— 128 段时一格比 σ 还宽，
      // 那些小特征会被采成折角而不是窝。
      radialSegments: 256,
      section: (t, ang) => {
        const y = HEAD_Y0 + (HEAD_Y1 - HEAD_Y0) * t;   // 建模坐标：只用来算最终世界 y
        // 本层最终落在哪里？分两步：先经 headY 到「作者世界 y」，再经 relift 到
        // 「最终世界 y」。**全部解剖特征（鼻、唇、眉弓、眼、颧、颊）都以 fy 为
        // 自变量** —— 于是代码里的 5.20 就是颏、27.20 就是颅顶，不再需要在
        // author y / world y 之间来回心算。
        const fy = reliftY(headY(y));
        const [rx, bz] = shellProfile(fy);             // 轮廓表也按最终世界 y 查
        const fz = midAt(fy);                          // 前缘 z 由中线剖面直接给
        const cz = (fz + bz) / 2;
        const sa = Math.sin(ang), ca = Math.cos(ang);
        const rF = Math.max(0.04, fz - cz);      // 前半径
        const rB = Math.max(0.04, cz - bz);      // 后半径
        // n 取 2.5：侧脸略平，不像球面那样鼓
        const k = superellipse(rx, sa >= 0 ? rF : rB, 2.5, ang);
        let x = k[0];
        let z = cz + k[1];

        const nx = Math.abs(ca);
        const ax = Math.abs(x);                        // 体表横向距离（世界单位）
        const dS = sideBump(fy, nx, sa);
        if (dS !== 0) x += (ca >= 0 ? 1 : -1) * dS;

        const dF = faceBump(fy, ax, sa);
        if (dF !== 0) {
          const rad = Math.hypot(x, z - cz) || 1;
          x += (x / rad) * dF;
          z += ((z - cz) / rad) * dF;
        }
        return [x, z];
      }
    });
    const head = new THREE.Mesh(shape, mat.skin);
    head.renderOrder = 20;
    rig.inner.add(head);
    meshes.push(head);

    /* 耳廓：一整块雕出来的。
       旧版是「底板 + 耳轮管 + 对耳轮管 + 耳甲腔碟 + 耳屏球 + 耳垂球」六件拼起来：
       六件各说各话，侧看就是一枚肉桂卷；更要紧的是底板的凹凸用的是
       `clamp((x + T) / 2T, 0, 1)`，把耳甲腔一律挖在 +x 那一面 —— 对右耳是外侧面，
       对左耳却是**贴颅的那一面**，左右耳其实从来没有镜像过。

       本轮再修三处（上一版仍像「贴在头侧的扁碟」）：
         ① **内侧收成楔形**：贴颅面的高度压到 0.70、进深压到 0.72，于是耳朵
            的根部是长进颞骨的，而不是一片离体立着的板。中心也从 |x|=8.25
            回到 7.95 —— 该处皮壳半宽 7.68，内侧面落在皮下，接缝自然消失。
         ② **厚度 0.50 → 0.62**，并把所有起伏只加在外侧（face = lat^0.5）：
            贴颅面保持一整块干净曲面，不会从后面透出耳甲腔的凹陷。
         ③ 耳轮改成有宽度的卷边（σ 0.10 → 0.135），耳甲腔从 0.78 收到 0.50
            （原来的 0.78 已经把碗底捅穿到内侧面，所以读成「一个洞」），
            并补上耳屏间切迹。 */
    [-1, 1].forEach(s => {
      const ear = new THREE.Group();
      // 上缘平眉弓（fy 18.1）、下缘平鼻底（fy 12.3）；外耳道约在颅深 60% 处
      ear.position.set(s * 7.95, headY(11.20), -2.60);
      ear.rotation.y = s * -0.34;                 // 耳廓向后外张开
      ear.rotation.x = -0.17;                     // 长轴后倾
      ear.rotation.z = s * 0.05;

      const T = 0.62;                             // 半厚（真人连卷边约 1.2cm）
      const H = 2.82, W = 1.58;                   // 半高 5.64、半深 3.16，与真人一致
      const geo = ellipsoid(T, H, W, 64, 44);
      deform(geo, (x, y, z) => {
        // ⚠ out 而不是 x：起伏必须按「离颅远近」定，这样左右耳天然镜像
        const out = x * s;
        const u = y / H, v = z / W;               // 归一化：u 上正，v 前正
        const rho = Math.hypot(u * 0.95, v * 0.84);          // 0 = 耳中心，1 = 外缘
        const lat = clamp((out + T) / (2 * T), 0, 1);        // 1 = 外侧面
        const face = Math.pow(lat, 0.5);                     // 起伏只长在外侧
        const upper = sm(clamp((u + 0.42) / 0.80, 0, 1));    // 耳轮只在上 2/3
        let d = 0;
        // ① 耳轮卷边 / 耳舟
        d += 0.36 * gauss(rho - 0.90, 0.135);
        d -= 0.22 * gauss(rho - 0.68, 0.095) * upper;
        // ② 对耳轮：耳舟内侧的隆起
        d += 0.26 * gauss(rho - 0.44, 0.115) * upper;
        // ③ 耳甲腔：中前部的碗 —— 耳朵的「眼」
        d -= 0.50 * Math.exp(-(((u + 0.16) ** 2) / 0.20 + ((v - 0.20) ** 2) / 0.30));
        // ④ 耳屏与耳屏间切迹
        d += 0.28 * Math.exp(-(((u + 0.02) ** 2) / 0.070 + ((v - 0.70) ** 2) / 0.080));
        d -= 0.20 * Math.exp(-(((u + 0.22) ** 2) / 0.045 + ((v - 0.60) ** 2) / 0.060));
        // ⑤ 耳垂：下端无软骨、无卷边，收成一块圆润厚肉
        const lobe = sm(clamp((-u - 0.66) / 0.42, 0, 1));
        d = d * (1 - lobe) + 0.26 * lobe;
        // 外形：上半加宽、下半收窄（真人耳廓的卵圆形）
        const wide = 1 + 0.16 * sm(clamp((u + 0.50) / 1.0, 0, 1))
                       - 0.22 * sm(clamp((-u - 0.32) / 0.55, 0, 1));
        // 内侧收成楔形：耳根长进颞骨
        const wedge = 1 - 0.30 * Math.pow(1 - lat, 1.5);
        return [out + s * d * face, y * wedge, z * wide * (0.72 + 0.28 * lat)];
      });
      const pinna = new THREE.Mesh(geo, mat.skin);
      ear.add(pinna);

      ear.traverse(o => { if (o.isMesh) { o.renderOrder = 20; o.userData.part = 'ear'; } });
      rig.inner.add(ear);
      meshes.push(...ear.children);
    });

    /* 鼻与唇不再单独建模 —— 它们现在是外壳 faceBump() 里的中线隆起。
       旧版把鼻做成一拫从 z=6.3 斜插到 z=8.9 的锥体、唇做成两根管子，
       与脸的交界处永远是一道生硬的接缝：雕塑是从一整块石料里减出来的，
       五官必须和脸共用一个曲面。 */

    /* 眼球与眼睑。
       旧版把眼球做成沿前后压扁的扁球、整体推到眶缘外面，眼睑只用一根
       loft 弧凑数 —— 不透明时像两颗白纽扣，半透明时像两颗悬浮的亮球。
       雕塑的眼睛是「嵌进眶里的球 + 上下睑把它包住」：
         · 眼球接近正球（真人前后径 24、横径 23.5，几乎不扁）；
         · 埋进眶内，只让角膜略略凸出眶内表面；
         · 上下睑用两顶球冠扣在眼球外，中间留出眼裂。 */
    {
      const scleraMat = makeMaterial(ORG_BY_ID.skin, { color: 0xd7ccc1, opacity: 1, roughness: 0.22 });
      const irisMat = makeMaterial(ORG_BY_ID.skin, { color: 0x4e5962, opacity: 1, roughness: 0.32 });
      const R = 0.95;
      const RL = R * 1.21;              // 睑缘外表面：真人眼睑厚约 3mm
      [-1, 1].forEach(s => {
        const eye = new THREE.Group();
        // 瞳孔间距 = 2×3.30 = 6.6（真人 6.3），而且必须整只缩进眶里：
        // 上一版眼睑球壳到 |x| = 4.94，而 z≈7.3 处的脸表面只有 4.34，
        // 于是眼球在**横向**上捅出了脸外，侧看是一颗挂在颊上的球。
        eye.position.set(s * 3.30, headY(12.28), 6.28);
        eye.rotation.y = s * 0.16;        // 随眶轴轻微朝外
        eye.scale.set(1, 0.98, 0.86);

        const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 30, 22), scleraMat);
        ball.userData.ownMaterial = true;
        eye.add(ball);

        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.37, 22, 18), irisMat);
        iris.scale.set(1, 1, 0.5);
        iris.position.z = R - 0.13;
        iris.userData.ownMaterial = true;
        eye.add(iris);

        // 上睑 / 下睑：两顶明显大于眼球的球冠扣在外面，中间的缝就是眼裂。
        // 半径差必须够大（这里 22%），否则眼睑与眼球几乎重合，看上去仍是"裸球"。
        const lidTop = new THREE.Mesh(
          new THREE.SphereGeometry(RL, 30, 14, 0, Math.PI * 2, 0, 1.05), mat.skin);
        const lidBottom = new THREE.Mesh(
          new THREE.SphereGeometry(RL, 30, 14, 0, Math.PI * 2, 2.02, Math.PI - 2.02), mat.skin);
        eye.add(lidTop, lidBottom);

        // 内眦：眼裂内侧端的软组织
        const canthus = new THREE.Mesh(ellipsoid(0.16, 0.30, 0.18, 14, 12), mat.skin);
        canthus.position.set(-0.92, -0.04, 0.42);
        eye.add(canthus);

        eye.traverse(o => { if (o.isMesh) { o.renderOrder = 20; o.userData.part = 'eye'; } });
        rig.inner.add(eye);
        meshes.push(ball, iris, lidTop, lidBottom, canthus);
      });
    }

    register('skin', rig, mat.skin, meshes);
  }

  /* ─────────────── 2. 颅骨 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    // 颅盖：顶点约 y=20.4，赤道（最宽处）在 y=12.8
    const calvaria = new THREE.Mesh(
      new THREE.SphereGeometry(7.60, 60, 38, 0, Math.PI * 2, 0, Math.PI * 0.56), mat.skull);
    calvaria.scale.set(0.92, 1.0, 0.98);
    calvaria.position.set(0, headY(12.80), -0.40);
    meshes.push(calvaria);

    // 颅底：前高后低的阶梯状骨板（前颅窝 → 鞍区 → 后颅窝）
    const baseW = [[0, 2.30], [0.14, 4.30], [0.34, 5.00], [0.56, 4.70], [0.80, 4.00], [1, 2.90]];
    const skullBase = new THREE.Mesh(sweepSection({
      curve: curveFrom([
        [0, 14.05, 5.60], [0, 13.45, 3.00], [0, 12.45, 0.20],
        [0, 11.10, -2.60], [0, 9.70, -4.90], [0, 8.60, -6.90]
      ], 0.5),
      up: [1, 0, 0],
      section: t => slabRing(0.24, widthAt(baseW, t), 4.5, 30),
      tubularSegments: 56
    }), mat.skull);
    meshes.push(skullBase);

    // 眼眶：眶缘 + 向后收敛的眶腔
    [-1, 1].forEach(s => {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.26, 10, 30), mat.skull);
      rim.position.set(s * 2.95, headY(12.35), 6.55);
      rim.rotation.x = -0.12;
      meshes.push(rim);

      const bowl = new THREE.Mesh(lathe([
        [1.26, 0.06], [1.22, -0.36], [1.04, -0.98], [0.74, -1.58], [0.42, -2.10]
      ], 26), mat.skull);
      bowl.rotation.x = Math.PI / 2;
      bowl.position.set(s * 2.95, headY(12.33), 6.35);
      meshes.push(bowl);
    });

    // 颧弓
    [-1, 1].forEach(s => {
      const bulge = t => 0.20 + 0.14 * Math.sin(Math.PI * t);
      meshes.push(new THREE.Mesh(loft({
        curve: curveFrom([
          [s * 4.30, 11.00, 5.30], [s * 6.10, 11.05, 3.20],
          [s * 6.85, 11.00, 0.40], [s * 6.40, 10.75, -2.20]
        ], 0.5),
        radius: t => [bulge(t), bulge(t) * 1.35],
        tubularSegments: 40, radialSegments: 12, capStart: true, capEnd: true
      }), mat.skull));
    });

    // 上颌骨：沿牙弓的马蹄形骨块（下缘为牙槽突，上缘参与鼻腔／眶底）
    const archW = [[0, 0.74], [0.3, 0.70], [0.62, 0.62], [0.86, 0.52], [1, 0.48]];
    const maxilla = new THREE.Mesh(sweepSection({
      curve: curveFrom([
        [-3.36, 9.35, 0.60], [-3.30, 9.35, 2.60], [-2.95, 9.35, 4.60],
        [-2.10, 9.35, 6.15], [-0.95, 9.35, 6.95], [0.00, 9.35, 7.18],
        [0.95, 9.35, 6.95], [2.10, 9.35, 6.15], [2.95, 9.35, 4.60],
        [3.30, 9.35, 2.60], [3.36, 9.35, 0.60]
      ], 0.5),
      up: [0, 1, 0],
      section: t => {
        const u = t * 2;
        const v = u > 1 ? 2 - u : u;
        return slabRing(0.50, widthAt(archW, v), 3.0, 24);
      },
      tubularSegments: 88
    }), mat.skull);
    meshes.push(maxilla);

    // 鼻骨
    [-1, 1].forEach(s => {
      const nb = new THREE.Mesh(ellipsoid(0.42, 0.95, 0.50, 18, 14), mat.skull);
      nb.position.set(s * 0.46, headY(12.55), 7.30);
      nb.rotation.x = -0.22;
      meshes.push(nb);
    });

    // 乳突
    [-1, 1].forEach(s => {
      const mastoid = new THREE.Mesh(ellipsoid(0.60, 0.85, 0.72, 18, 14), mat.skull);
      mastoid.position.set(s * 5.55, headY(9.85), -2.15);
      meshes.push(mastoid);
    });

    meshes.forEach(m => { m.renderOrder = 15; rig.inner.add(m); });
    register('skull', rig, mat.skull, meshes);
  }

  /* ─────────────── 3. 脑 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    // 大脑半球底面贴合前高后低的颅底
    const yBot = (z) => clamp(12.68 - (5.0 - z) * 0.42, 8.70, 12.95);

    /** 脑回（交叉脊状）+ 脑沟 */
    const gyri = (x, y, z) => {
      const g1 = Math.sin(x * 1.85 + y * 0.95 + z * 0.40) *
                 Math.sin(y * 1.55 + z * 0.85) * Math.sin(z * 2.05 + x * 0.60);
      const g2 = Math.sin(x * 3.60 + 1.70) * Math.sin(y * 3.20 + 0.30) * Math.sin(z * 3.00 + 2.20);
      const g3 = Math.sin(x * 7.10 + 0.90) * Math.sin(y * 6.40 + 2.10) * Math.sin(z * 6.00 + 1.30);
      return g1 * 0.30 + g2 * 0.145 + g3 * 0.058;
    };

    const cerebrum = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), mat.brain);
    cerebrum.geometry.scale(6.00, 4.20, 6.30);
    deform(cerebrum.geometry, (x, y, z, n) => {
      let d = gyri(x, y, z);
      // 半球间纵裂
      d -= Math.exp(-(x * x) / 0.42) * 0.84;
      // 外侧裂（颞叶上界）浅沟
      d -= 0.17 * Math.exp(-Math.pow((Math.abs(x) - 3.95) / 0.95, 2)) *
           Math.exp(-Math.pow((z - 0.90) / 2.70, 2)) *
           Math.max(0, 1 - Math.abs(y - 13.0) / 1.7);
      const nx = x + n.x * d, ny0 = y + n.y * d, nz = z + n.z * d;
      // 底面压平贴合颅底
      const yb = yBot(nz - 0.35) - 15.35;
      return [nx, Math.max(ny0, yb), nz];
    });
    cerebrum.geometry.translate(0, 15.35, -0.35);
    meshes.push(cerebrum);

    // 颞叶
    [-1, 1].forEach(s => {
      const t = new THREE.IcosahedronGeometry(1, 4);
      t.scale(1.78, 1.42, 2.78);
      deform(t, (x, y, z, n) => {
        const d = gyri(x * 0.55, y * 0.55, z * 0.55) * 0.9 - Math.exp(-(z * z) / 6) * 0.08;
        return [x + n.x * d, y + n.y * d, z + n.z * d];
      });
      const lobe = new THREE.Mesh(t, mat.brain);
      lobe.position.set(s * 4.15, headY(11.60), 0.70);
      meshes.push(lobe);
    });

    // 小脑：细密的叶片（folia）
    const cb = new THREE.IcosahedronGeometry(1, 5);
    cb.scale(2.88, 1.52, 1.98);
    deform(cb, (x, y, z, n) => {
      const folia = Math.sin(y * 9.5) * 0.055 + Math.sin(x * 3.4 + y * 1.2) * 0.026;
      const notch = Math.exp(-(x * x) / 0.30) * 0.14;   // 小脑蚓部纵向浅沟
      const d = folia - notch;
      return [x + n.x * d, y + n.y * d, z + n.z * d];
    });
    const cerebellum = new THREE.Mesh(cb, mat.brain);
    cerebellum.position.set(0, headY(11.35), -4.95);
    meshes.push(cerebellum);

    // 脑干：中脑 → 脑桥（膨大）→ 延髓
    const stem = new THREE.Mesh(loft({
      curve: curveFrom([[0, 13.30, -2.10], [0, 12.20, -2.55], [0, 11.05, -2.90], [0, 9.80, -3.05]], 0.5),
      radius: t => [0.95 + 0.32 * Math.sin(Math.PI * t), 0.92 + 0.26 * Math.sin(Math.PI * t)],
      tubularSegments: 28, radialSegments: 18, capStart: true, capEnd: true
    }), mat.brain);
    meshes.push(stem);

    // 大脑镰（纵裂内的硬脑膜皱襞）
    const falxMat = makeMaterial(ORG_BY_ID.brain, { color: 0xe6ded6, roughness: 0.6 });
    const falx = new THREE.Mesh(plate([
      [5.40, 19.40], [2.50, 20.58], [-1.00, 20.48], [-4.40, 18.60], [-6.30, 15.60],
      [-6.30, 13.60], [-3.00, 14.60], [0.60, 15.20], [3.60, 16.40], [5.30, 17.90]
    ], 0.10, 0.03), falxMat);
    falx.geometry.rotateY(-Math.PI / 2);
    falx.userData.ownMaterial = true;
    meshes.push(falx);

    meshes.forEach(m => rig.inner.add(m));
    register('brain', rig, mat.brain, meshes);
  }

  /* ─────────────── 4. 下颌骨 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    // 下颌体：沿牙弓的马蹄形骨条（下缘即颏底轮廓，上缘为牙槽突）
    const bodyW = [[0, 0.94], [0.34, 0.92], [0.68, 0.90], [0.86, 0.92], [1, 0.96]];
    const body = new THREE.Mesh(sweepSection({
      curve: curveFrom([
        [-4.62, 5.55, -0.10], [-4.94, 5.50, 1.60], [-4.80, 5.44, 3.40],
        [-3.90, 5.40, 5.10], [-2.30, 5.38, 6.45], [-0.80, 5.36, 7.05],
        [0.00, 5.36, 7.12],
        [0.80, 5.36, 7.05], [2.30, 5.38, 6.45], [3.90, 5.40, 5.10],
        [4.80, 5.44, 3.40], [4.94, 5.50, 1.60], [4.62, 5.55, -0.10]
      ], 0.5),
      up: [0, 1, 0],
      section: t => {
        const u = t * 2;
        const v = u > 1 ? 2 - u : u;
        return slabRing(0.58, widthAt(bodyW, v), 3.2, 24);
      },
      tubularSegments: 96
    }), mat.mandible);
    meshes.push(body);

    // 下颌支：向上后方的薄骨板
    [-1, 1].forEach(s => {
      const ramus = new THREE.Mesh(sweepSection({
        curve: curveFrom([
          [s * 4.70, 5.90, -0.30], [s * 4.62, 7.10, -0.70],
          [s * 4.52, 8.40, -0.90], [s * 4.42, 9.60, -1.00], [s * 4.36, 10.60, -0.90]
        ], 0.5),
        up: [0, 0, -1],
        section: t => slabRing(0.32, 1.55 - 0.45 * t, 3.4, 26),
        tubularSegments: 44
      }), mat.mandible);
      meshes.push(ramus);

      // 髁突
      const condyle = new THREE.Mesh(ellipsoid(0.62, 0.46, 0.95, 20, 16), mat.mandible);
      condyle.position.set(s * 4.36, headY(10.72), -1.05);
      condyle.rotation.y = s * 0.14;
      meshes.push(condyle);

      // 喙突（向前上方的尖）
      const coronoid = new THREE.Mesh(plate([
        [-0.90, -0.70], [0.55, -0.70], [1.30, 0.90], [0.05, 1.25], [-0.75, 0.30]
      ], 0.34, 0.05), mat.mandible);
      coronoid.geometry.rotateY(Math.PI / 2);
      coronoid.position.set(s * 4.30, headY(10.35), 0.95);
      meshes.push(coronoid);
    });

    meshes.forEach(m => { m.renderOrder = 14; rig.inner.add(m); });
    register('mandible', rig, mat.mandible, meshes);
  }

  /* ─────────────── 5. 舌骨 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    // 体部 + 大角：马蹄形
    const body = new THREE.Mesh(sweepSection({
      curve: curveFrom([
        [3.30, 4.55, -1.90], [3.05, 4.30, -0.50], [2.45, 4.18, 1.20],
        [1.15, 4.10, 2.45], [0.00, 4.08, 2.62],
        [-1.15, 4.10, 2.45], [-2.45, 4.18, 1.20], [-3.05, 4.30, -0.50], [-3.30, 4.55, -1.90]
      ], 0.5),
      up: [0, 1, 0],
      section: t => {
        const u = t * 2;
        const v = u > 1 ? 2 - u : u;
        const k = sm(v * 2);
        return slabRing(0.26 + 0.16 * k, 0.30 + 0.18 * k, 3.0, 20);
      },
      tubularSegments: 84
    }), mat.hyoid);
    meshes.push(body);

    // 小角
    [-1, 1].forEach(s => {
      const horn = new THREE.Mesh(loft({
        curve: curveFrom([[s * 1.35, 4.32, 2.28], [s * 1.42, 4.72, 2.05], [s * 1.40, 5.05, 1.70]], 0.5),
        radius: t => 0.15 - 0.05 * t,
        tubularSegments: 18, radialSegments: 8, capStart: true, capEnd: true
      }), mat.hyoid);
      meshes.push(horn);
    });

    meshes.forEach(m => rig.inner.add(m));
    register('hyoid', rig, mat.hyoid, meshes);
  }

  /* ─────────────── 6. 鼻腔 ─────────────── */
  {
    const rig = createRig();
    // t 由鼻前庭（z=9.6）到鼻后孔（z=-2.6）：[t, 半宽, 半高, 中心 y]
    const NASAL = [
      [0.000, 0.62, 0.58, 10.30],
      [0.115, 0.84, 0.90, 10.45],
      [0.328, 1.20, 1.16, 10.55],
      [0.541, 1.46, 1.42, 10.60],
      [0.738, 1.56, 1.56, 10.72],
      [0.893, 1.52, 1.46, 10.98],
      [1.000, 1.40, 1.30, 11.22]
    ];
    const cavity = new THREE.Mesh(sweepSection({
      curve: curveFrom(NASAL.map(r => [0, r[3], 9.60 - r[0] * 12.20]), 0.5),
      up: [0, 1, 0],
      section: t => {
        const [w, h] = profileAt(NASAL, t);
        return ringOf(a => superellipse(w, h, 2.6, a), 40);
      },
      tubularSegments: 80
    }), mat.nasalCavity);
    cavity.renderOrder = 8;
    rig.inner.add(cavity);
    register('nasalCavity', rig, mat.nasalCavity, [cavity]);
  }

  /* ─────────────── 7. 鼻中隔 ─────────────── */
  {
    const rig = createRig();
    // 真实鼻中隔是偏曲的：给一点柔和的 S 形偏移
    const SEP = [
      [0.000, 0.56], [0.180, 0.98], [0.400, 1.30], [0.620, 1.42],
      [0.800, 1.36], [1.000, 1.22]
    ];
    const septum = new THREE.Mesh(sweepSection({
      curve: curveFrom([
        [0.00, 10.18, 9.45], [0.07, 10.46, 6.60], [0.15, 10.58, 3.60],
        [0.11, 10.66, 0.80], [-0.05, 10.94, -1.40], [-0.12, 11.18, -2.70]
      ], 0.5),
      up: [0, 1, 0],
      section: t => slabRing(0.10, widthAt(SEP, t), 3.0, 18),
      tubularSegments: 60
    }), mat.nasalSeptum);
    septum.renderOrder = 9;
    rig.inner.add(septum);
    register('nasalSeptum', rig, mat.nasalSeptum, [septum]);
  }

  /* ─────────────── 8. 鼻甲（贝壳状卷曲） ─────────────── */
  {
    const rig = createRig();
    const meshes = [];
    // 在"曲线沿 +Z、u=+X、v=+Y"的规范标架里建模，再整体平移到位
    const buildConcha = (len, rOut, rIn, curlScale, steps) => (flip) => {
      const g = sweepSection({
        curve: curveFrom([[0, 0, 0], [0, 0.10, len * 0.45], [0, 0.16, len]], 0.5),
        up: [0, 1, 0],
        section: t => {
          const s = t * 2;
          const k = s > 1 ? 2 - s : s;
          const loop = horseshoeSection({
            rOuter: rOut * (0.80 + 0.30 * k),
            rInner: rIn * (0.82 + 0.28 * k),
            a0: -1.85, a1: 2.05,
            cx: curlScale, cy: 0.02,
            outerSteps: steps, innerSteps: steps
          });
          return flip ? loop.map(([u, v]) => [-u, v]) : loop;
        },
        tubularSegments: 56
      });
      return new THREE.Mesh(g, mat.conchae);
    };

    const specs = [
      { x: 1.32, y: 9.78, z: 5.70, len: 7.10, rOut: 0.50, rIn: 0.33, curl: -0.30 },  // 下鼻甲
      { x: 1.28, y: 10.62, z: 4.20, len: 5.90, rOut: 0.42, rIn: 0.27, curl: -0.26 }, // 中鼻甲
      { x: 1.16, y: 11.32, z: 2.00, len: 4.20, rOut: 0.30, rIn: 0.19, curl: -0.20 }  // 上鼻甲
    ];
    specs.forEach(sp => {
      const right = buildConcha(sp.len, sp.rOut, sp.rIn, sp.curl, 15)(false);
      right.position.set(sp.x, sp.y, sp.z - sp.len);
      meshes.push(right);

      const left = buildConcha(sp.len, sp.rOut, sp.rIn, sp.curl, 15)(true);
      left.position.set(-sp.x, sp.y, sp.z - sp.len);
      meshes.push(left);
    });

    meshes.forEach(m => { m.renderOrder = 9; rig.inner.add(m); });
    register('conchae', rig, mat.conchae, meshes);
  }

  /* ─────────────── 9. 鼻旁窦 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];
    [-1, 1].forEach(s => {
      const frontal = new THREE.Mesh(ellipsoid(1.42, 1.15, 1.30, 26, 18), mat.sinuses);
      frontal.position.set(s * 2.30, headY(15.30), 3.55);
      meshes.push(frontal);

      const maxillary = new THREE.Mesh(ellipsoid(1.52, 1.05, 1.75, 26, 18), mat.sinuses);
      maxillary.position.set(s * 2.72, headY(10.60), 3.60);
      maxillary.rotation.z = s * 0.16;
      meshes.push(maxillary);

      const ethmoid = new THREE.Mesh(ellipsoid(0.48, 0.62, 1.28, 20, 16), mat.sinuses);
      ethmoid.position.set(s * 0.82, headY(12.08), 3.10);
      meshes.push(ethmoid);
    });
    const sphenoid = new THREE.Mesh(ellipsoid(0.90, 0.78, 1.22, 24, 18), mat.sinuses);
    sphenoid.position.set(0, headY(11.92), -1.95);
    meshes.push(sphenoid);

    meshes.forEach(m => { m.renderOrder = 7; rig.inner.add(m); });
    register('sinuses', rig, mat.sinuses, meshes);
  }

  /* ─────────────── 10. 硬腭与软腭 ─────────────── */
  {
    // 旋转枢轴 = 硬腭后缘与软腭交界
    const rig = createRig([0, 8.30, -0.30]);

    const hardW = [[0.00, 2.26], [0.35, 2.70], [0.70, 3.00], [1.00, 3.14]];
    /** 腭穹窿高度：前部拱得高、后部渐平（真实硬腭就是一个前高后低的拱顶） */
    const DOME = v => 0.76 - 0.26 * v;
    const hard = new THREE.Mesh(sweepSection({
      curve: curveFrom([[0, 8.28, 6.88], [0, 8.26, 5.30], [0, 8.25, 3.55],
                        [0, 8.24, 1.80], [0, 8.24, 0.30], [0, 8.26, -0.30]], 0.5),
      up: [0, 1, 0],
      section: t => {
        const u = t * 2;
        const v = u > 1 ? 2 - u : u;
        const hw = widthAt(hardW, v);
        const dome = DOME(v);
        // 横断面是「拱」而不是一块平板：中间高、两侧低 —— 这是让口腔顶
        // 看起来像上腭而不是像插进去一根板子的关键。
        const N = 18, th = 0.24;
        const top = [], bot = [];
        for (let i = 0; i <= N; i++) {
          const q = -1 + (2 * i) / N;
          const y = dome * (1 - q * q);            // 抛物线拱
          top.push([q * hw, y]);
          bot.push([q * hw, y - th * (1 - 0.35 * q * q)]);
        }
        return [...top, ...bot.reverse()];
      },
      tubularSegments: 54
    }), mat.palate);
    rig.outer.add(hard);      // 硬腭不随软腭枢轴旋转

    // 腭皱襞（硬腭前部的横嵴）——沿穹窿走行，贴着拱顶
    const rugae = [];
    for (let i = 0; i < 5; i++) {
      const z = 6.20 - i * 0.52;
      const rr = 1.38 + i * 0.20;
      const pts = [-1, -0.55, 0, 0.55, 1].map(q => [
        q * rr,
        8.26 + DOME(0.15) * (1 - q * q) + 0.07,
        z - 0.14 * q * q
      ]);
      const arc = new THREE.Mesh(loft({
        curve: curveFrom(pts, 0.5),
        radius: () => [0.075, 0.055],
        tubularSegments: 22, radialSegments: 8, capStart: true, capEnd: true
      }), mat.palate);
      rugae.push(arc);
      rig.outer.add(arc);
    }

    // 软腭：可动的肌性瓣
    const softW = [[0, 2.95], [0.4, 2.80], [0.75, 2.40], [1, 1.95]];
    const soft = new THREE.Mesh(sweepSection({
      curve: curveFrom([
        [0, 8.32, -0.28], [0, 8.10, -0.90], [0, 7.62, -1.62], [0, 7.12, -2.28]
      ], 0.5),
      up: [0, 1, 0],
      section: t => slabRing(widthAt(softW, t), 0.17 + 0.06 * (1 - t), 3.2, 26),
      tubularSegments: 40
    }), mat.palate);
    rig.attach(soft);

    // 悬雍垂
    const uvula = new THREE.Mesh(loft({
      curve: curveFrom([[0, 7.16, -2.24], [0, 6.65, -2.10], [0, 6.05, -1.96]], 0.5),
      radius: t => [0.44 - 0.26 * t, 0.36 - 0.22 * t],
      tubularSegments: 26, radialSegments: 14, capStart: true, capEnd: true
    }), mat.palate);
    rig.attach(uvula);

    register('palate', rig, mat.palate, [hard, soft, uvula, ...rugae]);
    anim.softPalateRig = rig.inner;
  }

  /* ─────────────── 11. 口腔（含气腔） ─────────────── */
  {
    const rig = createRig();
    // [t, 半宽, 半高, 中心 y]，t 由口裂（z=8.4）向后至咽峡（z=-2.2）
    const ORAL = [
      [0.000, 3.30, 0.74, 7.36],
      [0.170, 3.46, 1.16, 7.20],
      [0.415, 3.32, 1.46, 7.06],
      [0.679, 2.96, 1.60, 7.00],
      [0.868, 2.56, 1.60, 6.96],
      [1.000, 2.10, 1.54, 6.92]
    ];
    const cavity = new THREE.Mesh(sweepSection({
      curve: curveFrom(ORAL.map(r => [0, r[3], 8.40 - r[0] * 10.60]), 0.5),
      up: [0, 1, 0],
      section: t => {
        const [w, h] = profileAt(ORAL, t);
        return ringOf(a => superellipse(w, h, 2.5, a), 38);
      },
      tubularSegments: 72
    }), mat.oralCavity);
    cavity.renderOrder = 6;
    rig.inner.add(cavity);
    register('oralCavity', rig, mat.oralCavity, [cavity]);
  }

  /* ─────────────── 12. 牙与牙龈 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];
    const toothMat = makeMaterial(ORG_BY_ID.teethGums, {
      color: 0xf1ece0, opacity: 1, roughness: 0.28
    });

    // 牙位定义：[x, z, 类型, 半宽, 半深, 冠高]
    const UPPER = [
      [0.52, 7.08, 'incisor', 0.42, 0.30, 1.06],
      [1.30, 6.82, 'incisor', 0.32, 0.28, 0.94],
      [2.08, 6.12, 'canine', 0.35, 0.36, 1.18],
      [2.72, 5.22, 'premolar', 0.36, 0.38, 0.90],
      [3.08, 4.22, 'premolar', 0.36, 0.40, 0.84],
      [3.30, 3.05, 'molar', 0.50, 0.46, 0.82],
      [3.38, 1.82, 'molar', 0.47, 0.43, 0.78]
    ];
    const GUM_TOP = 8.30;       // 上牙龈缘
    const OCCL = 7.25;          // 咬合平面
    const GUM_BOT = 6.52;       // 下牙龈缘

    const makeTooth = (spec, s, upper) => {
      const [x, z, kind, w, d, h] = spec;
      const group = new THREE.Group();
      const px = s * x;
      const theta = Math.atan2(px, z - 1.10);          // 牙弓外法向
      group.position.set(px, upper ? GUM_TOP : GUM_BOT, z);
      group.rotation.y = theta;

      const crown = new THREE.Mesh(crownGeometry({ outline: toothOutline(kind, w, d), height: h }), toothMat);
      crown.position.y = upper ? -h : 0;
      crown.userData.ownMaterial = true;
      group.add(crown);

      const root = new THREE.Mesh(rootGeometry({
        w: w * 0.72, d: d * 0.78, height: upper ? 1.28 : 1.05, tip: 0.28
      }), toothMat);
      root.userData.ownMaterial = true;
      group.add(root);

      return { group, crown, root };
    };

    [-1, 1].forEach(s => {
      UPPER.forEach(spec => {
        const t = makeTooth(spec, s, true);
        rig.inner.add(t.group);
        meshes.push(t.crown, t.root);
      });
      UPPER.forEach(spec => {
        // 下牙略小、略内收并后移（覆盖咬合）
        const [x, z, kind, w, d, h] = spec;
        const lower = [x * 0.90 - 0.06, z * 0.94 - 0.16, kind, w * 0.92, d * 0.94, h * 0.80];
        const t = makeTooth(lower, s, false);
        rig.inner.add(t.group);
        meshes.push(t.crown, t.root);
      });
    });

    // 牙龈：沿牙弓的软组织带（覆盖牙颈、包裹牙槽突，略宽于骨面故可见）
    const gumW = [[0.00, 0.58], [0.35, 0.62], [0.70, 0.66], [1.00, 0.68]];
    const buildGum = (upper) => {
      const marginY = upper ? 8.30 : 6.52;
      const halfV = upper ? 0.50 : 0.34;
      const vOff = upper ? halfV * 0.5 : -halfV * 0.5;
      const g = sweepSection({
        curve: curveFrom([
          [-3.30, marginY, 1.14], [-3.42, marginY, 2.40], [-3.36, marginY + 0.02, 3.60],
          [-3.05, marginY + 0.04, 4.80], [-2.55, marginY + 0.06, 5.86],
          [-1.62, marginY + 0.08, 6.66], [-0.60, marginY + 0.10, 7.10],
          [0.00, marginY + 0.10, 7.20],
          [0.60, marginY + 0.10, 7.10], [1.62, marginY + 0.08, 6.66],
          [2.55, marginY + 0.06, 5.86], [3.05, marginY + 0.04, 4.80],
          [3.36, marginY + 0.02, 3.60], [3.42, marginY, 2.40], [3.30, marginY, 1.14]
        ], 0.5),
        up: [0, 1, 0],
        section: t => {
          const u = t * 2;
          const v = u > 1 ? 2 - u : u;
          const hw = widthAt(gumW, v);
          return ringOf(a => {
            const [uu, vv] = superellipse(hw, halfV, 2.4, a);
            // 靠牙一侧略高、靠前庭一侧略低，形成龈缘的斜度
            return [uu, vOff + vv + uu * 0.16];
          }, 22);
        },
        tubularSegments: 90
      });
      return new THREE.Mesh(g, mat.teethGums);
    };
    meshes.push(buildGum(true), buildGum(false));

    meshes.forEach(m => { m.renderOrder = 13; rig.inner.add(m); });
    register('teethGums', rig, mat.teethGums, meshes);
  }

  /* ─────────────── 13. 舌 ─────────────── */
  {
    const rig = createRig([0, 5.78, -0.95]);   // 转向枢轴：舌根 / 舌骨平面
    // [t, 半宽, 半高, 中心 v]
    const TSEC = [
      [0.00, 1.42, 1.52, 0.16],
      [0.15, 1.86, 1.62, 0.05],
      [0.35, 2.16, 1.48, 0.00],
      [0.55, 2.26, 1.36, -0.04],
      [0.75, 2.08, 1.14, -0.09],
      [0.88, 1.52, 0.80, -0.14],
      [1.00, 0.56, 0.30, -0.18]
    ];
    const tongueGeo = sweepSection({
      curve: curveFrom([
        [0, 5.70, -1.60], [0, 5.96, -0.30], [0, 6.42, 1.30], [0, 6.92, 2.90],
        [0, 7.26, 4.40], [0, 7.40, 5.70], [0, 7.30, 6.78]
      ], 0.5),
      up: [0, 1, 0],
      section: t => {
        const [hw, hv, cv] = profileAt(TSEC, t);
        return ringOf(a => {
          const ca = Math.cos(a), sa = Math.sin(a);
          const n = sa > 0 ? 2.90 : 2.05;      // 舌背较平、舌腹较圆
          const k = Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), -1 / n);
          return [ca * hw * k, cv + sa * hv * k];
        }, 36);
      },
      tubularSegments: 120
    });

    // 轮廓乳头的坐标（沿界沟"V"排布，V 尖朝后）
    const papillae = [];
    for (let i = 0; i < 5; i++) {
      const px = i * 0.42;
      papillae.push([px, 0.62 + 1.42 * px]);
      if (px > 0.01) papillae.push([-px, 0.62 + 1.42 * px]);
    }

    deform(tongueGeo, (x, y, z, n) => {
      let d = 0;
      // 舌背正中沟
      d -= 0.14 * gauss(x, 0.27) * smoothstep(1.0, 2.2, z) * smoothstep(7.0, 6.0, z);
      // 界沟（V 形）
      d -= 0.24 * gauss(z - (0.62 + 1.42 * Math.abs(x)), 0.20) * smoothstep(6.1, 6.9, y);
      // 轮廓乳头：环绕的隆起 + 中央小凹
      for (const [px, pz] of papillae) {
        const dd = Math.hypot(x - px, z - pz);
        d += 0.115 * Math.exp(-Math.pow((dd - 0.155) / 0.075, 2)) * smoothstep(6.2, 6.9, y);
        d -= 0.055 * gauss(dd, 0.05) * smoothstep(6.2, 6.9, y);
      }
      // 菌状乳头（前 2/3 舌背零星分布）
      d += 0.036 * (Math.sin(x * 7.3 + z * 6.1) * Math.sin(z * 8.9 - x * 3.2)) *
           smoothstep(6.3, 6.9, y) * smoothstep(7.4, 6.4, z) * smoothstep(1.4, 2.6, z);
      return [x + n.x * d, y + n.y * d, z + n.z * d];
    });

    const tongue = new THREE.Mesh(tongueGeo, mat.tongue);
    rig.attach(tongue);

    // 舌系带与舌下襞
    const frenulum = new THREE.Mesh(loft({
      curve: curveFrom([[0, 6.08, 5.90], [0, 5.72, 5.40], [0, 5.50, 4.80]], 0.5),
      radius: t => [0.14, 0.42 - 0.16 * t],
      tubularSegments: 20, radialSegments: 12, capStart: true, capEnd: true
    }), mat.tongue);
    rig.attach(frenulum);

    register('tongue', rig, mat.tongue, [tongue, frenulum]);
    anim.tongueRig = rig.inner;
  }

  /* ─────────────── 14. 唾液腺 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];
    const lobulate = (rx, ry, rz, seed) => {
      const g = new THREE.IcosahedronGeometry(1, 4);
      g.scale(rx, ry, rz);
      deform(g, (x, y, z, n) => {
        const d = 0.11 * (Math.sin(x * 3.1 + seed) * Math.sin(y * 2.6 + seed * 1.7) * Math.sin(z * 2.9 + seed * 0.6))
                + 0.055 * Math.sin(x * 6.4 + y * 5.2) * Math.sin(z * 6.1 + seed);
        return [x + n.x * d, y + n.y * d, z + n.z * d];
      });
      return g;
    };

    [-1, 1].forEach(s => {
      // 腮腺：耳前下方、咬肌表面
      const parotid = new THREE.Mesh(lobulate(1.42, 1.75, 1.15, 1.1), mat.salivaryGlands);
      parotid.position.set(s * 5.15, headY(9.75), 0.30);
      parotid.rotation.z = s * 0.10;
      meshes.push(parotid);

      // 下颌下腺：下颌骨下缘内侧
      const submand = new THREE.Mesh(lobulate(1.05, 0.72, 1.32, 2.3), mat.salivaryGlands);
      submand.position.set(s * 3.05, 4.95, 2.55);
      meshes.push(submand);

      // 舌下腺：口底黏膜下
      const subling = new THREE.Mesh(lobulate(0.48, 0.26, 0.86, 3.7), mat.salivaryGlands);
      subling.position.set(s * 1.62, headY(5.86), 4.70);
      meshes.push(subling);
    });

    meshes.forEach(m => rig.inner.add(m));
    register('salivaryGlands', rig, mat.salivaryGlands, meshes);
  }

  /* ─────────────── 15. 咽 ─────────────── */
  {
    const rig = createRig();
    // [t, 半宽（左右）, 半深（前后）]
    const PH = [
      [0.000, 1.50, 1.20],   // 鼻咽顶（颅底）
      [0.150, 1.85, 1.40],
      [0.350, 2.45, 1.45],
      [0.550, 2.78, 1.30],   // 口咽（最宽）
      [0.750, 2.42, 1.05],
      [0.880, 2.30, 0.95],   // 喉咽（梨状隐窝处略外扩）
      [1.000, 1.90, 0.86]
    ];
    const pharynxGeo = sweepSection({
      curve: curveFrom([
        [0, 11.00, -2.30], [0, 10.20, -2.55], [0, 9.20, -2.70], [0, 8.00, -2.80],
        [0, 6.60, -2.80], [0, 5.40, -2.70], [0, 4.40, -2.55], [0, 3.45, -2.40]
      ], 0.5),
      up: [0, 0, 1],
      section: t => {
        const [w, d] = profileAt(PH, t);
        return ringOf(a => superellipse(w, d, 2.5, a), 40);
      },
      tubularSegments: 96
    });
    // 纵行黏膜皱襞
    deform(pharynxGeo, (x, y, z, n) => {
      const ang = Math.atan2(x, z + 2.70);
      const fold = 0.052 * Math.sin(ang * 13.0) + 0.022 * Math.sin(ang * 27.0 + 1.1);
      const k = smoothstep(3.2, 4.4, y) * smoothstep(11.2, 10.4, y);
      const d = fold * k;
      return [x + n.x * d, y + n.y * d, z + n.z * d];
    });
    const pharynx = new THREE.Mesh(pharynxGeo, mat.pharynx);
    pharynx.renderOrder = 5;
    rig.inner.add(pharynx);

    // 咽鼓管圆枕（鼻咽侧壁的隆起）与咽隐窝
    const tori = [-1, 1].map(s => {
      const g = new THREE.IcosahedronGeometry(1, 3);
      g.scale(0.42, 0.95, 0.62);
      const m = new THREE.Mesh(g, mat.pharynx);
      m.position.set(s * 1.95, headY(10.30), -2.05);
      m.rotation.z = s * 0.25;
      m.renderOrder = 6;
      rig.inner.add(m);
      return m;
    });

    register('pharynx', rig, mat.pharynx, [pharynx, ...tori]);
  }

  /* ─────────────── 16. 咽喉肌群 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    /** 咽缩肌：包绕咽后壁与侧壁的 C 形肌层，前方开放（呈叠瓦状套叠） */
    const constrictor = (yTop, yBot, rTable, thick) => sweepSection({
      curve: curveFrom([[0, yTop, -2.68], [0, (yTop + yBot) / 2, -2.78], [0, yBot, -2.72]], 0.5),
      up: [0, 0, 1],
      section: t => {
        const [rw, rd] = profileAt(rTable, t);
        return horseshoeSection({
          rOuter: 1, rInner: 1 - thick / Math.max(rw, 0.6),
          a0: 0.38, a1: -3.52, outerSteps: 18, innerSteps: 18
        }).map(([u, v]) => [u * rw, v * rd]);
      },
      tubularSegments: 30
    });

    meshes.push(
      new THREE.Mesh(constrictor(10.75, 9.05, [[0, 2.10, 1.45], [1, 2.55, 1.55]], 0.30), mat.muscles),
      new THREE.Mesh(constrictor(9.25, 7.10, [[0, 2.60, 1.58], [1, 2.82, 1.42]], 0.34), mat.muscles),
      new THREE.Mesh(constrictor(7.30, 4.60, [[0, 2.85, 1.40], [1, 2.20, 1.10]], 0.36), mat.muscles)
    );

    // 胸锁乳突肌：颈部最显著的肌性标志
    [-1, 1].forEach(s => {
      const scm = new THREE.Mesh(loft({
        curve: curveFrom([
          [s * 5.25, 9.70, -1.50], [s * 4.85, 7.20, 0.10], [s * 4.10, 3.60, 1.60],
          [s * 3.00, -0.60, 2.30], [s * 1.75, -5.20, 2.50], [s * 1.30, -8.20, 2.40]
        ], 0.5),
        radius: t => [0.62 - 0.16 * t, 0.54 - 0.12 * t],
        tubularSegments: 60, radialSegments: 16, capStart: true, capEnd: true
      }), mat.muscles);
      meshes.push(scm);
    });

    // 舌骨下肌群（胸骨舌骨肌 / 胸骨甲状腺肌）：喉与气管前方的带状肌
    [-1, 1].forEach(s => {
      [0, 0.62].forEach((off, i) => {
        const strap = new THREE.Mesh(loft({
          curve: curveFrom([
            [s * (0.62 + off), 4.15 - i * 0.15, 2.55 + i * 0.10],
            [s * (0.70 + off), 1.60, 2.35 + i * 0.10],
            [s * (0.82 + off), -2.00, 2.05 + i * 0.10],
            [s * (1.05 + off), -6.40, 1.80 + i * 0.10],
            [s * (1.25 + off), -8.40, 1.70 + i * 0.10]
          ], 0.5),
          radius: () => [0.26, 0.16],
          tubularSegments: 46, radialSegments: 12, capStart: true, capEnd: true
        }), mat.muscles);
        meshes.push(strap);
      });
    });

    // 二腹肌前腹：舌骨 → 颏
    [-1, 1].forEach(s => {
      const dig = new THREE.Mesh(loft({
        curve: curveFrom([
          [s * 0.95, 4.34, 2.55], [s * 1.35, 4.80, 3.80],
          [s * 1.72, 5.15, 5.20], [s * 1.95, 5.32, 6.35]
        ], 0.5),
        radius: t => [0.30 - 0.04 * t, 0.26 - 0.04 * t],
        tubularSegments: 26, radialSegments: 12, capStart: true, capEnd: true
      }), mat.muscles);
      meshes.push(dig);
    });

    // 下颌舌骨肌：构成口底的肌性吊床
    const mylohyoid = new THREE.Mesh(sweepSection({
      curve: curveFrom([[0, 5.62, 6.35], [0, 5.48, 3.60], [0, 5.30, 1.20], [0, 5.10, -0.70]], 0.5),
      up: [0, 1, 0],
      section: t => slabRing(1.55 + 1.05 * t, 0.13, 3.4, 20),
      tubularSegments: 30
    }), mat.muscles);
    meshes.push(mylohyoid);

    // 咬肌：颧弓 → 下颌角外侧面
    [-1, 1].forEach(s => {
      const masseter = new THREE.Mesh(loft({
        curve: curveFrom([
          [s * 5.15, 10.55, 2.60], [s * 5.50, 8.80, 1.40], [s * 5.35, 7.20, 0.30], [s * 5.05, 6.15, -0.10]
        ], 0.5),
        radius: t => [0.70 - 0.14 * t, 0.42 + 0.10 * t],
        tubularSegments: 34, radialSegments: 14, capStart: true, capEnd: true
      }), mat.muscles);
      meshes.push(masseter);
    });

    meshes.forEach(m => rig.inner.add(m));
    register('muscles', rig, mat.muscles, meshes);
  }

  /* ═══════════ 17. 喉部装配体（吞咽时整体上提） ═══════════ */
  const larynxRig = createRig([0, 0, 0]);
  root.add(larynxRig.outer);
  anim.larynxRig = larynxRig.inner;

  /* 17a. 会厌：基部 (0,4.30,0.45) → 尖端 (0,7.05,-1.85)，静止时向后上立起 */
  {
    const baseP = new THREE.Vector3(0, 4.30, 0.45);
    const tipP = new THREE.Vector3(0, 7.05, -1.85);
    const dir = tipP.clone().sub(baseP);
    const L = dir.length();
    dir.normalize();
    // 绕 X 的倾角：+Y 需映射到 dir
    const phi = Math.atan2(dir.z, dir.y);

    const leafGeo = plate(leafProfile({ length: L, halfWidth: 1.42, tipSharp: 0.54, waist: 0.30 }), 0.15, 0.05);
    // 会厌两侧向后卷曲成勺状
    deform(leafGeo, (x, y, z) => [x, y, z + 0.42 * Math.min(1, Math.pow(Math.abs(x) / 1.42, 2))]);
    leafGeo.translate(0, L / 2, 0);
    const leaf = new THREE.Mesh(leafGeo, mat.epiglottis);

    const rig = createRig([baseP.x, baseP.y, baseP.z]);
    const pend = new THREE.Group();
    pend.rotation.x = phi;          // 静止位：向后上方立起
    pend.add(leaf);
    rig.inner.add(pend);

    // 会厌柄（甲状会厌韧带）
    const petiole = new THREE.Mesh(loft({
      curve: curveFrom([[0, 4.22, 0.52], [0, 4.05, 1.30], [0, 3.95, 2.10], [0, 3.98, 2.72]], 0.5),
      radius: t => [0.26 - 0.06 * t, 0.20 - 0.05 * t],
      tubularSegments: 22, radialSegments: 10, capStart: true, capEnd: true
    }), mat.epiglottis);
    rig.attach(petiole);

    larynxRig.inner.add(rig.outer);
    register('epiglottis', rig, mat.epiglottis, [leaf, petiole], { parent: larynxRig.inner });
    anim.epiglottisRig = rig.inner;
  }

  /* 17b. 甲状软骨：V 形软骨板 + 喉结 + 上/下角 */
  {
    const rig = createRig();
    const meshes = [];
    const PHI = 0.78;              // 软骨板与正中矢状面的夹角（约 45°）
    const lamina = [
      [0.00, -1.55], [0.70, -1.95], [1.95, -1.85], [3.05, -1.35],
      [3.45, -0.30], [3.32, 0.95], [2.80, 2.00], [1.95, 2.62],
      [0.95, 2.72], [0.28, 2.05], [0.06, 0.60]
    ];
    [-1, 1].forEach(s => {
      const g = plate(lamina.map(([x, y]) => [x * s, y]), 0.24, 0.06);
      const m = new THREE.Mesh(g, mat.thyroidCartilage);
      m.position.set(0, 3.62, 2.42);
      m.rotation.y = s * PHI;
      m.renderOrder = 12;
      rig.inner.add(m);
      meshes.push(m);

      // 上角
      const sup = new THREE.Mesh(loft({
        curve: curveFrom([[s * 2.00, 5.32, 0.42], [s * 1.92, 5.95, -0.50], [s * 1.76, 6.38, -1.35]], 0.5),
        radius: () => 0.14,
        tubularSegments: 20, radialSegments: 8, capStart: true, capEnd: true
      }), mat.thyroidCartilage);
      // 下角
      const inf = new THREE.Mesh(loft({
        curve: curveFrom([[s * 2.42, 2.02, -0.25], [s * 2.40, 1.62, -0.80], [s * 2.28, 1.36, -1.10]], 0.5),
        radius: () => 0.13,
        tubularSegments: 18, radialSegments: 8, capStart: true, capEnd: true
      }), mat.thyroidCartilage);
      [sup, inf].forEach(m2 => { m2.renderOrder = 12; rig.inner.add(m2); meshes.push(m2); });
    });

    // 喉结
    const prominence = new THREE.Mesh(ellipsoid(0.46, 1.30, 0.52, 24, 18), mat.thyroidCartilage);
    prominence.position.set(0, 3.85, 2.62);
    prominence.renderOrder = 12;
    rig.inner.add(prominence);
    meshes.push(prominence);

    larynxRig.inner.add(rig.outer);
    register('thyroidCartilage', rig, mat.thyroidCartilage, meshes, { parent: larynxRig.inner });
  }

  /* 17c. 环状软骨：戒指状——前方低窄的弓 + 后方高宽的板 */
  {
    const rig = createRig();
    const meshes = [];

    const arch = new THREE.Mesh(arcRing({
      y: 1.16, radius: 1.30, tubeR: 0.22, startDeg: -32, endDeg: 212,
      verticalScale: 0.86, z: 0.32
    }), mat.cricoid);
    arch.renderOrder = 12;
    rig.inner.add(arch);
    meshes.push(arch);

    const lamina = new THREE.Mesh(plate([
      [-1.16, 0.00], [-1.22, 0.70], [-1.10, 1.30], [-0.55, 1.62],
      [0.55, 1.62], [1.10, 1.30], [1.22, 0.70], [1.16, 0.00], [0.62, -0.16], [-0.62, -0.16]
    ], 0.40, 0.07), mat.cricoid);
    lamina.position.set(0, 1.00, -0.98);
    lamina.rotation.x = -0.14;
    lamina.renderOrder = 12;
    rig.inner.add(lamina);
    meshes.push(lamina);

    larynxRig.inner.add(rig.outer);
    register('cricoid', rig, mat.cricoid, meshes, { parent: larynxRig.inner });
  }

  /* 17d. 杓状软骨与假声带 */
  {
    const rig = createRig();
    const meshes = [];

    // 杓状软骨：一对三棱锥形小软骨，坐在环状软骨板上缘
    [-1, 1].forEach(s => {
      const g = loft({
        curve: curveFrom([
          [s * 0.90, 2.58, -1.00], [s * 0.88, 2.92, -0.88], [s * 0.82, 3.22, -0.72]
        ], 0.5),
        radius: t => [0.42 - 0.19 * t, 0.50 - 0.24 * t],
        tubularSegments: 22, radialSegments: 14, capStart: true, capEnd: true
      });
      const ary = new THREE.Mesh(g, mat.arytenoid);
      ary.renderOrder = 12;
      rig.inner.add(ary);
      meshes.push(ary);

      // 肌突（向外后方突出）
      const mp = new THREE.Mesh(ellipsoid(0.24, 0.22, 0.30, 14, 12), mat.arytenoid);
      mp.position.set(s * 1.12, 2.68, -0.96);
      mp.renderOrder = 12;
      rig.inner.add(mp);
      meshes.push(mp);
    });

    // 假声带（前庭襞）：声带上方、内含腺体的厚襞
    [-1, 1].forEach(s => {
      const g = sweepSection({
        curve: curveFrom([
          [0, 3.42, 1.48], [s * 0.34, 3.36, 0.30],
          [s * 0.66, 3.28, -0.75], [s * 0.92, 3.22, -1.45]
        ], 0.5),
        up: [0, 1, 0],
        section: t => slabRing(0.17 + 0.06 * t, 0.26 + 0.10 * t, 2.6, 16),
        tubularSegments: 34
      });
      const vf = new THREE.Mesh(g, mat.arytenoid);
      vf.renderOrder = 12;
      rig.inner.add(vf);
      meshes.push(vf);
    });

    larynxRig.inner.add(rig.outer);
    register('arytenoid', rig, mat.arytenoid, meshes, { parent: larynxRig.inner });
  }

  /* 17e. 声带（声襞）：前联合 → 杓状软骨声带突 */
  {
    const comm = new THREE.Vector3(0, 3.02, 1.52);   // 前联合
    const rig = createRig([comm.x, comm.y, comm.z]);
    const folds = [-1, 1].map(s => {
      const g = sweepSection({
        curve: curveFrom([
          [0, 3.02, 1.52], [s * 0.30, 2.94, 0.42], [s * 0.58, 2.84, -0.66],
          [s * 0.80, 2.74, -1.36], [s * 0.88, 2.68, -1.76]
        ], 0.5),
        up: [0, 1, 0],
        section: t => ringOf(a => {
          const [u, v] = superellipse(0.10 + 0.05 * t, 0.30 + 0.14 * t, 2.2, a);
          return [u, v - 0.06 * t];
        }, 18),
        tubularSegments: 40
      });
      const m = new THREE.Mesh(g, mat.vocalCords);
      m.position.sub(comm);
      const grp = new THREE.Group();
      grp.add(m);
      rig.inner.add(grp);
      return grp;
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.30, 3.60), glowMat);
    glow.rotation.set(-Math.PI / 2, 0, -0.30);
    glow.position.set(0, -0.10, -1.10);
    glow.renderOrder = 30;
    rig.inner.add(glow);

    larynxRig.inner.add(rig.outer);
    register('vocalCords', rig, mat.vocalCords,
      folds.flatMap(p => p.children),
      { parent: larynxRig.inner, foldPivots: folds, glowMat, glowMesh: glow });
    anim.foldPivots = folds;
    anim.glottisGlow = glowMat;
  }

  /* ─────────────── 18. 气管 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];

    // 管壁（真正的管腔截面，端面可见内腔）
    const wallGeo = sweepSection({
      curve: curveFrom([[0, 1.30, 0.80], [0, -1.50, 0.72], [0, -4.50, 0.62], [0, -7.30, 0.50]], 0.5),
      up: [0, 0, 1],
      section: () => horseshoeSection({
        rOuter: 1.00, rInner: 0.84, a0: 0, a1: Math.PI * 2,
        outerSteps: 40, innerSteps: 40
      }),
      tubularSegments: 60
    });
    const wall = new THREE.Mesh(wallGeo, mat.trachea);
    wall.renderOrder = 4;
    rig.inner.add(wall);
    meshes.push(wall);

    // 16 个 C 形透明软骨环（后方开放，由气管肌封闭）
    const ringMat = makeMaterial(ORG_BY_ID.trachea, { opacity: 0.95, color: 0xd2e4f2 });
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const y = 0.95 - i * 0.545;
      const ring = new THREE.Mesh(arcRing({
        y, radius: 1.10 - 0.05 * t, tubeR: 0.135,
        startDeg: -45, endDeg: 225, verticalScale: 0.78, z: 0.62 - 0.012 * t
      }), ringMat);
      ring.renderOrder = 11;
      ring.userData.ownMaterial = true;
      rig.inner.add(ring);
      meshes.push(ring);
    }

    // 气管肌（膜性壁）：后方连接软骨环两端
    const muscle = new THREE.Mesh(
      new THREE.CylinderGeometry(1.06, 1.01, 8.4, 20, 1, true,
        THREE.MathUtils.degToRad(132), THREE.MathUtils.degToRad(96)),
      makeMaterial(ORG_BY_ID.trachea, { opacity: 0.42, color: 0xe0a8b4 })
    );
    muscle.position.set(0, -3.20, 0.56);
    muscle.renderOrder = 4;
    muscle.userData.ownMaterial = true;
    rig.inner.add(muscle);
    meshes.push(muscle);

    register('trachea', rig, mat.trachea, meshes);
    anim.tracheaRig = rig.inner;
  }

  /* ─────────────── 19. 食管 ─────────────── */
  {
    const rig = createRig();
    const esoCurve = curveFrom([
      [0, 3.40, -2.45], [0, 1.60, -2.15], [0, -1.00, -1.92],
      [0, -3.80, -1.72], [0, -7.40, -1.55]
    ], 0.5);
    const esoGeo = sweepSection({
      curve: esoCurve,
      up: [0, 0, 1],
      section: () => ringOf(a => superellipse(0.88, 1.02, 2.3, a), 30),
      tubularSegments: 90
    });
    // 纵行黏膜皱襞（非进食状态食管塌陷成条索状）
    deform(esoGeo, (x, y, z, n) => {
      const zc = -1.55 - 0.0833 * (y + 7.4);
      const ang = Math.atan2(x, z - zc);
      const d = 0.052 * Math.sin(ang * 9) + 0.024 * Math.sin(ang * 17 + 0.6);
      return [x + n.x * d, y + n.y * d, z + n.z * d];
    });
    const eso = new THREE.Mesh(esoGeo, mat.esophagus);
    eso.renderOrder = 3;
    rig.inner.add(eso);
    register('esophagus', rig, mat.esophagus, [eso]);
    anim.esophagusMesh = eso;
    anim.esophagusBase = Float32Array.from(eso.geometry.attributes.position.array);
    anim.esophagusCurve = esoCurve;
  }

  /* ─────────────── 20. 甲状腺 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];
    const lobulate = (rx, ry, rz, seed) => {
      const g = new THREE.IcosahedronGeometry(1, 4);
      g.scale(rx, ry, rz);
      deform(g, (x, y, z, n) => {
        const d = 0.085 * Math.sin(x * 3.4 + seed) * Math.sin(y * 2.8 + seed * 1.6) * Math.sin(z * 3.1 + seed * 0.7)
                + 0.042 * Math.sin(x * 7.0 + y * 5.6) * Math.sin(z * 6.6 + seed);
        return [x + n.x * d, y + n.y * d, z + n.z * d];
      });
      return g;
    };

    [-1, 1].forEach(s => {
      const lobe = new THREE.Mesh(lobulate(0.92, 1.78, 1.02, 1.4), mat.thyroidGland);
      lobe.position.set(s * 1.55, 0.85, 1.05);
      lobe.rotation.z = s * 0.12;
      meshes.push(lobe);
    });
    const isthmus = new THREE.Mesh(lobulate(0.86, 0.60, 0.72, 2.9), mat.thyroidGland);
    isthmus.position.set(0, 0.55, 1.18);
    meshes.push(isthmus);

    // 锥状叶（约半数人存在）
    const pyramid = new THREE.Mesh(lobulate(0.26, 0.62, 0.30, 4.1), mat.thyroidGland);
    pyramid.position.set(0.34, 1.72, 1.24);
    meshes.push(pyramid);

    meshes.forEach(m => rig.inner.add(m));
    register('thyroidGland', rig, mat.thyroidGland, meshes);
  }

  /* ─────────────── 21. 颈椎 ─────────────── */
  {
    const rig = createRig();
    const meshes = [];
    for (let i = 0; i < 7; i++) {
      const y = 8.40 - i * 1.80;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.30, 1.24, 1.26, 26), mat.cervicalSpine);
      body.position.set(0, y, -4.70);
      rig.inner.add(body); meshes.push(body);

      if (i < 6) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.37, 1.37, 0.56, 26), mat.cervicalSpine);
        disc.position.set(0, y - 0.90, -4.70);
        rig.inner.add(disc); meshes.push(disc);
      }
      // 棘突（颈椎多为分叉棘突）。z 从 −6.05 提到 −5.65：外壳轮廓的颈后缘
      // 最低只到 −7.05，而棘突末端原本伸到 −6.75 —— 恰好从颈后戳出皮面 1.5。
      // 真人的棘突是**皮下可触及**，不是穿出来，所以留 0.4~0.7 的软组织厚度。
      [-1, 1].forEach(s => {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 1.30), mat.cervicalSpine);
        sp.position.set(s * 0.26, y - 0.30, -5.65);
        sp.rotation.x = -0.30;
        sp.rotation.y = s * 0.10;
        rig.inner.add(sp); meshes.push(sp);
      });
      // 横突与横突孔（椎动脉通过）
      [-1, 1].forEach(s => {
        const t1 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.42, 0.48), mat.cervicalSpine);
        t1.position.set(s * 1.55, y - 0.10, -4.95);
        t1.rotation.y = s * 0.15;
        rig.inner.add(t1); meshes.push(t1);
        const fora = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.46, 12, 1, true), mat.cervicalSpine);
        fora.position.set(s * 1.15, y - 0.10, -4.95);
        rig.inner.add(fora); meshes.push(fora);
      });
    }
    meshes.forEach(m => { m.renderOrder = 13; });
    register('cervicalSpine', rig, mat.cervicalSpine, meshes);
  }

  // 全部结构都按「作者世界坐标」建好了 —— 现在整棵做一次纵向重映射，
  // 外壳与内部结构一起搬到按人体法度校正后的新坐标系里。
  // 必须放在 finish() 之前：包围盒、结构中心、半径都要用重映射之后的坐标算。
  reliftSubtree(root);

  return finish(root, organs, anim);
}

/* ══════════════════════════ 收尾：包围球与返回 ══════════════════════════ */

function finish(root, organs, anim) {
  root.updateMatrixWorld(true);
  const issues = [];
  organs.forEach((o, id) => {
    const box = new THREE.Box3();
    o.meshes.forEach(m => { if (m && m.isMesh) box.expandByObject(m); });
    if (!box.isEmpty()) {
      box.getCenter(o.center);
      o.radius = Math.max(1.5, box.getBoundingSphere(new THREE.Sphere()).radius);
    }
    // 顶点健康检查：NaN 顶点会让包围球失效、结构静默消失，必须在构建期拦下
    (o.meshes || []).forEach((m, i) => {
      const pos = m && m.geometry && m.geometry.attributes && m.geometry.attributes.position;
      if (!pos) return;
      const a = pos.array;
      for (let k = 0; k < a.length; k++) {
        if (!Number.isFinite(a[k])) {
          issues.push(`${id} 的第 ${i} 个 mesh 含 NaN 顶点 (${pos.count} 顶点)`);
          break;
        }
      }
    });
  });
  if (issues.length) console.warn('[anatomy] 几何自检未通过：', issues);
  return { root, organs, order: ORGANS.map(o => o.id), anim, issues };
}
