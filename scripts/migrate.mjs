// Hexo -> Starlight 迁移脚本
// 用法: node scripts/migrate.mjs
// 输入: legacy/source/**, legacy/FAQ/**, legacy/images/, legacy/source/_data/sidebar.yml
// 输出: src/content/docs/**, src/sidebar.generated.mjs, src/redirects.generated.mjs, public/**
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'legacy/source');
const FAQ = path.join(ROOT, 'legacy/FAQ');
const DOCS = path.join(ROOT, 'src/content/docs');
const PUBLIC_IMAGES = path.join(ROOT, 'public/images');
const SIDEBAR_YML = path.join(ROOT, 'legacy/source/_data/sidebar.yml');

const stats = { files: 0, htmlHeadings: 0, links: 0, missingTitle: 0 };
const report = { sidebarMissing: [], brokenLinks: new Map(), missingImages: [] };

// ---------- 工具 ----------

// Hexo URL -> Starlight URL (小写化 + 尾斜杠, 保留锚点原样)
// Starlight docsLoader 会将 slug 全部小写
function toUrl(url) {
  let anchor = '';
  const h = url.indexOf('#');
  if (h >= 0) { anchor = url.slice(h); url = url.slice(0, h); }
  url = url.split('?')[0];
  if (url.endsWith('.html')) url = url.slice(0, -5);
  if (url.endsWith('/index')) url = url.slice(0, -5);
  url = url.toLowerCase();
  if (url === '' ) url = '/';
  if (!url.endsWith('/') && url !== '/') url += '/';
  return url + anchor;
}

// Starlight URL -> src/content/docs 下的文件路径 (大小写不敏感)
function findEntry(dir, name, wantDir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (e.name.toLowerCase() === name.toLowerCase() && (wantDir ? e.isDirectory() : e.isFile())) {
      return path.join(dir, e.name);
    }
  }
  return null;
}

function urlToDocFile(url) {
  let u = url.split('#')[0].split('?')[0].toLowerCase();
  if (u.endsWith('/')) u = u.slice(0, -1);
  if (u === '' || u === '/') return findEntry(DOCS, 'index.md', false) || null;
  const parts = u.split('/').filter(Boolean);
  let cur = DOCS;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const name = parts[i];
    if (last) {
      // 优先 name.md, 其次 name/index.md
      const f = findEntry(cur, name + '.md', false);
      if (f) return f;
      const d = findEntry(cur, name, true);
      if (d) return findEntry(d, 'index.md', false) || null;
      return null;
    }
    const d = findEntry(cur, name, true);
    if (!d) return null;
    cur = d;
  }
  return null;
}

const yamlStr = (s) => JSON.stringify(String(s).trim());

// ---------- frontmatter / 正文转换 ----------

function splitFrontmatter(raw) {
  raw = raw.replace(/^[\r\n\uFEFF]+/, '');
  // 标准 YAML frontmatter
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end >= 0) {
      const fmText = raw.slice(3, end);
      const body = raw.slice(end + 4).replace(/^\n+/, '');
      const fm = {};
      for (const line of fmText.split('\n')) {
        const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (m) fm[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
      }
      return { fm, body };
    }
  }
  // 伪 frontmatter: 文件以 "title: X" 行开头, 紧跟一条 --- 水平线
  const pseudo = raw.match(/^title:[ \t]*(.+?)[ \t]*\r?\n---\r?\n?/);
  if (pseudo) {
    return { fm: { title: pseudo[1].trim() }, body: raw.slice(pseudo[0].length).replace(/^\n+/, '') };
  }
  return { fm: {}, body: raw };
}

// <h2 id='x' class="...">y</h2> -> ## y
function convertHtmlHeadings(body) {
  return body.replace(/^[ \t]*<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>[ \t]*$/gm, (m, lvl, attrs, text) => {
    stats.htmlHeadings++;
    return `${'#'.repeat(Number(lvl))} ${text.trim()}`;
  });
}

// 站内 .html 链接 -> Starlight 尾斜杠链接
function convertLinks(body, fileRelDir) {
  return body.replace(/(!?)\]\(([^)\s]+)\)/g, (m, bang, target) => {
    if (bang) return m; // 图片走 public，不改
    if (/^(https?:|mailto:|\/\/)/i.test(target)) return m;
    if (target.startsWith('#')) return m;
    if (target.startsWith('/images/')) return m;
    if (!/\.html?$/.test(target)) return m;
    let resolved = target;
    if (!target.startsWith('/')) {
      // 相对链接 -> 绝对
      resolved = path.posix.normalize(path.posix.join('/', fileRelDir, target));
    }
    stats.links++;
    return `](${toUrl(resolved)})`;
  });
}

function convertFile(srcFile, relPath, labelFallback) {
  const raw = fs.readFileSync(srcFile, 'utf8');
  const { fm, body } = splitFrontmatter(raw);
  let title = (fm.title || '').trim();
  if (!title) {
    title = (labelFallback || path.basename(relPath, '.md')).trim();
    stats.missingTitle++;
  }
  const relDir = path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath);
  let body2 = convertLinks(convertHtmlHeadings(body), relDir);
  // 修正个别错误语言标签
  body2 = body2
    .replace(/^```javascripte$/gm, '```javascript')
    .replace(/^```obj$/gm, '```objectivec');
  const out = `---\ntitle: ${yamlStr(title)}\n---\n\n${body2.trim()}\n`;
  const dest = path.join(DOCS, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  stats.files++;
  return title;
}

// ---------- sidebar.yml -> Starlight sidebar ----------

const PRODUCT_LABELS = {
  overview: '概览',
  sync: '实时通信引擎 Sync',
  conversation: '一对一视频通话',
  conference: '多人视频通话',
  location: '实时定位',
  sms: '智能短信',
  auth: '身份认证',
  video: '视频通话（旧版）',
  im: '即时通讯 IM',
  console: '控制台指南',
  api: '旧版文档',
  faq: '常见问题 FAQ',
};

// 单链接子树提升: { A: { B: url } } -> { label: A, link: url }
function flattenNode(label, node) {
  if (typeof node === 'string') return { label, link: toUrl(node) };
  const entries = Object.entries(node);
  if (entries.length === 1 && typeof entries[0][1] === 'string') {
    return { label, link: toUrl(entries[0][1]) };
  }
  return {
    label,
    collapsed: true,
    items: entries.map(([k, v]) => flattenNode(k, v)),
  };
}

// ---------- 目录 walk 生成 sidebar (im/video/console/api/faq 用) ----------

const DIR_LABELS = {
  guide: '完整指南',
  api: 'API 文档',
  rules: '安全性与规则',
  resources: '示例代码',
  quickstart: '快速入门',
  bestpractice: '最佳实践',
  payment: '付费相关',
  newbie: '新手常见问题',
  tech: '技术常见问题',
  auth: '身份认证',
  sync: '实时通信引擎',
  video: '视频通话',
  Android: 'Android',
  iOS: 'iOS',
  Web: 'Web',
  Java: 'Java',
  C: 'C',
  REST: 'REST',
  微信小程序: '微信小程序',
};
const FILE_LABELS = {
  'index.md': '概览',
  'quickstart.md': '快速入门',
  'changelog.md': '更新日志',
};

// 收集目录下所有 md 的 frontmatter title
function fileTitle(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { fm } = splitFrontmatter(raw);
  return (fm.title || '').trim();
}

const ORDER = ['index.md', 'quickstart.md', 'quickstart', 'guide', 'api', 'rules', 'resources', 'changelog.md'];

function dirToSidebar(absDir, urlPrefix) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter((e) => e.name !== '.DS_Store');
  const items = [];
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('_'));
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
  const sorted = [
    ...files.filter((f) => f.name === 'index.md'),
    ...dirs.sort((a, b) => {
      const ia = ORDER.indexOf(a.name); const ib = ORDER.indexOf(b.name);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
    }),
    ...files.filter((f) => f.name !== 'index.md').sort((a, b) => a.name.localeCompare(b.name)),
  ];
  for (const e of sorted) {
    if (e.isDirectory()) {
      const sub = dirToSidebar(path.join(absDir, e.name), `${urlPrefix}${e.name.toLowerCase()}/`);
      const childLinks = countLinks(sub);
      const label = DIR_LABELS[e.name] || e.name;
      if (childLinks === 1) {
        const only = firstLink(sub);
        items.push({ label, link: only });
      } else {
        items.push({ label, collapsed: true, items: sub });
      }
    } else {
      const name = e.name;
      const label = FILE_LABELS[name] || fileTitle(path.join(absDir, name)) || name.replace(/\.md$/, '');
      const link = name === 'index.md' ? (urlPrefix || '/') : `${urlPrefix}${name.replace(/\.md$/, '').toLowerCase()}/`;
      items.push({ label, link });
    }
  }
  return items;
}

function countLinks(node) {
  if (Array.isArray(node)) return node.reduce((s, n) => s + countLinks(n), 0);
  if (node.link) return 1;
  return countLinks(node.items || []);
}
function firstLink(node) {
  if (Array.isArray(node)) { for (const n of node) { const l = firstLink(n); if (l) return l; } return null; }
  if (node.link) return node.link;
  return firstLink(node.items || []);
}

// ---------- 主流程 ----------

fs.rmSync(DOCS, { recursive: true, force: true });
fs.rmSync(path.join(ROOT, 'src/sidebar.generated.mjs'), { force: true });
fs.rmSync(path.join(ROOT, 'public'), { recursive: true, force: true });
fs.mkdirSync(DOCS, { recursive: true });
fs.mkdirSync(PUBLIC_IMAGES, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });

// 1) 读取 sidebar.yml, 建立 URL->label 映射
const sidebarTree = yaml.load(fs.readFileSync(SIDEBAR_YML, 'utf8'));
const urlLabels = new Map();
(function walk(node) {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') urlLabels.set(toUrl(v), k.trim());
    else walk(v);
  }
})(sidebarTree);

// 2) 迁移 source/ 全部 md（跳过 _data/_posts/result）
const skipDirs = new Set(['_data', '_posts', 'result']);
(function migrateSrc(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue;
      migrateSrc(full);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      const rel = path.relative(SRC, full);
      const relPosix = rel.split(path.sep).join('/');
      const url = toUrl('/' + relPosix.replace(/\.md$/, e.name === 'index.md' ? '' : ''));
      const label = urlLabels.get(url);
      convertFile(full, relPosix, label);
    }
  }
})(SRC);

// 3) 迁移 FAQ/
(function migrateFaq(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) migrateFaq(full);
    else if (e.name.endsWith('.md')) {
      const rel = path.relative(FAQ, full);
      convertFile(full, 'faq/' + rel.split(path.sep).join('/'), null);
    }
  }
})(FAQ);

// 4) 复制图片（legacy/images，合并 source/images 中的补充资源）
for (const imgDir of [path.join(ROOT, 'legacy/images'), path.join(ROOT, 'legacy/source/images')]) {
  if (!fs.existsSync(imgDir)) continue;
  for (const f of fs.readdirSync(imgDir)) {
    const src = path.join(imgDir, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(PUBLIC_IMAGES, f));
  }
}

// 5) 生成 sidebar
const sidebar = [];
for (const [product, tree] of Object.entries(sidebarTree)) {
  const node = flattenNode(PRODUCT_LABELS[product] || product, tree);
  sidebar.push(node);
}

// im / video / console / api：目录 walk 生成
for (const dir of ['im', 'video', 'console', 'api']) {
  const abs = path.join(SRC, dir);
  if (!fs.existsSync(abs)) continue;
  const items = dirToSidebar(abs, `/${dir}/`);
  const links = countLinks(items);
  const label = PRODUCT_LABELS[dir];
  if (links === 1) sidebar.push({ label, link: firstLink(items) });
  else sidebar.push({ label, collapsed: true, items });
}

// FAQ
const faqItems = dirToSidebar(path.join(ROOT, 'src/content/docs/faq'), '/faq/');
sidebar.push({ label: PRODUCT_LABELS.faq, collapsed: true, items: faqItems });

const sidebarJs = `// 由 scripts/migrate.mjs 生成，勿手改\nexport const sidebar = ${JSON.stringify(sidebar, null, 2)};\n`;
fs.writeFileSync(path.join(ROOT, 'src/sidebar.generated.mjs'), sidebarJs);

// 5.5) 旧 URL 兼容:
// - 首页已由营销站镜像 (site-mirror/index.html) 占据, 无需 '/' 跳转
// - Astro redirects 仅用于根路径 (Astro 静态构建会把 .html 形态 redirect 生成目录, 无法命中)
// - 其余兼容走 public/ 下的 meta-refresh HTML 文件, 静态托管按字面路径命中
const redirects = {};

function redirectPage(target) {
  return `<!DOCTYPE html>
<html lang="zh" data-pagefind-ignore>
<head>
<meta charset="utf-8">
<title>Redirecting…</title>
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0;url=${target}">
</head>
<body>
<p>本页面已迁移，正在跳转到 <a href="${target}">新地址</a>…</p>
</body>
</html>
`;
}

const compatFiles = {};
(function buildCompat(dir, relPrefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      buildCompat(path.join(dir, e.name), relPrefix + e.name + '/');
    } else if (e.name.endsWith('.md') && e.name !== 'index.md') {
      // 旧站 URL 均为 .html 形态; 目录 index 形态在大小写不敏感文件系统上会与真实页面输出冲突,
      // 由 scripts/postbuild.mjs 构建后镜像处理
      const rel = relPrefix + e.name.slice(0, -3);
      compatFiles[rel + '.html'] = ('/' + rel).toLowerCase() + '/';
    }
  }
})(DOCS, '');

for (const [file, target] of Object.entries(compatFiles)) {
  const dest = path.join(ROOT, 'public', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, redirectPage(target));
}

// 5.6) 营销站镜像 (scripts/mirror-site.mjs 产物) 拷入 public/
// 首页 index.html、/product/*、/blog/*、/life/*、/status/*、/hacker/*、/_m/* 资产
const SITE_MIRROR = path.join(ROOT, 'site-mirror');
if (fs.existsSync(SITE_MIRROR)) {
  fs.cpSync(SITE_MIRROR, path.join(ROOT, 'public'), { recursive: true });
}
const redirectsJs = `// 由 scripts/migrate.mjs 生成，勿手改\nexport const redirects = ${JSON.stringify(redirects, null, 2)};\n`;
fs.writeFileSync(path.join(ROOT, 'src/redirects.generated.mjs'), redirectsJs);

// 6) 校验: sidebar 链接 -> 文件存在性
for (const node of sidebar) checkSidebarLinks(node);
function checkSidebarLinks(node) {
  if (Array.isArray(node)) { node.forEach(checkSidebarLinks); return; }
  if (node.link) {
    if (!urlToDocFile(node.link)) report.sidebarMissing.push(`${node.label} -> ${node.link}`);
  }
  if (node.items) checkSidebarLinks(node.items);
}

// 校验: 正文内部链接
const allConverted = [];
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full);
    else if (e.name.endsWith('.md')) allConverted.push(full);
  }
})(DOCS);

const linkRe = /\]\((\/[^)#\s]+)\)/g;
for (const f of allConverted) {
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = linkRe.exec(text))) {
    const target = m[1];
    if (target.startsWith('/images/')) {
      if (!fs.existsSync(path.join(ROOT, 'public', target))) report.missingImages.push(target);
      continue;
    }
    if (!urlToDocFile(target)) {
      const key = target;
      if (!report.brokenLinks.has(key)) report.brokenLinks.set(key, []);
      report.brokenLinks.get(key).push(path.relative(DOCS, f));
    }
  }
}

// 7) 报告
const rep = [
  `# 迁移报告`,
  `- 迁移文件: ${stats.files}`,
  `- 生成旧 URL 兼容跳转页: ${Object.keys(compatFiles).length}`,
  `- HTML 标题转换: ${stats.htmlHeadings}`,
  `- 链接转换: ${stats.links}`,
  `- 缺 frontmatter 标题(用目录/文件名兜底): ${stats.missingTitle}`,
  `\n## sidebar 条目指向不存在的文件 (${report.sidebarMissing.length})`,
  ...report.sidebarMissing.map((s) => `- ${s}`),
  `\n## 正文死链 (${[...report.brokenLinks.keys()].length})`,
  ...[...report.brokenLinks.entries()].map(([k, v]) => `- ${k} (被引用 ${v.length} 次)`),
  `\n## 缺失图片 (${report.missingImages.length})`,
  ...report.missingImages.map((s) => `- ${s}`),
].join('\n');
fs.writeFileSync(path.join(ROOT, 'tmp/migration-report.md'), rep);
console.log(rep);
