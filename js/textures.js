/**
 * textures.js — 程序化贴图工厂
 *
 * 全部用 canvas 逐像素运算现场生成，不引用任何外部图片，离线可用。
 * 提供：可平铺的各向异性 fbm 高度场 → normalMap / roughnessMap / 轻微色斑 map。
 *
 * 目的：让黏膜、肌肉、软骨、骨、腺体各自具备可辨识的微观质感，
 * 而不是一堆纯色的光滑管道。
 */
import * as THREE from '../vendor/three.module.js';

/* ═══════════════════ 确定性噪声 ═══════════════════ */

const mod = (n, p) => ((n % p) + p) % p;

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);

/** 可平铺值噪声（lattice 周期为 period 的整数格） */
function vnoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = mod(ix, period), y0 = mod(iy, period);
  const x1 = mod(ix + 1, period), y1 = mod(iy + 1, period);
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/**
 * 多倍频各向异性 fbm 高度场，归一化到 0..1。
 * aniso < 1 → 特征沿 Y 方向被拉长（肌纤维）；aniso > 1 → 沿 X 拉长。
 */
function fbmField(size, { seed = 1, scale = 8, octaves = 4, gain = 0.5, aniso = 1 } = {}) {
  const f = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  const steps = [];
  let freq = scale, amp = 1;
  for (let o = 0; o < octaves; o++) {
    steps.push({ f: Math.max(2, Math.round(freq)), a: amp });
    freq *= 2; amp *= gain;
  }
  const norm = steps.reduce((s, x) => s + x.a, 0);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let sum = 0;
      for (let o = 0; o < steps.length; o++) {
        const st = steps[o];
        sum += st.a * vnoise(u * st.f, v * st.f * aniso, st.f, seed + o * 131);
      }
      const val = sum / norm;
      f[y * size + x] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  const k = max > min ? 1 / (max - min) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - min) * k;
  return f;
}

/** 两场混合：out = a*(1-t) + b*t */
function mixField(a, b, t) {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] * (1 - t) + b[i] * t;
  return o;
}

/* ═══════════════════ 贴图生成 ═══════════════════ */

function newTexture(canvas, { srgb = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** 高度场 → 切线空间法线贴图（Sobel 差分） */
function normalTexture(field, size, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => field[mod(y, size) * size + mod(x, size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx, ny = -dy, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return newTexture(c);
}

/** 高度场 → 标量贴图（粗糙度）。lo/hi 为输出区间 */
function scalarTexture(field, size, lo, hi, gamma = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, n = size * size; i < n; i++) {
    const v = Math.pow(field[i], gamma);
    const g = Math.round(255 * (lo + (hi - lo) * v));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return newTexture(c);
}

/**
 * 高度场 → 极轻微色斑贴图（相对通道调制，乘在 material.color 上）。
 * tint 是"高值处偏向"的相对通道系数，例如 [1, 0.86, 0.88] 表示偏红。
 */
function mottleTexture(field, size, tint, amount) {
  if (!amount) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, n = size * size; i < n; i++) {
    const f = field[i] * amount;
    const i4 = i * 4;
    d[i4] = 255 * (1 - f * (1 - tint[0]));
    d[i4 + 1] = 255 * (1 - f * (1 - tint[1]));
    d[i4 + 2] = 255 * (1 - f * (1 - tint[2]));
    d[i4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return newTexture(c, { srgb: true });
}

/* ═══════════════════ 组织预设 ═══════════════════ */

/**
 * 各类组织的贴图参数。
 *  - scale/octaves  主纹理的频段
 *  - aniso          <1 沿 Y 拉长（肌纤维、纵行皱襞）
 *  - bump           法线强度
 *  - roughLo/Hi     粗糙度区间（越小越"湿"）
 *  - fine           叠加一层高频颗粒（黏膜腺窝、骨孔）
 */
const PRESETS = {
  /* 黏膜：细密颗粒 + 湿润光泽（鼻腔/口腔/咽/食管/声带） */
  mucosa: {
    size: 512, scale: 22, octaves: 4, aniso: 1, bump: 1.1,
    roughLo: 0.15, roughHi: 0.42,
    fine: { scale: 74, octaves: 2, fineMix: 0.45, bump: 1.5 },
    tint: [1.0, 0.88, 0.90], tintAmount: 0.30
  },
  /* 黏膜（纵行皱襞型：食管、咽后壁） */
  mucosaFolded: {
    size: 512, scale: 7, octaves: 3, aniso: 0.13, bump: 1.5,
    roughLo: 0.18, roughHi: 0.46,
    fine: { scale: 60, octaves: 2, fineMix: 0.30, bump: 1.2 },
    tint: [1.0, 0.90, 0.88], tintAmount: 0.26
  },
  /* 舌背：密集乳头颗粒 + 湿润 */
  tongueDorsum: {
    size: 512, scale: 46, octaves: 4, aniso: 1, bump: 1.6,
    roughLo: 0.13, roughHi: 0.36,
    fine: { scale: 120, octaves: 2, fineMix: 0.55, bump: 2.0 },
    tint: [1.0, 0.84, 0.86], tintAmount: 0.34
  },
  /* 骨骼肌：纤维束 + 细横纹 */
  muscle: {
    size: 512, scale: 6, octaves: 3, aniso: 0.11, bump: 1.9,
    roughLo: 0.34, roughHi: 0.62,
    fine: { scale: 90, octaves: 2, fineMix: 0.22, bump: 1.0 },
    tint: [1.0, 0.90, 0.88], tintAmount: 0.30
  },
  /* 透明软骨：细腻、微光 */
  cartilage: {
    size: 384, scale: 30, octaves: 4, aniso: 1, bump: 0.5,
    roughLo: 0.16, roughHi: 0.34,
    fine: { scale: 96, octaves: 2, fineMix: 0.35, bump: 0.7 },
    tint: [1.0, 0.98, 0.94], tintAmount: 0.14
  },
  /* 骨：粗孔 + 细纹 */
  bone: {
    size: 512, scale: 14, octaves: 5, aniso: 1, bump: 1.3,
    roughLo: 0.44, roughHi: 0.76,
    fine: { scale: 68, octaves: 3, fineMix: 0.4, bump: 1.2 },
    tint: [1.0, 0.98, 0.92], tintAmount: 0.20
  },
  /* 腺体：小叶状分叶（甲状腺） */
  gland: {
    size: 512, scale: 8, octaves: 3, aniso: 1, bump: 1.7,
    roughLo: 0.26, roughHi: 0.55,
    fine: { scale: 40, octaves: 2, fineMix: 0.3, bump: 0.9 },
    tint: [1.0, 0.90, 0.82], tintAmount: 0.30
  },
  /* 皮肤：细毛孔 + 皮纹 */
  skin: {
    size: 512, scale: 56, octaves: 4, aniso: 1, bump: 0.5,
    roughLo: 0.48, roughHi: 0.74,
    fine: { scale: 130, octaves: 2, fineMix: 0.4, bump: 0.6 },
    tint: [1.0, 0.95, 0.92], tintAmount: 0.16
  },
  /* 脑表面：脑膜血管纹理前的细斑 */
  brain: {
    size: 384, scale: 16, octaves: 4, aniso: 1, bump: 0.65,
    roughLo: 0.4, roughHi: 0.66,
    fine: { scale: 70, octaves: 2, fineMix: 0.35, bump: 0.8 },
    tint: [1.0, 0.90, 0.93], tintAmount: 0.22
  },
  /* 牙釉质 */
  tooth: {
    size: 256, scale: 34, octaves: 3, aniso: 1, bump: 0.35,
    roughLo: 0.10, roughHi: 0.26,
    fine: { scale: 80, octaves: 2, fineMix: 0.3, bump: 0.5 },
    tint: [1.0, 1.0, 0.97], tintAmount: 0.10
  }
};

const cache = new Map();

/** 取（并缓存）某类组织的贴图集合 */
export function getSurface(name) {
  if (cache.has(name)) return cache.get(name);
  const p = PRESETS[name] || PRESETS.mucosa;
  const { size } = p;

  let field = fbmField(size, { seed: name.length * 977 + 13, scale: p.scale, octaves: p.octaves, aniso: p.aniso });
  if (p.fine) {
    const fine = fbmField(size, { seed: name.length * 331 + 71, scale: p.fine.scale, octaves: p.fine.octaves, aniso: 1 });
    field = mixField(field, fine, p.fine.fineMix);
  }

  const out = {
    normalMap: normalTexture(field, size, p.bump),
    roughnessMap: scalarTexture(field, size, p.roughLo, p.roughHi),
    map: mottleTexture(field, size, p.tint, p.tintAmount),
    /** 建议的重复次数（按模型尺度约 6–14 单位周长估算） */
    repeat: 2.2
  };
  cache.set(name, out);
  return out;
}

/**
 * 把组织贴图应用到材质上。
 * @param {THREE.Material} mat
 * @param {string} name      PRESETS 键
 * @param {object} opts      { repeat, normalScale, roughness }
 */
export function dressMaterial(mat, name, opts = {}) {
  const s = getSurface(name);
  const repeat = opts.repeat ?? s.repeat;
  const clone = tex => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    return t;
  };
  mat.normalMap = clone(s.normalMap);
  mat.roughnessMap = clone(s.roughnessMap);
  if (s.map && opts.colorMap !== false) mat.map = clone(s.map);
  const ns = opts.normalScale ?? 1;
  mat.normalScale = new THREE.Vector2(ns, ns);
  if (opts.roughness !== undefined) mat.roughness = opts.roughness;
  mat.needsUpdate = true;
  return mat;
}
