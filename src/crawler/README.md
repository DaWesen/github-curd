# GitHub 深度爬虫（src/crawler）

为本项目量身打造的 GitHub 用户数据爬虫：**不配置 Token 也能拿到完整数据**，配置 Token 后走 GraphQL 拿到最全数据。抓取结果是一份 `DetailedStats` 详尽报告（JSON 落盘 + 控制台可视化报告），其中 `card` 字段与本卡片服务的 `UserStats` 结构完全兼容，可直接渲染 `/api/card`。

## 快速开始

```powershell
pnpm crawler DaWesen                 # 抓取 DaWesen，报告 + data/DaWesen.json
pnpm crawler DaWesen --quiet         # 只写文件不打印报告
pnpm crawler DaWesen --verbose       # 打印每个请求细节
pnpm crawler torvalds --repos 200    # 限制仓库扫描数
pnpm crawler DaWesen --deep-languages  # 无 Token 时逐仓库统计语言字节（消耗 REST 额度）
```

所有参数：

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `<username>` | GitHub 用户名（必填） | - |
| `--out <dir>` | JSON 输出目录 | `./data` |
| `--token <token>` | 覆盖 `GITHUB_TOKEN` 环境变量 | 读 `.env` |
| `--repos <n>` | 仓库扫描上限 | 1000 |
| `--deep-languages` | 无 Token 时逐仓库拉语言字节（每仓库 1 次核心额度） | 关 |
| `--deep-coverage <n>` | 字节深扫的覆盖目标 0.1~1（默认 1 全扫；0.9 表示扫到剩余仓库即使全按观测到的最大字节密度贡献也无法撼动 90% 覆盖即停） | 1 |
| `--deep-min-repos <n>` | 字节深扫的最少仓库数（默认 10，防止覆盖上界被大体积低代码量仓库拉低导致提前停） | 10 |
| `--no-search` | 跳过 Search API（PR/Issue/评审计数） | 开 |
| `--no-events` | 跳过公开事件流 | 开 |
| `--no-html` | 跳过 HTML 增补（置顶/成就/贡献日历兜底） | 开 |
| `--no-misc` | 跳过组织/Gists/给出 Star/代码评审（卡片用不到的增补字段，更快） | 开 |
| `--quiet` | 只写 JSON 文件 | 关 |
| `--verbose` | 打印请求级日志 | 关 |

## 三种工作模式（自动选择，自动降级）

| 模式 | 触发条件 | 数据通道 |
| --- | --- | --- |
| `graphql+rest+html` | 配置了 `GITHUB_TOKEN` | GraphQL 一次拿全（资料/贡献日历/PR/Issue/评审/Contributed to/给出 Star/Gists/组织 + 全部仓库含语言字节），HTML 补置顶仓库和成就 |
| `rest+html` | 无 Token（默认） | REST（资料/仓库分页/事件流/组织/Gists）+ Search（PR/Issue/评审计数）+ HTML（贡献日历/置顶/成就） |
| `html` | REST 核心额度耗尽时自动降级 | 纯 HTML 抓取：主页 + 仓库列表分页 + 贡献日历 |

模式之间**逐项降级**：某个通道失败只影响对应字段（会在报告的"抓取警告"和 `meta.errors` 里注明），其余字段照常抓取。

## 抓到的内容（信息清单）

- **meta**：抓取时间、耗时、工作模式、各类请求数（REST/GraphQL/Search/HTML/缓存命中/失败）、GitHub 限流余量与重置时间、每个字段的数据来源、错误清单。
- **profile**：登录名、昵称、账号类型、头像、简介、邮箱、位置、公司、网站、Twitter、加入时间、可雇佣状态、成就徽章（含 ×N 等级）、置顶仓库（含 Star/语言/描述）、公开组织。
- **counts**：公开仓库、关注者、关注中、获 Star/获 Fork（全仓库求和）、给出 Star、PR、Issue、代码评审、Contributed to、Gists、组织数——每个字段标注来源（graphql/rest/search/html/events），可信度一目了然。
- **repositories**：全部公开仓库（分页抓全），含描述、主语言、Star、Fork、Watchers、Open Issues、fork/归档状态、Topics、创建/更新/推送时间、体积、许可证，按 Star 排序。
- **languages**：语言占比。有 Token 时按**代码字节**精确统计（GraphQL languages 内联返回）；无 Token 时默认按仓库主语言计数，`--deep-languages` 可逐仓库升级为字节统计——按仓库体积降序扫，用实测字节做反馈自适应停止（剩余仓库即使全按观测到的最大字节密度贡献也无法撼动覆盖目标即停），`--deep-coverage 0.9` 通常十次左右请求即可逼近 GraphQL 精确度。标注统计口径（bytes / bytes-partial / repo-count）。
- **contributions**：近一年逐日贡献（含 0-4 热度等级）、月度分布、星期分布、活跃天数、日均/活跃日均、当前连击、最长连击（含起止日期）、最活跃一天、按类型拆分（提交/PR/Issue/评审，GraphQL 模式）。日历不可用时（HTML 被墙/被拦且无 Token）自动改用 Search Commits 估算（提交 + PR + Issue + 评审，标注 `search-estimate`）。
- **activity**：近期动态（公开事件流，≤90 天/300 条）：推送提交数、开/合并 PR、评审、开 Issue、Star/Fork、新建仓库、发布 Release、最活跃仓库、参与的外部仓库列表。
- **gists**：Gist 列表（描述、文件数、公开状态、链接、创建时间）。
- **rating**：0-100 综合评级（复用卡片服务的权重公式）+ 六个维度的得分明细。
- **card**：`UserStats` 结构，`profile/stats/repositories/languages/contributionWeeks/contributionDays` 一应俱全，可直接喂给 `renderStatsCard`。

## 工程细节

- **限速**：REST 未认证 1.4s/次（余量 ≤3 时放慢到 10s/次）、认证 120ms/次；Search 未认证 7s/次、认证 2.5s/次；HTML 0.8s/次 + 随机抖动，模拟真实浏览器请求头。
- **主机熔断**：某台主机连接级失败（超时/重置，如网络对 github.com 不可达而 api.github.com 正常）后立即短路本轮后续 HTML 请求（单请求内连接级失败也不重试，避免逐轮傻等超时）；api.github.com 与 www.github.com 相互独立、互不影响。
- **逐项降级**：任何字段抓不到都只记录警告，不拖垮整体；"给出 Star"在无 GraphQL/HTML 时也能通过 `starred` 端点的 Link 分页头一次请求取到总数。
- **重试**：429/403 次要限流/5xx/网络错误按指数退避重试（遵循 `Retry-After`）；核心额度用尽立即抛错并降级，不空耗重试。
- **ETag 缓存**：所有 REST GET 走条件请求，304 时复用本地缓存（`data/.cache/etags.json`），**不消耗核心额度**；5 分钟内的新鲜缓存直接用本地副本、连请求都不发；命中缓存的请求走快速限速通道（500ms），重复抓取几乎零成本。
- **风控检测**：HTML 响应命中风控特征文案时自动退避重试。
- **HTML 解析**：cheerio 结构化解析 + 页面内嵌 JSON 载荷双通道，贡献日历靠 `td id ↔ tool-tip for` 关联取数，兼容 GitHub 现行 DOM 结构。
- **合规**：只抓公开数据，遵守 GitHub 限流规则并主动留余量；不绕过任何认证或风控，被拦截时退避而非对抗。

## 与卡片服务的关系

卡片服务**已经以爬虫为数据引擎**：`app.ts` 默认的 `loadStats` 就是 `toUserStats(await crawlUser(username, { client, ... }))`，`/api/stats` 与 `/api/card` 的数据与命令行抓取完全同口径，渲染层零改动。服务端进程内共享同一个 `GithubHttpClient`（限速节奏、HTML 缓存、主机熔断全局生效），ETag 缓存与 CLI 共用 `data/.cache`；服务侧关闭了活动流与 misc 增补（卡片用不到），无 Token 冷抓更快。

```ts
import { crawlUser, toUserStats } from './crawler/crawler';

const detail = await crawlUser('DaWesen', { token: process.env.GITHUB_TOKEN });
const card = detail.card;                    // 或 toUserStats(detail)
renderStatsCard(card, 'neon-cyber', {});     // 直接渲染
```

## 输出示例

```text
══════════════════════════════════════════════════
  GitHub 爬虫报告 · DaWesen
══════════════════════════════════════════════════
模式 rest+html · 耗时 16.1s · 请求 REST 7 / GraphQL 0 / Search 2 / HTML 2（缓存命中 7，失败 0）
REST 额度剩余 46/60，重置于 17:46:38 UTC

【基本资料】…（成就：Pull Shark ×2 等、置顶仓库 WeKnora ★20900…）
【数据总览】…（每项标注来源 graphql/rest/search/html/events）
【综合评级】64/100（六维度明细）
【语言占比】（条形图）
【近一年贡献】月度/星期分布条形图、连击、最活跃一天
【近期动态】事件流统计、参与的外部仓库
【Top 仓库】Star 排序 + 许可证/fork 标记

已保存: data/DaWesen.json
```

## 文件结构

```text
src/crawler/
  types.ts     # DetailedStats 及全部子结构、REST/GraphQL 响应类型
  http.ts      # GithubHttpClient：分类限速/退避重试/ETag 缓存/风控检测
  parse.ts     # cheerio + 内嵌 JSON 解析器（主页/仓库列表/贡献日历）
  crawler.ts   # crawlUser 三模式编排、数据聚合、toUserStats 卡片适配
  cli.ts       # 命令行入口：参数解析、进度、可视化报告、JSON 落盘
  README.md    # 本文档
```
