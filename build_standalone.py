#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 head-throat-3d 打成**单文件自包含**版本 standalone.html：
双击即可用 Chrome 打开，不需要任何 HTTP 服务。

为什么需要它：`<script type="module">` 在 file:// 协议下会被浏览器以 CORS 拒绝
（模块 origin 是 null），脚本一行都不跑，而加载遮罩是靠脚本跑完才隐藏的 ——
于是页面永远停在「正在构建头颈解剖模型…」。

做法：自己做一个极小的打包器 —— 每个模块包成一个 IIFE，静态 import/export
改写为作用域内的变量绑定与返回对象。
依赖图是 DAG（three → geo/data/textures/labels → anatomy → app），
拓扑序执行即可，不需要运行时模块注册表。
"""
import re, os, sys, json

ROOT = '/Users/Season/FindEndorphin/工作/AI/vibe-coding/head-throat-3d'

# (模块 id, 文件, 依赖的模块 id 列表)
GRAPH = [
    ('three',    'vendor/three.module.js',  []),
    ('geo',      'js/geo.js',               ['three']),
    ('data',     'js/data.js',              []),
    ('textures', 'js/textures.js',          ['three']),
    ('labels',   'js/labels.js',            ['three']),
    ('orbit',    'vendor/OrbitControls.js', ['three']),
    ('anatomy',  'js/anatomy.js',           ['three', 'data', 'textures', 'geo']),
    ('app',      'js/app.js',               ['three', 'orbit', 'anatomy', 'labels', 'data', 'geo']),
]

# 文件路径 → 模块 id（用于把 import 的说明符解析成模块）
BY_FILE = {f: i for i, f, _ in GRAPH}

IMPORT_RE = re.compile(r"^[ \t]*import\s+(.*?)\s+from\s+['\"]([^'\"]+)['\"]\s*;?[ \t]*$",
                       re.MULTILINE | re.DOTALL)
EXPORT_FN_RE = re.compile(r"^([ \t]*)export\s+(async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)",
                          re.MULTILINE)
EXPORT_VAR_RE = re.compile(r"^([ \t]*)export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)
EXPORT_LIST_RE = re.compile(r"^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$", re.MULTILINE)


def resolve(spec, me_file):
    """把 import 说明符解析成模块 id"""
    p = os.path.normpath(os.path.join(os.path.dirname(me_file), spec))
    if p in BY_FILE:
        return BY_FILE[p]
    raise SystemExit('无法解析 import: %r (来自 %s)' % (spec, me_file))


def parse_bindings(clause, mod):
    """解析 import 子句 → [(本地名, '模块id.原名'), ...]"""
    out = []
    c = clause.strip()
    if c.startswith('*'):
        m = re.match(r"\*\s+as\s+([A-Za-z_$][\w$]*)", c)
        # ⚠ 模块命名空间的变量名是 __m_<id>，不是裸的 <id>
        out.append((m.group(1), '__m_' + mod))
        return out
    m = re.match(r"\{([\s\S]*)\}", c)
    if not m:
        raise SystemExit('无法解析 import 子句: %r' % clause)
    for part in m.group(1).split(','):
        part = part.strip()
        if not part:
            continue
        if ' as ' in part:
            orig, local = [x.strip() for x in part.split(' as ')]
        else:
            orig = local = part
        out.append((local, '__m_%s.%s' % (mod, orig)))
    return out


def process(mid, rel):
    path = os.path.join(ROOT, rel)
    src = open(path, encoding='utf-8').read()

    # ── 1. 剥离 import，收集绑定 ──
    binds = []
    def sub_import(m):
        clause, spec = m.group(1), m.group(2)
        mod = resolve(spec, rel)
        for local, expr in parse_bindings(clause, mod):
            binds.append((local, expr))
        return ''
    body = IMPORT_RE.sub(sub_import, src)

    # ── 2. 处理 export ──
    names = []
    def sub_list(m):
        for part in m.group(1).split(','):
            part = part.strip()
            if part:
                names.append(part.split(' as ')[-1].strip())
        return ''
    body = EXPORT_LIST_RE.sub(sub_list, body)

    def sub_fn(m):
        names.append(m.group(4))
        return '%s%s%s %s' % (m.group(1), m.group(2) or '', m.group(3), m.group(4))
    body = EXPORT_FN_RE.sub(sub_fn, body)

    def sub_var(m):
        names.append(m.group(3))
        return '%s%s %s' % (m.group(1), m.group(2), m.group(3))
    body = EXPORT_VAR_RE.sub(sub_var, body)

    # ── 3. 冲突检查：import 绑定名 vs 模块自身声明名 ──
    declared = set(re.findall(r"^[ \t]*(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)",
                              body, re.MULTILINE))
    clash = sorted({b for b, _ in binds} & declared)
    if clash:
        raise SystemExit('[%s] import 绑定与本地声明重名，需改名: %s' % (mid, clash))

    head = '\n'.join('  var %s = %s;' % (n, e) for n, e in binds)
    tail = '  return { %s };' % ', '.join('%s: %s' % (n, n) for n in sorted(set(names)))
    return ('/* ────── module: %s ────── */\n'
            'var __m_%s = (function () {\n%s\n%s\n%s\n})();\n') % (mid, mid, head, body, tail)


def main():
    # 拓扑排序（图本来就小，直接按依赖深度）
    order, done = [], set()
    def visit(mid):
        if mid in done:
            return
        rel = dict((i, f) for i, f, _ in GRAPH)[mid]
        for dep in dict((i, d) for i, _, d in GRAPH)[mid]:
            visit(dep)
        done.add(mid)
        order.append(mid)
    for i, _, _ in GRAPH:
        visit(i)

    parts = ['(function () {', "'use strict';",
             '/* 本文件由 build_standalone.py 自动生成，请勿手改。 */']
    for mid in order:
        rel = dict((i, f) for i, f, _ in GRAPH)[mid]
        parts.append(process(mid, rel))
    parts.append('})();')
    bundle = '\n'.join(parts)

    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'styles.css'), encoding='utf-8').read()

    html = html.replace('<link rel="stylesheet" href="styles.css" />',
                        '<style>\n' + css + '\n</style>')

    # 把「入口守卫」整块换成内联的全量 bundle。
    # 守卫本身是为「开发版在 file:// 下会卡死」准备的；单文件版没有这个问题，
    # 不需要守卫，也不需要任何外部脚本。
    guard = re.compile(r"<!-- CWGUARD:START -->.*?<!-- CWGUARD:END -->", re.DOTALL)
    assert guard.search(html), 'index.html 里的 CWGUARD 标记不见了，请同步 build_standalone.py'
    # ⚠ 必须用函数式替换：bundle 里有大量 \w \d \( 之类的反斜杠，
    #   直接当替换串会被 re 当成模板转义解析，报 "bad escape \w"。
    payload = '<script>\n' + bundle + '\n</script>'
    html = guard.sub(lambda m: payload, html)

    out = os.path.join(ROOT, 'standalone.html')
    open(out, 'w', encoding='utf-8').write(html)
    print('已生成 %s   %.2f MB   （内联 JS %.2f MB + CSS %.2f MB）'
          % (out, len(html.encode()) / 1e6, len(bundle.encode()) / 1e6, len(css.encode()) / 1e6))


if __name__ == '__main__':
    main()
