import type { UserStats } from './types';
import { cardFontStacks, type CardOptions } from './types';
import { getTheme } from './themes';
import { neonStarlightBackground } from './neon-starlight-bg';

// GitHub 官方语言色板（github/linguist languages.yml），与 github.com 仓库页语言标识同色
const languageColors: Record<string, string> = {
  // 流行度榜首的通用语言
  JavaScript: '#f1e05a', Python: '#3572a5', TypeScript: '#3178c6', Java: '#b07219',
  'C++': '#f34b7d', C: '#555555', 'C#': '#178600', PHP: '#4f5d95',
  Go: '#00add8', Rust: '#dea584', Ruby: '#701516', Swift: '#f05138',
  Kotlin: '#a97bff', Dart: '#00b4ab', Scala: '#c22d40', Julia: '#a270ba',
  // Web 前端与样式
  HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Svelte: '#ff3e00',
  Astro: '#ff5a03', SCSS: '#c6538c', Sass: '#c6538c', Less: '#1d365d',
  Stylus: '#ff6347', Pug: '#a86454', Handlebars: '#f7931e', EJS: '#a91e50',
  CoffeeScript: '#244776', Elm: '#60b5cc', ClojureScript: '#db5855',
  // 脚本、Shell 与标记
  Shell: '#89e051', PowerShell: '#012456', Batchfile: '#c1f12e', Lua: '#000080',
  Perl: '#0298c3', R: '#198ce7', MATLAB: '#e16737', Assembly: '#6e4c13',
  'Jupyter Notebook': '#da5b0b', Markdown: '#083fa1', YAML: '#cb171e',
  TOML: '#9c4221', JSON: '#292929', XML: '#0060ac', XSLT: '#eb8ceb',
  // 系统与函数式
  'Objective-C': '#438eff', 'Objective-C++': '#6866fb', Haskell: '#5e5086',
  Erlang: '#b83998', Elixir: '#6e4a7e', OCaml: '#3be133', 'F#': '#b845fc',
  Clojure: '#db5855', Scheme: '#1e4aec', 'Common Lisp': '#3fb68b', Racket: '#3c5caa',
  Nim: '#ffc200', Zig: '#ec915c', Crystal: '#000100', D: '#ba5951',
  V: '#4f87c4', Vale: '#fb7c2a',
  // 数据库、工具链与其他
  SQL: '#e38c00', PLpgSQL: '#336790', TSQL: '#e38c00', Makefile: '#427819',
  CMake: '#da3434', Dockerfile: '#384d54', Fortran: '#4d41b1',
  Pascal: '#e3f171', Delphi: '#b0ce4e', Ada: '#02f88c', COBOL: '#005ca5',
  Groovy: '#4298b8', Gradle: '#02303a', Solidity: '#aa6746', VBA: '#867db1',
  'Visual Basic .NET': '#945db7', ABAP: '#e8274b', Apex: '#1797c0', Nix: '#7e7eff',
  GDScript: '#355570', QML: '#44a51c', Vala: '#a56de2', Verilog: '#b2b7f8',
  VHDL: '#adb2cb', Cython: '#fedf5b', Twig: '#c1d026', GraphQL: '#e10098',
};

// 未收录语言：按名字哈希生成稳定色相，保证不同语言不会互相撞色
function languageColor(name: string): string {
  const known = languageColors[name];
  if (known) return known;
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return `hsl(${hash % 360}, 62%, 52%)`;
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

// 统一用 en-US 分组，避免服务端 locale 不同导致卡片数字格式不稳定
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

const monthAbbreviations = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthLabel(date: Date): string {
  return `${monthAbbreviations[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(2)}`;
}

export interface AxisLabel {
  label: string;
  fraction: number;
}

// 月度贡献图横轴标签：优先取真实贡献窗口的首尾月份，无数据时退回最近 12 个月
export function contributionAxisLabels(data: UserStats): AxisLabel[] {
  const days = data.contributionDays;
  const first = days.length > 0 ? new Date(`${days[0].date}T00:00:00Z`) : new Date(NaN);
  const last = days.length > 0 ? new Date(`${days[days.length - 1].date}T00:00:00Z`) : new Date(NaN);
  if (!Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime()) && last.getTime() > first.getTime()) {
    const span = last.getTime() - first.getTime();
    const at = (fraction: number) => formatMonthLabel(new Date(first.getTime() + span * fraction));
    return [
      { label: at(0), fraction: 0 },
      { label: at(1 / 3), fraction: 1 / 3 },
      { label: at(2 / 3), fraction: 2 / 3 },
      { label: at(1), fraction: 1 },
    ];
  }
  const now = new Date();
  const monthsAgo = (count: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 15));
  return [
    { label: formatMonthLabel(monthsAgo(11)), fraction: 0 },
    { label: formatMonthLabel(monthsAgo(7)), fraction: 1 / 3 },
    { label: formatMonthLabel(monthsAgo(3)), fraction: 2 / 3 },
    { label: formatMonthLabel(monthsAgo(0)), fraction: 1 },
  ];
}

function monthAxisText(labels: AxisLabel[], chartX: number, chartWidth: number, chartY: number, font: string, muted: string): string {
  return labels.map(({ label, fraction }, index) => {
    const x = (chartX + fraction * chartWidth).toFixed(0);
    const anchor = index === 0 ? '' : index === labels.length - 1 ? 'text-anchor="end"' : 'text-anchor="middle"';
    return `<text x="${x}" y="${chartY}" ${anchor} font-family="${font}" font-size="9" fill="${muted}">${label}</text>`;
  }).join('');
}

// 自绘 SVG 图标：统一以 (0,0) 为中心、约 ±6 单位大小，替代 unicode 字符图标
function svgIconFlame(color: string): string {
  return `<path d="M0 3c-1.8-2.5-3-4.3-3-6a3 3 0 0 1 6 0c0 1.7-1.2 3.5-3 6z" fill="${color}"/><circle cx="0" cy="-3" r="1.2" fill="${color}" opacity=".55"/>`;
}
function svgIconRepository(color: string): string {
  return `<path d="M-4.5-6.5h9v13l-4.5-2.5-4.5 2.5z" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`;
}
function svgIconCalendar(color: string): string {
  return `<rect x="-5" y="-4" width="10" height="9" rx="1.5" fill="none" stroke="${color}" stroke-width="1.8"/><line x1="-5" y1="-1.2" x2="5" y2="-1.2" stroke="${color}" stroke-width="1.8"/><line x1="-2" y1="-6" x2="-2" y2="-3.5" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/><line x1="2" y1="-6" x2="2" y2="-3.5" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
}
function svgIconPin(color: string, inner: string): string {
  return `<path d="M0 6C-3 2-5-0.5-5-2.5A5 5 0 0 1 5-2.5C5-0.5 3 2 0 6z" fill="${color}"/><circle cx="0" cy="-2.5" r="1.8" fill="${inner}"/>`;
}
function svgIconChart(color: string): string {
  return `<rect x="-5" y="1" width="3" height="5" rx="1" fill="${color}"/><rect x="-1" y="-2" width="3" height="8" rx="1" fill="${color}"/><rect x="3" y="-5" width="3" height="11" rx="1" fill="${color}"/>`;
}
function svgIconStar(color: string): string {
  return `<path d="M0-6l1.85 3.74L6-1.7l-3 2.92.71 4.17L0 3.6l-3.71 1.79.71-4.17-3-2.92 4.15.44z" fill="${color}"/>`;
}
function svgIconCommit(color: string): string {
  return `<circle cx="0" cy="0" r="4.5" fill="none" stroke="${color}" stroke-width="2"/><circle cx="0" cy="0" r="1.5" fill="${color}"/>`;
}
function svgIconPullRequest(color: string): string {
  return `<path d="M-5-6h10M0-6v12M-5 6h10" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
}
function svgIconIssue(color: string): string {
  return `<circle cx="0" cy="0" r="5.5" fill="none" stroke="${color}" stroke-width="2"/><circle cx="0" cy="-1" r="1.2" fill="${color}"/><line x1="0" y1="0.5" x2="0" y2="3.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
}
function svgIconBranch(color: string): string {
  return `<circle cx="-4" cy="-5" r="2.2" fill="${color}"/><circle cx="-4" cy="5" r="2.2" fill="${color}"/><circle cx="4" cy="-5" r="2.2" fill="${color}"/><path d="M-4-2.8v5.6M4-2.8c0 4-8 1.5-8 5" stroke="${color}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
}
function svgIconCode(color: string): string {
  return `<path d="M-2.5-5l-4 5 4 5" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5-5l4 5-4 5" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="1" y1="-6" x2="-1" y2="6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
}
function svgIconSparkle(color: string): string {
  return `<path d="M0-7l1.7 5.3 5.3 1.7-5.3 1.7L0 7l-1.7-5.3L-7 0l5.3-1.7z" fill="${color}"/>`;
}
function svgIconTarget(color: string): string {
  return `<circle cx="0" cy="0" r="6.5" fill="none" stroke="${color}" stroke-width="2.2"/><circle cx="0" cy="0" r="2.6" fill="${color}"/>`;
}
function svgIconPulse(color: string): string {
  return `<path d="M-6 0h3l1.5-3 2 6 1.5-3h3" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// 分级：越高越难（对数评级下 90+ 极罕见，60+ 已是活跃开发者）
function grade(rating: number): string {
  if (rating >= 90) return 'S';
  if (rating >= 75) return 'A';
  if (rating >= 60) return 'B';
  if (rating >= 40) return 'C';
  if (rating >= 20) return 'D';
  return 'E';
}

function lineChart(data: UserStats, x: number, y: number, width: number, height: number, color: string): string {
  const values = data.contributionWeeks.map((week) => week.contributions);
  if (values.length < 2 || values.every((value) => value === 0)) return '';
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const pointX = x + index / (values.length - 1) * width;
    const pointY = y + height - value / max * height;
    return `${pointX.toFixed(1)},${pointY.toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${x},${y + height} ${points} ${x + width},${y + height}" fill="${color}" fill-opacity=".16"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}

  function dailyActivityChart(data: UserStats, x: number, y: number, width: number, height: number, color: string): string {
    const days = data.contributionDays.slice(-31);
    const values = days.map((day) => day.contributions);
    if (values.length < 2 || values.every((value) => value === 0)) return '';
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => {
      const pointX = x + index / (values.length - 1) * width;
      const pointY = y + height - value / max * height;
      return `${pointX.toFixed(1)},${pointY.toFixed(1)}`;
    }).join(' ');
    const dots = values.map((value, index) => {
      if (value === 0 && index !== 0 && index !== values.length - 1) return '';
      const pointX = x + index / (values.length - 1) * width;
      const pointY = y + height - value / max * height;
      return `<circle cx="${pointX.toFixed(1)}" cy="${pointY.toFixed(1)}" r="4" fill="${color}"/>`;
    }).join('');
    return `<polygon points="${x},${y + height} ${points} ${x + width},${y + height}" fill="${color}" fill-opacity=".18"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }

// ------------------------- 霓虹星空主题（霓虹星空.png 设计稿底图） -------------------------
// 卡片 = 设计稿底图 + 数据叠层：底图由 scripts/build-bg.js 预处理生成，代码只负责把数据画进
// 设计稿留出的槽位。下方是全部槽位与数据的对照表——图标是烙在底图里的，标签必须跟图标语义一致，
// 改数据前先对照这里（历史上星环面板被错放过 Repos/Forks、人形行被错放过 Contributed To，别再犯）：
//
// 【头图区】
//   霓虹圆环           → 用户头像（圆形 clipPath 嵌入；拉不到头像时保持纯装饰环）
//   环右侧 4 行        → 姓名 / @登录名 / 简介 / 位置·加入年份
//   顶部星空居中       → 座右铭（?motto= 参数，可选，斜体带引号）
//
// 【右上图表面板】（柱状小图标）
//   折线 + 月份刻度    → 近 12 个月按周聚合的贡献折线；右上角文字 = 年度贡献总数
//
// 【统计面板】（左侧大面板，五行图标自上而下，行图标决定行标签，不可互换）
//   ⭐ 金色星星        → Total Stars            收到的 Star 总数
//   ◎ 绿色圆环记录    → Contributions · 1yr    近一年贡献数
//   ⫛ 紫蓝双支线      → Pull Requests · 1yr    近一年拉取请求数
//   ⊕ 红粉感叹圆      → Issues · 1yr           近一年 Issue 数
//   👥 青色人形        → Followers              关注者数
//
// 【评级环 + 胶囊】   → Rating 渐变进度弧 / 等级字母（S-E）/ 分数 / RATING 字样
//
// 【语言面板】（</> 橙色图标）
//   两列 4 行彩色圆点  → 语言占比，最多 8 条，圆点用 GitHub 官方语言色
//
// 【三个小面板】（自左向右，面板图标决定主题，不可互换）
//   🪐 星环/绕行轨道   → 贡献主题：Contributions（近一年贡献数，第一行大数）
//                        + Contributed（贡献过的仓库数 contributedTo）
//   🔥 火焰            → 连击主题：Current（当前连击天数）+ Longest（最长连击天数）
//   ⫛ PR 双支线        → PR 主题：PRs（近一年拉取请求）+ Reviews（近一年为他人 PR 的评审数）
//
// 【热力图面板】（循环箭头图标）
//   53×7 圆点网格      → 逐日贡献日历（列按周、行按星期对齐），末列对齐最新一天的真实星期
//   左侧彩色圆点 4 行  → 亮点指标：年度总量 / 单日峰值 / 活跃天数 / 日均
//   底部刻度           → 月份标签（取真实月初）
//
// 【底栏】（</> / ⭐ / 🚀）
//   三段文字           → 公开仓库数 / 总 Star 数 / 年度贡献数（与上方面板呼应的摘要行）
//
// 全部叠层坐标为对设计稿逐像素实测，NEON_* 常量即测量结果；改底图后须重新测量。
const NEON_WIDTH = 1024;
const NEON_HEIGHT = 1536;
const NEON_PANEL = '#010e28';
const NEON_STAT_ROWS = [714, 759, 802, 845, 889];
const NEON_LANG_ROWS = [716, 766, 816, 866];
const NEON_LANG_COLUMNS = [
  { dotX: 552, nameX: 570, valueX: 712 },
  { dotX: 780, nameX: 798, valueX: 956 },
];
const NEON_MINI_ROWS = [1023, 1068];
const NEON_HEAT_BULLETS = [
  { y: 1220, color: '#6c41fa' },
  { y: 1255, color: '#0275fc' },
  { y: 1289, color: '#f462b4' },
  { y: 1323, color: '#f87021' },
];
// 热力图 53 周 × 7 天，圆点几何按设计稿网格区域（189..946 × 1220..1338）重新推算
const NEON_HEAT = { x0: 189, x1: 946, y0: 1220, y1: 1338, radius: 5 };
const NEON_HEAT_LEVELS = ['#151954', '#2b2a6e', '#5640c8', '#8b5cf6', '#c9b8ff'];
const NEON_RING = { cx: 400, cy: 760, r: 62 };
// 头图霓虹环实测圆心 (200, 265)、内半径约 117；头像取 r=110，与环内缘留一圈暗缝
const NEON_AVATAR = { cx: 200, cy: 265, r: 110 };
const NEON_CHART = { x0: 556, x1: 961, top: 405, base: 567 };

function neonCompact(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return formatNumber(n);
}

// 折线图与热力图共用的横轴月份标签：优先取真实贡献窗口，无数据退回最近 12 个月
function neonMonthLabels(data: UserStats, count: number): string[] {
  const days = data.contributionDays;
  const first = days.length ? new Date(`${days[0].date}T00:00:00Z`) : new Date(NaN);
  const last = days.length ? new Date(`${days[days.length - 1].date}T00:00:00Z`) : new Date(NaN);
  if (!Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime()) && last.getTime() > first.getTime()) {
    const span = last.getTime() - first.getTime();
    return Array.from({ length: count }, (_, index) => formatMonthLabel(new Date(first.getTime() + span * (index / (count - 1)))));
  }
  const now = new Date();
  const back = [11, 9, 7, 4, 2, 0];
  return Array.from({ length: count }, (_, index) => formatMonthLabel(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back[Math.min(index, back.length - 1)], 15))));
}

export function renderNeonStarlightCard(data: UserStats, opts: CardOptions): string {
  const fontStack = cardFontStacks[opts.font];
  const { profile, stats } = data;
  const avatarDataUri = opts.avatarDataUri;
  const days = data.contributionDays;
  const total = stats.contributionsLastYear;
  const cover = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${NEON_PANEL}"/>`;
  const text = (x: number, y: number, size: number, fill: string, content: string, anchor = '', weight = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}${weight ? ` font-weight="${weight}"` : ''}>${content}</text>`;

  // 头图文案：姓名 / @登录名 / 简介 / 位置与加入年份（没有位置时单独的年份要带 since 才可读）
  const joinedYear = profile.joinedAt ? new Date(profile.joinedAt).getUTCFullYear() : 0;
  const heroMeta = [profile.location, joinedYear ? (profile.location ? `${joinedYear}` : `since ${joinedYear}`) : ''].filter(Boolean).join(' · ');
  const hero = [
    text(372, 270, 23, '#f8faff', escapeXml(truncate(profile.name || profile.login, 14)), '', '700'),
    text(372, 313, 14, '#9aa8ff', escapeXml(`@${truncate(profile.login, 20)}`)),
    profile.bio ? text(372, 356, 13, '#ccd4f5', escapeXml(truncate(profile.bio, 22))) : '',
    heroMeta ? text(372, 398, 12, '#8b93c8', escapeXml(truncate(heroMeta, 24))) : '',
  ].join('');

  // 贡献折线图（右上面板）：近 12 个月按周聚合，霓虹渐变描边 + 渐隐面积
  const weekValues = data.contributionWeeks.map((week) => week.contributions);
  const hasChart = weekValues.length > 1 && weekValues.some((value) => value > 0);
  let chart = '';
  if (hasChart) {
    const max = Math.max(...weekValues, 1);
    const points = weekValues.map((value, index) =>
      `${(NEON_CHART.x0 + index / (weekValues.length - 1) * (NEON_CHART.x1 - NEON_CHART.x0)).toFixed(1)},${(NEON_CHART.base - value / max * (NEON_CHART.base - NEON_CHART.top)).toFixed(1)}`);
    chart = `<polygon points="${NEON_CHART.x0},${NEON_CHART.base} ${points.join(' ')} ${NEON_CHART.x1},${NEON_CHART.base}" fill="url(#neonArea)"/><polyline class="neonPulse" points="${points.join(' ')}" fill="none" stroke="url(#neonLine)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#neonGlow)"/>`;
  }
  const chartAxis = neonMonthLabels(data, 6).map((label, index, labels) => {
    const x = NEON_CHART.x0 + index / (labels.length - 1) * (NEON_CHART.x1 - NEON_CHART.x0);
    const anchor = index === 0 ? '' : index === labels.length - 1 ? 'end' : 'middle';
    return text(Math.round(x), 588, 9.5, '#7c87b8', label, anchor);
  }).join('');

  // 统计面板五行：行顺序固定，标签必须与底图行图标同义（星星/圆环记录/双支线/感叹圆/人形）
  const statRows: Array<[string, string]> = [
    ['Total Stars', formatNumber(stats.stars)],                        // ⭐ 星星图标：收到 Star 总数
    ['Contributions · 1yr', formatNumber(stats.contributionsLastYear)], // ◎ 圆环记录图标：近一年贡献
    ['Pull Requests · 1yr', formatNumber(stats.pullRequests)],         // ⫛ 双支线图标：近一年 PR
    ['Issues · 1yr', formatNumber(stats.issues)],                      // ⊕ 感叹圆图标：近一年 Issue
    ['Followers', formatNumber(stats.followers)],                      // 👥 人形图标：关注者（勿放其他指标）
  ];
  const statLayer = statRows.map(([label, value], index) => {
    const y = NEON_STAT_ROWS[index];
    return text(106, y + 4, 13, '#b4bde6', label) + text(298, y + 4, 15, '#f4f6ff', value, 'end', '700');
  }).join('');
  // 评级环：设计稿在统计面板右侧留了空霓虹圆环 + 下方空胶囊，分别画评级进度弧和 RATING 字样
  const ringFraction = Math.min(Math.max(stats.rating, 0), 100) / 100;
  const ringLength = 2 * Math.PI * NEON_RING.r;
  const ringLayer = `<circle cx="${NEON_RING.cx}" cy="${NEON_RING.cy}" r="${NEON_RING.r}" fill="none" stroke="url(#neonArc)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(ringLength * ringFraction).toFixed(1)} ${ringLength.toFixed(1)}" transform="rotate(-90 ${NEON_RING.cx} ${NEON_RING.cy})" filter="url(#neonGlow)"/>` +
    text(NEON_RING.cx, 772, 36, '#ffffff', grade(stats.rating), 'middle', '700') +
    text(NEON_RING.cx, 794, 12.5, '#9aa8ff', `${stats.rating} / 100`, 'middle') +
    `<text x="397" y="880" text-anchor="middle" font-size="13" letter-spacing="4" fill="#a78bfa">RATING</text>`;

  // 语言占比：两列 × 四行，圆点重着色为 GitHub 官方语言色
  const languages = data.languages.slice(0, 8);
  const languageLayer = languages.map((language, index) => {
    const column = NEON_LANG_COLUMNS[index % 2];
    const y = NEON_LANG_ROWS[Math.floor(index / 2)];
    return `<circle cx="${column.dotX}" cy="${y}" r="8" fill="${languageColor(language.name)}"/>` +
      text(column.nameX, y + 4.5, 13, '#dce2ff', escapeXml(truncate(language.name, 16))) +
      text(column.valueX, y + 4.5, 12, '#98a2d8', `${language.percentage}%`, 'end');
  }).join('');

  // 三个小面板：面板图标决定两行主题，不可互换（星环=贡献、火焰=连击、双支线=拉取请求）
  // 星环面板标签较长，字号缩到 11.5、数值锚点右移，避免和多位数值碰撞
  const miniPanels: Array<{ labelX: number; valueX: number; labelSize?: number; rows: Array<[string, string]> }> = [
    { labelX: 214, valueX: 318, labelSize: 11.5, rows: [
      ['Contributions', formatNumber(stats.contributionsLastYear)], // 🪐 星环：近一年贡献总数（此面板第一行大数）
      ['Contributed', formatNumber(stats.contributedTo)],           // 🪐 星环：贡献过的仓库数
    ] },
    { labelX: 522, valueX: 627, rows: [
      ['Current', `${stats.currentStreak}d`],                       // 🔥 火焰：当前连击天数
      ['Longest', `${stats.longestStreak}d`],                       // 🔥 火焰：最长连击天数
    ] },
    { labelX: 827, valueX: 955, rows: [
      ['PRs', formatNumber(stats.pullRequests)],                    // ⫛ 双支线：近一年拉取请求
      ['Reviews', formatNumber(stats.reviews)],                     // ⫛ 双支线：近一年为他人 PR 的评审数
    ] },
  ];
  const miniLayer = miniPanels.map((panel) => panel.rows.map(([label, value], index) => {
    const y = NEON_MINI_ROWS[index];
    return text(panel.labelX, y + 4, panel.labelSize ?? 12, '#a6afdd', label) + text(panel.valueX, y + 4, 15, '#f4f6ff', value, 'end', '700');
  }).join('')).join('');

  // 贡献热力图：真实 53 周 × 7 天日历（列按周、行按星期对齐），左侧四个彩色圆点改为亮点指标
  const maxDay = days.reduce((peak, day) => Math.max(peak, day.contributions), 0);
  const activeDays = days.filter((day) => day.contributions > 0).length;
  const perDay = days.length ? total / days.length : 0;
  const highlights = [
    `${neonCompact(total)} total`,
    `peak ${maxDay}`,
    `${activeDays} active`,
    `${perDay.toFixed(1)}/day`,
  ];
  const bulletLayer = NEON_HEAT_BULLETS.map((bullet, index) => text(86, bullet.y + 4, 11.5, '#a6afdd', highlights[index] || '')).join('');
  let heatDots = '';
  if (days.length) {
    const lastWeekday = new Date(`${days[days.length - 1].date}T00:00:00Z`).getUTCDay();
    const weekDays = 7;
    const pitchX = (NEON_HEAT.x1 - NEON_HEAT.x0) / 52;
    const pitchY = (NEON_HEAT.y1 - NEON_HEAT.y0) / 6;
    const max = Math.max(maxDay, 1);
    days.forEach((day, index) => {
      // 最新一天落在网格末列的其真实星期上，向前逐格回推
      const cell = 364 + lastWeekday - (days.length - 1 - index);
      if (cell < 0) return;
      const value = day.contributions;
      const ratio = value / max;
      const level = value === 0 ? 0 : ratio < 0.3 ? 1 : ratio < 0.55 ? 2 : ratio < 0.8 ? 3 : 4;
      heatDots += `<circle cx="${(NEON_HEAT.x0 + Math.floor(cell / weekDays) * pitchX).toFixed(1)}" cy="${(NEON_HEAT.y0 + (cell % weekDays) * pitchY).toFixed(1)}" r="${NEON_HEAT.radius}" fill="${NEON_HEAT_LEVELS[level]}"/>`;
    });
  }
  // 热力图月份刻度：取窗口内真实月初，过密时跳过
  const heatTicks: Array<{ label: string; x: number }> = [];
  if (days.length) {
    const lastWeekday = new Date(`${days[days.length - 1].date}T00:00:00Z`).getUTCDay();
    const pitchX = (NEON_HEAT.x1 - NEON_HEAT.x0) / 52;
    let lastColumn = -99;
    days.forEach((day, index) => {
      const cell = 364 + lastWeekday - (days.length - 1 - index);
      if (cell < 0) return;
      const date = new Date(`${day.date}T00:00:00Z`);
      const column = Math.floor(cell / 7);
      if (date.getUTCDate() === 1 && column - lastColumn >= 3) {
        heatTicks.push({ label: monthAbbreviations[date.getUTCMonth()], x: NEON_HEAT.x0 + column * pitchX });
        lastColumn = column;
      }
    });
  }
  const heatTickLabels = (heatTicks.length >= 2 ? heatTicks : neonMonthLabels(data, 6).map((label, index) => ({ label, x: NEON_HEAT.x0 + Math.round(index / 5 * 52) * (NEON_HEAT.x1 - NEON_HEAT.x0) / 52 })))
    .map((tick, index, ticks) => {
      const anchor = index === 0 ? '' : index === ticks.length - 1 ? 'end' : 'middle';
      return text(Math.round(tick.x), 1381, 9.5, '#7c87b8', tick.label, anchor);
    }).join('');

  // 底栏摘要：仓库 / Star / 年度贡献
  const footer = [
    text(122, 1476, 12.5, '#b4bde6', `${formatNumber(stats.publicRepositories)} public repositories`),
    text(368, 1476, 12.5, '#b4bde6', `${formatNumber(stats.stars)} total stars`),
    text(893, 1476, 12.5, '#b4bde6', `${neonCompact(total)} contributions`, 'end'),
  ].join('');

  // 头像：服务端拉取失败时缺省，霓虹环退回纯装饰（设计稿原貌）
  const avatarLayer = avatarDataUri
    ? `<clipPath id="neonAvatarClip"><circle cx="${NEON_AVATAR.cx}" cy="${NEON_AVATAR.cy}" r="${NEON_AVATAR.r}"/></clipPath>` +
      `<image xlink:href="${avatarDataUri}" x="${NEON_AVATAR.cx - NEON_AVATAR.r}" y="${NEON_AVATAR.cy - NEON_AVATAR.r}" width="${NEON_AVATAR.r * 2}" height="${NEON_AVATAR.r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#neonAvatarClip)"/>`
    : '';

  // 座右铭：卡片最上方星空区居中斜体；引号在渲染层包上，长度超限在这里兜底截断
  const mottoLayer = opts.motto
    ? `<text x="512" y="66" text-anchor="middle" font-size="16" font-style="italic" letter-spacing="1.5" fill="#c7cfff">${escapeXml(`“${truncate(opts.motto.trim(), 40)}”`)}</text>`
    : '';

  // 面板内占位元素（虚线 / "--" / 装饰圆点 / 装饰刻度）统一同色覆盖
  const covers = [
    ...NEON_STAT_ROWS.flatMap((y) => [cover(100, y - 8, 154, 16), cover(266, y - 8, 34, 16)]),
    ...NEON_LANG_ROWS.flatMap((y) => [
      `<circle cx="${NEON_LANG_COLUMNS[0].dotX}" cy="${y}" r="10" fill="${NEON_PANEL}"/><circle cx="${NEON_LANG_COLUMNS[1].dotX}" cy="${y}" r="10" fill="${NEON_PANEL}"/>`,
      cover(570, y - 8, 146, 16), cover(798, y - 8, 162, 16),
    ]),
    ...NEON_MINI_ROWS.flatMap((y) => [cover(206, y - 8, 112, 16), cover(514, y - 8, 118, 16), cover(819, y - 8, 140, 16)]),
    cover(183, 1206, 770, 146),
    ...NEON_HEAT_BULLETS.map((bullet) => cover(84, bullet.y - 8, 88, 16)),
    cover(160, 1365, 786, 22),
    cover(548, 571, 424, 20),
    cover(114, 1460, 200, 20), cover(678, 1460, 220, 20),
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${NEON_WIDTH}" height="${NEON_HEIGHT}" viewBox="0 0 ${NEON_WIDTH} ${NEON_HEIGHT}" role="img" aria-labelledby="neonTitle neonDesc">
  <title id="neonTitle">${escapeXml(profile.name || profile.login)} GitHub stats</title>
  <desc id="neonDesc">GitHub contribution and language statistics for ${escapeXml(profile.login)}</desc>
  <defs>
    <linearGradient id="neonLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff3cac"/><stop offset=".5" stop-color="#8b5cf6"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
    <linearGradient id="neonArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c3aed" stop-opacity=".38"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></linearGradient>
    <linearGradient id="neonArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3cac"/><stop offset="1" stop-color="#3c8ce7"/></linearGradient>
    <filter id="neonGlow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>
      text { font-family: ${fontStack}; }
      .neonPulse { animation: neonPulse 3.2s ease-in-out infinite; }
      @keyframes neonPulse { 0%, 100% { opacity: .78; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .neonPulse { animation: none; opacity: 1; } }
    </style>
  </defs>
  <image xlink:href="${neonStarlightBackground}" x="0" y="0" width="${NEON_WIDTH}" height="${NEON_HEIGHT}"/>
  ${avatarLayer}
  ${mottoLayer}
  ${covers}
  ${hero}
  ${text(598, 360, 12, '#8f9ad0', 'CONTRIBUTIONS', '', '700')}
  ${text(NEON_CHART.x1, 360, 12, '#aab3dd', `${formatNumber(total)} contributions · past year`, 'end')}
  ${chart}
  ${chartAxis}
  ${statLayer}
  ${ringLayer}
  ${languageLayer}
  ${miniLayer}
  ${bulletLayer}
  ${heatDots}
  ${heatTickLabels}
  ${footer}
</svg>`;
}

// 经典自绘风格的统计卡片（除霓虹星空外的所有主题共用），版面自上而下：
//   顶部        → 姓名 + @登录名（居中标题）
//   左列四行    → 年度贡献 / 公开仓库 / 加入时间 / 联系方式（带辉光图标）
//   右上        → 近 12 个月按周贡献折线 + 月份轴
//   中部两面板  → GitHub Stats（Star/贡献/PR/Issue/Contributed 五行 + 评级环）｜Most Used Languages（占比条 + 两列明细）
//   底部三面板  → Total Contributions ｜ Current Streak（含最长连击）｜Repositories Contributed
//   最底        → 近 31 天逐日贡献折线面板
export function renderStatsCard(data: UserStats, themeName?: unknown, options: Partial<CardOptions> = {}): string {
  const opts: CardOptions = { ...defaultCardOptions, ...options };
  const fontStack = cardFontStacks[opts.font];
  const { profile, stats } = data;
  const theme = getTheme(themeName);
  // 霓虹星空主题使用 霓虹星空.png 设计稿底图的专属渲染器，不走自绘样式
  if (theme.name === 'neon-starlight') return renderNeonStarlightCard(data, opts);
  const title = profile.name || profile.login;
  const languages = data.languages.slice(0, 8);
  const languageTotal = languages.reduce((total, item) => total + item.percentage, 0) || 1;
  let languageOffset = 0;
  const languageBar = languages.map((language, index) => {
    const width = language.percentage / languageTotal * 294;
    const color = languageColor(language.name);
    const result = `<rect x="${416 + languageOffset}" y="286" width="${width}" height="10" fill="${color}"/>`;
    languageOffset += width;
    return result;
  }).join('');
  const languageList = languages.slice(0, 6).map((language, index) => {
    const itemX = 420 + (index % 2) * 145;
    const itemY = 329 + Math.floor(index / 2) * 23;
    const color = languageColor(language.name);
    return `<circle cx="${itemX}" cy="${itemY - 4}" r="4" fill="${color}"/><text x="${itemX + 12}" y="${itemY}" font-family="Arial, sans-serif" font-size="11" fill="${theme.body}">${escapeXml(truncate(language.name, 12))}</text><text x="${itemX + 112}" y="${itemY}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="${theme.muted}">${language.percentage}%</text>`;
  }).join('');
  const hasContributions = stats.contributionsLastYear > 0 && data.contributionWeeks.length > 1;
  const activityChart = hasContributions ? dailyActivityChart(data, 54, 650, 650, 60, theme.chart) : '';
  const topChart = hasContributions ? lineChart(data, 470, 112, 240, 73, theme.chart) : '';
  const joined = profile.joinedAt ? new Date(profile.joinedAt).getFullYear() : 0;
  const joinedYears = joined ? new Date().getFullYear() - joined : 0;
  const joinedLabel = joined ? `Joined GitHub ${joinedYears} year${joinedYears === 1 ? '' : 's'} ago` : 'GitHub member';
  const contact = [profile.location, profile.company, profile.email || profile.website].filter(Boolean).join('  |  ');
  const monthAxis = monthAxisText(contributionAxisLabels(data), 470, 240, 202, 'Arial, sans-serif', theme.muted);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="773" height="766" viewBox="0 0 773 766" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)} GitHub stats</title>
  <desc id="description">GitHub contribution and language statistics for ${escapeXml(profile.login)}</desc>
  <defs>
    <filter id="iconGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="blur"/><feFlood flood-color="${theme.glow}" flood-opacity="0.9" result="color"/><feComposite in="color" in2="blur" operator="in" result="halo"/><feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>
      text { font-family: ${fontStack}; }
      .iconGlow { filter: url(#iconGlow); animation: iconPulse 3.2s ease-in-out infinite; }
      @keyframes iconPulse { 0%, 100% { opacity: .82; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .iconGlow { animation: none; opacity: 1; } }
    </style>
  </defs>
  <rect width="773" height="766" fill="${theme.background}"/>
  <rect x="9" y="10" width="755" height="746" rx="13" fill="none" stroke="${theme.panelBorder}" stroke-width="2"/>
  <text x="386" y="43" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="${theme.chart}">${escapeXml(title)}</text>
  <text x="386" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="${theme.body}">${escapeXml(profile.login)}</text>
  <g class="iconGlow" transform="translate(41,120)">${svgIconFlame(theme.chart)}</g><text x="52" y="124" font-family="Arial, sans-serif" font-size="13" fill="${theme.body}">${formatNumber(stats.contributionsLastYear)} contributions in the last 12 months</text>
  <g class="iconGlow" transform="translate(41,147)">${svgIconRepository(theme.chart)}</g><text x="52" y="151" font-family="Arial, sans-serif" font-size="13" fill="${theme.body}">${stats.publicRepositories} public repositories</text>
  <g class="iconGlow" transform="translate(41,174)">${svgIconCalendar(theme.chart)}</g><text x="52" y="178" font-family="Arial, sans-serif" font-size="13" fill="${theme.body}">${escapeXml(joinedLabel)}</text>
  <g class="iconGlow" transform="translate(41,201)">${svgIconPin(theme.chart, theme.background)}</g><text x="52" y="205" font-family="Arial, sans-serif" font-size="13" fill="${theme.body}">${escapeXml(truncate(contact, 56) || 'GitHub developer')}</text>
  <text x="584" y="101" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${theme.body}">Monthly Contributions (Last 12 Months)</text>
  <line x1="470" y1="185" x2="710" y2="185" stroke="${theme.divider}"/><line x1="470" y1="130" x2="710" y2="130" stroke="${theme.divider}" stroke-dasharray="2 4"/>${topChart}
  ${monthAxis}
  <rect x="39" y="235" width="339" height="180" rx="13" fill="${theme.divider}" fill-opacity=".18" stroke="${theme.panelBorder}"/><g class="iconGlow" transform="translate(44,267)">${svgIconChart(theme.panelTitle)}</g><text x="60" y="271" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${theme.panelTitle}">GitHub Stats</text>
  <g class="iconGlow" transform="translate(48,300)">${svgIconStar(theme.chart)}</g><text x="65" y="304" font-family="Arial, sans-serif" font-size="12" fill="${theme.body}">Total Stars Earned</text><text x="266" y="304" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="${theme.title}">${stats.stars}</text>
  <g class="iconGlow" transform="translate(48,324)">${svgIconCommit(theme.chart)}</g><text x="65" y="328" font-family="Arial, sans-serif" font-size="12" fill="${theme.body}">Contributions (12mo)</text><text x="266" y="328" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="${theme.title}">${stats.contributionsLastYear}</text>
  <g class="iconGlow" transform="translate(48,348)">${svgIconPullRequest(theme.chart)}</g><text x="65" y="352" font-family="Arial, sans-serif" font-size="12" fill="${theme.body}">Pull Requests (12mo)</text><text x="266" y="352" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="${theme.title}">${stats.pullRequests}</text>
  <g class="iconGlow" transform="translate(48,372)">${svgIconIssue(theme.chart)}</g><text x="65" y="376" font-family="Arial, sans-serif" font-size="12" fill="${theme.body}">Issues (12mo)</text><text x="266" y="376" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="${theme.title}">${stats.issues}</text>
  <g class="iconGlow" transform="translate(48,396)">${svgIconBranch(theme.chart)}</g><text x="65" y="400" font-family="Arial, sans-serif" font-size="12" fill="${theme.body}">Contributed To (12mo)</text><text x="266" y="400" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="${theme.title}">${stats.contributedTo}</text>
  <circle cx="330" cy="331" r="37" fill="none" stroke="${theme.panelBorder}" stroke-width="3"/><circle cx="330" cy="331" r="29" fill="${theme.background}"/><text x="330" y="340" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="${theme.chart}">${grade(stats.rating)}</text><text x="330" y="386" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="${theme.body}">Rating</text>
  <rect x="395" y="235" width="339" height="180" rx="13" fill="${theme.divider}" fill-opacity=".18" stroke="${theme.panelBorder}"/><g class="iconGlow" transform="translate(399,267)">${svgIconCode(theme.panelTitle)}</g><text x="416" y="271" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${theme.panelTitle}">Most Used Languages</text><rect x="416" y="286" width="294" height="10" rx="5" fill="${theme.divider}"/>${languageBar}${languageList}
  <rect x="39" y="435" width="216" height="127" rx="13" fill="${theme.divider}" fill-opacity=".18" stroke="${theme.panelBorder}"/><g class="iconGlow" transform="translate(147,473) scale(1.9)">${svgIconSparkle(theme.chart)}</g><text x="147" y="505" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${theme.chart}">${stats.contributionsLastYear}</text><text x="147" y="527" text-anchor="middle" font-size="11" font-weight="700" fill="${theme.body}">Total Contributions</text><text x="147" y="547" text-anchor="middle" font-size="10" fill="${theme.muted}">${joined ? `Since ${joined}` : 'Last 12 months'}</text>
  <rect x="278" y="435" width="216" height="127" rx="13" fill="${theme.divider}" fill-opacity=".18" stroke="${theme.panelBorder}"/><g class="iconGlow" transform="translate(386,473) scale(1.9)">${svgIconTarget(theme.chart)}</g><text x="386" y="511" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="${theme.title}">${stats.currentStreak}</text><text x="386" y="533" text-anchor="middle" font-size="11" font-weight="700" fill="${theme.body}">Current Streak</text><text x="386" y="549" text-anchor="middle" font-size="10" fill="${theme.muted}">Longest: ${stats.longestStreak} days</text>
  <rect x="517" y="435" width="217" height="127" rx="13" fill="${theme.divider}" fill-opacity=".18" stroke="${theme.panelBorder}"/><g class="iconGlow" transform="translate(625,473) scale(1.9)">${svgIconBranch(theme.body)}</g><text x="625" y="511" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="${theme.body}">${stats.contributedTo}</text><text x="625" y="533" text-anchor="middle" font-size="11" font-weight="700" fill="${theme.body}">Repositories Contributed</text><text x="625" y="549" text-anchor="middle" font-size="10" fill="${theme.muted}">outside own repos</text>
  <rect x="39" y="584" width="695" height="143" rx="13" fill="${theme.divider}" fill-opacity=".18" stroke="${theme.panelBorder}"/><g class="iconGlow" transform="translate(44,616)">${svgIconPulse(theme.panelTitle)}</g><text x="60" y="620" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${theme.panelTitle}">Contribution Activity</text><text x="60" y="640" font-family="Arial, sans-serif" font-size="11" fill="${theme.body}">${hasContributions ? 'Daily contributions · Last 31 days' : ''}</text><line x1="54" y1="650" x2="704" y2="650" stroke="${theme.divider}" stroke-dasharray="3 4"/><line x1="54" y1="680" x2="704" y2="680" stroke="${theme.divider}" stroke-dasharray="3 4"/><line x1="54" y1="710" x2="704" y2="710" stroke="${theme.divider}"/><text x="42" y="654" text-anchor="end" font-family="Arial, sans-serif" font-size="9" fill="${theme.body}">${hasContributions ? Math.max(...data.contributionDays.slice(-31).map((day) => day.contributions), 0) : ''}</text><text x="42" y="684" text-anchor="end" font-family="Arial, sans-serif" font-size="9" fill="${theme.body}">${hasContributions ? Math.round(Math.max(...data.contributionDays.slice(-31).map((day) => day.contributions), 0) / 2) : ''}</text><text x="42" y="714" text-anchor="end" font-family="Arial, sans-serif" font-size="9" fill="${theme.body}">${hasContributions ? '0' : ''}</text>${activityChart}<text x="54" y="723" font-family="Arial, sans-serif" font-size="9" fill="${theme.muted}">${hasContributions ? data.contributionDays.slice(-31)[0]?.date.slice(5) : ''}</text><text x="379" y="723" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="${theme.muted}">${hasContributions ? data.contributionDays.slice(-31)[15]?.date.slice(5) : ''}</text><text x="704" y="723" text-anchor="end" font-family="Arial, sans-serif" font-size="9" fill="${theme.muted}">${hasContributions ? data.contributionDays.slice(-1)[0]?.date.slice(5) : ''}</text>
</svg>`;
}

export const defaultCardOptions: CardOptions = {
  font: 'sans',
};

export function renderLanguagesCard(data: UserStats, themeName?: unknown): string {
  const theme = getTheme(themeName);
  const languages = data.languages.slice(0, 8);
  const total = languages.reduce((sum, language) => sum + language.percentage, 0) || 1;
  let offset = 68;
  const bar = languages.map((language, index) => {
    const width = language.percentage / total * 859;
    const color = languageColor(language.name);
    const segment = `<rect x="${offset.toFixed(1)}" y="164" width="${width.toFixed(1)}" height="32" fill="${color}"/>`;
    offset += width;
    return segment;
  }).join('');
  const rows = languages.map((language, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = column === 0 ? 68 : 527;
    const y = 266 + row * 71;
    const color = languageColor(language.name);
    return `<circle cx="${x + 15}" cy="${y - 11}" r="13" fill="${color}"/><text x="${x + 52}" y="${y}" font-family="Arial, sans-serif" font-size="31" font-weight="700" fill="${theme.title}">${escapeXml(truncate(language.name, 16))}</text><text x="${x + 402}" y="${y}" text-anchor="end" font-family="Arial, sans-serif" font-size="31" fill="${theme.body}">${language.percentage.toFixed(1)}%</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="533" viewBox="0 0 1000 533" role="img" aria-labelledby="title description">
  <title id="title">Most Used Languages</title>
  <desc id="description">Programming language distribution for ${escapeXml(data.profile.login)}</desc>
  <rect width="1000" height="533" fill="${theme.background}"/>
  <rect x="4" y="7" width="988" height="522" rx="36" fill="${theme.divider}" fill-opacity=".22" stroke="${theme.panelBorder}" stroke-width="2"/>
  <g transform="translate(86,100) scale(1.6)">${svgIconCode(theme.chart)}</g>
  <text x="142" y="113" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="${theme.panelTitle}">Most Used Languages</text>
  <rect x="68" y="164" width="859" height="32" rx="16" fill="${theme.divider}"/>${bar}
${rows}
</svg>`;
}

