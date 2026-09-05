# GitHub Stats

用于生成 GitHub 统计卡片的轻量 API 基础工程。卡片服务与内置爬虫共用同一套数据引擎（`src/crawler/`），无 Token 也能拿到完整数据。

## 开始使用

```powershell
pnpm install
Copy-Item .env.example .env
pnpm start
```

服务默认运行在 `http://localhost:3000`。

## 部署到 Vercel

项目已经提供 Vercel Serverless 入口 `api/index.ts`。将项目导入 Vercel 后，在项目设置中配置以下环境变量：

```text
GITHUB_TOKEN
GITHUB_API_URL=https://api.github.com
DEFAULT_USERNAME
```

`DEFAULT_USERNAME` 可选，配置后访问根路径直接展示该用户的卡片；不配则展示主题列表。

部署完成后，接口地址会变成：

```text
https://你的域名.vercel.app/api/stats/:username
```

本地的 `pnpm start` 仍然使用常驻 Express 服务，Vercel 会自动使用 `api/index.ts`，不需要额外启动命令。

## API

- `GET /health`：服务健康检查
- `GET /api/stats/:username`：获取用户资料、仓库、Star、Fork 等卡片数据
- `GET /api/card/:username.svg`：直接生成 SVG 统计卡片
- `GET /api/card/:username`：不带 `.svg` 后缀的卡片地址
- `GET /api/card?username=:username&theme=:theme`：通过查询参数生成卡片
- `GET /api/card/:username/languages.svg?theme=:theme`：生成独立语言统计卡片
- `GET /api/themes`：获取所有主题名称和中文标签

设置 `GITHUB_TOKEN` 可以提高 GitHub API 的请求额度并走 GraphQL 模式。Token 只从环境变量读取，不会出现在响应中。无 Token 时数据引擎自动走 REST + Search + HTML 混合抓取，关注者、Star、仓库、贡献日历等数据依然完整。

缓存分四层：卡片响应带 5 分钟 CDN 缓存头；服务进程内同一用户名缓存 5 分钟，过期后先返回旧数据、后台静默刷新（stale-while-revalidate）；最近一次成功的数据还会落盘（`data/.cache/lastgood/`，7 天内有效），GitHub 完全不可达时卡片依然照常显示；REST 请求全部走 ETag 条件缓存（304 不消耗额度，5 分钟内的新鲜缓存连请求都不发）。

例如你的卡片地址是：`/api/card/DaWesen?theme=polar-starlight&font=mono`，也可以使用查询参数格式：`/api/card?username=DaWesen&theme=polar-starlight&font=mono`。

卡片目前包含：近 12 个月贡献总数和周频率、贡献折线图、仓库数量、加入 GitHub 时间、联系方式、语言占比、Star、Fork、Pull Request、Issues、Contributed to 和 0-100 Rating。卡片图标带荧光动态效果。

卡片字体可通过 `font` 参数切换：`sans`、`serif`、`mono`、`rounded`。后续下载了新字体，在 `src/types.ts` 的 `CardFont` 联合类型和 `cardFontStacks` 里补充即可。

可用主题：`dreamy-galaxy`（梦幻星河）、`neon-cyber`（霓虹赛博）、`neon-starlight`（霓虹星空）、`aurora-nebula`（星云极光）、`summer-lemon`（夏日柠檬）、`sakura-story`（樱花物语）、`deep-sea-blue`（深海幽蓝）、`amber-sun`（琥珀暖阳）、`emerald-forest`（翡翠森林）、`midnight-count`（暗夜伯爵）、`minimal-white`（极简纯白）、`polar-starlight`（极地星光）。

其中 `neon-starlight`（霓虹星空）使用根目录 `霓虹星空.png` 设计稿作为卡片底图（1024×1536，压缩为 JPEG 内嵌进 SVG，卡片自包含），头图文案、贡献折线图、统计面板、语言占比、连击指标、贡献热力图等全部为真实数据动态叠绘。用户头像会在服务端拉取后内嵌进头像霓虹环（进程内缓存 1 小时；拉取失败自动退回无头像的纯装饰环，不影响出卡）。

霓虹星空主题支持 `motto` 参数：座右铭以斜体显示在卡片最上方的星空区域（最长 40 字符，超长截断），例如 `/api/card/DaWesen?theme=neon-starlight&motto=仰望星空，脚踏实地`；其他主题暂不显示该参数。

## 开发

```powershell
pnpm dev
pnpm test
pnpm check
```

## GitHub 爬虫

项目内置一个专为 GitHub 打造的深度爬虫（`src/crawler/`），同时也是卡片服务的数据引擎：`/api/stats` 与 `/api/card` 的数据都来自 `crawlUser()` 转换出的 `card` 字段，服务端与命令行抓取口径完全一致。无 Token 也能抓到完整数据（REST + Search + HTML 三通道混合，额度耗尽自动降级纯 HTML），配置 `GITHUB_TOKEN` 后走 GraphQL 拿最全数据。无 Token 时语言占比会按体积降序深扫 `languages_url`（用实测字节反馈自适应停止、最少扫 10 个仓库），实测与全量字节统计的误差在 1 个百分点左右，接近 GraphQL 的字节级精确度。抓取内容包括：资料全字段、全部公开仓库（含许可证/Topics/Fork 状态）、按字节的语言占比、逐日贡献与连击分析、近期动态、置顶仓库、成就徽章、Gists、0-100 评级明细等，结果输出可视化报告和 JSON 文件。

```powershell
pnpm crawler DaWesen          # 详尽报告 + data/DaWesen.json
pnpm crawler DaWesen --quiet  # 只写 JSON
```

详细用法、参数与字段说明见 [src/crawler/README.md](src/crawler/README.md)。
