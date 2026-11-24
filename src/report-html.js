/**
 * Single-file self-contained HTML: import graph / scopes / global registrations visualization
 */
function renderHtmlReport(graph) {
  const dataJson = JSON.stringify(graph).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="en">
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
  <h1>Vue2→Vue3 Preflight · ${escapeHtml(graph.meta.packageName || '')}</h1>
  <p>${escapeHtml(graph.meta.projectRoot || '')} · ${escapeHtml(graph.meta.analyzedAt || '')}</p>
  <div class="stats" id="stats"></div>
</header>
<div class="layout">
  <nav id="nav">
    <button data-view="overview" class="active">Overview</button>
    <button data-view="files">Files & import graph</button>
    <button data-view="scopes">Variable scopes</button>
    <button data-view="globals">Global registrations</button>
    <button data-view="mixins">Mixin</button>
    <button data-view="lookup">Symbol lookup</button>
    <button data-view="cycles">Cycles</button>
    <button data-view="entry">Entry import tree</button>
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
    ['Files', s.fileCount],
    ['Import edges', s.edgeCount],
    ['Dynamic imports', s.dynamicCount],
    ['Global regs', s.globalRegistrationCount],
    ['Mixin apps', s.mixinApplicationCount],
    ['Mixin members', s.mixinMemberCount],
    ['Cycles', s.cycleCount],
    ['Parse errors', s.parseErrorCount],
    ['External imports', s.externalImportCount],
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
      <h3>Notes</h3>
      <p class="muted">This report records: (1) import graph; (2) scope tree; (3) global register/mutation sites (not call sites);
      (4) Mixins (Vue.mixin / mixins:[] → source file → methods/data member reverse lookup).
      The symbol lookup page finds global regs and mixin injection sources by name in one query.</p>
    </div>
    <div class="split">
      <div class="panel-card">
        <h3>Circular dependencies</h3>
        <p>\${cycles ? '<span class="tag danger">' + cycles + ' group(s)</span> see Cycles tab' : '<span class="tag ok">None</span>'}</p>
      </div>
      <div class="panel-card">
        <h3>Parse errors</h3>
        <p>\${(DATA.parseErrors||[]).length
          ? '<span class="tag warn">' + DATA.parseErrors.length + ' file(s)</span>'
          : '<span class="tag ok">None</span>'}</p>
      </div>
    </div>
    <div class="panel-card">
      <h3>Global registrations (top 15)</h3>
      <table><thead><tr><th>API</th><th>Kind</th><th>Count</th><th>File</th></tr></thead>
      <tbody>\${topGlobals || '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody></table>
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
          <p class="muted">Imported by (\${f.importers.length}) · Imports (\${f.importees.length})</p>
          <div class="split">
            <div>
              <h4>importees</h4>
              <ul>\${f.importees.map(x => '<li class="mono"><a class="file-link" data-file="'+esc(x)+'">'+esc(x)+'</a></li>').join('') || '<li class="muted">None</li>'}</ul>
            </div>
            <div>
              <h4>importers</h4>
              <ul>\${f.importers.map(x => '<li class="mono"><a class="file-link" data-file="'+esc(x)+'">'+esc(x)+'</a></li>').join('') || '<li class="muted">None</li>'}</ul>
            </div>
          </div>
          <h4>imports detail</h4>
          <table><thead><tr><th>type</th><th>source</th><th>resolved</th><th>external</th></tr></thead>
          <tbody>\${f.imports.map(i => '<tr><td>'+esc(i.type)+'</td><td class="mono">'+esc(i.source)+'</td><td class="mono">'+esc(i.to||'')+'</td><td>'+(i.external?'<span class="tag warn">ext</span>':'')+'</td></tr>').join('')}</tbody></table>
          <h4>exports</h4>
          <table><thead><tr><th>type</th><th>names</th><th>source</th></tr></thead>
          <tbody>\${f.exports.map(e => '<tr><td>'+esc(e.type)+'</td><td class="mono">'+esc((e.names||[]).join(', '))+'</td><td class="mono">'+esc(e.source||'')+'</td></tr>').join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}</tbody></table>
        </div>\`;
    }
  }

  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-file" type="search" placeholder="Filter file path…" value="\${esc(q)}" />
    </div>
    \${detail}
    <div class="panel-card">
      <table>
        <thead><tr><th>File</th><th>Kind</th><th>Deps out</th><th>Deps in</th><th>Ext</th><th>Globals</th><th>Bindings</th><th>Errors</th></tr></thead>
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
      + '<span class="muted">(' + esc(b.kind) + (b.shadowed ? ', shadows outer' : '') + ')</span>';
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
    : '<p class="muted">No scope tree</p>';

  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-scope" type="search" placeholder="Filter file or variable…" value="\${esc(q)}" />
      <select id="layer-filter">
        <option value="">All layers</option>
        <option value="file-top-import" \${layer==='file-top-import'?'selected':''}>Top-level imports</option>
        <option value="file-top-decl" \${layer==='file-top-decl'?'selected':''}>Top-level decls</option>
        <option value="function-local-decl" \${layer==='function-local-decl'?'selected':''}>Function-local decls</option>
      </select>
      <select id="file-scope">
        \${(DATA.files||[]).map(x => '<option value="'+esc(x.path)+'" '+(x.path===fileSel?'selected':'')+'>'+esc(x.path)+'</option>').join('')}
      </select>
    </div>
    <div class="split">
      <div class="panel-card tree">
        <h3>Scope tree · \${esc(fileSel || '')}</h3>
        \${treeHtml}
      </div>
      <div class="panel-card">
        <h3>Flat bindings (max 800)</h3>
        <table>
          <thead><tr><th>File</th><th>Var</th><th>Layer</th><th>kind</th><th>Scope</th><th>Shadow</th></tr></thead>
          <tbody>\${rows.map(r => '<tr><td class="mono"><a class="file-link" data-file="'+esc(r.file)+'">'+esc(r.file)+'</a></td><td class="mono">'+esc(r.name)+'</td><td><span class="tag">'+esc(r.layer)+'</span></td><td>'+esc(r.kind)+'</td><td>'+esc(r.scopeType)+'/'+esc(r.scopeName)+'</td><td>'+(r.shadowed?'yes':'')+'</td></tr>').join('')}</tbody>
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
      <input id="q-global" type="search" placeholder="Filter global API…" value="\${esc(q)}" />
      <span class="muted">Only registration/assignment sites; call sites not tracked</span>
    </div>
    <div class="panel-card">
      <table>
        <thead><tr><th>API</th><th>Kind</th><th>Reg count</th><th>Location</th></tr></thead>
        <tbody>\${rows || '<tr><td colspan="4" class="muted">No global registrations</td></tr>'}</tbody>
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
      <input id="q-mixin" type="search" placeholder="Filter mixin / member…" value="\${esc(q)}" />
      <span class="muted">Vue.mixin = global; component mixins:[] = local; members reverse-lookup to source file</span>
    </div>
    <div class="panel-card">
      <h3>Mixin applications (\${apps.length}）</h3>
      <table><thead><tr><th>Scope</th><th>Applied in</th><th>Local name</th><th>Mixin source</th><th>Line</th></tr></thead>
      <tbody>\${appRows || '<tr><td colspan="5" class="muted">None</td></tr>'}</tbody></table>
    </div>
    <div class="panel-card">
      <h3>Injected member index (max 400)</h3>
      <table><thead><tr><th>Member</th><th>Section</th><th>Defined in</th><th>Applied by</th></tr></thead>
      <tbody>\${memRows || '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody></table>
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
  let body = '<p class="muted">Enter a name like $fxWebsite, $fxCloseKeepAlive, cacheMixin</p>';
  if (raw.trim()) {
    body = \`
      <div class="panel-card">
        <h3>Global registrations · \${esc(r.query)}</h3>
        \${r.globals.length ? '<table><thead><tr><th>API</th><th>Registered at</th></tr></thead><tbody>' +
          r.globals.map(g => '<tr><td class="mono">'+esc(g.api)+'</td><td>' +
            g.registrations.map(x => '<div class="mono"><a class="file-link" data-file="'+esc(x.file)+'">'+esc(x.file)+'</a>'+(x.loc?':'+x.loc.line:'')+' <span class="muted">'+esc(x.action)+'</span></div>').join('') +
          '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No global registration hit</p>'}
      </div>
      <div class="panel-card">
        <h3>Mixin injected members</h3>
        \${r.mixinMembers.length ? '<table><thead><tr><th>Member</th><th>Section</th><th>Defined in</th><th>Applied</th></tr></thead><tbody>' +
          r.mixinMembers.map(m => '<tr><td class="mono">'+esc(m.name)+'</td><td>'+esc(m.section)+'</td><td class="mono"><a class="file-link" data-file="'+esc(m.mixinFile)+'">'+esc(m.mixinFile)+'</a></td><td>' +
            (m.appliedBy||[]).map(a=>esc(a.file)+'/'+esc(a.scope)).join(', ') + '</td></tr>').join('') +
          '</tbody></table>' : '<p class="muted">No mixin member hit</p>'}
      </div>
      <div class="panel-card">
        <h3>File top-level bindings</h3>
        \${r.scopes.length ? '<table><thead><tr><th>File</th><th>Layer</th><th>kind</th><th>Line</th></tr></thead><tbody>' +
          r.scopes.map(s => '<tr><td class="mono"><a class="file-link" data-file="'+esc(s.file)+'">'+esc(s.file)+'</a></td><td>'+esc(s.layer)+'</td><td>'+esc(s.kind)+'</td><td>'+(s.loc&&s.loc.line||'')+'</td></tr>').join('') +
          '</tbody></table>' : '<p class="muted">No top-level binding hit</p>'}
      </div>\`;
  }
  main.innerHTML = \`
    <div class="toolbar">
      <input id="q-lookup" type="search" placeholder="Symbol name, e.g. $fxWebsite / $fxCloseKeepAlive" value="\${esc(raw)}" style="min-width:320px" />
      <button type="button" id="btn-lookup" style="background:var(--accent);color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer">Lookup</button>
    </div>
    \${body}\`;
  const go = () => { renderLookup(); };
  const inp = document.getElementById('q-lookup');
  const btn = document.getElementById('btn-lookup');
  if (btn) btn.addEventListener('click', () => { /* value already in input */ currentView='lookup'; renderLookup(); });
  if (inp) {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderLookup(); });
    // Keep focus: do not steal when a query exists; restore after rebind
    if (raw) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  bindFileLinks();
}

function renderCycles() {
  const cycles = DATA.cycles || [];
  main.innerHTML = \`
    <div class="panel-card">
      <h3>Cycle SCCs (\${cycles.length}）</h3>
      \${cycles.length ? cycles.map((c,i) =>
        '<div style="margin-bottom:12px"><span class="tag danger">#'+(i+1)+'</span> '
        + c.map(f => '<a class="file-link mono" data-file="'+esc(f)+'">'+esc(f)+'</a>').join(' → ')
        + '</div>'
      ).join('') : '<p class="muted">No circular dependencies detected</p>'}
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
      <h3>Entry import tree</h3>
      \${trees.length ? trees.map(t =>
        '<h4 class="mono">'+esc(t.entry)+'</h4><ul>'+renderEntryTreeNode(t.tree)+'</ul>'
      ).join('') : '<p class="muted">No entry like src/main.js found</p>'}
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
