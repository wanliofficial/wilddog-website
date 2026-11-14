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

const report = { pages: [], assets: 0, skipped: [], failed: [], aliased: [] };
const queue = new Map(); // key: 原始绝对URL(小写host) -> { ts, out } 待下载资源

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decodeP = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
// 资源存储路径须去掉 query/fragment (浏览器请求不携带, 磁盘文件名带则无法命中)
const stripQF = (p) => p.split('?')[0].split('#')[0];

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
  let p = u.pathname; if (p.startsWith('/blog/')) p = p.slice(5); // WP 子目录前缀去重
  return '/blog' + (p === '/' ? '/' : p); // ?ver= 等查询参数丢弃
}

// 任意 URL(相对则按 baseUrl 绝对化) → 本地路径; 返回 null 表示保持原样
function rewrite(rawUrl, baseUrl) {
  if (!rawUrl || /^(?:#|mailto:|javascript:|data:|tel:)/i.test(rawUrl)) return null;
  let u;
  try { u = new URL(rawUrl, baseUrl); } catch { return null; }
  switch (u.hostname) {
    case 'cdn.wilddog.com': // 双斜杠路径规范化, query 丢弃
    case 'img.wdstatic.cn': // 2017 时期 CDN 域, 路径与 cdn.wilddog.com 同构, 并入 /_m/
    case 'css.wdstatic.cn':
      return '/_m' + u.pathname.replace(/([^:])\/{2,}/g, '/');
    case 'docs.wilddog.com':
      return toDocsLocal(u) + u.hash;
    case 'www.wilddog.com': // 保持无扩展名形态 (静态托管目录命中)
      return u.pathname + u.search + u.hash;
    case 'blog.wilddog.com': // blogLocal: ?cat/?p 语义化 + WP 子目录前缀去重
      return blogLocal(u) + u.hash;
    case 'status.wilddog.com': {
      let p = u.pathname; if (p.startsWith('/status/')) p = p.slice(7);
      return '/status' + (p === '/' ? '/' : p) + u.search + u.hash;
    }
    case 'life.wilddog.com': {
      let p = u.pathname; if (p.startsWith('/life/')) p = p.slice(5);
      return '/life' + (p === '/' ? '/' : p) + u.hash;
    }
    case 'hacker.wilddog.com': // 站内资源挂 /_m/hacker2016/, 与 CDN 命名空间一致, 不拼 /hacker 前缀
      if (u.pathname.startsWith('/_m/')) return u.pathname + u.hash;
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

// CDX 回退: 指定 ts 无可用存档(或存的是404记录)时, 查全时间线最近的 statuscode:200 快照
async function cdxNearest200(absUrl) {
  let u; try { u = new URL(absUrl); } catch { return null; }
  for (const key of [u.hostname + u.pathname, ...variants(absUrl).slice(1).map(v => { try { const w = new URL(v); return w.hostname + w.pathname; } catch { return null; } }).filter(Boolean)]) {
    try {
      const res = await fetch(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(key)}&filter=statuscode:200&output=json&limit=-3`, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const rows = await res.json(); // [header, ...captures] 升序, 取最后一条
      const hit = rows && rows.length > 1 ? rows[rows.length - 1] : null;
      if (hit && hit[1]) return hit[1]; // timestamp
    } catch { /* 下一个变体 */ }
    if (key === u.hostname + u.pathname) break; // 原始 URL 已查, 不再查变体(罕见路径形态)
  }
  return null;
}

// Wayback 有时对无存档 URL 返回 200 + 通用 HTML 页, 需内容校验拦截 (仅资源型扩展名; 页面本身就是 HTML)
function looksHtml(buf) {
  const s = buf.subarray(0, 300).toString('latin1').trimStart().toLowerCase();
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.startsWith('<head');
}

async function fetchArchive(absUrl, ts, binary = true, tries = 4) {
  let lastNull = false;
  const grab = async (url) => {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
    if (res.status === 200) {
      const buf = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      if (!binary || !ASSET_RE.test(url) || !looksHtml(buf)) return buf;
      return 'FAKE_200'; // HTML 冒充资源
    }
    if (res.status === 404 || res.status === 410) return 'MISS';
    return 'RETRY';
  };
  for (const target of [absUrl, ...variants(absUrl).slice(1)]) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await grab(ARCHIVE + ts + 'id_/' + target);
        if (Buffer.isBuffer(r) || typeof r === 'string' && r !== 'FAKE_200' && r !== 'MISS' && r !== 'RETRY') return r;
        if (r === 'MISS') { lastNull = true; break; }
        if (r === 'FAKE_200') { lastNull = true; break; }
      } catch { /* 网络抖动, 重试 */ }
      await sleep(1500 * (i + 1));
    }
  }
  // 就近 ts 失败 → CDX 找任意时期的 200 存档(如 2017-01 存过但 2017-10 只存了 404 记录)
  const altTs = await cdxNearest200(absUrl);
  if (altTs) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await grab(ARCHIVE + altTs + 'id_/' + absUrl);
        if (Buffer.isBuffer(r) || typeof r === 'string' && r !== 'FAKE_200' && r !== 'MISS' && r !== 'RETRY') return r;
        if (r === 'RETRY') { await sleep(1500 * (i + 1)); continue; }
        break; // MISS/FAKE_200 → 放弃
      } catch { /* 重试 */ }
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
        queue.set(abs.origin + abs.pathname + abs.search, { ts: TS.get(pageUrl) || CURRENT_TS, out: stripQF(local) });
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
        queue.set(abs.origin + abs.pathname + abs.search, { ts: CURRENT_TS, out: stripQF(local) });
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
  // 6) 根元素注入: data-pagefind-ignore(不进文档搜索) + data-mirror-site(移动端补丁作用域)
  html = injectPatch(html, page.site);
  return html;
}

// 注入 <html> 站点属性 + 移动端补丁样式 (幂等, 可对已下载文件重复执行)
const PATCH_LINK = '<link rel="stylesheet" href="/_m/mobile-patch.css">';
function injectPatch(html, site) {
  html = html.replace(/<html\b([^>]*)>/i, (m, attrs) => {
    let a = attrs;
    if (!/data-pagefind-ignore/.test(a)) a += ' data-pagefind-ignore';
    if (site && !/data-mirror-site/.test(a)) a += ` data-mirror-site="${site}"`;
    return `<html${a}>`;
  });
  if (!html.includes('mobile-patch.css') && html.includes('</head>')) {
    html = html.replace('</head>', `    ${PATCH_LINK}\n</head>`);
  }
  return html;
}

// ---------- 主流程 ----------

const TS = new Map(); // pageUrl -> ts (供资源请求就近取快照)
let CURRENT_TS = '';
if (FORCE) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 移动端补丁: 仅 ≤768px 生效, PC 保持归档原设计; 按 data-mirror-site 作用域隔离
const MOBILE_PATCH_CSS = `/* wilddog 镜像站移动端补丁 — 只修横向溢出, PC 端不影响 */
@media (max-width: 768px) {
  /* blog (WordPress): 文章内大图约束 */
  [data-mirror-site='blog'] .entry-content img,
  [data-mirror-site='blog'] .entry-summary img { max-width: 100%; height: auto; }
  /* download: 头部阴影图 + PC 横向拖动卡片带改纵向堆叠 */
  [data-mirror-site='www'] img[src*='download/shadow'] { max-width: 100%; height: auto; }
  [data-mirror-site='www'] .download-boxs { width: auto; max-height: none; }
  [data-mirror-site='www'] .download-box { float: none; margin: 16px auto; }
  /* life 联系页: textarea 固定 cols 撑宽 */
  [data-mirror-site='life'] textarea { width: 100%; max-width: 100%; box-sizing: border-box; }
  /* hacker (纯 PC 活动页): 图片/视频约束 + 固定宽容器收缩 */
  [data-mirror-site='hacker'] img,
  [data-mirror-site='hacker'] video { max-width: 100%; height: auto; }
  [data-mirror-site='hacker'] .introduce,
  [data-mirror-site='hacker'] .band-des,
  [data-mirror-site='hacker'] .band-des .text,
  [data-mirror-site='hacker'] .start-wd-text { max-width: 100%; box-sizing: border-box; }
}
`;
fs.mkdirSync(path.join(OUT, '_m'), { recursive: true });
fs.writeFileSync(path.join(OUT, '_m/mobile-patch.css'), MOBILE_PATCH_CSS);

// --patch-only: 不抓取, 仅对已下载页面幂等注入补丁 (mirror-site 产物已就位时用)
if (process.argv.includes('--patch-only')) {
  let n = 0;
  for (const page of PAGES) {
    const f = path.join(OUT, page.out);
    if (!fs.existsSync(f)) { console.log(`  - 跳过(不存在) ${page.out}`); continue; }
    fs.writeFileSync(f, injectPatch(fs.readFileSync(f, 'utf8'), page.site));
    console.log(`  ✓ patched ${page.out}`); n++;
  }
  console.log(`[patch-only] 完成 ${n} 页`);
  process.exit(0);
}

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

// 存量 CSS 回填: 早期落盘的是原始字节(url 指向已死域名), 按落盘路径推断原始域作 baseUrl 重写并补抓缺失资源
{
  const ORIGIN_BY_PREFIX = { _m: 'https://cdn.wilddog.com/', blog: 'https://blog.wilddog.com/', life: 'https://life.wilddog.com/', status: 'https://status.wilddog.com/', hacker: 'https://hacker.wilddog.com/' };
  const walkCss = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walkCss(path.join(d, e.name)) : (e.name.endsWith('.css') ? [path.join(d, e.name)] : []));
  for (const f of fs.existsSync(OUT) ? walkCss(OUT) : []) {
    const css = fs.readFileSync(f, 'utf8');
    if (!/(cdn\.wilddog\.com|wdstatic\.cn|(blog|life|status|hacker)\.wilddog\.com)/.test(css)) continue;
    const rel = path.relative(OUT, f).split(path.sep);
    const origin = ORIGIN_BY_PREFIX[rel[0]] || 'https://cdn.wilddog.com/';
    fs.writeFileSync(f, rewriteCssUrls(css, origin + rel.slice(1).join('/'))); // 重写落盘 + 缺失资源入队
    console.log(`  ↻ css 回填 ${path.relative(OUT, f)}`);
  }
}

console.log(`[mirror] 下载资源 (队列 ${queue.size})…`);

// 别名顶替: 2017 版 wdstatic 资源 Wayback 无存档, 用本地同站新版同构文件复制为请求名;
// ':empty' = 写空壳(css 注释 / 1x1 透明 svg)避免 404。偏离原始字节, 记入报告。
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
const ALIAS = {
  'www-nd/styles/wilddog-ui.5ceee38b.css': 'www-nd/styles/wilddog-ui/wilddog-ui-6faff576b5.css',
  'www-nd/styles/product-common.82f94fc1.css': 'www-nd/styles/product/product-common-1f7ed8904f.css',
  'www-nd/styles/product-overview.da5f9def.css': 'www-nd/styles/product/product-overview-88cac37b6e.css',
  'www-nd/styles/sync-overview.0500c101.css': 'www-nd/styles/product/sync-overview-c27a546cd8.css',
  'www-nd/styles/webfonts.8d22f436.css': ':empty',
  'www-nd/styles/fonts.82514e40.css': ':empty',
  'www-nd/scripts/header.a83e4263.js': 'www-nd/scripts/header-fd2f5e3f5b.js',
  'www-nd/scripts/product-overview.cfa3a525.js': 'www-nd/scripts/product/product-overview-49241a2c53.js',
  'www-nd/scripts/sync-overview.0ab0a695.js': 'www-nd/scripts/product/sync-overview-99c8f4ecb3.js',
  'www-nd/images/footer-logo.520e0511.svg': 'www-nd/images/footer-logo-885bb9fe94.svg',
  'www-nd/images/footer-logo-m.84529912.svg': 'www-nd/images/footer-logo-m-59a59bd7e9.svg',
  'www-nd/images/beta.834b5d8c.svg': ':empty',
  'www-nd/images/index/drop-down.ff929b03.svg': 'www-nd/images/index/drop-down-5165ef22d3.svg',
  'www-nd/images/product/multiple.b62f2604.svg': ':empty',
  'www-nd/images/product/sync/active.008b31c2.svg': 'www-nd/images/product/sync/active-401c0ccc1d.svg',
  'www-nd/images/product/sync/active-big.4259da21.svg': 'www-nd/images/product/sync/active-401c0ccc1d.svg',
  'www-nd/images/product/sync/distribute.fe39a945.svg': 'www-nd/images/product/sync/distribute-c87fd8d17f.svg',
  'www-nd/images/product/sync/easy.d78f3d48.svg': ':empty',
  'www-nd/images/product/sync/feature-bg.c6368504.svg': 'www-nd/images/product/sync/feature-bg-d337895f61.svg',
  'www-nd/images/product/sync/finacial.434ac6fb.svg': ':empty',
  'www-nd/images/product/sync/finacial-icon.d9993c7a.svg': 'www-nd/images/product/sync/finacial-icon-bb91e9494c.svg',
  'www-nd/images/product/sync/game.6050496e.svg': 'www-nd/images/product/sync/game-88501edb26.svg',
  'www-nd/images/product/sync/game-big.7e7d5f06.svg': 'www-nd/images/product/sync/game-88501edb26.svg',
  'www-nd/images/product/sync/hi.0b84a7f8.svg': 'www-nd/images/product/sync/hi-9d84aa4786.svg',
  'www-nd/images/product/sync/live.1b3ceff2.svg': ':empty',
  'www-nd/images/product/sync/overview.04f3a09f.svg': 'www-nd/images/product/sync/overview-6ce5c58ece.svg',
  'www-nd/images/product/sync/overview-left.337c33ab.svg': 'www-nd/images/product/sync/overview-left-cee8e7f69c.svg',
  'www-nd/images/product/sync/save.6495d0d6.svg': ':empty',
  'www-nd/images/product/sync/sites.27ef1b77.svg': ':empty',
  'www-nd/images/product/sync/sites-icon.8e88f0cd.svg': 'www-nd/images/product/sync/sites-icon-39ed548ac1.svg',
  'www-nd/images/product/sync/stable.fb6a74b3.svg': ':empty',
  'www-nd/images/product/sync/store.9dfee54c.svg': 'www-nd/images/product/sync/store-8983dc18ab.svg',
  'www-nd/images/product/sync/sync-communication-title.66ddd37f.svg': 'www-nd/images/product/sync/sync-communication-title-8e89737413.svg',
  'www-nd/images/product/sync/things.0c7a47b5.svg': 'www-nd/images/product/sync/things-8fd19af9c9.svg',
  'www-nd/images/product/sync/things-big.29757647.svg': 'www-nd/images/product/sync/things-8fd19af9c9.svg',
  'www-nd/images/product/sync/traffic.1196b8a2.svg': 'www-nd/images/product/sync/traffic-7f67a32491.svg',
  'www-nd/images/product/sync/traffic-big.13dbe2f5.svg': 'www-nd/images/product/sync/traffic-7f67a32491.svg',
  'www-nd/images/product/sync/worth.7e8c314c.svg': 'www-nd/images/product/sync/worth-472922ee35.svg',
  'www-nd/images/product/sync/wxapp.ed64e738.svg': 'www-nd/images/product/sync/wxapp-70f01e6685.svg',
  'www-nd/images/product/sync/wxapp-big.40b875c8.svg': 'www-nd/images/product/sync/wxapp-70f01e6685.svg',
  // hacker2016 字体: Wayback 未存档, 用 www-nd 同字体 hash 版顶替 (format 不匹配时浏览器自动跳过该 src)
  'hacker2016/fonts/wd-icon.eot': 'www-nd/fonts/wd-icon-d160fc7b29.eot',
  'hacker2016/fonts/wd-icon.woff': 'www-nd/fonts/wd-icon-f51df61bf8.woff',
  'hacker2016/fonts/wd-icon.ttf': 'www-nd/fonts/wd-icon-5304655f18.ttf',
  'hacker2016/fonts/wd-icon.svg': 'www-nd/fonts/wd-icon-ef2fdabd8b.svg',
  'hacker2016/fonts/fzltxh.ttf': 'www-nd/fonts/fzltxh-5449119962.woff',
  // 装饰背景图: Wayback 无真实存档(仅假 200), 透明 1x1 占位
  'hacker201/images/pc/video-bg-3cce5f2bff.png': ':empty',
  'hacker201/images/pc/troop-5467b113b3.jpg': ':empty',
  'www-nd/images/account/signup_bg-5ff4429982.jpg': ':empty',
  'images/index/customer-bg.png': ':empty',
  'www-nd/images/price/questions-bg-036729d89b.jpg': ':empty',
  'www-nd/images/product/bradge-bg-12e7fc4fbc.png': ':empty',
};

// 空占位内容: css 注释 / 1x1 svg / 1x1 透明 png(也用于 jpg)
const EMPTY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function emptyFor(rel) {
  if (/\.css$/i.test(rel)) return Buffer.from('/* archived copy unavailable; placeholder */');
  if (/\.svg$/i.test(rel)) return Buffer.from(EMPTY_SVG);
  if (/\.(png|jpe?g|gif)$/i.test(rel)) return EMPTY_PNG;
  return Buffer.alloc(0);
}

// 存量补齐: ALIAS 目标不存在则生成(幂等), 保证 CSS 内本地引用完整
function ensureAlias() {
  const made = [];
  for (const [dst, src] of Object.entries(ALIAS)) {
    const d = path.join(OUT, '_m', dst);
    if (fs.existsSync(d)) continue;
    if (src === ':empty') save('_m/' + dst, emptyFor(dst));
    else if (fs.existsSync(path.join(OUT, '_m', src))) save('_m/' + dst, fs.readFileSync(path.join(OUT, '_m', src)));
    else continue;
    console.log(`  ≈ ${dst} ${src === ':empty' ? '(空占位)' : '<- ' + src}`);
    made.push(`${dst} <- ${src === ':empty' ? '空占位' : src}`);
  }
  return made;
}

let round = 0;
while (queue.size > 0 && round < 20) {
  round++;
  const batch = [...queue.entries()];
  queue.clear();
  for (const [absUrl, { ts, out }] of batch) {
    if (!FORCE && fs.existsSync(path.join(OUT, out.replace(/^\//, '')))) continue;
    CURRENT_TS = ts;
    const buf = await fetchArchive(absUrl, ts, true);
    if (buf === null || buf === undefined) {
      // 归档缺失 → 别名顶替 (out 形如 /_m/www-nd/..., ALIAS 键去 _m/ 前缀)
      const rel = out.replace(/^\//, '');
      const key = rel.replace(/^_m\//, '');
      const src = ALIAS[key];
      if (src === ':empty') {
        save(rel, Buffer.from(/\.css$/i.test(rel) ? '/* archived copy unavailable; placeholder */' : EMPTY_SVG));
        report.aliased.push(`${key} <- 空占位`);
        console.log(`  ≈ ${rel} (空占位)`);
      } else if (src && fs.existsSync(path.join(OUT, '_m', src))) {
        save(rel, fs.readFileSync(path.join(OUT, '_m', src)));
        report.aliased.push(`${key} <- ${src}`);
        console.log(`  ≈ ${rel} <- ${src}`);
      } else {
        report.failed.push(`资源 ${absUrl} -> ${buf === null ? 404 : '重试耗尽'}`);
      }
      continue;
    }
    save(out.replace(/^\//, ''), /\.css$/i.test(out)
      ? Buffer.from(rewriteCssUrls(buf.toString('utf8'), absUrl), 'utf8') // CSS 落盘前重写 url → /_m/ 本地化
      : buf);
    report.assets++;
    console.log(`  ✓ ${out} (${buf.length}B)`);
    await sleep(350);
  }
}

report.aliased.push(...ensureAlias()); // 存量补齐: CSS 内本地引用完整性兜底

const rep = [
  '# 营销站镜像报告',
  `- 页面: ${report.pages.length}/${PAGES.length}`,
  `- 资源: ${report.assets}`,
  `- 失败: ${report.failed.length}`,
  `- 别名顶替(Wayback缺失, 用同站新版/占位): ${report.aliased.length}`,
  ...report.aliased.map((s) => `- ≈ ${s}`),
  ...report.failed.map((s) => `- ✗ ${s}`),
].join('\n');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp/mirror-report.md'), rep);
console.log(rep);
if (report.failed.length > 0) process.exitCode = 1;
