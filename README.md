# 野狗开发文档（Starlight）

基于 [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) 的野狗开发文档站，由原 Hexo 站点迁移而来。

- 正式版文档：https://docs.wilddog.com

## 技术栈

| 项目 | 说明 |
| --- | --- |
| 框架 | Astro 7 + `@astrojs/starlight` |
| 内容 | Markdown，位于 `src/content/docs/` |
| 搜索 | Pagefind（构建时自动生成索引） |
| 语言 | 简体中文（`zh-CN`） |

## 快速开始

```bash
npm install
npm run dev      # 本地开发 http://localhost:4321
npm run build    # 生产构建，输出到 dist/
npm run preview  # 预览构建产物
```

> `dev` 与 `build` 会先自动执行迁移脚本，从 `legacy/` 重新生成 `src/content/docs/` 与 `public/`。

## 目录结构

```
├── legacy/               # 迁移源（原 Hexo 仓库内容，只读）
│   ├── source/           #   原 source/：产品 × 平台文档 + _data/sidebar.yml
│   ├── FAQ/              #   原根目录 FAQ
│   └── images/           #   原主题图片资源
├── src/
│   ├── content/docs/     # 文档正文（生成物，按 legacy/source 结构镜像）
│   ├── content.config.ts # Starlight docs collection 定义
│   ├── sidebar.generated.mjs    # 侧边栏（生成物，源自 sidebar.yml）
│   └── redirects.generated.mjs  # 根路径跳转（生成物）
├── public/               # 生成物：图片 + 旧 URL 兼容跳转页（勿手工编辑）
├── scripts/
│   ├── migrate.mjs       # 迁移脚本：legacy → src/content/docs + public
│   └── postbuild.mjs     # 构建后处理：大写路径目录镜像（Linux 部署环境）
└── astro.config.mjs      # Starlight 站点配置
```

## 迁移说明

`scripts/migrate.mjs` 负责从 `legacy/` 生成站点内容，可重复执行（幂等）：

1. **正文转换**：剥离 Hexo 手写的 `title:` 伪 frontmatter，重写为 Starlight frontmatter；HTML 标题（`<h2 id=...>`）转为 Markdown 标题。
2. **链接转换**：站内 `.html` 链接转为 Starlight 尾斜杠 URL（如 `/sync/Web/guide/concept.html` → `/sync/web/guide/concept/`）。
3. **URL 小写化**：Starlight 的 slug 全小写，因此所有生成链接统一小写。
4. **侧边栏生成**：以 `legacy/source/_data/sidebar.yml` 的分组与顺序为准；`im`、`video`、`console`、`api`、`faq` 等未在 sidebar 中登记的分区按目录结构自动生成。
5. **旧 URL 兼容**：为旧站每个 `.html` URL 生成 meta-refresh 跳转页（`public/`），保证外部链接与搜索引擎收录不失效。
6. **校验**：输出 `tmp/migration-report.md`，包含侧边栏链接完整性、正文死链、缺失图片清单。

### 旧 URL 兼容策略

- 旧站 URL 形如 `/sync/Web/guide/concept.html`（大小写混合 + `.html` 后缀）。
- `public/**.html` 中的跳转页负责将此类 URL 引导到新地址。
- `scripts/postbuild.mjs` 在大小写敏感的文件系统（Linux CI）上额外镜像大写路径目录，使 `/sync/Web/index.html` 这类目录页 URL 直接命中内容。
- 文档站内部链接已全部改为新 URL 形式。

**注意**：不要直接修改 `src/content/docs/` 与 `public/` 中的文件，它们由迁移脚本生成；如需长期修改内容，请同时更新 `legacy/` 源文件或调整迁移脚本。
