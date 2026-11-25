#!/usr/bin/env node
/**
 * In-repo copy (2to3): detect missing local import/require targets.
 * Format docs: ../docs/missing-refs-format.md
 * Call via bin/check-refs.js; do not depend on the user global ~/.cursor/skills.
 *
 * Alias resolution uses the nearest project config walking up from each file:
 * - vite.config.* / vue.config.js / webpack.config.* / next.config.*
 * - jsconfig.json / tsconfig.json paths + baseUrl
 * - Defaults: @ -> src, ~ -> project root or src
 *
 * Usage:
 *   node scripts/check-import-refs.mjs [projectRoot] --json [--files-from list.txt]
 *   node scripts/check-import-refs.mjs --self-test
 *
 * Success: with --json { ok:true, ... }, else true; exit 0
 * Failure: JSON (with missing); exit 1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_EXTS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.json',
  '.scss',
  '.sass',
  '.css',
  '.less',
  '.styl',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
]);

const RESOLVE_EXTS = [
  '',
  '.vue',
  '.tsx',
  '.ts',
  '.jsx',
  '.mjs',
  '.js',
  '.cjs',
  '.json',
  '.scss',
  '.sass',
  '.css',
  '.less',
  '/index.vue',
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
  '/index.mjs',
  '/index.json',
];

const CONFIG_CANDIDATES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.mjs',
  'vite.config.js',
  'vite.config.cjs',
  'vue.config.js',
  'vue.config.mjs',
  'vue.config.cjs',
  'webpack.config.js',
  'webpack.config.mjs',
  'webpack.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'craco.config.js',
  'jsconfig.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.base.json',
];

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function normalizeSlashes(p) {
  return p.replace(/\\/g, '/');
}

function isSourceFile(file) {
  return SOURCE_EXTS.has(path.extname(file).toLowerCase());
}

function stripJsonComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function parseJsonc(text) {
  return JSON.parse(stripJsonComments(text));
}

/** Resolve relative paths from config to absolute; supports object/array alias forms */
function addAlias(map, key, value, root) {
  if (key == null || value == null) return;
  let k = String(key).replace(/\/\*$/, '').replace(/\*$/, '').replace(/\/$/, '');
  if (!k) return;
  let v = value;
  if (typeof v === 'object' && v !== null) {
    v = v.replacement || v.find || v[0];
  }
  if (typeof v !== 'string') return;
  // tsconfig paths: "@/*" -> "src/*"; strip wildcards from the target too
  v = v
    .replace(/['"`]/g, '')
    .replace(/\/\*$/, '')
    .replace(/\*$/, '')
    .replace(/\/$/, '');
  if (!v) v = '.';
  if (v.startsWith('file:')) v = fileURLToPath(v);
  const abs = path.isAbsolute(v) ? v : path.resolve(root, v);
  map.set(k, abs);
}

function loadTsJsPaths(root, map) {
  for (const name of ['jsconfig.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json']) {
    const file = path.join(root, name);
    if (!exists(file)) continue;
    try {
      const json = parseJsonc(readText(file));
      const baseUrl = json.compilerOptions?.baseUrl || '.';
      const paths = json.compilerOptions?.paths || {};
      const base = path.resolve(root, baseUrl);
      for (const [alias, targets] of Object.entries(paths)) {
        const target = Array.isArray(targets) ? targets[0] : targets;
        if (!target) continue;
        addAlias(map, alias, path.resolve(base, target), root);
      }
    } catch {
      // ignore broken config
    }
  }
}

/**
 * Pick the last string literal from an alias assignment expression as the target path.
 * Example: '@': resolve(rootDir, './src')  to ./src
 */
function pickAliasTarget(expr) {
  const strs = [...expr.matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1]);
  if (!strs.length) return null;
  // Prefer path segments that start with ./ or include src
  const preferred =
    [...strs].reverse().find(s => s.startsWith('.') || s.includes('src') || s.includes('components')) ||
    strs[strs.length - 1];
  return preferred;
}

/**
 * Extract aliases from bundler config text (do not eval config; avoid plugin side effects).
 * Covers: alias: { '@': ..., '~': ... } and [{ find, replacement }]
 */
function loadBundlerAliases(root, map) {
  for (const name of CONFIG_CANDIDATES) {
    if (name.endsWith('.json')) continue;
    const file = path.join(root, name);
    if (!exists(file)) continue;
    const text = readText(file);

    // Grab alias: { ... } block (brace matching; avoid lazy-regex truncation)
    const aliasIdx = text.search(/\balias\s*:\s*\{/);
    if (aliasIdx >= 0) {
      const braceStart = text.indexOf('{', aliasIdx);
      let depth = 0;
      let end = -1;
      for (let i = braceStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end > braceStart) {
        const body = text.slice(braceStart + 1, end);
        for (const rawLine of body.split(/\r?\n/)) {
          const line = rawLine.replace(/\/\/.*$/, '').trim();
          if (!line || line.startsWith('//')) continue;
          const m = line.match(/^(?:['"`]([^'"`]+)['"`]|(@|~|[\w.-]+))\s*:\s*(.+?)(?:,)?\s*$/);
          if (!m) continue;
          const key = m[1] || m[2];
          const target = pickAliasTarget(m[3]);
          if (key && target) addAlias(map, key, target, root);
        }
      }
    }

    // alias: [{ find: '@', replacement: '...' }]
    const arrRe =
      /find\s*:\s*['"`]([^'"`]+)['"`][\s\S]{0,120}?replacement\s*:\s*([^,\n}]+)/g;
    let a;
    while ((a = arrRe.exec(text))) {
      const target = pickAliasTarget(a[2]);
      if (target) addAlias(map, a[1], target, root);
    }

    // vue-cli: config.resolve.alias.set('@', ...)
    const setRe = /\.set\(\s*['"`]([^'"`]+)['"`]\s*,\s*([^)]+)\)/g;
    let z;
    while ((z = setRe.exec(text))) {
      const target = pickAliasTarget(z[2]);
      if (target) addAlias(map, z[1], target, root);
    }

    // next/webpack: config.resolve.alias['@'] = path.resolve(...)
    const assignRe =
      /(?:resolve\.)?alias\s*(?:\[['\"`]([^'"`]+)['"`]\]|\.([@~\w.-]+))\s*=\s*([^;\n]+)/g;
    let asg;
    while ((asg = assignRe.exec(text))) {
      const key = asg[1] || asg[2];
      const target = pickAliasTarget(asg[3]);
      if (key && target) addAlias(map, key, target, root);
    }
  }
}

function dirHasProjectConfig(dir) {
  return CONFIG_CANDIDATES.some(name => exists(path.join(dir, name)));
}

/**
 * Walk up from the file dir to the nearest project-config root (vite/jsconfig/vue.config, etc.).
 * Do not go past boundary (usually the CLI workspace root).
 */
export function findProjectRoot(filePath, boundary) {
  const stop = path.resolve(boundary);
  let dir = path.dirname(path.resolve(filePath));
  let fallback = null;
  while (true) {
    if (dirHasProjectConfig(dir)) return dir;
    if (exists(path.join(dir, 'package.json'))) fallback = fallback || dir;
    if (dir === stop || path.dirname(dir) === dir) break;
    const parent = path.dirname(dir);
    // Stop if we would leave the boundary
    const rel = path.relative(stop, parent);
    if (rel.startsWith('..') && !path.isAbsolute(rel)) break;
    dir = parent;
  }
  if (dirHasProjectConfig(stop)) return stop;
  return fallback || stop;
}

function discoverAliases(root) {
  const map = new Map();
  loadTsJsPaths(root, map);
  loadBundlerAliases(root, map);

  // Common defaults (do not override already-resolved aliases)
  if (!map.has('@')) addAlias(map, '@', './src', root);
  if (!map.has('~')) {
    // Vue CLI often maps ~ to src; Vite often maps to root. Prefer existing src.
    addAlias(map, '~', exists(path.join(root, 'src')) ? './src' : './', root);
  }
  return map;
}

function aliasesToObject(aliases, root) {
  return Object.fromEntries(
    [...aliases.entries()].map(([k, v]) => [k, normalizeSlashes(path.relative(root, v) || '.')])
  );
}

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) return '';
  return r.stdout || '';
}

function isGitRepo(root) {
  return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).status === 0;
}

/** Uncommitted changes + optional commits vs base branch */
function collectChangedFiles(root, { branchDiff } = {}) {
  const files = new Set();
  const absRoot = path.resolve(root);
  if (!isGitRepo(absRoot)) return [];

  const gitTop = git(absRoot, ['rev-parse', '--show-toplevel']).trim();
  const absGit = gitTop ? path.resolve(gitTop) : absRoot;

  const porcelain = git(absRoot, ['status', '--porcelain', '-uall']);
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // XY PATH or XY ORIG -> PATH
    const renamed = line.match(/^R.\s+.+?->\s+(.+)$/);
    const normal = line.match(/^..\s+(.+)$/);
    const raw = (renamed ? renamed[1] : normal ? normal[1] : '').trim().replace(/^"|"$/g, '');
    if (!raw) continue;
    files.add(normalizeSlashes(raw));
  }

  if (branchDiff) {
    const diff = git(absRoot, ['diff', '--name-only', '--diff-filter=ACMR', branchDiff]);
    for (const line of diff.split(/\r?\n/)) {
      if (line.trim()) files.add(normalizeSlashes(line.trim()));
    }
  } else {
    // Include commits ahead of upstream when present; skip if no upstream
    const upstream = git(absRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).trim();
    if (upstream) {
      const diff = git(absRoot, ['diff', '--name-only', '--diff-filter=ACMR', `${upstream}...HEAD`]);
      for (const line of diff.split(/\r?\n/)) {
        if (line.trim()) files.add(normalizeSlashes(line.trim()));
      }
    }
  }

  const underRoot = p => {
    const rel = path.relative(absRoot, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  return [...files]
    .map(f => {
      const a = path.resolve(absRoot, f);
      if (exists(a)) return a;
      const b = path.resolve(absGit, f);
      if (exists(b)) return b;
      return null;
    })
    .filter(
      f =>
        f &&
        underRoot(f) &&
        isSourceFile(f) &&
        !f.includes(`${path.sep}node_modules${path.sep}`)
    );
}

/**
 * Extract module specifiers. Covers:
 * import x from 'a'
 * import('a')
 * require('a')
 * export { x } from 'a'
 * export * from 'a'
 * Plus request/axios-style: request('@/api/...') if path-like; skip plain URLs
 */
function extractSpecifiers(content) {
  const hits = [];
  // Static import/export must start a statement, so the word "import" inside strings
  // (e.g. desc: 'default import') is not read as a side-effect import; specifiers never span lines.
  const patterns = [
    /(?:^|[;}>])[ \t]*import\s*(?:type\s+)?[^;'"`]*?\bfrom\s*['"`]([^'"`\r\n]+)['"`]/gm,
    /(?:^|[;}>])[ \t]*import\s*['"`]([^'"`\r\n]+)['"`]/gm,
    /\bimport\s*\(\s*['"`]([^'"`\r\n]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`\r\n]+)['"`]\s*\)/g,
    /(?:^|[;}>])[ \t]*export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"`]([^'"`\r\n]+)['"`]/gm,
    // Common wrappers: skip request('/api'); check request('@/x') / request('./x')
    /\b(?:request|axios|http|fetchJson|get|post)\s*\(\s*['"`]([.@~][^'"`\r\n]+)['"`]/g,
  ];

  const lines = content.split(/\r?\n/);
  const lineAt = index => {
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      acc += lines[i].length + 1;
      if (index < acc) return i + 1;
    }
    return lines.length;
  };

  // Strip comments to reduce false positives
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped))) {
      hits.push({ specifier: m[1], line: lineAt(m.index) });
    }
  }
  return hits;
}

function isPackageSpecifier(spec) {
  if (!spec) return true;
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~/'))
    return false;
  if (spec.startsWith('http://') || spec.startsWith('https://') || spec.startsWith('data:'))
    return true;
  if (spec.startsWith('node:')) return true;
  // Scoped package @scope/pkg — distinct from path aliases @/, @components; resolve matches aliases first
  if (/^@[^{/]+\/[^/]+/.test(spec) || /^@[^{/]+$/.test(spec)) return true;
  // lodash, vue, element-plus/dist/index.css: skip as external when no alias hits
  if (!spec.startsWith('@') && !spec.startsWith('~') && !spec.includes(':') && !/^[./]/.test(spec)) {
    return true;
  }
  return false;
}

function resolveWithAliases(spec, fromFile, aliases, root) {
  if (spec.startsWith('.')) {
    return path.resolve(path.dirname(fromFile), spec);
  }
  if (path.isAbsolute(spec) && !spec.startsWith('@') && !spec.startsWith('~')) {
    return spec;
  }

  // Longest-prefix alias match
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (spec === key) return aliases.get(key);
    if (spec.startsWith(`${key}/`)) {
      return path.join(aliases.get(key), spec.slice(key.length + 1));
    }
  }

  // Unaliased "components/xxx"-style: skip as external if package-like
  if (isPackageSpecifier(spec)) return null;

  // Fallback: relative to project root
  return path.resolve(root, spec.replace(/^\//, ''));
}

function fileExistsResolved(absPath) {
  if (!absPath) return false;
  if (exists(absPath) && fs.statSync(absPath).isFile()) return true;
  for (const ext of RESOLVE_EXTS) {
    const candidate = absPath + ext;
    if (exists(candidate) && fs.statSync(candidate).isFile()) return true;
  }
  return false;
}

function shouldSkipSpecifier(spec) {
  if (!spec) return true;
  if (spec.startsWith('virtual:') || spec.startsWith('\0')) return true;
  if (/\?/.test(spec) && !spec.startsWith('.') && !spec.startsWith('@') && !spec.startsWith('~')) {
    // Build-time virtual modules like vue?vue&type=style
  }
  const clean = spec.split('?')[0].split('#')[0];
  if (!clean) return true;
  // Remote CSS
  if (/^https?:/.test(clean)) return true;
  return false;
}

export function checkProject(root, options = {}) {
  const absRoot = path.resolve(root);
  if (!exists(absRoot)) {
    return {
      ok: false,
      error: `Project directory not found: ${absRoot}`,
      missing: [],
    };
  }

  const changed = options.files?.length
    ? options.files.map(f => path.resolve(absRoot, f)).filter(exists)
    : collectChangedFiles(absRoot, options);

  const aliasCache = new Map(); // projectRoot -> Map
  const getAliases = projectRoot => {
    if (!aliasCache.has(projectRoot)) aliasCache.set(projectRoot, discoverAliases(projectRoot));
    return aliasCache.get(projectRoot);
  };

  const missing = [];
  const checkedFiles = [];
  const projectAliasReport = {};

  for (const file of changed) {
    if (!isSourceFile(file)) continue;
    const projectRoot = findProjectRoot(file, absRoot);
    const aliases = getAliases(projectRoot);
    const projKey = normalizeSlashes(path.relative(absRoot, projectRoot) || '.');
    if (!projectAliasReport[projKey]) {
      projectAliasReport[projKey] = aliasesToObject(aliases, projectRoot);
    }

    checkedFiles.push(normalizeSlashes(path.relative(absRoot, file)));
    let content;
    try {
      content = readText(file);
    } catch {
      continue;
    }
    const specs = extractSpecifiers(content);
    for (const { specifier, line } of specs) {
      if (shouldSkipSpecifier(specifier)) continue;
      const clean = specifier.split('?')[0].split('#')[0];

      // Resolve via this file's project aliases first; skip if no hit and looks like npm
      const resolvedBase = resolveWithAliases(clean, file, aliases, projectRoot);
      if (resolvedBase == null) continue;

      if (!fileExistsResolved(resolvedBase)) {
        missing.push({
          file: normalizeSlashes(path.relative(absRoot, file)),
          line,
          specifier: clean,
          missing: normalizeSlashes(path.relative(absRoot, resolvedBase)),
          project: projKey,
        });
      }
    }
  }

  // With no changed files, still load root config so --json can show aliases
  if (!Object.keys(projectAliasReport).length) {
    projectAliasReport['.'] = aliasesToObject(discoverAliases(absRoot), absRoot);
  }

  const single =
    Object.keys(projectAliasReport).length === 1
      ? projectAliasReport[Object.keys(projectAliasReport)[0]]
      : undefined;

  return {
    ok: missing.length === 0,
    root: absRoot,
    aliases: single || projectAliasReport,
    projectAliases: projectAliasReport,
    checkedFiles,
    missing,
  };
}

/* --------------------- self-test fixtures --------------------- */

function writeFixtureTree(base, tree) {
  fs.mkdirSync(base, { recursive: true });
  for (const [rel, body] of Object.entries(tree)) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (body === null) continue; // Directory placeholder only; do not create a file
    fs.writeFileSync(full, body, 'utf8');
  }
}

function runSelfTests() {
  const tmp = path.join(__dirname, '.tmp-check-import-refs');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const cases = [];

  // Case 1: Vite Vue3, @ -> src; missing file should fail
  {
    const root = path.join(tmp, 'vite-vue3-missing');
    writeFixtureTree(root, {
      'vite.config.mjs': `
import { resolve } from 'path';
export default {
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '~': resolve(__dirname, './'),
    },
  },
};
`,
      'jsconfig.json': `{
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } }
}`,
      'src/main.js': `import App from '@/App.vue';\nimport missing from '@/utils/nope.js';\n`,
      'src/App.vue': `<template><div/></template>\n`,
    });
    const r = checkProject(root, { files: ['src/main.js'] });
    cases.push({
      name: 'vite-vue3 missing @/utils/nope.js',
      pass: r.ok === false && r.missing.some(m => m.specifier.includes('utils/nope')),
      detail: r,
    });
  }

  // Case 2: same setup, all files present should pass
  {
    const root = path.join(tmp, 'vite-vue3-ok');
    writeFixtureTree(root, {
      'vite.config.mjs': `
import { resolve } from 'path';
export default { resolve: { alias: { '@': resolve(__dirname, './src') } } };
`,
      'src/main.js': `import App from '@/App.vue';\nimport util from '@/utils/ok.js';\n`,
      'src/App.vue': `<template><div/></template>\n`,
      'src/utils/ok.js': `export default 1;\n`,
    });
    const r = checkProject(root, { files: ['src/main.js'] });
    cases.push({ name: 'vite-vue3 refs complete', pass: r.ok === true, detail: r });
  }

  // Case 3: Vue2 / webpack ~ and @
  {
    const root = path.join(tmp, 'vue2-webpack');
    writeFixtureTree(root, {
      'vue.config.js': `
const path = require('path');
module.exports = {
  configureWebpack: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '~': path.resolve(__dirname, 'src'),
      },
    },
  },
};
`,
      'src/views/Home.vue': `
<script>
import X from '@/components/X.vue';
import Y from '~/components/Missing.vue';
export default {};
</script>
`,
      'src/components/X.vue': `<template><div/></template>\n`,
    });
    const r = checkProject(root, { files: ['src/views/Home.vue'] });
    cases.push({
      name: 'vue2 ~ alias missing file',
      pass: r.ok === false && r.missing.some(m => /Missing/.test(m.specifier)),
      detail: r,
    });
  }

  // Case 4: React + jsconfig paths
  {
    const root = path.join(tmp, 'react-jsconfig');
    writeFixtureTree(root, {
      'jsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"], "@components/*": ["src/components/*"] }
  }
}`,
      'src/App.jsx': `
import Button from '@components/Button';
import ghost from '@/lib/ghost';
`,
      'src/components/Button.jsx': `export default function Button(){return null}\n`,
    });
    const r = checkProject(root, { files: ['src/App.jsx'] });
    cases.push({
      name: 'react jsconfig missing @/lib/ghost',
      pass: r.ok === false && r.missing.some(m => m.specifier.includes('lib/ghost')),
      detail: r,
    });
  }

  // Case 5: Next.js style
  {
    const root = path.join(tmp, 'next-app');
    writeFixtureTree(root, {
      'next.config.mjs': `
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default {
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
};
`,
      'jsconfig.json': `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}`,
      'src/pages/index.jsx': `
import Layout from '@/components/Layout';
import { get } from '@/utils/request';
export default function Page(){return null}
`,
      'src/components/Layout.jsx': `export default function Layout({children}){return children}\n`,
      'src/utils/request.js': `export const get = () => {};\n`,
    });
    const r = checkProject(root, { files: ['src/pages/index.jsx'] });
    cases.push({ name: 'next refs complete', pass: r.ok === true, detail: r });
  }

  // Case 6: relative path missing + require
  {
    const root = path.join(tmp, 'relative-require');
    writeFixtureTree(root, {
      'src/a.js': `
const b = require('./b');
import c from './c.ts';
`,
      'src/b.js': `module.exports = 1;\n`,
    });
    const r = checkProject(root, { files: ['src/a.js'] });
    cases.push({
      name: 'relative path missing ./c.ts',
      pass: r.ok === false && r.missing.some(m => m.specifier.includes('./c')),
      detail: r,
    });
  }

  // Case 7: omitted extension / index resolve
  {
    const root = path.join(tmp, 'index-resolve');
    writeFixtureTree(root, {
      'jsconfig.json': `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}`,
      'src/main.ts': `import mod from '@/features/hello';\n`,
      'src/features/hello/index.ts': `export default 'ok';\n`,
    });
    const r = checkProject(root, { files: ['src/main.ts'] });
    cases.push({ name: 'directory index resolve pass', pass: r.ok === true, detail: r });
  }

  // Case 8: external packages should not error
  {
    const root = path.join(tmp, 'external-pkg');
    writeFixtureTree(root, {
      'src/main.js': `
import vue from 'vue';
import axios from 'axios';
import scope from '@vue/shared';
`,
    });
    const r = checkProject(root, { files: ['src/main.js'] });
    cases.push({ name: 'external npm packages skipped', pass: r.ok === true, detail: r });
  }

  // Case 9: request('@/api/foo') local path check
  {
    const root = path.join(tmp, 'request-alias');
    writeFixtureTree(root, {
      'jsconfig.json': `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}`,
      'src/page.js': `
import request from '@/utils/request';
request('@/api/missing-module');
request('/blade-system/ok');
`,
      'src/utils/request.js': `export default function request(){}\n`,
    });
    const r = checkProject(root, { files: ['src/page.js'] });
    cases.push({
      name: 'request(@/...) reports missing module',
      pass: r.ok === false && r.missing.some(m => m.specifier.includes('api/missing')),
      detail: r,
    });
  }

  // Case 10: short alias components/
  {
    const root = path.join(tmp, 'short-alias');
    writeFixtureTree(root, {
      'vite.config.ts': `
import { resolve } from 'path';
export default {
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      components: resolve(__dirname, './src/components'),
    },
  },
};
`,
      'src/views/x.vue': `
<script setup>
import A from 'components/A.vue';
import B from 'components/B.vue';
</script>
`,
      'src/components/A.vue': `<template><div/></template>\n`,
    });
    const r = checkProject(root, { files: ['src/views/x.vue'] });
    cases.push({
      name: 'short alias components missing B',
      pass: r.ok === false && r.missing.some(m => m.specifier.includes('components/B')),
      detail: r,
    });
  }

  // Case 11: workspace-root check of subproject file — must read subproject vite config (styles, etc.)
  {
    const root = path.join(tmp, 'monorepo');
    writeFixtureTree(root, {
      'README.md': '# workspace\n',
      'app-a/vite.config.mjs': `
import { resolve } from 'path';
export default {
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      styles: resolve(__dirname, './src/styles'),
    },
  },
};
`,
      'app-a/jsconfig.json': `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}`,
      'app-a/src/main.js': `
import 'styles/common.scss';
import x from '@/utils/ok.js';
import 'element-plus/dist/index.css';
`,
      'app-a/src/styles/common.scss': `body{}\n`,
      'app-a/src/utils/ok.js': `export default 1;\n`,
      'app-b/vite.config.mjs': `
import { resolve } from 'path';
export default { resolve: { alias: { '@': resolve(__dirname, './src') } } };
`,
      'app-b/src/main.js': `import missing from '@/nope.js';\n`,
    });
    const rOk = checkProject(root, { files: ['app-a/src/main.js'] });
    cases.push({
      name: 'workspace root reads subproject config (styles/@)',
      pass:
        rOk.ok === true &&
        rOk.projectAliases?.['app-a']?.styles === 'src/styles' &&
        rOk.projectAliases?.['app-a']?.['@'] === 'src',
      detail: rOk,
    });
    const rMiss = checkProject(root, { files: ['app-b/src/main.js'] });
    cases.push({
      name: 'workspace root subproject missing file',
      pass: rMiss.ok === false && rMiss.missing.some(m => m.project === 'app-b'),
      detail: rMiss,
    });
  }

  // Case 12: next.config assignment form alias['@'] = ...
  {
    const root = path.join(tmp, 'next-assign-alias');
    writeFixtureTree(root, {
      'next.config.mjs': `
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default {
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
};
`,
      'src/pages/index.jsx': `import Layout from '@/components/Layout';\n`,
      'src/components/Layout.jsx': `export default function Layout({children}){return children}\n`,
    });
    const r = checkProject(root, { files: ['src/pages/index.jsx'] });
    cases.push({
      name: 'next alias[\'@\']= assignment parse',
      pass: r.ok === true && r.aliases?.['@'] === 'src',
      detail: r,
    });
  }

  // Case 13: the word "import" inside string literals is not a side-effect import
  {
    const root = path.join(tmp, 'import-in-string');
    writeFixtureTree(root, {
      'vite.config.mjs': `export default { resolve: { alias: { '@': './src' } } };\n`,
      'src/Page.vue': `<template><div /></template>
<script setup>import ok from '@/ok.js'
import {
  a,
  b,
} from './multi.js'
const rows = [{
  desc: 'default import',
  expect: 'tag:x',
}, { desc: 'side import', expect: 'y' }]
const lazy = () => import('./lazy.js')
</script>
`,
      'src/ok.js': `export default 1;\n`,
      'src/multi.js': `export const a = 1, b = 2;\n`,
      'src/lazy.js': `export default 1;\n`,
    });
    const r = checkProject(root, { files: ['src/Page.vue'] });
    cases.push({
      name: 'string containing "import" is not a module specifier',
      pass: r.ok === true,
      detail: r,
    });
  }

  const failed = cases.filter(c => !c.pass);
  console.log('===== self-test =====');
  for (const c of cases) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) console.log(JSON.stringify(c.detail.missing || c.detail, null, 2));
  }
  console.log(`total=${cases.length} fail=${failed.length}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

/* --------------------- CLI --------------------- */

function printUsage() {
  console.log(`Usage:
  node check-import-refs.mjs [projectRoot] [--branch-diff <ref>] [--files a,b] [--files-from list.txt]
  node check-import-refs.mjs --self-test

Options:
  --branch-diff <ref>   Also compare git diff --name-only <ref> (e.g. origin/dev)
  --files a,b,c         Check only these source files relative to project root (migration use)
  --files-from <path>   Read path list from a text file (one per line)
  --json                Always print full JSON on success too
  --self-test           Run built-in multi-framework cases
`);
}

function takeFlagValue(argv, flag, skip) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  skip.add(idx);
  if (idx + 1 < argv.length) {
    skip.add(idx + 1);
    return argv[idx + 1];
  }
  return undefined;
}

function parseFilesOption(argv, skip, root) {
  const fromArg = takeFlagValue(argv, '--files', skip);
  const fromFile = takeFlagValue(argv, '--files-from', skip);
  const list = [];
  if (fromArg) {
    list.push(
      ...fromArg
        .split(/[,;\n]/)
        .map(s => s.trim())
        .filter(Boolean)
    );
  }
  if (fromFile) {
    const abs = path.isAbsolute(fromFile) ? fromFile : path.resolve(root || process.cwd(), fromFile);
    if (exists(abs)) {
      list.push(
        ...readText(abs)
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(s => s && !s.startsWith('#'))
      );
    }
  }
  return [...new Set(list)];
}

function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }
  if (argv.includes('--self-test')) {
    runSelfTests();
    return;
  }

  const skip = new Set();
  const mark = flag => {
    const i = argv.indexOf(flag);
    if (i >= 0) {
      skip.add(i);
      if (i + 1 < argv.length) skip.add(i + 1);
    }
  };
  mark('--branch-diff');
  mark('--files');
  mark('--files-from');
  const wantJson = argv.includes('--json');
  if (wantJson) {
    const ji = argv.indexOf('--json');
    if (ji >= 0) skip.add(ji);
  }

  const rootArg = argv.find((a, i) => !a.startsWith('-') && !skip.has(i));
  const root = rootArg ? path.resolve(rootArg) : process.cwd();

  const branchDiff = takeFlagValue(argv, '--branch-diff', new Set());
  const files = parseFilesOption(argv, new Set(), root);

  const result = checkProject(root, {
    branchDiff,
    ...(files.length ? { files } : {}),
  });
  if (result.ok) {
    if (wantJson) console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    else console.log('true');
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        ok: false,
        missing: result.missing.map(m => ({
          file: m.file,
          line: m.line,
          specifier: m.specifier,
          missing: m.missing,
          project: m.project,
        })),
        aliases: result.aliases,
        projectAliases: result.projectAliases,
        checkedFiles: result.checkedFiles,
      },
      null,
      2
    )
  );
  process.exit(1);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main(process.argv.slice(2));
