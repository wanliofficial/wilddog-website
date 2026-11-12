// 构建后处理: 为含大写的目录路径生成镜像副本
// - Linux (大小写敏感文件系统): dist/sync/web -> dist/sync/Web 镜像, 兼容旧站大小写混合 URL
// - macOS/Windows (大小写不敏感): 源与目标为同一路径, realpath 判等后跳过
// 用法: node scripts/postbuild.mjs (由 npm run build 自动执行)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS = path.join(ROOT, 'src/content/docs');
const DIST = path.join(ROOT, 'dist');

function copyDir(src, dest) {
  // 大小写不敏感 FS: 源与目标为同一路径, 跳过 (仅 Linux 大小写敏感环境会真实镜像)
  try {
    if (fs.realpathSync(src) === fs.realpathSync(dest)) return false;
  } catch { /* dest 不存在, 继续复制 */ }
  try {
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`镜像: ${path.relative(ROOT, dest)} <- ${path.relative(ROOT, src)}`);
    return true;
  } catch (e) {
    if (e.code === 'ERR_FS_CP_EINVAL') return false; // 同一路径 (大小写不敏感 FS)
    throw e;
  }
}

// 收集含大写字母的目录前缀 (如 sync/Web, auth/Android/api)
const upperDirs = [];
(function collect(dir, relPrefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const rel = relPrefix + e.name;
      if (/[A-Z]/.test(e.name)) upperDirs.push(rel);
      collect(path.join(dir, e.name), rel + '/');
    }
  }
})(DOCS, '');

let copied = 0;
for (const rel of upperDirs) {
  const src = path.join(DIST, rel.toLowerCase());
  const dest = path.join(DIST, rel);
  if (!fs.existsSync(src)) {
    console.warn(`跳过(源不存在): ${rel}`);
    continue;
  }
  if (copyDir(src, dest)) copied++;
}
console.log(`postbuild 完成: ${copied} 个大写路径镜像 (macOS 大小写不敏感环境下为 0, 属正常)`);
