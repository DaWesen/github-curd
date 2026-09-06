import type { ThemeName } from './types';

// 设计稿槽位布局：全部主题共用同一模板（对 霓虹星空.png 逐像素实测）；
// 个别设计稿版式不同（如极地星光 6 行统计/6 行语言），在 geometryOverrides 里按主题覆盖。
// 坐标均为 1024×1536 卡片空间的实测值；更换底图后必须重新核对。
export interface CardLayout {
  motto: { x: number; y: number };
  avatar: { cx: number; cy: number; r: number };
  heroX: number;
  heroYs: [number, number, number, number];
  chart: {
    x0: number; x1: number; top: number; base: number; axisY: number;
    headerLabelX: number; headerLabelY: number; headerTotalX: number;
  };
  statRows: number[];
  statLabels: string[];
  statLabelX: number;
  statValueX: number;
  ring: { cx: number; cy: number; r: number };
  gradeY: number;
  scoreY: number;
  ratingY: number;
  capsule: { left: number; top: number; width: number; height: number };
  langRows: number[];
  langColumns: Array<{ dotX: number; nameX: number; valueX: number }>;
  miniRows: number[];
  miniPanels: Array<{ labelX: number; valueX: number; labelSize?: number }>;
  heat: { x0: number; x1: number; y0: number; y1: number; radius: number };
  /** 设计稿装饰网格的实心覆盖区（构造期由 build-bg 使用，运行时不用） */
  heatCover: { left: number; top: number; width: number; height: number };
  heatBulletX: number;
  heatBulletYs: number[];
  heatTickY: number;
}

// 通用模板（与 5 行统计 / 4 行语言的设计稿配套）
export const templateLayout: CardLayout = {
  motto: { x: 512, y: 66 },
  avatar: { cx: 200, cy: 265, r: 110 },
  heroX: 372,
  heroYs: [270, 313, 356, 398],
  chart: { x0: 556, x1: 961, top: 405, base: 567, axisY: 588, headerLabelX: 598, headerLabelY: 360, headerTotalX: 961 },
  statRows: [714, 759, 802, 845, 889],
  statLabels: ['Total Stars', 'Contributions · 1yr', 'Pull Requests · 1yr', 'Issues · 1yr', 'Followers'],
  statLabelX: 106,
  statValueX: 298,
  ring: { cx: 400, cy: 760, r: 62 },
  gradeY: 772,
  scoreY: 794,
  ratingY: 880,
  capsule: { left: 340, top: 860, width: 96, height: 34 },
  langRows: [716, 766, 816, 866],
  langColumns: [
    { dotX: 552, nameX: 570, valueX: 712 },
    { dotX: 780, nameX: 798, valueX: 956 },
  ],
  miniRows: [1023, 1068],
  miniPanels: [
    { labelX: 214, valueX: 318, labelSize: 11.5 },
    { labelX: 522, valueX: 627 },
    { labelX: 827, valueX: 955 },
  ],
  heat: { x0: 189, x1: 946, y0: 1220, y1: 1338, radius: 5 },
  heatCover: { left: 170, top: 1196, width: 792, height: 162 },
  heatBulletX: 86,
  heatBulletYs: [1220, 1255, 1289, 1323],
  heatTickY: 1381,
};

// 逐主题版式覆盖。极地星光为 6 行统计（星星/圆环/齿轮=仓库/双支线/圆靶=Issue/人形）+ 6 行语言（12 项），
// 面板整体比模板高一个层级，评级环、胶囊、折线图、小面板坐标全部按新图实测。
// avatar 各主题单独覆盖：设计稿装饰环位置/大小各异（圆心 ±10px、半径 112~127），值来自
// 候选圆叠加审计的逐主题读取，目标是头像撑满头像框
const layoutOverrides: Partial<Record<ThemeName, Partial<CardLayout>>> = {
  'dreamy-galaxy': { avatar: { cx: 198, cy: 260, r: 118 } },
  'neon-cyber': { avatar: { cx: 199, cy: 259, r: 123 } },
  'neon-starlight': { avatar: { cx: 200, cy: 261, r: 117 } },
  'aurora-nebula': { avatar: { cx: 199, cy: 260, r: 120 } },
  'summer-lemon': { avatar: { cx: 202, cy: 265, r: 118 } },
  'sakura-story': { avatar: { cx: 202, cy: 265, r: 120 } },
  'deep-sea-blue': { avatar: { cx: 202, cy: 264, r: 121 } },
  'amber-sun': { avatar: { cx: 202, cy: 263, r: 121 } },
  'emerald-forest': { avatar: { cx: 197, cy: 262, r: 123 } },
  'midnight-count': { avatar: { cx: 202, cy: 262, r: 119 } },
  'minimal-white': { avatar: { cx: 195, cy: 258, r: 121 } },
  'polar-starlight': {
      // 头像撑满头像框：设计稿的环极不规则（环线距圆心 115~141，下方被地面雾光融接），
      // 圆心/半径按 8 向亮度剖面取值，让头像边缘四面都贴住环线
      avatar: { cx: 196, cy: 270, r: 119 },
    heroYs: [241, 291, 336, 384],
    chart: { x0: 560, x1: 950, top: 262, base: 482, axisY: 506, headerLabelX: 592, headerLabelY: 252, headerTotalX: 950 },
    statRows: [608, 651, 694, 738, 781, 824],
    statLabels: ['Total Stars', 'Contributions · 1yr', 'Public Repositories', 'Pull Requests · 1yr', 'Issues · 1yr', 'Followers'],
    statValueX: 272,
    ring: { cx: 385, cy: 674, r: 72 },
    gradeY: 686,
    scoreY: 708,
    ratingY: 807,
    capsule: { left: 317, top: 780, width: 130, height: 42 },
    langRows: [629, 672, 714, 756, 798, 840],
    langColumns: [
      { dotX: 549, nameX: 567, valueX: 700 },
      { dotX: 763, nameX: 781, valueX: 937 },
    ],
    miniRows: [949, 988],
    miniPanels: [
      { labelX: 214, valueX: 312, labelSize: 11.5 },
      { labelX: 524, valueX: 628 },
      { labelX: 829, valueX: 950 },
    ],
    // 设计稿的热力图装饰网格是 20 列 × 5 行大圆点（y≈1118-1317），装不下真实的 53×7 日历：
    // 整片盖掉后，真实网格在面板内上移重排，月份刻度也对位到设计稿的刻度虚线处
    heat: { x0: 189, x1: 946, y0: 1152, y1: 1294, radius: 6 },
    heatCover: { left: 170, top: 1115, width: 800, height: 205 },
    heatTickY: 1366,
  },
};

export function layoutFor(name: ThemeName): CardLayout {
  return { ...templateLayout, ...layoutOverrides[name] };
}
