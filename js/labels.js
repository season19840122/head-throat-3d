/**
 * labels.js — 引线式 3D 标注层
 * 把结构锚点投影到屏幕，用折线 + 浮动标签标注，自动防重叠。
 */
import * as THREE from '../vendor/three.module.js';

export function createLabelLayer(host, camera) {
  const SVGNS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'leader-layer');
  const nodes = document.createElement('div');
  nodes.className = 'label-nodes';
  host.appendChild(svg);
  host.appendChild(nodes);

  const cache = new Map();   // id → { g, line, dot, node, dotEl, width }
  const tmp = new THREE.Vector3();

  function ensure(id, title, color) {
    let c = cache.get(id);
    if (!c) {
      const g = document.createElementNS(SVGNS, 'g');

      const line = document.createElementNS(SVGNS, 'polyline');
      line.setAttribute('class', 'leader-line');
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('class', 'leader-dot');
      dot.setAttribute('r', '3.4');
      g.appendChild(line);
      g.appendChild(dot);
      svg.appendChild(g);

      const node = document.createElement('div');
      node.className = 'label-node';
      const swatch = document.createElement('i');
      swatch.className = 'swatch';
      const span = document.createElement('span');
      node.appendChild(swatch);
      node.appendChild(span);
      nodes.appendChild(node);

      c = { g, line, dot, node, swatch, span, width: 0, text: '' };
      cache.set(id, c);
    }
    if (c.text !== title) {
      c.text = title;
      c.span.textContent = title;
      c.width = 0;   // 触发重新测量
    }
    if (c.color !== color) {
      c.color = color;
      c.swatch.style.background = color;
      c.line.setAttribute('stroke', color);
      c.dot.setAttribute('fill', color);
    }
    return c;
  }

  /**
   * @param {Array} items [{ id, title, color, anchor: THREE.Vector3, forcedSide }]
   * @param {HTMLElement} viewport 用于取尺寸
   * @param {Object} bounds 界面安全区 { left, right, top, bottom }
   */
  function update(items, viewport, bounds) {
    const W = viewport.clientWidth;
    const H = viewport.clientHeight;
    const active = new Set();

    const projected = [];
    for (const it of items) {
      const c = ensure(it.id, it.title, it.color);
      active.add(it.id);

      tmp.copy(it.anchor).project(camera);
      const behind = tmp.z < -1 || tmp.z > 1;
      const x = (tmp.x * 0.5 + 0.5) * W;
      const y = (-tmp.y * 0.5 + 0.5) * H;
      const off = x < -W * 0.35 || x > W * 1.35 || y < -H * 0.35 || y > H * 1.35;

      c.node.style.display = behind || off ? 'none' : '';
      c.line.style.display = behind || off ? 'none' : '';
      c.dot.style.display = behind || off ? 'none' : '';
      if (behind || off) continue;

      if (!c.width) {
        c.width = c.node.offsetWidth || 90;
        c.height = c.node.offsetHeight || 26;
      }
      projected.push({ c, x, y, side: it.forcedSide || (x < W / 2 ? -1 : 1) });
    }

    // 清理不再使用的
    cache.forEach((c, id) => {
      if (!active.has(id)) {
        c.g.remove(); c.node.remove(); cache.delete(id);
      }
    });

    // 分列 + 纵向解重叠（受界面安全区约束）
    const GAP = 6;
    const B = bounds || { left: 16, right: W - 16, top: 16, bottom: H - 16 };
    for (const side of [-1, 1]) {
      const col = projected.filter(p => p.side === side).sort((a, b) => a.y - b.y);
      let cursor = B.top;
      for (const p of col) {
        const h = p.c.height || 26;
        const ty = Math.max(p.y, cursor + h / 2);
        p.ty = ty;
        cursor = ty + h / 2 + GAP;
      }
      // 底部溢出：整列上推
      let overflow = 0;
      for (let i = col.length - 1; i >= 0; i--) {
        const bottom = col[i].ty + (col[i].c.height || 26) / 2;
        if (bottom > B.bottom) overflow = Math.max(overflow, bottom - B.bottom);
      }
      if (overflow > 0) col.forEach(p => { p.ty -= overflow; });
      // 顶部溢出：整列下压
      for (let i = 0; i < col.length; i++) {
        const top = col[i].ty - (col[i].c.height || 26) / 2;
        if (top < B.top) { const d = B.top - top; col.forEach(p => { p.ty += d; }); break; }
      }
    }

    // 写入 DOM
    for (const p of projected) {
      const { c } = p;
      const w = c.width || 90;
      const h = c.height || 26;
      const boxX = p.side === -1 ? B.left : B.right - w;   // 标签左边缘
      const boxY = p.ty - h / 2;
      c.node.style.transform = `translate3d(${boxX}px, ${boxY}px, 0)`;

      const elbowX = p.side === -1 ? boxX + w + 12 : boxX - 12;
      const elbowY = p.ty;
      c.line.setAttribute(
        'points',
        `${p.x},${p.y} ${elbowX},${elbowY} ${(p.side === -1 ? boxX + w + 4 : boxX - 4)},${elbowY}`
      );
      c.dot.setAttribute('cx', p.x);
      c.dot.setAttribute('cy', p.y);
    }
  }

  function clear() {
    cache.forEach(c => { c.g.remove(); c.node.remove(); });
    cache.clear();
  }

  return { update, clear, svg, nodes };
}
