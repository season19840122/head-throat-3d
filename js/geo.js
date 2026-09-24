/**
 * geo.js — 程序化几何构造工具
 * 全部基于 three.js 原生 geometry，不依赖任何外部模型文件。
 */
import * as THREE from '../vendor/three.module.js';

const V = THREE.Vector3;

/* ───────────────────────── 通用小工具 ───────────────────────── */

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 高斯核，用于在体表上叠加局部隆起/凹陷 */
export const gauss = (x, sigma) => Math.exp(-(x * x) / (2 * sigma * sigma));

/**
 * 由控制点表插值。table 形如 [[y0, v0, w0, ...], [y1, v1, w1, ...], ...]（y 单调）。
 * 返回 y → 各分量数组的函数。
 */
export function profileAt(table, y) {
  const n = table.length;
  if (y <= table[0][0]) return table[0].slice(1);
  if (y >= table[n - 1][0]) return table[n - 1].slice(1);
  for (let i = 1; i < n; i++) {
    if (y <= table[i][0]) {
      const a = table[i - 1], b = table[i];
      const t = (y - a[0]) / (b[0] - a[0]);
      const out = [];
      for (let k = 1; k < a.length; k++) out.push(a[k] + (b[k] - a[k]) * t);
      return out;
    }
  }
  return table[n - 1].slice(1);
}

/**
 * 非均匀 Catmull-Rom（三次 Hermite，切线取中心差分）插值。
 *
 * profileAt 是线性插值：对头部这种控制点较疏、曲率又连续变化的轮廓，
 * 线性插值会在相邻控制点之间留下一条折痕（曲率突变）。210 层截面叠起来，
 * 就是一圈圈肉眼可见的「棱」——像车床车出来的木胎，不像雕出来的石像。
 * 体表轮廓一律走这个函数。
 */
export function splineAt(table, y) {
  const n = table.length;
  if (y <= table[0][0]) return table[0].slice(1);
  if (y >= table[n - 1][0]) return table[n - 1].slice(1);
  let i = 1;
  while (i < n - 1 && y > table[i][0]) i++;
  const a = table[i - 1], b = table[i];
  const p = table[i - 2] || a, q = table[i + 1] || b;
  const yPrev = table[i - 2] ? p[0] : a[0] - (b[0] - a[0]);
  const yNext = table[i + 1] ? q[0] : b[0] + (b[0] - a[0]);
  const h = b[0] - a[0];
  const t = (y - a[0]) / h;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const out = [];
  for (let k = 1; k < a.length; k++) {
    const m0 = (b[k] - p[k]) / (b[0] - yPrev);
    const m1 = (q[k] - a[k]) / (yNext - a[0]);
    out.push(h00 * a[k] + h10 * h * m0 + h01 * b[k] + h11 * h * m1);
  }
  return out;
}

/**
 * 自然三次样条求值器（**C² 连续**）—— 专治「结点横纹」。
 *
 * splineAt 是 Catmull-Rom 型三次 Hermite：切线取中心差分，所以只有 C¹ ——
 * 一阶导连续、**二阶导（曲率）在结点处是跳变的**。对控制点密、曲率又平缓的
 * 体表轮廓表，这一点是致命的：曲率跳变在光滑面上会显成一道横向明暗带，
 * 而重映射到世界坐标后控制点间距约 1.5~1.8 单位，于是侧脸上出现一道道
 * 间距与之严格对应的横纹 —— 远看就是「车床车出来的木胎」。
 * （实测 HEAD_TABLE 各控制点处 bz 的二阶导跳变最大 0.79，rx 最大 2.34。）
 *
 * 改用自然三次样条（两端二阶导为 0）：二阶导全局连续，横纹的成因直接消失。
 * 控制点上的插值值与 splineAt 完全一致 —— 形体分毫不动，只是结点之间不再是
 * 「曲率有拐点」的三次段。代价是端点两段略平，对一张首尾本来就是收口的
 * 轮廓表没有影响。
 *
 * @param {number[][]} table 控制点表 [x, v1, v2, ...]
 * @returns {(y:number)=>number[]} 与 splineAt 同签名
 */
export function makeC2Spline(table) {
  const n = table.length;
  const xs = table.map(r => r[0]);
  const cols = table[0].length - 1;
  const h = new Float64Array(Math.max(1, n - 1));
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];

  // 每个分量解一次三对角方程求结点二阶导 M（Thomas 算法）
  const M = [];
  for (let k = 0; k < cols; k++) {
    const v = table.map(r => r[k + 1]);
    const m = new Float64Array(n);
    if (n > 2) {
      const a = new Float64Array(n), b = new Float64Array(n),
            c = new Float64Array(n), d = new Float64Array(n);
      b[1] = 2 * (h[0] + h[1]);
      c[1] = h[1];
      d[1] = 6 * ((v[2] - v[1]) / h[1] - (v[1] - v[0]) / h[0]);
      for (let i = 2; i <= n - 2; i++) {
        a[i] = h[i - 1];
        b[i] = 2 * (h[i - 1] + h[i]);
        c[i] = h[i];
        d[i] = 6 * ((v[i + 1] - v[i]) / h[i] - (v[i] - v[i - 1]) / h[i - 1]);
      }
      for (let i = 2; i <= n - 2; i++) {
        const w = a[i] / b[i - 1];
        b[i] -= w * c[i - 1];
        d[i] -= w * d[i - 1];
      }
      m[n - 2] = d[n - 2] / b[n - 2];
      for (let i = n - 3; i >= 1; i--) m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
    }
    M.push(m);
  }

  return (y) => {
    if (y <= xs[0]) return table[0].slice(1);
    if (y >= xs[n - 1]) return table[n - 1].slice(1);
    let i = 1;
    while (i < n - 1 && y > xs[i]) i++;
    const dt = y - xs[i - 1], hi = h[i - 1];
    const out = [];
    for (let k = 0; k < cols; k++) {
      const v0 = table[i - 1][k + 1], v1 = table[i][k + 1];
      const m0 = M[k][i - 1], m1 = M[k][i];
      const bco = (v1 - v0) / hi - hi * (2 * m0 + m1) / 6;
      out.push(v0 + bco * dt + (m0 / 2) * dt * dt + ((m1 - m0) / (6 * hi)) * dt * dt * dt);
    }
    return out;
  };
}

/* ───────────────────────── 曲线 ───────────────────────── */

/** 由点数组生成平滑曲线；pts 为 [x,y,z] 数组 */
export function curveFrom(pts, tension = 0.5, closed = false) {
  return new THREE.CatmullRomCurve3(
    pts.map(p => new V(p[0], p[1], p[2])),
    closed,
    'catmullrom',
    tension
  );
}

/* ───────────────────────── 变径管腔放样 ───────────────────────── */

/**
 * 沿曲线生成变半径管腔（可椭圆截面）。
 * @param {THREE.Curve} curve          中心线
 * @param {Function} radius            t => number | [rN, rB]（N=法向面内半径, B=副法向半径）
 * @param {number} tubularSegments     纵向分段
 * @param {number} radialSegments      环向分段
 * @param {boolean} capStart/capEnd    是否封口
 */
export function loft({
  curve,
  radius,
  tubularSegments = 120,
  radialSegments = 32,
  capStart = false,
  capEnd = false
}) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];

  const P = new V();
  const N = new V();
  const B = new V();
  const p = new V();
  const n = new V();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]);
    B.copy(frames.binormals[i]);

    const r = radius(t);
    const rn = Array.isArray(r) ? r[0] : r;
    const rb = Array.isArray(r) ? r[1] : r;

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);

      // 椭圆截面上的点
      const a = cos * rn;
      const b = sin * rb;
      p.copy(P).addScaledVector(N, a).addScaledVector(B, b);
      pos.push(p.x, p.y, p.z);

      // 椭圆的真实法向：∇(x²/rn² + y²/rb²)
      n.set(0, 0, 0)
        .addScaledVector(N, (cos * rn) / (rn * rn))
        .addScaledVector(B, (sin * rb) / (rb * rb))
        .normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(i / tubularSegments, j / radialSegments);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = stride * i + j - 1;
      const b = stride * (i - 1) + j - 1;
      const c = stride * (i - 1) + j;
      const d = stride * i + j;
      idx.push(a, b, d, b, c, d);
    }
  }

  // 端面封盖（三角扇）
  const addCap = (ringStart, flip) => {
    const center = new V();
    for (let j = 0; j <= radialSegments; j++) {
      center.x += pos[(ringStart + j) * 3];
      center.y += pos[(ringStart + j) * 3 + 1];
      center.z += pos[(ringStart + j) * 3 + 2];
    }
    center.multiplyScalar(1 / (radialSegments + 1));
    const ci = pos.length / 3;
    pos.push(center.x, center.y, center.z);
    const nrm = new V(0, 0, 0);
    const t = ringStart === 0 ? -1 : 1;
    const tan = frames.tangents[ringStart === 0 ? 0 : tubularSegments];
    nrm.copy(tan).multiplyScalar(t);
    nor.push(nrm.x, nrm.y, nrm.z);
    uv.push(0.5, 0.5);
    for (let j = 0; j < radialSegments; j++) {
      const a = ringStart + j;
      const b = ringStart + j + 1;
      if (flip) idx.push(ci, b, a);
      else idx.push(ci, a, b);
    }
  };
  if (capStart) addCap(0, true);
  if (capEnd) addCap(stride * tubularSegments, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ─────────────────── 任意闭合截面沿曲线扫掠 ─────────────────── */

/**
 * 这是最通用的建模原语：给一个闭合的 2D 截面（在曲线的法平面内），沿曲线扫掠成实体。
 * 可以做出马蹄形（鼻甲卷曲）、泪滴形（咽腔）、扁带状（声带）等真实截面。
 *
 * @param {THREE.Curve} curve
 * @param {Function} section      t => [[u, v], ...]  闭合点列（各环点数必须相同）
 * @param {number[]} up           参考上方向，用于建立稳定（不扭转）的局部标架
 * @param {boolean} flipU         镜像 u 方向（左右侧结构复用同一份截面数据）
 * @param {boolean} capStart/capEnd
 */
export function sweepSection({
  curve,
  section,
  tubularSegments = 72,
  up = [0, 1, 0],
  flipU = false,
  capStart = true,
  capEnd = true
}) {
  const upV = new V(up[0], up[1], up[2]).normalize();
  const P = new V(), T = new V(), N = new V(), B = new V(), p = new V();
  const pos = [], uv = [];
  const rings = [];
  const centers = [];
  const m = section(0).length;

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T).normalize();
    N.copy(upV).cross(T);
    if (N.lengthSq() < 1e-8) N.set(1, 0, 0).cross(T);
    N.normalize();
    if (flipU) N.negate();
    B.copy(T).cross(N).normalize();

    const loop = section(t);
    const cen = new V();
    for (let j = 0; j < m; j++) {
      const [u, v] = loop[j];
      p.copy(P).addScaledVector(N, u).addScaledVector(B, v);
      pos.push(p.x, p.y, p.z);
      cen.add(p);
      uv.push(t * 6, j / m * 3);
    }
    cen.multiplyScalar(1 / m);
    centers.push(cen);
    rings.push(i * m);
  }

  // 面：同时记录"期望的外向"用于自动判定绕向
  const faces = [];
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = i * m + j, b = i * m + j2, c = (i + 1) * m + j, d = (i + 1) * m + j2;
      const pa = new V(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
      const pb = new V(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      const pc = new V(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
      const pd = new V(pos[d * 3], pos[d * 3 + 1], pos[d * 3 + 2]);
      const ex = pa.clone().add(pb).add(pc).add(pd).multiplyScalar(0.25);
      const out = ex.clone().sub(centers[i].clone().add(centers[i + 1]).multiplyScalar(0.5));
      faces.push([a, b, d, out], [a, d, c, out]);
    }
  }
  const capRings = [];
  if (capStart) capRings.push([0, -1]);
  if (capEnd) capRings.push([tubularSegments, 1]);
  for (const [ri, sgn] of capRings) {
    const ci = pos.length / 3;
    pos.push(centers[ri].x, centers[ri].y, centers[ri].z);
    uv.push(0.5, 0.5);
    curve.getTangentAt(ri === 0 ? 0 : 1, T).normalize();
    const out = T.clone().multiplyScalar(sgn);
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      faces.push([ci, ri * m + j, ri * m + j2, out.clone()]);
    }
  }

  // 多数表决判定绕向，向外翻面（避免内外反了导致发黑）
  let vote = 0;
  for (const [a, b, c, out] of faces) {
    const pa = new V(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const pb = new V(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const pc = new V(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    vote += Math.sign(n.dot(out));
  }
  const flip = vote < 0;
  const idx = [];
  for (const [a, b, c] of faces) {
    if (flip) idx.push(a, c, b);
    else idx.push(a, b, c);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* ─────────────────── 水平截面逐层构建（头/颈/躯干） ─────────────────── */

/**
 * 沿 +Y 逐层堆叠截面。section(t, ang) 直接返回该方向的 [x, z] 绝对坐标，
 * 因此可以在半径上叠加任意局部隆起（鼻、眉弓、颏、下颌角）。
 *
 * @param {Function} yAt        t => y
 * @param {Function} section    (t, ang) => [x, z]
 * @param {number} layers       纵向层数
 * @param {number} radialSegments  环向分段
 */
export function horizontalShell({
  yAt,
  section,
  layers = 140,
  radialSegments = 80,
  capBottom = true,
  capTop = true
}) {
  const pos = [], uv = [];
  const centers = [];
  const m = radialSegments + 1;

  for (let i = 0; i <= layers; i++) {
    const t = i / layers;
    const y = yAt(t);
    const cen = new V(0, y, 0);
    let cx = 0, cz = 0;
    const raw = [];
    for (let j = 0; j <= radialSegments; j++) {
      const ang = (j / radialSegments) * Math.PI * 2;
      const [x, z] = section(t, ang);
      raw.push([x, z]);
      cx += x; cz += z;
    }
    cx /= m; cz /= m;
    for (let j = 0; j <= radialSegments; j++) {
      pos.push(raw[j][0], y, raw[j][1]);
      uv.push(j / radialSegments * 4, t * 10);
    }
    centers.push(new V(cx, y, cz));
  }

  const faces = [];
  const stride = m;
  for (let i = 0; i < layers; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j, b = i * stride + j + 1;
      const c = (i + 1) * stride + j, d = (i + 1) * stride + j + 1;
      const pa = new V(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
      const pb = new V(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      const pc = new V(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
      const pd = new V(pos[d * 3], pos[d * 3 + 1], pos[d * 3 + 2]);
      const ex = pa.clone().add(pb).add(pc).add(pd).multiplyScalar(0.25);
      const axis = new V((centers[i].x + centers[i + 1].x) / 2, ex.y, (centers[i].z + centers[i + 1].z) / 2);
      const out = ex.clone().sub(axis);
      if (out.lengthSq() < 1e-9) out.set(0, 1, 0);
      faces.push([a, b, d, out], [a, d, c, out]);
    }
  }
  /**
   * 封口。
   *
   * ⚠ 顶盖必须是**穹顶**，不能是平扇形。平扇形的法线整体垂直，而它外圈那一环
   * 的法线几乎是水平的 —— 一个面里转 80°，明暗上就是颅顶那一圈「帽檐」
   * （实测相邻层法线夹角在 y≈26.9 处冲到 12.5°，|d²z/dy²| 32）。
   * 这里改成按幂律曲面收顶：
   *     r(s) = R·(1−s)^q ,  y(s) = y₀ + h·s ,  s ∈ [0,1]
   * q 由「与最后一环的斜率衔接」定：dr/dy|₀ = −R·q/h，令它等于实测斜率，
   * 于是穹顶与体表是**相切**接上的，不会有折角。s=1 处 r=0，收成一点。
   *
   * 底面（胸廓切口）保持平面 —— 那是一个解剖横断面，本来就该是平的。
   */
  const capOf = (ri, sgn, dome = false) => {
    const cx = centers[ri].x, cy = centers[ri].y, cz = centers[ri].z;
    if (!dome) {
      const ci = pos.length / 3;
      pos.push(cx, cy, cz);
      uv.push(0.5, 0.5);
      const out = new V(0, sgn, 0);
      for (let j = 0; j < radialSegments; j++) {
        faces.push([ci, ri * stride + j, ri * stride + j + 1, out]);
      }
      return;
    }

    const rowR = (r) => {
      let acc = 0;
      for (let j = 0; j <= radialSegments; j++) {
        const k = r * stride + j;
        acc += Math.hypot(pos[k * 3] - centers[r].x, pos[k * 3 + 2] - centers[r].z);
      }
      return acc / (radialSegments + 1);
    };
    const R = rowR(ri);
    /* 穹顶走幂律：r = R·(1−s)^q，y = cy + sgn·h·s。
       q 由「与体表相切」定：起始斜率 dr/dy = −R·q/h，令它等于体表斜率。
       ⚠ 体表斜率必须在**多层的基线上**估，不能用最后一层 —— 那一层只有 0.035 高，
       单层斜率噪声极大（实测反解出 q=6，半径一上来就塌，颅顶长出一根针）。
       也不用椭圆弧 —— 椭圆在 θ=0 处 dr/dy 恒为 0，与体表的 −3.5 差 74°，
       接缝处会鼓起一个圆钮。 */
    const nc = Math.min(6, ri);
    const rj = Math.max(0, ri - nc);
    const dy = Math.abs(centers[ri].y - centers[rj].y) || 1e-4;
    const slope = Math.abs(R - rowR(rj)) / dy;
    const h = Math.max(0.04, R * 0.55);
    const q = Math.min(3.0, Math.max(1.1, slope * h / Math.max(R, 1e-4)));

    const base = [];
    for (let j = 0; j <= radialSegments; j++) {
      const k = ri * stride + j;
      base.push([pos[k * 3], pos[k * 3 + 2]]);
    }

    const K = 5;
    /* ⚠ prevStart 是**绝对顶点索引**，不是行号。
       侧壁的行是按 i·stride 排的，但封口的行是紧接在后面追加的 ——
       若把追加行的起始索引再乘一次 stride，面就会连到完全无关的顶点上，
       整颗头会被一个大三角形切穿（实测表现为一根黑杆从颅顶直插到颈）。
       这里统一用绝对索引，就和行怎么排无关了。 */
    let prevStart = ri * stride;
    for (let m = 1; m <= K; m++) {
      const s = m / (K + 1);
      const sc = Math.pow(1 - s, q);
      const y = cy + sgn * h * s;
      const rowStart = pos.length / 3;
      for (let j = 0; j <= radialSegments; j++) {
        pos.push(cx + (base[j][0] - cx) * sc, y, cz + (base[j][1] - cz) * sc);
        uv.push(j / radialSegments * 4, 10 + s * 2);
      }
      for (let j = 0; j < radialSegments; j++) {
        const a = prevStart + j, b = prevStart + j + 1;
        const c = rowStart + j, d = rowStart + j + 1;
        const ex = (pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4;
        const ez = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2] + pos[d * 3 + 2]) / 4;
        const out = new V(ex - cx, sgn * 0.35, ez - cz);
        faces.push([a, b, d, out], [a, d, c, out]);
      }
      prevStart = rowStart;
    }
    const ci = pos.length / 3;
    pos.push(cx, cy + sgn * h, cz);
    uv.push(0.5, 0.5);
    const tip = new V(0, sgn, 0);
    for (let j = 0; j < radialSegments; j++) {
      faces.push([ci, prevStart + j, prevStart + j + 1, tip]);
    }
  };
  if (capBottom) capOf(0, -1, false);
  if (capTop) capOf(layers, 1, true);

  let vote = 0;
  for (const [a, b, c, out] of faces) {
    const pa = new V(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const pb = new V(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const pc = new V(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    vote += Math.sign(n.dot(out));
  }
  const flip = vote < 0;
  const idx = [];
  for (const [a, b, c] of faces) {
    if (flip) idx.push(a, c, b);
    else idx.push(a, b, c);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* ───────────────────────── 截面工具 ───────────────────────── */

/** 超椭圆上的一点：|x/a|^n + |z/b|^n = 1 */
export function superellipse(a, b, n, ang) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const k = Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), -1 / n);
  return [ca * a * k, sa * b * k];
}

/**
 * 马蹄形（部分圆环）闭合截面——用于鼻甲、软骨环等"卷曲的壳"。
 * 返回闭合点列，可直接交给 sweepSection。
 */
export function horseshoeSection({
  rOuter = 0.6, rInner = 0.42, a0 = 0, a1 = Math.PI * 1.5,
  cx = 0, cy = 0, outerSteps = 14, innerSteps = 14, scallop = 0, scallopN = 1
}) {
  const outer = [], inner = [];
  for (let i = 0; i <= outerSteps; i++) {
    const a = a0 + (a1 - a0) * (i / outerSteps);
    const r = rOuter * (1 + scallop * Math.sin(a * scallopN));
    outer.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  for (let i = innerSteps; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / innerSteps);
    const r = rInner * (1 + scallop * Math.sin(a * scallopN));
    inner.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return outer.concat(inner);
}

/** 卵形/泪滴截面（上大下小），用于咽、食管等 */
export function teardropSection({ w = 1, h = 1, topFlat = 0.55, steps = 30 }) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = Math.pow(Math.pow(Math.abs(ca), 2.4) + Math.pow(Math.abs(sa), 2.4), -1 / 2.4);
    let x = ca * w * k;
    let y = sa * h * k;
    if (y > 0) y *= topFlat + (1 - topFlat) * (1 - Math.abs(ca));
    pts.push([x, y]);
  }
  return pts;
}

/* ───────────────────────── 回转体 ───────────────────────── */

/** profile: [[r,y], ...]，绕 Y 轴回转 */
export function lathe(profile, segments = 72, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)),
    segments,
    phiLength
  );
}

/** 绕任意轴回转：先绕 Y 回转再整体旋转（返回 geometry，未旋转，交给 mesh 旋转） */
export function latheAroundX(profile, segments = 72) {
  return lathe(profile, segments);
}

/* ───────────────────────── 软骨环（C 形环） ───────────────────────── */

/**
 * 在 XZ 平面生成一段圆弧环（用于气管软骨环等）。
 * 角度约定：0° = +X（右侧），90° = +Z（前方），270° = -Z（后方）。
 */
export function arcRing({
  y = 0,
  radius = 1.6,
  tubeR = 0.17,
  startDeg = -70,
  endDeg = 250,
  verticalScale = 0.78,
  cap = true,
  x = 0,
  z = 0
} = {}) {
  const a0 = THREE.MathUtils.degToRad(startDeg);
  const a1 = THREE.MathUtils.degToRad(endDeg);
  const steps = 8;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([x + radius * Math.cos(a), y, z + radius * Math.sin(a)]);
  }
  return loft({
    curve: curveFrom(pts, 0.5),
    radius: () => [tubeR, tubeR * verticalScale],
    tubularSegments: 96,
    radialSegments: 12,
    capStart: cap,
    capEnd: cap
  });
}

/* ───────────────────────── 骨板 / 软骨板挤出 ───────────────────────── */

/**
 * 由 2D 剖面挤出带轻微倒角的板状结构。
 * pts: [[x,y], ...] 闭合轮廓；thickness 沿局部 +Z 挤出
 */
export function plate(pts, thickness = 0.22, bevel = 0.06) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8
  });
  g.translate(0, 0, -thickness / 2);
  g.computeVertexNormals();
  return g;
}

/* ───────────────────────── 牙齿 ───────────────────────── */

/**
 * 牙冠 2D 轮廓（在 x–z 平面，z 为唇/颊侧正向）。
 * kind: 'incisor' | 'canine' | 'premolar' | 'molar'
 */
export function toothOutline(kind, w, d, samples = 30) {
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    let n = 2.6, ww = w, dd = d;
    if (kind === 'incisor') n = 3.2;
    if (kind === 'canine') n = 2.1;
    if (kind === 'premolar') n = 2.5;
    if (kind === 'molar') n = 2.3;
    const k = Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), -1 / n);
    let x = ca * ww * k;
    let z = sa * dd * k;
    // 磨牙：颊舌向稍宽、近远中向略收，并给出牙尖的微弱起伏
    if (kind === 'molar' || kind === 'premolar') {
      const f = 1 + 0.08 * Math.cos(2 * a);
      x *= f; z *= f;
    }
    // 切牙：切缘稍薄
    if (kind === 'incisor' && z > 0) z *= 0.9;
    pts.push([x, z]);
  }
  return pts;
}

/**
 * 由轮廓挤出牙冠。
 * 轮廓的 y 分量代表"深度"，映射到世界坐标的 -Z；height 沿 +Y 挤出。
 */
export function crownGeometry({ outline, height, bevel = 0.07 }) {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], -outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], -outline[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8
  });
  g.rotateX(-Math.PI / 2);   // 挤出方向 +Z → +Y；深度方向 y → -z
  g.computeVertexNormals();
  return g;
}

/** 牙根：由冠底向下收细的锥体 */
export function rootGeometry({ w, d, height, tip = 0.35, segments = 18, rings = 12 }) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const k = Math.pow(1 - t, 0.55);
    const sw = Math.max(0.02, w * (tip + (1 - tip) * k));
    const sd = Math.max(0.02, d * (tip + (1 - tip) * k));
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * sw, -height * t, Math.sin(a) * sd);
      uv.push(j / segments, t);
    }
  }
  const stride = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j, b = i * stride + j + 1;
      const c = (i + 1) * stride + j + 1, d = (i + 1) * stride + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ───────────────────────── 叶状轮廓（会厌） ───────────────────────── */

/** 叶状轮廓（会厌）——沿局部 Y 轴生长，x 为半宽 */
export function leafProfile({
  length = 2.6,
  halfWidth = 1.25,
  tipSharp = 0.55,
  samples = 26,
  waist = 0.42
} = {}) {
  const right = [];
  const left = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    // 最宽处偏上，下端（会厌柄）收窄
    const w = halfWidth * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.78)), tipSharp) *
      (waist + (1 - waist) * Math.min(1, u * 2.4));
    const y = -length / 2 + u * length;
    right.push([w, y]);
    left.push([-w, y]);
  }
  return right.concat(left.reverse());
}

/* ───────────────────────── 变形与噪声 ───────────────────────── */

/** 通用顶点变形：fn(x, y, z, normal) → [x, y, z] */
export function deform(geom, fn) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const p = new V();
  const n = new V();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    const [x, y, z] = fn(p.x, p.y, p.z, n);
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/** 多倍频正弦噪声，用于脑回样起伏 */
export function ripple(x, y, z, freq = 1.0, amp = 1.0) {
  return (
    amp *
    (0.62 * Math.sin(x * 1.35 * freq) * Math.sin(y * 1.1 * freq) * Math.sin(z * 1.5 * freq) +
      0.30 * Math.sin(x * 2.9 * freq + 1.3) * Math.sin(y * 2.4 * freq + 0.7) * Math.sin(z * 3.1 * freq + 2.1) +
      0.14 * Math.sin(x * 5.3 * freq + 0.4) * Math.sin(y * 4.7 * freq + 2.9) * Math.sin(z * 5.1 * freq + 1.1))
  );
}

/** 带脑回起伏的球体 */
export function rippledSphere(radius, detail = 5, { freq = 1.0, amp = 0.42, scale = [1, 1, 1] } = {}) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  deform(g, (x, y, z, n) => {
    const d = ripple(x, y, z, freq, amp);
    return [x + n.x * d, y + n.y * d, z + n.z * d];
  });
  g.scale(scale[0], scale[1], scale[2]);
  g.computeVertexNormals();
  return g;
}

/* ───────────────────────── 小工具 ───────────────────────── */

/** 生成椭球 */
export function ellipsoid(rx, ry, rz, seg = 40, rings = 28) {
  const g = new THREE.SphereGeometry(1, seg, rings);
  g.scale(rx, ry, rz);
  g.computeVertexNormals();
  return g;
}

/** 遍历 mesh，应用材质与 userData 结构 id */
export function tagStructure(group, id, material) {
  group.traverse(o => {
    if (o.isMesh) {
      o.material = material;
      o.userData.organId = id;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  group.userData.organId = id;
  return group;
}
