/**
 * app.js — 头颈咽喉 3D 交互解剖：场景装配、交互、动画与界面
 */
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { buildAnatomy, headY, reliftY } from './anatomy.js';
import { createLabelLayer } from './labels.js';
import { ORGANS, ORG_BY_ID, GROUPS } from './data.js';
import { curveFrom } from './geo.js';

/* ═══════════════ DOM ═══════════════ */
const $ = id => document.getElementById(id);
const canvas = $('stage');
const appEl = $('app');
const overlay = $('overlay');
const tooltip = $('tooltip');
const loader = $('loader');
const hint = $('hint');
const structList = $('structList');
const detailScroll = $('detailScroll');
const detailPanel = $('detail');
const scopeCanvas = $('scope');
const scopeCtx = scopeCanvas.getContext('2d');

/* ═══════════════ 状态 ═══════════════ */
const S = {
  // 默认「完整」：先让人一眼认出这是一个头，而不是先看到被劈开的剖面。
  // 剖面是「想看清内部通道时」才切换的进阶视图。
  mode: 'solid',
  shell: 1.0,
  explode: 0,
  labels: true,
  theme: 'light',
  anim: null,              // 'breathing' | 'swallow' | 'voice'
  pitch: 132,
  selected: null,
  hovered: null,
  pointerDown: null,
  panMode: false
};

/* ═══════════════ 渲染器 / 场景 ═══════════════ */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  loader.classList.add('error');
  loader.querySelector('p').textContent = '无法创建 WebGL 上下文';
  loader.querySelector('.sub').textContent = '请使用最新版 Chrome / Edge / Firefox / Safari，并确认已启用硬件加速';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 800);

/* 环境光照贴图：程序化生成一张等距柱状图再 PMREM，让软骨/黏膜有通透感。
 *
 * ⚠ 本函数是「颅顶那圈贝雷帽」的真正病根所在，已重写。
 *
 * 旧版把「前上方柔亮斑」画在 canvas 的 (9, 26)，用的是 2D 画布坐标，没有换算
 * 成方向。按 three.js 的等距柱状采样约定反推：
 *     u = atan2(z, x)/(2π) + 0.5  →  方位角 = (u − 0.5)·360°
 *     v = asin(y)/π + 0.5
 * (9, 26) 换成方向是**方位角 −79°（左后方）**，而主光 d1 在 (24,36,30)、
 * 方位角 **+39°（右前方）**。两个亮源几乎背对，球面上必然夹出一条暗带 ——
 * 那圈「帽檐」就是这么来的：不是形体，也不是平行光的 N·L 截断，而是
 * **两个亮源之间的暗带**。
 *
 * 现在改成逐像素按方向生成：天空按 dir.y 给竖向梯度，主光斑与轮廓光斑
 * 分别用 dot(d, L)^n 直接画在各自的**真实方向**上。于是球面上只有一个
 * 主亮斑，明暗过渡连续，不再有夹出来的暗带。
 */
function makeEnvironment() {
  const W = 128, H = 64;                      // 逐像素生成，分辨率给足
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const px = img.data;

  // 与三盏平行光严格同向（下面 lights 里用的是同一组坐标）
  const KEY = new THREE.Vector3(24, 36, 30).normalize();
  const RIM = new THREE.Vector3(-6, 20, -36).normalize();

  // 天空：天顶近白、地平线中灰、底下压暗。三段平滑插值。
  const SKY = [[244, 247, 251], [176, 190, 205], [62, 70, 82]];
  const skyAt = (t) => {                       // t = 0(底) → 1(顶)
    const s = t < 0.5 ? 0 : 1;
    const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const a = SKY[s], b = SKY[s + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  };

  const d = new THREE.Vector3();
  for (let iy = 0; iy < H; iy++) {
    const v = 1 - (iy + 0.5) / H;              // canvas 顶行 → v = 1（flipY）
    const sinLat = Math.sin((v - 0.5) * Math.PI);
    const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
    for (let ix = 0; ix < W; ix++) {
      const u = (ix + 0.5) / W;
      const lon = (u - 0.5) * Math.PI * 2;
      d.set(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
      const sky = skyAt((sinLat + 1) / 2);
      // 主光斑：与 d1 同向。指数 8 → 约 ±40° 的柔亮区，边缘连续
      const k1 = Math.pow(Math.max(0, d.dot(KEY)), 8);
      // 轮廓光斑：与 d3 同向，弱一档
      const k2 = Math.pow(Math.max(0, d.dot(RIM)), 6) * 0.45;
      const add = k1 + k2;
      const o = (iy * W + ix) * 4;
      px[o]     = Math.min(255, sky[0] * (1 - add) + 255 * add);
      px[o + 1] = Math.min(255, sky[1] * (1 - add) + 250 * add);
      px[o + 2] = Math.min(255, sky[2] * (1 - add) + 240 * add);
      px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
scene.environment = makeEnvironment();
/* 环境光强度：给到 0.85 让暗部不从 0 起步（明暗交界才化得开），
   但不再像 0.95 那样把形体的转折照平。 */
if ('environmentIntensity' in scene) scene.environmentIntensity = 0.85;

const lights = new THREE.Group();
scene.add(lights);
/* 雕塑布光：低环境光 + 强主光 + 弱补光 + 后方轮廓光。
   关键是**只留一个主亮源**：环境贴图的主光斑（见 makeEnvironment）与 d1 同向，
   三者不再是三个各照各的光，形体的明暗交界线才读得出来 —— 雕塑靠明暗读体积。 */
lights.add(new THREE.AmbientLight(0xffffff, 0.10));
lights.add(new THREE.HemisphereLight(0xeef4ff, 0x94a2b2, 0.30));
{
  // 主光：右上前方，负责塑造主要明暗与投影
  const d1 = new THREE.DirectionalLight(0xfff6ec, 2.10); d1.position.set(24, 36, 30); lights.add(d1);
  // 补光：左后方，弱，只把暗部提起来一点，不能压掉明暗交界
  const d2 = new THREE.DirectionalLight(0xd2e2ff, 0.35); d2.position.set(-30, 10, -18); lights.add(d2);
  // 轮廓光：脑后偏上，勾出颅顶与颈后的边缘线
  const d3 = new THREE.DirectionalLight(0xffffff, 0.60); d3.position.set(-6, 20, -36); lights.add(d3);
}

/* 剖面裁剪平面：切掉 +X 一侧 */
const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.0);

/* ═══════════════ 模型 ═══════════════ */
const __tBuild = performance.now();
const { root, organs, order, anim, issues } = buildAnatomy(scene);
const buildMs = Math.round(performance.now() - __tBuild);

/* 拾取网格表 */
const pickables = [];
const meshOwner = new Map();
organs.forEach(o => {
  (o.meshes || []).forEach(m => {
    if (m.isMesh && m.geometry) { pickables.push(m); meshOwner.set(m, o.def.id); }
  });
});
/**
 * 拾取优先级：数值越大越优先。
 *   -1 皮肤：完全不参与拾取（否则整颗头挡在最前面，什么都点不到里层）
 *    0 外壳层（颅骨 / 下颌骨 / 咽 / 颈椎）与「覆盖层」（咽喉肌群）
 *      —— 允许点穿它们，直接选到里面的器官
 *    1 其它具体器官
 * 肌群必须放在 0：它是一大片半透明的覆盖层，若按「谁近谁赢」，
 * 气管、甲状腺会被它挡住，点什么都只能点到肌群。
 */
const priorityOf = id => {
  if (id === 'skin') return -1;
  const d = ORG_BY_ID[id];
  return d.shell || d.cover ? 0 : 1;
};

/* ═══════════════ 气道粒子 / 食团 ═══════════════ */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 气流 / 食团的路径控制点也是按「作者世界坐标」写的，模型整体纵向重映射过，
   这些曲线必须跟着搬一遍，否则气流会从鼻孔下方穿出来。 */
const liftCurve = arr => arr.map(([x, y, z]) => [x, reliftY(y), z]);

const AIRWAY = curveFrom(liftCurve([
  [0.85, 10.28, 9.10], [1.05, 10.45, 7.00], [1.20, 10.56, 4.60],
  [1.32, 10.60, 2.20], [1.15, 10.70, 0.20], [0.60, 10.95, -1.60],
  [0.00, 11.05, -2.55], [0.00, 10.20, -2.62], [0.00, 8.20, -2.78],
  [0.00, 6.20, -2.80], [0.00, 4.60, -2.60], [0.00, 3.70, -1.80],
  [0.00, 3.30, -0.40], [0.00, 3.05, 0.85], [0.00, 2.40, 0.80],
  [0.00, 0.00, 0.72], [0.00, -3.50, 0.64], [0.00, -7.00, 0.52]
]), 0.5);

const SWALLOW_PATH = curveFrom(liftCurve([
  [0, 7.10, 5.60], [0, 7.15, 3.60], [0, 7.05, 1.60],
  [0, 6.70, -0.40], [0, 6.00, -2.00], [0, 4.80, -2.55],
  [0, 3.30, -2.45], [0, 1.60, -2.15], [0, -1.00, -1.92],
  [0, -3.80, -1.72], [0, -6.60, -1.58]
]), 0.5);

const AIR_COUNT = 220;
const airGeom = new THREE.BufferGeometry();
const airPos = new Float32Array(AIR_COUNT * 3);
const airCol = new Float32Array(AIR_COUNT * 3);
const airPhase = new Float32Array(AIR_COUNT);
const airJitter = new Float32Array(AIR_COUNT * 3);
for (let i = 0; i < AIR_COUNT; i++) {
  airPhase[i] = (i / AIR_COUNT) * 1.0;
  airJitter[i * 3] = (Math.random() - 0.5) * 0.52;
  airJitter[i * 3 + 1] = (Math.random() - 0.5) * 0.34;
  airJitter[i * 3 + 2] = (Math.random() - 0.5) * 0.52;
}
airGeom.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
airGeom.setAttribute('color', new THREE.BufferAttribute(airCol, 3));
const airMat = new THREE.PointsMaterial({
  size: 0.5, map: dotTexture(), vertexColors: true, transparent: true,
  opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
});
const airPoints = new THREE.Points(airGeom, airMat);
airPoints.frustumCulled = false;
airPoints.renderOrder = 40;
scene.add(airPoints);

const bolus = new THREE.Mesh(
  new THREE.SphereGeometry(0.62, 20, 16),
  new THREE.MeshStandardMaterial({ color: 0xf0c27a, roughness: 0.55, metalness: 0.02, transparent: true, opacity: 0.92 })
);
bolus.visible = false;
bolus.renderOrder = 41;
scene.add(bolus);

/* ═══════════════ 相机与控制器 ═══════════════ */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 9;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI * 0.96;
controls.rotateSpeed = 0.9;
controls.zoomSpeed = 0.85;
controls.panSpeed = 1.35;
controls.screenSpacePanning = true;      // 平移与屏幕平行，拖拽方向和内容 1:1 跟手
controls.target.set(0, reliftY(7.0), 0);

/**
 * 鼠标 / 触控板手势。
 *
 * 触控板上「右键」其实是双指点按，按下去很难继续拖动，所以除了右键之外
 * 必须再给几条更容易触发的平移通路：
 *   · 中键拖拽                     → 平移（鼠标用户最快）
 *   · Shift / Ctrl / Cmd + 左键拖拽 → 平移（OrbitControls 内置行为，触控板最顺手）
 *   · 空格按住                      → 临时平移（抓手工具，松手复原）
 *   · ✋ 平移按钮 / P 键            → 切换成「左键拖拽平移」模式
 *   · 触屏双指拖动                  → 平移
 */
const MOUSE_DEFAULT = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
const MOUSE_PAN = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

/** 触屏：单指旋转，双指捏合缩放 + 拖动平移（DOLLY_PAN 两者同时可用） */
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
function setPanMode(on) {
  S.panMode = !!on;
  controls.mouseButtons = S.panMode ? MOUSE_PAN : MOUSE_DEFAULT;
  const btn = $('panBtn');
  if (btn) {
    btn.classList.toggle('on', S.panMode);
    btn.textContent = S.panMode ? '✋ 平移中…' : '✋ 拖拽平移';
  }
  document.body.classList.toggle('pan-mode', S.panMode);
}
setPanMode(false);

/**
 * 右键菜单必须彻底屏蔽。
 * OrbitControls 只在 canvas 上拦 contextmenu，一旦光标落在顶栏 / 底部控制台 / 侧边栏上
 * 右键，系统菜单照样弹出来盖住画面，右键拖拽平移就"看起来失效"了。
 * 所以在整个 .app 上兜底拦截，保证任何位置右键都是纯手势。
 */
appEl.addEventListener('contextmenu', e => e.preventDefault());

const VIEWS = {
  // fit 是「需要装进画面的模型尺寸」，调紧一点让头颈填满画面、少留白
  iso: { pos: [30, 14.5, 27], target: [0, 6.6, 0], fit: [23, 32] },
  front: { pos: [0.01, 8.0, 60], target: [0, 8.0, 0], fit: [23, 33] },
  sagittal: { pos: [58, 8.0, 1.2], target: [0, 8.0, 0], fit: [23, 33] },
  top: { pos: [0.5, 62, 5], target: [0, 8.0, 0], fit: [23, 27] },
  larynx: { pos: [16, 6.5, 16], target: [0, 3.2, 0.6] }
};

/** 让给定尺寸（宽 × 高，模型单位）在「真正可见区域」内取全所需的相机距离 */
function fitDistance(w, h, margin = 1.16) {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // 小屏：下半屏被详情面板占用，可用高度只有一半左右
  const usable = appEl.clientWidth <= 960 ? 0.50 : 1.0;
  return Math.max(h / 2 / tan, w / 2 / (tan * Math.max(0.2, camera.aspect))) * margin / usable;
}

let tween = null;
function flyTo(pos, target, dur = 0.78) {
  tween = {
    t0: performance.now(),
    dur: dur * 1000,
    p0: camera.position.clone(), p1: new THREE.Vector3(pos[0], pos[1], pos[2]),
    t0v: controls.target.clone(), t1v: new THREE.Vector3(target[0], target[1], target[2])
  };
}
function setView(name) {
  const v = VIEWS[name];
  if (!v) return;
  const tgt = new THREE.Vector3(v.target[0], reliftY(v.target[1]), v.target[2]);
  const dir = new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]).sub(tgt);
  const len = dir.length();
  const d = v.fit ? Math.max(len, fitDistance(v.fit[0], v.fit[1])) : len;
  dir.setLength(d);
  const p = tgt.clone().add(dir);
  flyTo([p.x, p.y, p.z], v.target);
  [...$('viewset').children].forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function easeCam(dt) {
  if (!tween) return;
  const k = Math.min(1, (performance.now() - tween.t0) / tween.dur);
  const e = easeInOut(k);
  camera.position.lerpVectors(tween.p0, tween.p1, e);
  controls.target.lerpVectors(tween.t0v, tween.t1v, e);
  if (k >= 1) tween = null;
}

function focusOrgan(id) {
  const o = organs.get(id);
  if (!o) return;
  const d = fitDistance(o.radius * 2, o.radius * 2, 1.2);
  const dist = THREE.MathUtils.clamp(d, 13, 130);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() < 0.01) dir.set(0.7, 0.25, 0.66).normalize();
  const pos = o.center.clone().addScaledVector(dir, dist);
  pos.y = Math.max(pos.y, 3);
  flyTo([pos.x, pos.y, pos.z], [o.center.x, o.center.y, o.center.z]);
}

/* ═══════════════ 标注层 ═══════════════ */
const labelLayer = createLabelLayer(overlay, camera);
/* 标注锚点写在 data.js 里，用的是「作者世界坐标」；模型做过纵向重映射，
   锚点必须跟着搬一遍，否则标注会整体偏低。 */
const LABEL_ANCHORS = new Map(
  ORGANS.map(o => [o.id, new THREE.Vector3(o.anchor[0], reliftY(o.anchor[1]), o.anchor[2])])
);
function cssColor(id) {
  const hex = ORG_BY_ID[id].color.toString(16).padStart(6, '0');
  return '#' + hex;
}
/** 小屏空间有限，默认只标注贯穿「头→咽喉」的核心链路 */
const MOBILE_LABELS = ['skull', 'brain', 'nasalCavity', 'conchae', 'palate', 'teethGums',
  'tongue', 'pharynx', 'epiglottis', 'vocalCords', 'trachea', 'thyroidGland'];

function labeledIds() {
  if (!S.labels) return [];
  const visible = new Set();
  organs.forEach((o, id) => {
    if (o.rig.outer.visible !== false) visible.add(id);
  });
  let list = order.filter(id => {
    if (!visible.has(id)) return false;
    if (S.mode !== 'solid' && ORG_BY_ID[id].shell && id === 'skin') return false;
    return true;
  });
  if (S.selected) return list.filter(id => id === S.selected);
  if (appEl.clientWidth <= 960) list = list.filter(id => MOBILE_LABELS.includes(id));
  return list;
}

/** 标注可用的安全区：避开左右面板、顶栏与底部控制台 */
function labelBounds() {
  const W = appEl.clientWidth, H = appEl.clientHeight;
  const mobile = W <= 960;
  let left = 14, right = W - 14;
  if (!mobile) {
    const sb = $('sidebar').getBoundingClientRect();
    const dp = detailPanel.getBoundingClientRect();
    if (sb.width > 0 && sb.right < W * 0.5) left = sb.right + 10;
    if (dp.width > 0 && dp.left > W * 0.5) right = dp.left - 10;
  }
  const top = document.querySelector('.topbar').getBoundingClientRect().bottom + 8;
  const dockTop = $('dock').getBoundingClientRect().top;
  const bottom = Math.min(H - 14, (dockTop > 100 ? dockTop - 8 : H - 14));
  return { left, right, top, bottom };
}

/* ═══════════════ 高亮 ═══════════════ */
const hiState = new Map();   // id → 当前高亮强度
function updateHighlight(dt) {
  const speed = Math.min(1, dt * 11);
  organs.forEach((o, id) => {
    const target = id === S.selected ? 1 : id === S.hovered ? 0.55 : 0;
    const cur = hiState.get(id) || 0;
    const v = cur + (target - cur) * speed;
    hiState.set(id, v);
    (o.materials || []).forEach(m => {
      m.emissiveIntensity = v * 0.75;
      const base = m.userData.baseOpacity ?? 1;
      if (m.transparent) {
        m.opacity = Math.min(0.96, base * (1 + v * 0.62)) * (o.def.shell ? S.shell : 1);
      }
    });
  });
}

/* ═══════════════ 模式 / 外观 ═══════════════ */
function applyMode() {
  organs.forEach((o, id) => {
    const isShell = !!o.def.shell;
    (o.materials || []).forEach(m => {
      m.wireframe = S.mode === 'wire';
      const clip = S.mode === 'wire' || S.mode === 'section';
      m.clippingPlanes = clip && isShell ? [clipPlane] : [];
      if (S.mode === 'wire' && isShell) {
        m.transparent = true;
        m.opacity = Math.min(0.42, (m.userData.baseOpacity ?? 1) * 2.4);
        m.depthWrite = false;
      }
      m.needsUpdate = true;
    });
  });
  labelLayer.clear();
}

function applyExplode() {
  organs.forEach((o, id) => {
    const d = o.def.explode || [0, 0, 0];
    o.rig.outer.position.set(d[0] * S.explode, d[1] * S.explode, d[2] * S.explode);
  });
}

/* ═══════════════ 交互：拾取 ═══════════════ */
const ray = new THREE.Raycaster();
ray.params.Points.threshold = 0.6;
const ndc = new THREE.Vector2();

function pickAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables, false);
  if (!hits.length) return null;
  let best = null;
  for (const h of hits) {
    const id = h.object.userData.organId || meshOwner.get(h.object);
    if (!id) continue;
    const p = priorityOf(id);
    if (p < 0) continue;                     // 皮肤不参与拾取
    if (!best || p > best.p || (p === best.p && h.distance < best.d)) {
      best = { id, p, d: h.distance, point: h.point };
    }
  }
  return best;
}

canvas.addEventListener('pointermove', ev => {
  if (ev.buttons) {
    tooltip.classList.remove('on');
    if (S.hovered) { S.hovered = null; }
    return;
  }
  const hit = pickAt(ev.clientX, ev.clientY);
  const id = hit ? hit.id : null;
  if (id !== S.hovered) S.hovered = id;

  if (id) {
    const def = ORG_BY_ID[id];
    tooltip.innerHTML = `${def.name}<small>${def.en}</small>`;
    tooltip.style.left = ev.clientX + 'px';
    tooltip.style.top = ev.clientY + 'px';
    tooltip.classList.add('on');
    canvas.classList.add('pickable');
  } else {
    tooltip.classList.remove('on');
    canvas.classList.remove('pickable');
  }
});

canvas.addEventListener('pointerleave', () => {
  tooltip.classList.remove('on');
  S.hovered = null;
});

canvas.addEventListener('pointerdown', ev => {
  S.pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false };
  canvas.classList.add('grabbing');
});
canvas.addEventListener('pointermove', ev => {
  if (S.pointerDown && !S.pointerDown.moved) {
    const dx = ev.clientX - S.pointerDown.x, dy = ev.clientY - S.pointerDown.y;
    if (dx * dx + dy * dy > 37) S.pointerDown.moved = true;
  }
});
window.addEventListener('pointerup', ev => {
  canvas.classList.remove('grabbing');
  const pd = S.pointerDown;
  S.pointerDown = null;
  // 只有左键"点击"才做选中：右键/中键用于平移与缩放，不应触发选择
  if (ev.button !== 0) return;
  if (!pd || pd.moved || performance.now() - pd.t > 500) return;
  const hit = pickAt(ev.clientX, ev.clientY);
  if (hit) { select(hit.id, ev.clientX, ev.clientY); }
  else if (S.selected) select(null);
});

/* ═══════════════ 选择 ═══════════════ */
function select(id, x, y) {
  S.selected = id;
  renderDetail(id);
  renderList();
  if (id && x !== undefined) {
    // 点击 3D 结构：只做轻微聚焦，不打断浏览（小屏不自动移镜，避免被面板遮挡）
    const o = organs.get(id);
    if (o && window.innerWidth > 960) {
      const dist = THREE.MathUtils.clamp(fitDistance(o.radius * 2.4, o.radius * 2.4, 1.0), 16, 110);
      const dir = camera.position.clone().sub(controls.target).normalize();
      const pos = o.center.clone().addScaledVector(dir, dist);
      flyTo([pos.x, Math.max(pos.y, 4), pos.z], [o.center.x, o.center.y, o.center.z], 0.62);
    }
  }
  if (id) {
    const def = ORG_BY_ID[id];
    tooltip.innerHTML = `${def.name}<small>${def.en}</small>`;
    tooltip.classList.add('on');
  }
  labelLayer.clear();
}

/* ═══════════════ 界面：结构目录 ═══════════════ */
function renderList() {
  structList.innerHTML = '';
  GROUPS.forEach(g => {
    const items = ORGANS.filter(o => o.group === g.id);
    if (!items.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'grp';

    const head = document.createElement('button');
    head.className = 'grp-head';
    head.innerHTML = `<span>${g.icon}</span><span>${g.name}</span>
      <span class="chev">▾</span>`;
    head.onclick = () => wrap.classList.toggle('closed');
    wrap.appendChild(head);

    const box = document.createElement('div');
    box.className = 'grp-items';
    items.forEach(o => {
      const el = document.createElement('div');
      el.className = 'item' + (S.selected === o.id ? ' on' : '');
      el.dataset.id = o.id;
      el.innerHTML = `
        <span class="dot" style="background:${cssColor(o.id)}"></span>
        <span class="txt"><span class="nm">${o.name}</span><span class="en">${o.en}</span></span>
        <span class="badge">${o.shell ? '外壳' : '内部'}</span>`;
      el.onclick = () => { select(o.id); focusOrgan(o.id); };
      el.onmouseenter = () => { S.hovered = o.id; };
      el.onmouseleave = () => { if (S.hovered === o.id) S.hovered = null; };
      box.appendChild(el);
    });
    wrap.appendChild(box);
    structList.appendChild(wrap);
  });
  $('structCount').textContent = `${ORGANS.length} 组`;
}

/* ═══════════════ 界面：详情卡 ═══════════════ */
function renderDetail(id) {
  const o = id ? organs.get(id) : null;
  if (!o) {
    $('detailCount').textContent = '';
    detailScroll.innerHTML = `
      <div class="dp-head">
        <div class="dp-headtxt">
          <h2>交互指南</h2>
          <div class="en">Head ⇢ Throat · Interactive Atlas</div>
        </div>
      </div>
      <div class="dp-empty">
        <p>这是一个从上往下贯穿的呼吸–消化通道模型，共 ${ORGANS.length} 组结构。</p>
        <ul>
          <li><kbd>左键拖拽</kbd> 旋转 · <kbd>滚轮</kbd> 缩放</li>
          <li><kbd>拖拽画面</kbd>（触控板推荐）：点底部 <kbd>✋ 拖拽平移</kbd> 按钮后用左键拖，或直接 <kbd>Shift+左键拖</kbd>、<kbd>中键拖</kbd>、<kbd>右键拖</kbd>；按住 <kbd>空格</kbd> 也可临时平移</li>
          <li><kbd>触屏</kbd> 单指旋转 · 双指捏合缩放 / 拖动平移</li>
          <li><kbd>点击结构</kbd> 查看解剖要点，自动聚焦</li>
          <li><kbd>剖面</kbd> 沿正中矢状面切开，看内部通道</li>
          <li><kbd>爆炸</kbd> 把各层结构沿各自方向拉开</li>
          <li><kbd>呼吸 / 吞咽 / 发声</kbd> 三种生理动画</li>
          <li>键盘：<kbd>L</kbd> 标注 · <kbd>P</kbd> 平移 · <kbd>B</kbd> 呼吸 · <kbd>S</kbd> 吞咽 · <kbd>V</kbd> 发声 · <kbd>R</kbd> 重置</li>
        </ul>
        <p style="margin-top:12px;color:var(--text-faint);font-size:11.5px">
          提示：先从左侧目录点「咽」「喉」开始，再打开吞咽动画，能看清气道是怎么被保护的。
        </p>
      </div>`;
    return;
  }
  const def = o.def;
  const g = GROUPS.find(x => x.id === def.group);
  $('detailCount').textContent = `${order.indexOf(id) + 1} / ${ORGANS.length}`;
  detailScroll.innerHTML = `
    <div class="dp-head">
      <span class="dot" style="background:${cssColor(id)}"></span>
      <div>
        <h2>${def.name}</h2>
        <div class="en">${def.en}</div>
      </div>
    </div>
    <div class="detail-body">
      <div class="dp-chips">
        <span class="chip">${g ? g.icon + ' ' + g.name : ''}</span>
        <span class="chip warn">${def.shell ? '外壳层 · 参与剖面' : '内部结构'}</span>
      </div>
      <div class="dp-row"><div class="k">位置</div><div class="v">${def.info.position}</div></div>
      <div class="dp-row"><div class="k">功能</div><div class="v">${def.info.func}</div></div>
      <div class="dp-row"><div class="k">临床</div><div class="v">${def.info.clinical}</div></div>
      <div class="dp-actions">
        <button class="btn ghost" id="focusBtn">聚焦此结构</button>
        <button class="btn ghost" id="hideBtn">${o.rig.outer.visible ? '暂时隐藏' : '恢复显示'}</button>
        <button class="btn ghost" id="clearBtn">取消选择</button>
      </div>
    </div>`;
  $('focusBtn').onclick = () => focusOrgan(id);
  $('hideBtn').onclick = () => {
    o.rig.outer.visible = !o.rig.outer.visible;
    labelLayer.clear();
    renderDetail(id);
  };
  $('clearBtn').onclick = () => select(null);
}

/* ═══════════════ 动画 ═══════════════ */
let animT = 0;
let swallowClock = 0;
let voicePhase = 0;

function setAnim(name) {
  S.anim = S.anim === name ? null : name;
  [...$('animSet').children].forEach(b => b.classList.toggle('on', b.dataset.anim === S.anim));
  $('pitchRange').disabled = S.anim !== 'voice';
  if (S.anim !== 'swallow') resetSwallow();
  if (S.anim !== 'voice') resetVoice();
}

function resetSwallow() {
  anim.epiglottisRig.rotation.x = 0;
  anim.softPalateRig.rotation.x = 0;
  anim.tongueRig.rotation.x = 0;
  anim.larynxRig.position.set(0, 0, 0);
  anim.foldPivots.forEach(p => { p.rotation.y = 0; });
  bolus.visible = false;
  if (anim.esophagusMesh) {
    anim.esophagusMesh.geometry.attributes.position.array.set(anim.esophagusBase);
    anim.esophagusMesh.geometry.attributes.position.needsUpdate = true;
    anim.esophagusMesh.geometry.computeVertexNormals();
  }
}
function resetVoice() {
  anim.foldPivots.forEach(p => { p.rotation.y = 0; });
  anim.glottisGlow.opacity = 0;
}

const bump = (p, a, b) => {
  if (p < a || p > b) return 0;
  return Math.pow(Math.sin(Math.PI * ((p - a) / (b - a))), 0.75);
};

function updateAnimations(dt, time) {
  /* —— 粒子 —— */
  const showAir = S.anim === 'breathing' || S.anim === 'voice';
  const targetOpacity = showAir ? 1 : 0;
  airMat.opacity += (targetOpacity - airMat.opacity) * Math.min(1, dt * 4);
  if (airMat.opacity > 0.01) {
    const dir = S.anim === 'voice' ? -1 : 1;
    const speed = S.anim === 'voice' ? 0.34 : 0.12;
    animT = (animT + dt * speed * dir + 1) % 1;
    const col = new THREE.Color(S.anim === 'voice' ? 0x8ff0ff : 0x9fe4ff);
    for (let i = 0; i < AIR_COUNT; i++) {
      let u = (airPhase[i] + animT) % 1;
      if (u < 0) u += 1;
      const p = AIRWAY.getPointAt(u);
      airPos[i * 3] = p.x + airJitter[i * 3];
      airPos[i * 3 + 1] = p.y + airJitter[i * 3 + 1];
      airPos[i * 3 + 2] = p.z + airJitter[i * 3 + 2];
      // 两端淡入淡出
      const fade = Math.min(1, Math.min(u, 1 - u) / 0.09);
      const k = fade * fade * (S.anim === 'voice' ? 1.25 : 1);
      airCol[i * 3] = col.r * k;
      airCol[i * 3 + 1] = col.g * k;
      airCol[i * 3 + 2] = col.b * k;
    }
    airGeom.attributes.position.needsUpdate = true;
    airGeom.attributes.color.needsUpdate = true;
  }

  /* —— 呼吸：气管随呼吸轻微扩张 —— */
  if (S.anim === 'breathing') {
    const br = Math.sin(time * 2 * Math.PI * 0.26);
    const sc = 1 + 0.035 * br;
    if (anim.tracheaRig) anim.tracheaRig.scale.set(sc, 1, sc);
  } else if (anim.tracheaRig && anim.tracheaRig.scale.x !== 1) {
    anim.tracheaRig.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 5));
  }

  /* —— 吞咽 —— */
  if (S.anim === 'swallow') {
    swallowClock = (swallowClock + dt / 2.9) % 1;
    const s = bump(swallowClock, 0.08, 0.72);
    anim.epiglottisRig.rotation.x = 1.05 * s;
    anim.softPalateRig.rotation.x = 0.42 * s;
    anim.tongueRig.rotation.x = -0.20 * s;   // 枢轴在舌根：负角 = 舌尖上抬后送
    anim.larynxRig.position.y = 0.9 * s;
    anim.larynxRig.position.z = 0.28 * s;
    anim.foldPivots.forEach((p, i) => { p.rotation.y = (i === 0 ? -1 : 1) * 0.11 * s; });

    // 食团
    const bu = (swallowClock - 0.10) / 0.66;
    if (bu > 0 && bu < 1) {
      const p = SWALLOW_PATH.getPointAt(Math.min(1, bu));
      bolus.visible = true;
      bolus.position.copy(p);
      const sc = 0.75 + 0.35 * Math.sin(Math.PI * bu);
      bolus.scale.set(sc, sc * 0.8, sc * 1.25);
    } else bolus.visible = false;

    // 食管蠕动波
    if (anim.esophagusMesh) {
      const yc = 3.4 - swallowClock * 12.5;
      const pos = anim.esophagusMesh.geometry.attributes.position;
      const base = anim.esophagusBase;
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
        const d = by - yc;
        const k = Math.exp(-(d * d) / 0.62) * 0.30 + 0.02;
        const zc = -1.55 - 0.0833 * (by + 7.4);
        const dx = bx, dz = bz - zc;
        pos.setXYZ(i, bx * (1 + k), by, zc + dz * (1 + k));
      }
      pos.needsUpdate = true;
      anim.esophagusMesh.geometry.computeVertexNormals();
    }
  }

  /* —— 发声 —— */
  if (S.anim === 'voice') {
    const visibleRate = Math.min(S.pitch, 18);       // 视觉上用可见频率表现振动
    voicePhase += dt * visibleRate * 2 * Math.PI;
    const amp = 0.075;
    anim.foldPivots.forEach((p, i) => {
      p.rotation.y = (i === 0 ? -1 : 1) * (0.055 + amp * 0.6 * Math.sin(voicePhase));
    });
    anim.glottisGlow.opacity = 0.18 + 0.34 * Math.max(0, Math.sin(voicePhase));
    if (anim.glottisGlow.opacity > 0.01) anim.glottisGlow.opacity *= 1.0;
  }
}

/* ═══════════════ 示波器 ═══════════════ */
function drawScope(time) {
  const W = scopeCanvas.width, H = scopeCanvas.height;
  scopeCtx.clearRect(0, 0, W, H);
  const dark = S.theme === 'dark';
  scopeCtx.strokeStyle = dark ? 'rgba(160,190,215,0.28)' : 'rgba(60,90,120,0.20)';
  scopeCtx.lineWidth = 1;
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, H / 2); scopeCtx.lineTo(W, H / 2);
  scopeCtx.stroke();

  const active = S.anim === 'voice';
  const f0 = S.pitch;
  const win = 0.023;
  const t0 = active ? time : 0;
  scopeCtx.beginPath();
  for (let i = 0; i <= W; i++) {
    const tt = t0 + (i / W) * win;
    const ph = (tt * f0) % 1;
    const v =
      0.66 * Math.exp(-ph * 3.4) * Math.sin(2 * Math.PI * ph + 1.15) +
      0.28 * Math.exp(-ph * 6.0) * Math.sin(4 * Math.PI * ph + 0.4) +
      0.13 * Math.exp(-ph * 9.5) * Math.sin(6 * Math.PI * ph);
    const x = i;
    const y = H / 2 - v * (H * 0.36);
    if (i === 0) scopeCtx.moveTo(x, y); else scopeCtx.lineTo(x, y);
  }
  scopeCtx.strokeStyle = active
    ? (dark ? '#3fd0e6' : '#0c7f95')
    : (dark ? 'rgba(120,150,175,0.5)' : 'rgba(120,140,160,0.45)');
  scopeCtx.lineWidth = 2;
  scopeCtx.lineJoin = 'round';
  scopeCtx.stroke();
}

/* ═══════════════ 界面绑定 ═══════════════ */
$('viewset').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
$('modeSet').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  S.mode = b.dataset.mode;
  [...$('modeSet').children].forEach(x => x.classList.toggle('on', x === b));
  applyMode();
});
$('animSet').addEventListener('click', e => {
  const b = e.target.closest('button[data-anim]');
  if (b) setAnim(b.dataset.anim);
});
$('shellRange').addEventListener('input', e => {
  S.shell = +e.target.value / 100;
  $('shellVal').textContent = e.target.value + '%';
});
$('explodeRange').addEventListener('input', e => {
  S.explode = +e.target.value / 100 * 0.85;
  $('explodeVal').textContent = e.target.value + '%';
  applyExplode();
  labelLayer.clear();
});
$('pitchRange').addEventListener('input', e => {
  S.pitch = +e.target.value;
  $('pitchVal').textContent = S.pitch + 'Hz';
});
$('labelBtn').addEventListener('click', e => {
  S.labels = !S.labels;
  e.target.classList.toggle('on', S.labels);
  if (!S.labels) labelLayer.clear();
});
$('resetBtn').addEventListener('click', () => resetAll());
$('themeBtn').addEventListener('click', e => {
  S.theme = S.theme === 'light' ? 'dark' : 'light';
  document.body.classList.toggle('dark', S.theme === 'dark');
  e.target.textContent = S.theme === 'dark' ? '浅色' : '深色';
});
$('navBtn').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
});
$('panBtn').addEventListener('click', () => setPanMode(!S.panMode));

function resetAll() {
  setAnim(null);
  S.mode = 'solid'; S.shell = 1; S.explode = 0; S.labels = true;
  S.selected = null; S.hovered = null;
  $('shellRange').value = 100; $('shellVal').textContent = '100%';
  $('explodeRange').value = 0; $('explodeVal').textContent = '0%';
  $('pitchRange').value = 132; $('pitchVal').textContent = '132Hz';
  S.pitch = 132;
  [...$('modeSet').children].forEach(x => x.classList.toggle('on', x.dataset.mode === 'solid'));
  $('labelBtn').classList.add('on');
  organs.forEach(o => { o.rig.outer.visible = true; });
  applyMode();
  applyExplode();
  labelLayer.clear();
  setView('iso');
  renderList();
  renderDetail(null);
}

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  // 空格：临时切换为平移（松手恢复），类似图像软件的抓手工具
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat && S._panHold === undefined) {
      S._panHold = S.panMode;
      setPanMode(true);
    }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'l') $('labelBtn').click();
  else if (k === 'b') setAnim('breathing');
  else if (k === 's') setAnim('swallow');
  else if (k === 'v') setAnim('voice');
  else if (k === 'p') setPanMode(!S.panMode);
  else if (k === 'r') resetAll();
  else if (k === 'escape') select(null);
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && S._panHold !== undefined) {
    setPanMode(S._panHold);
    S._panHold = undefined;
  }
});

/* ═══════════════ 尺寸 ═══════════════ */
function resize() {
  const w = appEl.clientWidth, h = appEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 小屏：把可视窗口整体上移，避免模型被底部详情面板挡住
  if (w <= 960) camera.setViewOffset(w, h, 0, h * 0.20, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(appEl);

/* ═══════════════ 主循环 ═══════════════ */
let last = performance.now();
let frames = 0;
let frameNo = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  easeCam(dt);
  controls.update();
  updateAnimations(dt, time);
  updateHighlight(dt);

  // 标注：隔帧更新，开销可控
  if (frameNo % 2 === 0) {
    const ids = labeledIds();
    labelLayer.update(
      ids.map(id => ({
        id, title: ORG_BY_ID[id].name, color: cssColor(id),
        anchor: LABEL_ANCHORS.get(id)
      })),
      appEl,
      labelBounds()
    );
  }
  frameNo++;

  drawScope(time);
  renderer.render(scene, camera);

  if (++frames === 2) {
    loader.classList.add('hide');
    setTimeout(() => { loader.style.display = 'none'; }, 520);
  }
}

/* ═══════════════ 启动 ═══════════════ */
resize();
renderList();
renderDetail(null);
applyMode();
applyExplode();
$('labelBtn').classList.add('on');
/* 初始机位：按当前视口宽高比取全整个模型 */
{
  const v = VIEWS.iso;
  const tgt = new THREE.Vector3(v.target[0], reliftY(v.target[1]), v.target[2]);
  const dir = new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]).sub(tgt);
  dir.setLength(Math.max(dir.length(), fitDistance(v.fit[0], v.fit[1])));
  controls.target.copy(tgt);
  camera.position.copy(tgt).add(dir);
  [...$('viewset').children].forEach(b => b.classList.toggle('on', b.dataset.view === 'iso'));
}
requestAnimationFrame(loop);

/* 调试/自动化质检钩子：读取渲染结果与内部状态 */
window.__atlas = {
  THREE, renderer, scene, camera, controls, organs, order, S, anim, headY, reliftY,
  /** 建模坐标 → 最终世界坐标（质检脚本用） */
  worldY: (m) => reliftY(headY(m)),
  snapshot() {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    renderer.render(scene, camera);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, sum2 = 0, n = 0, lit = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3];
      if (a < 8) continue;
      const l = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      sum += l; sum2 += l * l; n++;
      if (a > 200) lit++;
    }
    const mean = n ? sum / n : 0;
    return {
      w, h, sampled: n, coverage: n / (w * h), lit: lit / (w * h),
      mean, std: n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0
    };
  }
};

setTimeout(() => hint.classList.add('hide'), 9000);
window.addEventListener('pointerdown', () => hint.classList.add('hide'), { once: true });
