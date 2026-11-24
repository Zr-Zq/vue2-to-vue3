/**
 * 单文件自包含 HTML：导入图 / 作用域 / 全局登记 可视化
 */
function renderHtmlReport(graph) {
  const dataJson = JSON.stringify(graph).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>2to3 Preflight — ${escapeHtml(graph.meta.packageName || 'project')}</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #1a2332;
    --border: #2d3a4f;
    --text: #e7ecf3;
    --muted: #8b9bb4;
    --accent: #3d9cf0;
    --ok: #3ecf8e;
    --warn: #f0b429;
    --danger: #f07178;
    --chip: #243044;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.45;
  }
  header {
    padding: 16px 20px; border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, #1a2740 0%, var(--bg) 100%);
  }
  header h1 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
  header p { margin: 0; color: var(--muted); font-size: 13px; }
  .stats {
    display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px;
  }
  .stat {
    background: var(--chip); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 12px; min-width: 110px;
  }
  .stat b { display: block; font-size: 20px; color: var(--accent); }
  .stat span { font-size: 12px; color: var(--muted); }
  .layout {
    display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 140px);
  }
  nav {
    border-right: 1px solid var(--border); background: var(--panel);
    padding: 12px; overflow: auto;
  }
  nav button {
    display: block; width: 100%; text-align: left; background: transparent;
    border: 0; color: var(--text); padding: 8px 10px; border-radius: 6px;
    cursor: pointer; font-size: 13px; margin-bottom: 2px;
  }
  nav button:hover, nav button.active { background: #2a3a55; color: var(--accent); }
  main { padding: 16px 20px; overflow: auto; }
  .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
  input[type=search], select {
    background: var(--panel); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 7px 10px; font-size: 13px; min-width: 200px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 500; position: sticky; top: 0; background: var(--bg); }
  tr:hover td { background: #182233; }
  .tag {
    display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px;
    background: var(--chip); color: var(--muted); margin-right: 4px;
  }
  .tag.ok { color: var(--ok); }
  .tag.warn { color: var(--warn); }
  .tag.danger { color: var(--danger); }
  .tag.accent { color: var(--accent); }
  .tree ul { list-style: none; padding-left: 16px; margin: 4px 0; }
  .tree > ul { padding-left: 0; }
  .tree li { margin: 2px 0; }
  .tree .node {
    font-family: ui-monospace, Consolas, monospace; font-size: 12px;
    padding: 2px 0;
  }
  .tree .meta { color: var(--muted); font-size: 11px; margin-left: 6px; }
  .panel-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 14px;
  }
  .panel-card h3 { margin: 0 0 8px; font-size: 14px; }
  .muted { color: var(--muted); }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 960px) {
    .layout { grid-template-columns: 1fr; }
    .split { grid-template-columns: 1fr; }
    nav { border-right: 0; border-bottom: 1px solid var(--border); max-height: 160px; }
  }
  a.file-link { color: var(--accent); cursor: pointer; text-decoration: none; }
  a.file-link:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>Vue2→Vue3 前置分析 · ${escapeHtml(graph.meta.packageName || '')}</h1>
  <p>${escapeHtml(graph.meta.projectRoot || '')} · ${escapeHtml(graph.meta.analyzedAt || '')}</p>
  <div class="stats" id="stats"></div>
</header>
<div class="layout">
  <nav id="nav">
    <button data-view="overview" class="active">总览</button>
    <button data-view="files">文件与导入图</button>
    <button data-view="scopes">变量作用域</button>
    <button data-view="globals">全局注册登记</button>
    <button data-view="mixins">Mixin</button>
    <button data-view="lookup">符号反查</button>
    <button data-view="cycles">循环依赖</button>
    <button data-view="entry">入口导入树</button>
  </nav>
  <main id="main"></main>
</div>
<script>
const DATA = ${dataJson};

const $ = (sel) => document.querySelector(sel);
const main = $('#main');
let currentView = 'overview';
let selectedFile = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderStats() {
  const s = DATA.stats || {};
  const items = [
    ['文件', s.fileCount],
    ['导入边', s.edgeCount],
    ['动态导入', s.dynamicCount],
    ['全局登记', s.globalRegistrationCount],
    ['Mixin应用', s.mixinApplicationCount],
    ['Mixin成员', s.mixinMemberCount],
    ['循环', s.cycleCount],
    ['解析错误', s.parseErrorCount],
    ['外部导入', s.externalImportCount],
  ];
  $('#stats').innerHTML = items.map(([k,v]) =>
    '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>'
  ).join('');
}

function fileById(id) {
  return (DATA.files || []).find(f => f.id === id || f.path === id);
}

function renderOverview() {
  const g = DATA.globalIndex || [];
  const topGlobals = g.slice(0, 15).map(x =>
    '<tr><td class="mono">' + esc(x.api) + '</td><td>' + esc(x.kind) +
    '</td><td>' + x.registrations.length + '</td><td class="mono">' +
    esc(x.registrations.map(r => r.file).join(', ')) + '</td></tr>'
  ).join('');
  const cycles = (DATA.cycles || []).length;
  main.innerHTML = \`
    <div class="panel-card">
      <h3>说明</h3>
      <p class="muted">本报告记录：① 导入图；② 作用域树；③ 全局注册/修改点（不记调用）；
      ④ Mixin（Vue.mixin / mixins:[] → 源文件 → methods/data 等成员反查）。
      符号反查页可按名一次查出全局登记与 mixin 注入来源。</p>
    </div>
    <div class="split">
      <div class="panel-card">
        <h3>循环依赖</h3>
        <p>\${cycles ? '<span class="tag danger">' + cycles + ' 组</span> 见「循环依赖」页' : '<span class="tag ok">无</span>'}</p>
      </div>
      <div class="panel-card">
        <h3>解析错误</h3>
        <p>\${(DATA.parseErrors||[]).length
          ? '<span class="tag warn">' + DATA.parseErrors.length + ' 文件</span>'
          : '<span class="tag ok">无</span>'}</p>
      </div>
    </div>
    <div class="panel-card">
      <h3>全局登记（前 15）</h3>
      <table><thead><tr><th>API</th><th>类型</th><th>次数</th><th>文件</th></tr></thead>
      <tbody>\${topGlobals || '<tr><td colspan="4" class="muted">无</td></tr>'}</tbody></table>
    </div>
  \`;
}

function renderFiles() {
  const q = (document.getElementById('q-file') || {}).value || '';
  const files = (DATA.files || []).filter(f => !q || f.path.toLowerCase().includes(q.toLowerCase()));
  const rows = files.map(f => \`
    <tr>
      <td><a class="file-link" data-file="\${esc(f.path)}">\${esc(f.path)}</a></td>
      <td><span class="tag">\${esc(f.kind)}</span></td>
      <td>\${f.importees.length}</td>
      <td>\${f.importers.length}</td>
      <td>\${f.imports.filter(i=>i.external).length}</td>
      <td>\${f.globals.length}</td>
      <td>\${f.scopeFlat.length}</td>
      <td>\${f.errors.length ? '<span class="tag warn">' + f.errors.length + '</span>' : ''}</td>
    </tr>\`).join('');

  let detail = '';
  if (selectedFile) {
    const f = fileById(selectedFile);
    if (f) {
      detail = \`
        <div class="panel-card">
          <h3 class="mono">\${esc(f.path)}</h3>
          <p class="muted">被导入于 (\${f.importers.length}) · 导入 (\${f.importees.length})</p>
          <div class="split">
            <div>
              <h4>importees</h4>
              <ul>\${f.importees.map(x => '<li class="mono"><a class="file-link" data-file="'+esc(x)+'">'+esc(x)+'</a></li>').join('') || '<li class="muted">无</li>'}</ul>
            </div>
            <div>
              <h4>importers</h4>
              <ul>\${f.importers.map(x => '<li class="mono"><a class="file-link" data-file="'+esc(x)+'">'+esc(x)+'</a></li>').join('') || '<li class="muted">无</li>'}</ul>
            </div>
          </div>
          <h4>imports 明细</h4>
          <table><thead><tr><th>type</th><th>source</th><th>resolved</th><th>external</th></tr></thead>
          <tbody>\${f.imports.map(i => '<tr><td>'+esc(i.type)+'</td><td class="mono">'+esc(i.source)+'</td><td class="mono">'+esc(i.to||'')+'</td><td>'+(i.external?'<span class="tag warn">ext</span>':'')+'</td></tr>').join('')}</tbody></table>
          <h4>exports</h4>
          <table><thead><tr><th>type</th><th>names</th><th>source</th></tr></thead>
          <tbody>\${f.exports.map(e => '<tr><td>'+esc(e.type)+'</td><td class="mono">'+esc((e.names||[]).join(', '))+'</td><td class="mono">'+esc(e.source||'')+'</td></tr>').join('') || '<tr><td colspan="3" class="muted">无</td></tr>'}</tbody></table>
        </div>\`;
    }
  }

  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-file" type="search" placeholder="过滤文件路径…" value="\${esc(q)}" />
    </div>
    \${detail}
    <div class="panel-card">
      <table>
        <thead><tr><th>文件</th><th>类型</th><th>导出依赖</th><th>被依赖</th><th>外部</th><th>全局</th><th>绑定</th><th>错误</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>\`;

  const inp = document.getElementById('q-file');
  if (inp) inp.addEventListener('input', () => renderFiles());
  bindFileLinks();
}

function renderScopeTree(node, depth) {
  if (!node) return '';
  const bindings = (node.bindings || []).map(b => {
    const layerTag = b.layer === 'file-top-import' ? 'accent'
      : b.layer === 'file-top-decl' ? 'ok'
      : 'warn';
    return '<span class="tag ' + layerTag + '">' + esc(b.layer) + '</span> '
      + '<span class="mono">' + esc(b.name) + '</span> '
      + '<span class="muted">(' + esc(b.kind) + (b.shadowed ? ', 遮蔽外层' : '') + ')</span>';
  }).join('<br/>');
  let html = '<li><div class="node"><strong>' + esc(node.type) + '</strong> '
    + esc(node.name)
    + (bindings ? '<div style="margin:4px 0 4px 12px">' + bindings + '</div>' : '')
    + '</div>';
  if (node.children && node.children.length) {
    html += '<ul>' + node.children.map(c => renderScopeTree(c, depth + 1)).join('') + '</ul>';
  }
  html += '</li>';
  return html;
}

function renderScopes() {
  const q = (document.getElementById('q-scope') || {}).value || '';
  const layer = (document.getElementById('layer-filter') || {}).value || '';
  let rows = [];
  (DATA.files || []).forEach(f => {
    (f.scopeFlat || []).forEach(b => {
      if (q && !(f.path.includes(q) || b.name.includes(q))) return;
      if (layer && b.layer !== layer) return;
      rows.push(Object.assign({ file: f.path }, b));
    });
  });
  rows = rows.slice(0, 800);

  const fileSel = selectedFile || ((DATA.files || [])[0] || {}).path;
  const f = fileById(fileSel);
  const treeHtml = f && f.scopeTree
    ? '<ul>' + renderScopeTree(f.scopeTree, 0) + '</ul>'
    : '<p class="muted">无作用域树</p>';

  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-scope" type="search" placeholder="过滤文件或变量名…" value="\${esc(q)}" />
      <select id="layer-filter">
        <option value="">全部层级</option>
        <option value="file-top-import" \${layer==='file-top-import'?'selected':''}>顶层导入</option>
        <option value="file-top-decl" \${layer==='file-top-decl'?'selected':''}>顶层声明</option>
        <option value="function-local-decl" \${layer==='function-local-decl'?'selected':''}>函数内声明</option>
      </select>
      <select id="file-scope">
        \${(DATA.files||[]).map(x => '<option value="'+esc(x.path)+'" '+(x.path===fileSel?'selected':'')+'>'+esc(x.path)+'</option>').join('')}
      </select>
    </div>
    <div class="split">
      <div class="panel-card tree">
        <h3>作用域树 · \${esc(fileSel || '')}</h3>
        \${treeHtml}
      </div>
      <div class="panel-card">
        <h3>扁平绑定表（最多 800）</h3>
        <table>
          <thead><tr><th>文件</th><th>变量</th><th>层级</th><th>kind</th><th>作用域</th><th>遮蔽</th></tr></thead>
          <tbody>\${rows.map(r => '<tr><td class="mono"><a class="file-link" data-file="'+esc(r.file)+'">'+esc(r.file)+'</a></td><td class="mono">'+esc(r.name)+'</td><td><span class="tag">'+esc(r.layer)+'</span></td><td>'+esc(r.kind)+'</td><td>'+esc(r.scopeType)+'/'+esc(r.scopeName)+'</td><td>'+(r.shadowed?'是':'')+'</td></tr>').join('')}</tbody>
        </table>
      </div>
    </div>\`;

  ['q-scope','layer-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderScopes);
    if (el && el.tagName === 'INPUT') el.addEventListener('input', renderScopes);
  });
  const fs = document.getElementById('file-scope');
  if (fs) fs.addEventListener('change', () => { selectedFile = fs.value; renderScopes(); });
  bindFileLinks();
}

function renderGlobals() {
  const q = (document.getElementById('q-global') || {}).value || '';
  const list = (DATA.globalIndex || []).filter(g =>
    !q || g.api.toLowerCase().includes(q.toLowerCase()) || g.name.toLowerCase().includes(q.toLowerCase())
  );
  const rows = list.map(g => \`
    <tr>
      <td class="mono">\${esc(g.api)}</td>
      <td><span class="tag accent">\${esc(g.kind)}</span></td>
      <td>\${g.registrations.length}</td>
      <td>\${g.registrations.map(r =>
        '<div class="mono"><a class="file-link" data-file="'+esc(r.file)+'">'+esc(r.file)+'</a>'
        + (r.loc ? ':' + r.loc.line : '')
        + ' <span class="muted">' + esc(r.action) + (r.valueHint != null ? ' = ' + esc(r.valueHint) : '') + '</span></div>'
      ).join('')}</td>
    </tr>\`).join('');

  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-global" type="search" placeholder="过滤全局 API…" value="\${esc(q)}" />
      <span class="muted">只登记注册/赋值点，不追踪调用</span>
    </div>
    <div class="panel-card">
      <table>
        <thead><tr><th>API</th><th>类型</th><th>登记次数</th><th>位置</th></tr></thead>
        <tbody>\${rows || '<tr><td colspan="4" class="muted">无全局登记</td></tr>'}</tbody>
      </table>
    </div>\`;
  const inp = document.getElementById('q-global');
  if (inp) inp.addEventListener('input', renderGlobals);
  bindFileLinks();
}

function renderMixins() {
  const mx = DATA.mixins || {};
  const apps = mx.applications || [];
  const members = mx.memberIndex || [];
  const q = (document.getElementById('q-mixin') || {}).value || '';
  const appRows = apps.filter(a => !q || JSON.stringify(a).toLowerCase().includes(q.toLowerCase())).map(a => \`
    <tr>
      <td><span class="tag \${a.scope==='global'?'danger':'accent'}">\${esc(a.scope)}</span></td>
      <td class="mono"><a class="file-link" data-file="\${esc(a.file)}">\${esc(a.file)}</a></td>
      <td class="mono">\${esc(a.localName||'(inline)')}\${a.factory?' <span class="tag warn">factory</span>':''}</td>
      <td class="mono">\${a.mixinFile ? '<a class="file-link" data-file="'+esc(a.mixinFile)+'">'+esc(a.mixinFile)+'</a>' : esc(a.mixinSource||'')}</td>
      <td>\${a.loc ? a.loc.line : ''}</td>
    </tr>\`).join('');
  const memRows = members.filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.mixinFile.toLowerCase().includes(q.toLowerCase())).slice(0, 400).map(m => \`
    <tr>
      <td class="mono">\${esc(m.name)}</td>
      <td><span class="tag">\${esc(m.section)}</span>\${m.global?' <span class="tag danger">global</span>':''}</td>
      <td class="mono"><a class="file-link" data-file="\${esc(m.mixinFile)}">\${esc(m.mixinFile)}</a></td>
      <td class="mono">\${(m.appliedBy||[]).map(a => '<a class="file-link" data-file="'+esc(a.file)+'">'+esc(a.file)+'</a> ('+esc(a.scope)+')').join('<br/>')}</td>
    </tr>\`).join('');
  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-mixin" type="search" placeholder="过滤 mixin / 成员名…" value="\${esc(q)}" />
      <span class="muted">Vue.mixin = global；组件 mixins:[] = local；成员可反查来源文件</span>
    </div>
    <div class="panel-card">
      <h3>Mixin 应用（\${apps.length}）</h3>
      <table><thead><tr><th>范围</th><th>应用文件</th><th>本地名</th><th>Mixin 源</th><th>行</th></tr></thead>
      <tbody>\${appRows || '<tr><td colspan="5" class="muted">无</td></tr>'}</tbody></table>
    </div>
    <div class="panel-card">
      <h3>注入成员索引（最多 400）</h3>
      <table><thead><tr><th>成员</th><th>区块</th><th>定义于</th><th>被谁应用</th></tr></thead>
      <tbody>\${memRows || '<tr><td colspan="4" class="muted">无</td></tr>'}</tbody></table>
    </div>\`;
  const inp = document.getElementById('q-mixin');
  if (inp) inp.addEventListener('input', renderMixins);
  bindFileLinks();
}

function lookupSymbolClient(name) {
  const q = String(name || '').replace(/^this\\./, '').replace(/^Vue\\.prototype\\./, '');
  if (!q) return { query: name, globals: [], mixinMembers: [], scopes: [] };
  const globals = (DATA.globalIndex || []).filter(g =>
    g.name === q || g.api === q || g.api.endsWith('.' + q) || String(g.name).endsWith(q)
  );
  const mixinMembers = ((DATA.mixins && DATA.mixins.memberIndex) || []).filter(m =>
    m.name === q || m.name === '$' + q
  );
  const scopes = [];
  (DATA.files || []).forEach(f => {
    (f.scopeFlat || []).forEach(b => {
      if (b.name === q && (b.layer === 'file-top-decl' || b.layer === 'file-top-import')) {
        scopes.push({ file: f.path, layer: b.layer, kind: b.kind, loc: b.loc });
      }
    });
  });
  return { query: q, globals, mixinMembers, scopes };
}

function renderLookup() {
  const raw = (document.getElementById('q-lookup') || {}).value || '';
  const r = lookupSymbolClient(raw.trim());
  let body = '<p class="muted">输入如 $fxWebsite、$fxCloseKeepAlive、cacheMixin</p>';
  if (raw.trim()) {
    body = \`
      <div class="panel-card">
        <h3>全局登记 · \${esc(r.query)}</h3>
        \${r.globals.length ? '<table><thead><tr><th>API</th><th>登记位置</th></tr></thead><tbody>' +
          r.globals.map(g => '<tr><td class="mono">'+esc(g.api)+'</td><td>' +
            g.registrations.map(x => '<div class="mono"><a class="file-link" data-file="'+esc(x.file)+'">'+esc(x.file)+'</a>'+(x.loc?':'+x.loc.line:'')+' <span class="muted">'+esc(x.action)+'</span></div>').join('') +
          '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">未命中全局登记</p>'}
      </div>
      <div class="panel-card">
        <h3>Mixin 注入成员</h3>
        \${r.mixinMembers.length ? '<table><thead><tr><th>成员</th><th>区块</th><th>定义于</th><th>应用</th></tr></thead><tbody>' +
          r.mixinMembers.map(m => '<tr><td class="mono">'+esc(m.name)+'</td><td>'+esc(m.section)+'</td><td class="mono"><a class="file-link" data-file="'+esc(m.mixinFile)+'">'+esc(m.mixinFile)+'</a></td><td>' +
            (m.appliedBy||[]).map(a=>esc(a.file)+'/'+esc(a.scope)).join(', ') + '</td></tr>').join('') +
          '</tbody></table>' : '<p class="muted">未命中 mixin 成员</p>'}
      </div>
      <div class="panel-card">
        <h3>文件顶层绑定</h3>
        \${r.scopes.length ? '<table><thead><tr><th>文件</th><th>层级</th><th>kind</th><th>行</th></tr></thead><tbody>' +
          r.scopes.map(s => '<tr><td class="mono"><a class="file-link" data-file="'+esc(s.file)+'">'+esc(s.file)+'</a></td><td>'+esc(s.layer)+'</td><td>'+esc(s.kind)+'</td><td>'+(s.loc&&s.loc.line||'')+'</td></tr>').join('') +
          '</tbody></table>' : '<p class="muted">未命中顶层绑定</p>'}
      </div>\`;
  }
  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-lookup" type="search" placeholder="符号名，如 $fxWebsite / $fxCloseKeepAlive" value="\${esc(raw)}" style="min-width:320px" />
      <button type="button" id="btn-lookup" style="background:var(--accent);color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer">查询</button>
    </div>
    \${body}\`;
  const go = () => { renderLookup(); };
  const inp = document.getElementById('q-lookup');
  const btn = document.getElementById('btn-lookup');
  if (btn) btn.addEventListener('click', () => { /* value already in input */ currentView='lookup'; renderLookup(); });
  if (inp) {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderLookup(); });
    // 保持焦点：仅在有查询词时不自动抢；重新绑定后恢复
    if (raw) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  bindFileLinks();
}

function renderCycles() {
  const cycles = DATA.cycles || [];
  main.innerHTML = \`
    <div class="panel-card">
      <h3>循环依赖 SCC（\${cycles.length}）</h3>
      \${cycles.length ? cycles.map((c,i) =>
        '<div style="margin-bottom:12px"><span class="tag danger">#'+(i+1)+'</span> '
        + c.map(f => '<a class="file-link mono" data-file="'+esc(f)+'">'+esc(f)+'</a>').join(' → ')
        + '</div>'
      ).join('') : '<p class="muted">未检测到循环依赖</p>'}
    </div>\`;
  bindFileLinks();
}

function renderEntryTreeNode(node) {
  if (!node) return '';
  const flags = [
    node.cycle ? '<span class="tag danger">cycle</span>' : '',
    node.truncated ? '<span class="tag warn">truncated</span>' : '',
    node.missing ? '<span class="tag warn">missing</span>' : '',
  ].join(' ');
  let html = '<li><div class="node"><a class="file-link mono" data-file="'+esc(node.id)+'">'
    + esc(node.id) + '</a> ' + flags
    + '<span class="meta">imp ' + (node.importCount||0)
    + ' · bind ' + (node.bindingCount||0)
    + ' · global ' + (node.globalCount||0) + '</span></div>';
  if (node.children && node.children.length) {
    html += '<ul>' + node.children.map(renderEntryTreeNode).join('') + '</ul>';
  }
  return html + '</li>';
}

function renderEntry() {
  const trees = DATA.entryTrees || [];
  main.innerHTML = \`
    <div class="panel-card tree">
      <h3>入口导入树</h3>
      \${trees.length ? trees.map(t =>
        '<h4 class="mono">'+esc(t.entry)+'</h4><ul>'+renderEntryTreeNode(t.tree)+'</ul>'
      ).join('') : '<p class="muted">未找到 src/main.js 等入口</p>'}
    </div>\`;
  bindFileLinks();
}

function bindFileLinks() {
  main.querySelectorAll('[data-file]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      selectedFile = el.getAttribute('data-file');
      currentView = 'files';
      setActiveNav();
      renderFiles();
    });
  });
}

function setActiveNav() {
  document.querySelectorAll('#nav button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === currentView);
  });
}

function render() {
  setActiveNav();
  if (currentView === 'overview') renderOverview();
  else if (currentView === 'files') renderFiles();
  else if (currentView === 'scopes') renderScopes();
  else if (currentView === 'globals') renderGlobals();
  else if (currentView === 'mixins') renderMixins();
  else if (currentView === 'lookup') renderLookup();
  else if (currentView === 'cycles') renderCycles();
  else if (currentView === 'entry') renderEntry();
}

document.querySelectorAll('#nav button').forEach(b => {
  b.addEventListener('click', () => {
    currentView = b.getAttribute('data-view');
    render();
  });
});

renderStats();
render();
</script>
</body>
</html>`
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = {
  renderHtmlReport,
}
