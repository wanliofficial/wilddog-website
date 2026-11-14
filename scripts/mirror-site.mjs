// wilddog.com 营销站镜像脚本（web.archive.org → site-mirror/）
// 用法: node scripts/mirror-site.mjs [--force]
// - 按 PAGES 清单抓取归档页面(id_ 模式, 原始字节), 重写站内链接/资源引用后写入 site-mirror/
// - CSS/JS/图片资源: cdn.wilddog.com → /_m/<路径>; 各子站资源 → /<子站前缀>/<路径>
// - 产物由 scripts/migrate.mjs 复制进 public/; 本脚本只在清单变更时手动重跑
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'site-mirror');
const FORCE = process.argv.includes('--force');
const ARCHIVE = 'https://web.archive.org/web/';
const UA = 'wilddog-archive-mirror/1.0 (+local site migration)';

// ---------- 页面清单 (用户提供的 web.archive.org 快照) ----------
const PAGES = [
  // www.wilddog.com → 根路径, 目录形式 (静态托管 clean URL)
  { ts: '20190501134418', url: 'https://www.wilddog.com/', out: 'index.html', site: 'www' },
  { ts: '20190317100110', url: 'https://www.wilddog.com/product/message-overview', out: 'product/message-overview/index.html', site: 'www' },
  { ts: '20190317083253', url: 'https://www.wilddog.com/product/sync-overview', out: 'product/sync-overview/index.html', site: 'www' },
  { ts: '20190317104208', url: 'https://www.wilddog.com/product/product-overview', out: 'product/product-overview/index.html', site: 'www' },
  { ts: '20190317090405', url: 'https://www.wilddog.com/product/pricing', out: 'product/pricing/index.html', site: 'www' },
  { ts: '20190317095608', url: 'https://www.wilddog.com/product/customer/overview', out: 'product/customer/overview/index.html', site: 'www' },
  { ts: '20170606212918', url: 'https://www.wilddog.com/product/product-features', out: 'product/product-features/index.html', site: 'www' },
  { ts: '20190317092733', url: 'https://www.wilddog.com/product/sales', out: 'product/sales/index.html', site: 'www' },
  { ts: '20190317105856', url: 'https://www.wilddog.com/download', out: 'download/index.html', site: 'www' },
  { ts: '20190317083410', url: 'https://www.wilddog.com/my-account/login', out: 'my-account/login/index.html', site: 'www' },
  { ts: '20190317101626', url: 'https://www.wilddog.com/my-account/signup', out: 'my-account/signup/index.html', site: 'www' },
  // blog.wilddog.com (WordPress) → /blog/; ?cat=N → /blog/cat-N/
  { ts: '20181130233100', url: 'https://blog.wilddog.com/', out: 'blog/index.html', site: 'blog' },
  { ts: '20190317102520', url: 'https://blog.wilddog.com/?cat=28', out: 'blog/cat-28/index.html', site: 'blog' },
  { ts: '20190317091222', url: 'https://blog.wilddog.com/?cat=70', out: 'blog/cat-70/index.html', site: 'blog' },
  // status.wilddog.com → /status/
  { ts: '20190317105502', url: 'https://status.wilddog.com/', out: 'status/index.html', site: 'status' },
  // life.wilddog.com → /life/
  { ts: '20190122211408', url: 'https://life.wilddog.com/', out: 'life/index.html', site: 'life' },
  { ts: '20190317082948', url: 'https://life.wilddog.com/wilddog-contact.html', out: 'life/wilddog-contact.html', site: 'life' },
  { ts: '20190317103943', url: 'https://life.wilddog.com/wilddog-all-job.html', out: 'life/wilddog-all-job.html', site: 'life' },
  // hacker.wilddog.com → /hacker/
  { ts: '20190317094913', url: 'https://hacker.wilddog.com/', out: 'hacker/index.html', site: 'hacker' },
];

const PREFIX = { www: '', blog: '/blog', status: '/status', life: '/life', hacker: '/hacker' };
const ASSET_RE = /\.(css|mjs|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|webp|json|txt)$/i;
// 资源属性所在标签 (只对这些标签的 href/src 入队下载; <a href> 只重写不下载)
const RES_TAG_RE = /<(?:link|script|img|source|video|audio|embed|object|use)\b[^>]*>/gi;
const ATTR_RE = /\b(href|src|data-original|data-background|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const URL_FN_RE = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^'")\s]+))\s*\)/gi;
const SKIP_LINK_RE = /rel\s*=\s*["'][^"']*(dns-prefetch|preconnect)[^"']*["']/i;

const report = { pages: [], assets: 0, skipped: [], failed: [] };
const queue = new Map(); // key: 原始绝对URL(小写host) -> { ts, out } 待下载资源

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decodeP = (p) => { try { return decodeURIComponent(p); } catch { return p; } };

// ---------- URL 重写 ----------

// docs.wilddog.com → 本地 Starlight 文档 URL (与 scripts/migrate.mjs toUrl 规则一致)
function toDocsLocal(u) {
  let p = u.pathname;
  if (/\.html?$/i.test(p)) p = p.replace(/\.html?$/, '');
  if (p.endsWith('/index')) p = p.slice(0, -6);
  p = p.toLowerCase();
  if (p === '') p = '/';
  if (!p.endsWith('/') && p !== '/') p += '/';
  return p;
}

function blogLocal(u) {
  const q = u.searchParams;
  if (q.has('cat')) return `/blog/cat-${q.get('cat')}/`;
  if (q.has('p')) return `/blog/p-${q.get('p')}/`;
  if (q.has('author')) return `/blog/author-${q.get('author')}/`;
  return '/blog' + (u.pathname === '/' ? '/' : u.pathname); // ?ver= 等查询参数丢弃
}

// 任意 URL(相对则按 baseUrl 绝对化) → 本地路径; 返回 null 表示保持原样
function rewrite(rawUrl, baseUrl) {
  if (!rawUrl || /^(?:#|mailto:|javascript:|data:|tel:)/i.test(rawUrl)) return null;
  let u;
  try { u = new URL(rawUrl, baseUrl); } catch { return null; }
  switch (u.hostname) {
    case 'cdn.wilddog.com': // 双斜杠路径规范化, query 丢弃
      return '/_m' + u.pathname.replace(/\/{2,}/g, '/');
    case 'docs.wilddog.com':
      return toDocsLocal(u) + u.hash;
    case 'www.wilddog.com': // 保持无扩展名形态 (静态托管目录命中)
      return u.pathname + u.search + u.hash;
    case 'blog.wilddog.com':
      return blogLocal(u) + u.hash;
    case 'status.wilddog.com':
      return '/status' + (u.pathname === '/' ? '/' : u.pathname) + u.search + u.hash;
    case 'life.wilddog.com':
      return '/life' + (u.pathname === '/' ? '/' : u.pathname) + u.hash;
    case 'hacker.wilddog.com':
      return '/hacker' + (u.pathname === '/' ? '/' : u.pathname) + u.hash;
    default:
      return null; // 外部域(github/kf5/qq/weibo/z.wilddog/hacker2015...)原样保留
  }
}

// ---------- 抓取 ----------

// 404 变体: Wayback 把 带query/不带query、双斜杠/单斜杠 视为不同归档条目
function variants(absUrl) {
  const out = [absUrl];
  let u;
  try { u = new URL(absUrl); } catch { return out; }
  if (u.search) out.push(u.origin + u.pathname); // 去 query
  const flat = u.pathname.replace(/([^:])\/{2,}/g, '$1/');
  if (flat !== u.pathname) out.push(u.origin + flat); // 双斜杠压平
  else {
    const m = u.pathname.match(/^\/[^/]+\/\S/); // 首段后插双斜杠 (/hacker2016//x)
    if (m) out.push(u.origin + '/' + u.pathname.slice(1).replace('/', '//'));
  }
  return [...new Set(out)];
}

async function fetchArchive(absUrl, ts, binary = true, tries = 4) {
  let lastNull = false;
  for (const target of [absUrl, ...variants(absUrl).slice(1)]) {
    const url = ARCHIVE + ts + 'id_/' + target;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
        if (res.status === 200) return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
        if (res.status === 404 || res.status === 410) { lastNull = true; break; }
      } catch { /* 网络抖动, 重试 */ }
      await sleep(1500 * (i + 1));
    }
  }
  return lastNull ? null : undefined; // null=归档无此资源, undefined=重试耗尽
}

function save(relPath, buf) {
  const dest = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

// ---------- HTML / CSS 处理 ----------

// 重写文本中所有资源属性; isResTagOnly=false 时也处理 <a href> 等
function rewriteAttrs(html, pageUrl, collectAssets) {
  return html.replace(ATTR_RE, (m, attr, v1, v2) => {
    const val = v1 ?? v2;
    if (!val) return m;
    const local = rewrite(val, pageUrl);
    if (local === null || local === val) return m;
    if (collectAssets && ASSET_RE.test(local.split('?')[0].split('#')[0])) {
      try {
        const abs = new URL(val, pageUrl);
        queue.set(abs.origin + abs.pathname + abs.search, { ts: TS.get(pageUrl) || CURRENT_TS, out: local });
      } catch { /* 忽略 */ }
    }
    return `${attr}="${local}"`;
  });
}

function rewriteCssUrls(css, cssUrl) {
  return css.replace(URL_FN_RE, (m, v1, v2, v3) => {
    const val = v1 ?? v2 ?? v3;
    if (!val || /^(?:data:|#)/i.test(val)) return m;
    const local = rewrite(val, cssUrl);
    if (local === null || local === val) return m;
    if (ASSET_RE.test(local.split('?')[0].split('#')[0])) {
      try {
        const abs = new URL(val, cssUrl);
        queue.set(abs.origin + abs.pathname + abs.search, { ts: CURRENT_TS, out: local });
      } catch { /* 忽略 */ }
    }
    return `url("${local}")`;
  });
}

function processHtml(html, page) {
  // 1) 摘出 dns-prefetch/preconnect link (不做重写)
  const held = [];
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (SKIP_LINK_RE.test(tag)) { held.push(tag); return `<!--WDMIRROR${held.length - 1}-->`; }
    return tag;
  });
  // 2) 资源标签: 重写 + 入队
  html = html.replace(RES_TAG_RE, (tag) => rewriteAttrs(tag, page.url, true));
  // 3) 其余属性 (<a href> 等): 只重写
  html = rewriteAttrs(html, page.url, false);
  // 4) 内联 <style> 块: url() 重写 + 入队
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css) =>
    m.slice(0, m.indexOf('>') + 1) + rewriteCssUrls(css, page.url) + '</style>');
  // 5) 放回 dns-prefetch
  html = html.replace(/<!--WDMIRROR(\d+)-->/g, (_, i) => held[Number(i)]);
  // 6) 根元素注入 data-pagefind-ignore (不进文档搜索索引; 与旧URL兼容页同一惯例)
  if (/data-pagefind-ignore/.test(html)) return html;
  return html.replace(/<html\b([^>]*)>/i, (m, attrs) => `<html${attrs} data-pagefind-ignore>`);
}

// ---------- 主流程 ----------

const TS = new Map(); // pageUrl -> ts (供资源请求就近取快照)
let CURRENT_TS = '';
if (FORCE) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log(`[mirror] 抓取 ${PAGES.length} 个页面…`);
for (const page of PAGES) {
  if (!FORCE && fs.existsSync(path.join(OUT, page.out))) {
    report.pages.push(`${page.out} (已存在, 跳过)`);
    continue;
  }
  TS.set(page.url, page.ts);
  CURRENT_TS = page.ts;
  const buf = await fetchArchive(page.url, page.ts, true);
  if (buf === null || buf === undefined) {
    report.failed.push(`页面 ${page.url} (${page.ts}) -> HTTP ${buf === null ? '404' : '重试耗尽'}`);
    continue;
  }
  const html = processHtml(buf.toString('utf8'), page);
  save(page.out, html);
  report.pages.push(`${page.out} <- ${page.url}`);
  console.log(`  ✓ ${page.out} (${buf.length}B)`);
  await sleep(400);
}

console.log(`[mirror] 下载资源 (队列 ${queue.size})…`);
let round = 0;
while (queue.size > 0 && round < 20) {
  round++;
  const batch = [...queue.entries()];
  queue.clear();
  for (const [absUrl, { ts, out }] of batch) {
    if (!FORCE && fs.existsSync(path.join(OUT, out.replace(/^\//, '')))) continue;
    CURRENT_TS = ts;
    const buf = await fetchArchive(absUrl, ts, true);
    if (buf === null) { report.failed.push(`资源 ${absUrl} -> 404`); continue; }
    if (buf === undefined) { report.failed.push(`资源 ${absUrl} -> 重试耗尽`); continue; }
    save(out.replace(/^\//, ''), buf);
    report.assets++;
    // CSS 递归: 其内部 url() 引用继续入队
    if (/\.css$/i.test(out)) rewriteCssUrls(buf.toString('utf8'), absUrl);
    console.log(`  ✓ ${out} (${buf.length}B)`);
    await sleep(350);
  }
}

const rep = [
  '# 营销站镜像报告',
  `- 页面: ${report.pages.length}/${PAGES.length}`,
  `- 资源: ${report.assets}`,
  `- 失败: ${report.failed.length}`,
  ...report.failed.map((s) => `- ✗ ${s}`),
].join('\n');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp/mirror-report.md'), rep);
console.log(rep);
if (report.failed.length > 0) process.exitCode = 1;
