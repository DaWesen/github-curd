import type { CardTheme, ThemeName, UserStats } from './types';
import { cardFontStacks, type CardOptions } from './types';
import { getTheme } from './themes';
import { themeBackgrounds, type ThemeBackground } from './theme-bgs';
import { layoutFor } from './card-layouts';

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

// ------------------------- 设计稿底图渲染器（全部主题共用） -------------------------
// 卡片 = 设计稿底图 + 数据叠层：底图由 scripts/build-bg.js 从 images/<主题>.png 预处理生成
// （统一 1024×1536、擦除全部占位元素），代码只负责把数据画进设计稿留出的槽位。
// 下方是全部槽位与数据的对照表——图标是烙在底图里的，标签必须跟图标语义一致，
// 改数据前先对照这里（历史上星环面板被错放过 Repos/Forks、人形行被错放过 Contributed To，别再犯）：
//
// 【头图区】
//   装饰圆环           → 用户头像（圆形 clipPath 嵌入；拉不到头像时保持纯装饰环）
//   环右侧 4 行        → 姓名 / @登录名 / 简介 / 位置·加入年份
//   顶部艺术区居中     → 座右铭（?motto= 参数，可选，斜体带引号）
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
//   🔥 火焰/水晶       → 连击主题：Current（当前连击天数）+ Longest（最长连击天数）
//   ⫛ 双支线/星座      → PR 主题：PRs（近一年拉取请求）+ Reviews（近一年为他人 PR 的评审数）
//
// 【热力图面板】（循环箭头图标）
//   53×7 圆点网格      → 逐日贡献日历（列按周、行按星期对齐），末列对齐最新一天的真实星期
//   左侧彩色圆点 4 行  → 亮点指标：年度总量 / 单日峰值 / 活跃天数 / 日均
//   底部刻度           → 月份标签（取真实月初）
//
// 【底栏】保持设计稿原样（装饰图标 / 主题标志），不叠绘数据
//
// 全部叠层坐标为对设计稿逐像素实测（所有主题共用同一模板），TPL_* 常量即测量结果；
// 更换/重制底图后须核对坐标是否仍然对得上。
// 全部叠层坐标在 src/card-layouts.ts 里按设计稿逐像素实测（通用模板 + 逐主题覆盖）；
// 更换/重制底图后须核对坐标是否仍然对得上。
const TPL_WIDTH = 1024;
const TPL_HEIGHT = 1536;

// 叠层配色：深色面板直接用主题自带的浅色文字；樱花物语/琥珀暖阳的设计稿是浅色面板，
// 旧主题色按深色底定的部分在这里按设计稿覆盖（heatAccent 同时用于热力图分级色）
interface DesignPalette {
  heroName: string; heroLogin: string; heroBio: string; heroMeta: string; motto: string;
  headerLabel: string; headerTotal: string; axisTick: string;
  statLabel: string; statValue: string;
  grade: string; score: string; ratingWord: string;
  langName: string; langValue: string;
  miniLabel: string; miniValue: string; highlight: string; heatTick: string;
  chartLine: [string, string, string]; chartArea: string; ringArc: [string, string]; heatAccent: string;
}

function designPalette(theme: CardTheme): DesignPalette {
  const palette: DesignPalette = {
    heroName: theme.title, heroLogin: theme.muted, heroBio: theme.body, heroMeta: theme.muted, motto: theme.body,
    headerLabel: theme.panelTitle, headerTotal: theme.body, axisTick: theme.muted,
    statLabel: theme.body, statValue: theme.title,
    grade: theme.title, score: theme.muted, ratingWord: theme.panelTitle,
    langName: theme.body, langValue: theme.muted,
    miniLabel: theme.body, miniValue: theme.title, highlight: theme.body, heatTick: theme.muted,
    chartLine: [theme.glow, theme.accent, theme.chart], chartArea: theme.accent, ringArc: [theme.glow, theme.accent], heatAccent: theme.accent,
  };
  // 浅色设计稿的深色文字覆盖（面板底色见 src/theme-bgs.ts 的采样值）
  const overrides: Partial<Record<ThemeName, Partial<DesignPalette>>> = {
    'sakura-story': {
      heroName: '#5c2440', heroLogin: '#a4708a', heroBio: '#7d3b57', heroMeta: '#a4708a', motto: '#7d3b57',
      headerLabel: '#c2497c', headerTotal: '#7d3b57', axisTick: '#a4708a',
      statLabel: '#7d3b57', statValue: '#4a1f33',
      grade: '#4a1f33', score: '#a4708a', ratingWord: '#c2497c',
      langName: '#7d3b57', langValue: '#a4708a',
      miniLabel: '#7d3b57', miniValue: '#4a1f33', highlight: '#7d3b57', heatTick: '#a4708a',
      chartLine: ['#f472b6', '#ec4899', '#fbbf24'], chartArea: '#ec4899', ringArc: ['#f472b6', '#be185d'], heatAccent: '#c2497c',
    },
    'amber-sun': {
      heroName: '#5b2f0e', heroLogin: '#9a5b1f', heroBio: '#7a4212', heroMeta: '#9a5b1f', motto: '#7a4212',
      headerLabel: '#b45309', headerTotal: '#7a4212', axisTick: '#9a5b1f',
      statLabel: '#7a4212', statValue: '#4a2408',
      grade: '#4a2408', score: '#9a5b1f', ratingWord: '#b45309',
      langName: '#7a4212', langValue: '#9a5b1f',
      miniLabel: '#7a4212', miniValue: '#4a2408', highlight: '#7a4212', heatTick: '#9a5b1f',
      chartLine: ['#fb923c', '#f59e0b', '#fde047'], chartArea: '#f59e0b', ringArc: ['#fb923c', '#d97706'], heatAccent: '#b45309',
    },
    'summer-lemon': { heatAccent: '#eab308' },
    // 极地星光的头图坐在深色星空上，与浅色面板不同，头图/座右铭要用浅色文字
    'polar-starlight': {
      heroName: '#f2f7ff', heroLogin: '#c9daf2', heroBio: '#e2ebfa', heroMeta: '#bdd0ea', motto: '#e6eefb',
    },
  };
  return { ...palette, ...overrides[theme.name] };
}

// 十六进制取色插值：热力图分级色 = 面板底色 → 强调色 渐进混合（浅色/深色面板都成立）
function parseHex(color: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16)) as [number, number, number];
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  return '#' + pa.map((value, index) => Math.round(value + (pb[index] - value) * t).toString(16).padStart(2, '0')).join('');
}

function compactNumber(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return formatNumber(n);
}

// 折线图与热力图共用的横轴月份标签：优先取真实贡献窗口，无数据退回最近 12 个月
function designMonthLabels(data: UserStats, count: number): string[] {
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

export function renderDesignCard(data: UserStats, opts: CardOptions, theme: CardTheme, background: ThemeBackground): string {
  const fontStack = cardFontStacks[opts.font];
  const G = layoutFor(theme.name);
  const palette = designPalette(theme);
  const heatLevels = [0.14, 0.32, 0.52, 0.74].map((t) => mixHex(background.panelColor, palette.heatAccent, t)).concat(palette.heatAccent) as [string, string, string, string, string];
  const { profile, stats } = data;
  const avatarDataUri = opts.avatarDataUri;
  const days = data.contributionDays;
  const total = stats.contributionsLastYear;
  const text = (x: number, y: number, size: number, fill: string, content: string, anchor = '', weight = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}${weight ? ` font-weight="${weight}"` : ''}>${content}</text>`;

  // 头图文案：姓名 / @登录名 / 简介 / 位置与加入年份（没有位置时单独的年份要带 since 才可读）
  const joinedYear = profile.joinedAt ? new Date(profile.joinedAt).getUTCFullYear() : 0;
  const heroMeta = [profile.location, joinedYear ? (profile.location ? `${joinedYear}` : `since ${joinedYear}`) : ''].filter(Boolean).join(' · ');
  const hero = [
    text(G.heroX, G.heroYs[0], 23, palette.heroName, escapeXml(truncate(profile.name || profile.login, 14)), '', '700'),
    text(G.heroX, G.heroYs[1], 14, palette.heroLogin, escapeXml(`@${truncate(profile.login, 20)}`)),
    profile.bio ? text(G.heroX, G.heroYs[2], 13, palette.heroBio, escapeXml(truncate(profile.bio, 22))) : '',
    heroMeta ? text(G.heroX, G.heroYs[3], 12, palette.heroMeta, escapeXml(truncate(heroMeta, 24))) : '',
  ].join('');

  // 贡献折线图（右上面板）：近 12 个月按周聚合，主题渐变描边 + 渐隐面积
  const weekValues = data.contributionWeeks.map((week) => week.contributions);
  const hasChart = weekValues.length > 1 && weekValues.some((value) => value > 0);
  let chart = '';
  if (hasChart) {
    const max = Math.max(...weekValues, 1);
    const points = weekValues.map((value, index) =>
      `${(G.chart.x0 + index / (weekValues.length - 1) * (G.chart.x1 - G.chart.x0)).toFixed(1)},${(G.chart.base - value / max * (G.chart.base - G.chart.top)).toFixed(1)}`);
    chart = `<polygon points="${G.chart.x0},${G.chart.base} ${points.join(' ')} ${G.chart.x1},${G.chart.base}" fill="url(#designArea)"/><polyline class="designPulse" points="${points.join(' ')}" fill="none" stroke="url(#designLine)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#designGlow)"/>`;
  }
  const chartAxis = designMonthLabels(data, 6).map((label, index, labels) => {
    const x = G.chart.x0 + index / (labels.length - 1) * (G.chart.x1 - G.chart.x0);
    const anchor = index === 0 ? '' : index === labels.length - 1 ? 'end' : 'middle';
    return text(Math.round(x), G.chart.axisY, 9.5, palette.axisTick, label, anchor);
  }).join('');

  // 统计面板：行数与标签由布局决定，行顺序固定，标签必须与底图行图标同义
  const statRows: Array<[string, string]> = G.statLabels.map((label, index) => [label, formatNumber(statMetric(label, stats, data))]);
  const statLayer = statRows.map(([label, value], index) => {
    const y = G.statRows[index];
    return text(G.statLabelX, y + 4, 13, palette.statLabel, label) + text(G.statValueX, y + 4, 15, palette.statValue, value, 'end', '700');
  }).join('');
  // 评级环：设计稿在统计面板右侧留了空圆环 + 下方空胶囊，分别画评级进度弧和 RATING 字样
  const ringFraction = Math.min(Math.max(stats.rating, 0), 100) / 100;
  const ringLength = 2 * Math.PI * G.ring.r;
  const ringLayer = `<circle cx="${G.ring.cx}" cy="${G.ring.cy}" r="${G.ring.r}" fill="none" stroke="url(#designArc)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(ringLength * ringFraction).toFixed(1)} ${ringLength.toFixed(1)}" transform="rotate(-90 ${G.ring.cx} ${G.ring.cy})" filter="url(#designGlow)"/>` +
    text(G.ring.cx, G.gradeY, 36, palette.grade, grade(stats.rating), 'middle', '700') +
    text(G.ring.cx, G.scoreY, 12.5, palette.score, `${stats.rating} / 100`, 'middle') +
    `<text x="${G.ring.cx - 3}" y="${G.ratingY}" text-anchor="middle" font-size="13" letter-spacing="4" fill="${palette.ratingWord}">RATING</text>`;

  // 语言占比：行数 × 两列，圆点着色为 GitHub 官方语言色
  const languageCount = G.langRows.length * G.langColumns.length;
  const languages = data.languages.slice(0, languageCount);
  const languageLayer = languages.map((language, index) => {
    const column = G.langColumns[index % G.langColumns.length];
    const y = G.langRows[Math.floor(index / G.langColumns.length)];
    return `<circle cx="${column.dotX}" cy="${y}" r="8" fill="${languageColor(language.name)}"/>` +
      text(column.nameX, y + 4.5, 13, palette.langName, escapeXml(truncate(language.name, 16))) +
      text(column.valueX, y + 4.5, 12, palette.langValue, `${language.percentage}%`, 'end');
  }).join('');

  // 三个小面板：面板图标决定两行主题，不可互换（星环=贡献、火焰=连击、双支线=拉取请求）
  // 星环面板标签较长，字号缩到 11.5、数值锚点右移，避免和多位数值碰撞
  const miniPanels: Array<{ labelX: number; valueX: number; labelSize?: number; rows: Array<[string, string]> }> = [
    { labelX: G.miniPanels[0].labelX, valueX: G.miniPanels[0].valueX, labelSize: G.miniPanels[0].labelSize, rows: [
      ['Contributions', formatNumber(stats.contributionsLastYear)], // 🪐 星环：近一年贡献总数（此面板第一行大数）
      ['Contributed', formatNumber(stats.contributedTo)],           // 🪐 星环：贡献过的仓库数
    ] },
    { labelX: G.miniPanels[1].labelX, valueX: G.miniPanels[1].valueX, rows: [
      ['Current', `${stats.currentStreak}d`],                       // 🔥 火焰：当前连击天数
      ['Longest', `${stats.longestStreak}d`],                       // 🔥 火焰：最长连击天数
    ] },
    { labelX: G.miniPanels[2].labelX, valueX: G.miniPanels[2].valueX, rows: [
      ['PRs', formatNumber(stats.pullRequests)],                    // ⫛ 双支线：近一年拉取请求
      ['Reviews', formatNumber(stats.reviews)],                     // ⫛ 双支线：近一年为他人 PR 的评审数
    ] },
  ];
  const miniLayer = miniPanels.map((panel) => panel.rows.map(([label, value], index) => {
    const y = G.miniRows[index];
    return text(panel.labelX, y + 4, panel.labelSize ?? 12, palette.miniLabel, label) + text(panel.valueX, y + 4, 15, palette.miniValue, value, 'end', '700');
  }).join('')).join('');

  // 贡献热力图：真实 53 周 × 7 天日历（列按周、行按星期对齐），左侧彩色圆点旁为亮点指标
  const maxDay = days.reduce((peak, day) => Math.max(peak, day.contributions), 0);
  const activeDays = days.filter((day) => day.contributions > 0).length;
  const perDay = days.length ? total / days.length : 0;
  const highlights = [
    `${compactNumber(total)} total`,
    `peak ${maxDay}`,
    `${activeDays} active`,
    `${perDay.toFixed(1)}/day`,
  ];
  const bulletLayer = G.heatBulletYs.map((y, index) => text(G.heatBulletX, y + 4, 11.5, palette.highlight, highlights[index] || '')).join('');
  let heatDots = '';
  if (days.length) {
    const lastWeekday = new Date(`${days[days.length - 1].date}T00:00:00Z`).getUTCDay();
    const weekDays = 7;
    const pitchX = (G.heat.x1 - G.heat.x0) / 52;
    const pitchY = (G.heat.y1 - G.heat.y0) / 6;
    const max = Math.max(maxDay, 1);
    days.forEach((day, index) => {
      // 最新一天落在网格末列的其真实星期上，向前逐格回推
      const cell = 364 + lastWeekday - (days.length - 1 - index);
      if (cell < 0) return;
      const value = day.contributions;
      const ratio = value / max;
      const level = value === 0 ? 0 : ratio < 0.3 ? 1 : ratio < 0.55 ? 2 : ratio < 0.8 ? 3 : 4;
      heatDots += `<circle cx="${(G.heat.x0 + Math.floor(cell / weekDays) * pitchX).toFixed(1)}" cy="${(G.heat.y0 + (cell % weekDays) * pitchY).toFixed(1)}" r="${G.heat.radius}" fill="${heatLevels[level]}"/>`;
    });
  }
  // 热力图月份刻度：取窗口内真实月初，过密时跳过
  const heatTicks: Array<{ label: string; x: number }> = [];
  if (days.length) {
    const lastWeekday = new Date(`${days[days.length - 1].date}T00:00:00Z`).getUTCDay();
    const pitchX = (G.heat.x1 - G.heat.x0) / 52;
    let lastColumn = -99;
    days.forEach((day, index) => {
      const cell = 364 + lastWeekday - (days.length - 1 - index);
      if (cell < 0) return;
      const date = new Date(`${day.date}T00:00:00Z`);
      const column = Math.floor(cell / 7);
      if (date.getUTCDate() === 1 && column - lastColumn >= 3) {
        heatTicks.push({ label: monthAbbreviations[date.getUTCMonth()], x: G.heat.x0 + column * pitchX });
        lastColumn = column;
      }
    });
  }
  const heatTickLabels = (heatTicks.length >= 2 ? heatTicks : designMonthLabels(data, 6).map((label, index) => ({ label, x: G.heat.x0 + Math.round(index / 5 * 52) * (G.heat.x1 - G.heat.x0) / 52 })))
    .map((tick, index, ticks) => {
      const anchor = index === 0 ? '' : index === ticks.length - 1 ? 'end' : 'middle';
      return text(Math.round(tick.x), G.heatTickY, 9.5, palette.heatTick, tick.label, anchor);
    }).join('');

  // 头像：服务端拉取失败时缺省，装饰环退回纯装饰（设计稿原貌）
  const avatarLayer = avatarDataUri
    ? `<clipPath id="neonAvatarClip"><circle cx="${G.avatar.cx}" cy="${G.avatar.cy}" r="${G.avatar.r}"/></clipPath>` +
      `<image xlink:href="${avatarDataUri}" x="${G.avatar.cx - G.avatar.r}" y="${G.avatar.cy - G.avatar.r}" width="${G.avatar.r * 2}" height="${G.avatar.r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#neonAvatarClip)"/>`
    : '';

  // 座右铭：卡片最上方艺术区居中斜体；引号在渲染层包上，长度超限在这里兜底截断
  const mottoLayer = opts.motto
    ? `<text x="${G.motto.x}" y="${G.motto.y}" text-anchor="middle" font-size="16" font-style="italic" letter-spacing="1.5" fill="${palette.motto}">${escapeXml(`“${truncate(opts.motto.trim(), 40)}”`)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TPL_WIDTH}" height="${TPL_HEIGHT}" viewBox="0 0 ${TPL_WIDTH} ${TPL_HEIGHT}" role="img" aria-labelledby="cardTitle cardDesc">
  <title id="cardTitle">${escapeXml(profile.name || profile.login)} GitHub stats</title>
  <desc id="cardDesc">GitHub contribution and language statistics for ${escapeXml(profile.login)}</desc>
  <defs>
    <linearGradient id="designLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${palette.chartLine[0]}"/><stop offset=".5" stop-color="${palette.chartLine[1]}"/><stop offset="1" stop-color="${palette.chartLine[2]}"/></linearGradient>
    <linearGradient id="designArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.chartArea}" stop-opacity=".38"/><stop offset="1" stop-color="${palette.chartArea}" stop-opacity="0"/></linearGradient>
    <linearGradient id="designArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.ringArc[0]}"/><stop offset="1" stop-color="${palette.ringArc[1]}"/></linearGradient>
    <filter id="designGlow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>
      text { font-family: ${fontStack}; }
      .designPulse { animation: designPulse 3.2s ease-in-out infinite; }
      @keyframes designPulse { 0%, 100% { opacity: .78; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .designPulse { animation: none; opacity: 1; } }
    </style>
  </defs>
  <image xlink:href="${background.dataUri}" x="0" y="0" width="${TPL_WIDTH}" height="${TPL_HEIGHT}"/>
  ${avatarLayer}
  ${mottoLayer}
  ${hero}
  ${text(G.chart.headerLabelX, G.chart.headerLabelY, 12, palette.headerLabel, 'CONTRIBUTIONS', '', '700')}
  ${text(G.chart.headerTotalX, G.chart.headerLabelY, 12, palette.headerTotal, `${formatNumber(total)} contributions · past year`, 'end')}
  ${chart}
  ${chartAxis}
  ${statLayer}
  ${ringLayer}
  ${languageLayer}
  ${miniLayer}
  ${bulletLayer}
  ${heatDots}
  ${heatTickLabels}
</svg>`;
}

// 统计行标签 → 指标值：标签顺序与底图行图标语义绑定（改标签前先对照设计稿图标）
function statMetric(label: string, stats: UserStats['stats'], data: UserStats): number {
  switch (label) {
    case 'Total Stars': return stats.stars;
    case 'Contributions · 1yr': return stats.contributionsLastYear;
    case 'Public Repositories': return stats.publicRepositories;
    case 'Pull Requests · 1yr': return stats.pullRequests;
    case 'Issues · 1yr': return stats.issues;
    case 'Followers': return stats.followers;
    default: return data.stats.contributionsLastYear;
  }
}

// 统计卡片入口：所有主题都使用「设计稿底图 + 数据叠层」渲染器（底图见 src/theme-bgs.ts）；
// 万一某主题缺底图，退回经典自绘样式保证出卡不中断
export function renderStatsCard(data: UserStats, themeName?: unknown, options: Partial<CardOptions> = {}): string {
  const opts: CardOptions = { ...defaultCardOptions, ...options };
  const theme = getTheme(themeName);
  const background = themeBackgrounds[theme.name];
  if (background) return renderDesignCard(data, opts, theme, background);
  return renderClassicCard(data, opts, theme);
}

// 经典自绘风格的统计卡片（无设计稿底图时的兜底），版面自上而下：
//   顶部        → 姓名 + @登录名（居中标题）
//   左列四行    → 年度贡献 / 公开仓库 / 加入时间 / 联系方式（带辉光图标）
//   右上        → 近 12 个月按周贡献折线 + 月份轴
//   中部两面板  → GitHub Stats（Star/贡献/PR/Issue/Contributed 五行 + 评级环）｜Most Used Languages（占比条 + 两列明细）
//   底部三面板  → Total Contributions ｜ Current Streak（含最长连击）｜Repositories Contributed
//   最底        → 近 31 天逐日贡献折线面板
function renderClassicCard(data: UserStats, opts: CardOptions, theme: CardTheme): string {
  const fontStack = cardFontStacks[opts.font];
  const { profile, stats } = data;
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

