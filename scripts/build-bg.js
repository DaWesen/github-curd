// 一次性预处理脚本：把 images/ 下各主题设计稿处理成卡片底图，生成 src/theme-bgs.ts
// 所有设计稿槽位坐标来自 src/card-layouts.ts（通用模板 + 逐主题覆盖，1024×1536 空间）：
// 1) 统一 resize 到 1024×1536（源图尺寸略有出入时归一化）
// 2) 按各主题布局生成擦除条，中值滤波+模糊擦除占位元素（虚线 / "--" / 语言圆点 / 热力图占位网格 / 刻度），
//    运行时渲染器只做数据叠绘、不再需要同色遮罩；底栏保持设计稿原样（装饰图标 / 主题标志），不擦除
// 3) 在若干安全点采样面板底色（中位数），供热力图分级色派生使用
// 4) 压缩为 JPEG q90 并生成 src/theme-bgs.ts（base64 data URI，随卡片内嵌保证自包含）
// 用法：node scripts/build-bg.js   （换底图后必须核对 src/card-layouts.ts 里的槽位坐标）
const sharp = require(process.cwd() + '/node_modules/sharp');
const fs = require('fs');
const path = require('path');
require('tsx/cjs');
const { layoutFor } = require(path.join(__dirname, '..', 'src', 'card-layouts.ts'));

// 主题名 → 设计稿文件名
const THEME_SOURCES = {
  'dreamy-galaxy': '梦幻星河.png',
  'neon-cyber': '霓虹赛博.png',
  'neon-starlight': '霓虹星空.png',
  'aurora-nebula': '星云极光.png',
  'summer-lemon': '夏日柠檬.png',
  'sakura-story': '樱花物语.png',
  'deep-sea-blue': '深海幽蓝.png',
  'amber-sun': '琥珀暖阳.png',
  'emerald-forest': '翡翠森林.png',
  'midnight-count': '暗夜伯爵.png',
  'minimal-white': '极简纯白.png',
  'polar-starlight': '极地星光.png',
  'blue-archive': '蔚蓝档案.png',
};

const CARD_WIDTH = 1024;
const CARD_HEIGHT = 1536;

// 各类擦除条：全部从布局坐标推导，随逐主题覆盖自动对位
function heroStrips(L) {
  return L.heroYs.map((y) => ({ left: L.heroX - 42, top: y - 25, width: 236, height: 40 }));
}
function statRowStrips(L) {
  return L.statRows.map((y) => ({ left: L.statLabelX - 8, top: y - 20, width: L.statValueX - L.statLabelX + 26, height: 40 }));
}
function langRowStrips(L) {
  // 极地星光等设计稿的占位圆点较大（半径可达 17px），左右各留 36px、上下留 22px 才盖得住
  return L.langRows.flatMap((y) => L.langColumns.map((c) => ({
    left: c.dotX - 36, top: y - 22, width: c.valueX - c.dotX + 54, height: 44,
  })));
}
function miniRowStrips(L) {
  return L.miniRows.flatMap((y) => L.miniPanels.map((p) => ({
    left: p.labelX - 14, top: y - 20, width: p.valueX - p.labelX + 28, height: 40,
  })));
}
function bulletStrips(L) {
  // 从圆点右侧开始擦（设计稿的彩色圆点保留完整，运行时文字画在点右边）
  return L.heatBulletYs.map((y) => ({ left: L.heatBulletX - 2, top: y - 20, width: 106, height: 40 }));
}
function chartTickStrip(L) {
  return { left: L.chart.x0 - 16, top: L.chart.axisY - 17, width: L.chart.x1 - L.chart.x0 + 32, height: 27 };
}
function heatTickStrip(L) {
  return { left: 150, top: L.heatTickY - 23, width: 800, height: 36 };
}
// 热力图装饰网格区：直接用本地中位色实心覆盖，运行时重画真实日历（区域由布局显式给出）
function heatGridCover(L) {
  return L.heatCover;
}

// 面板底色采样点：避开图标、虚线、网格与评级环的空旷处（通用模板与各覆盖版式都落在面板内）
const PANEL_SAMPLE_POINTS = [
  [600, 480], [700, 350],   // 折线图面板中部
  [180, 737], [180, 782],   // 统计面板行间隙
  [300, 640],               // 统计面板顶部（评级环左侧）
  [560, 992],               // 火焰小面板首行上方
  [700, 1192],              // 热力图面板，图例与网格之间
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

(async () => {
  const entries = [];
  for (const [theme, file] of Object.entries(THEME_SOURCES)) {
    const L = layoutFor(theme);
    const src = path.join(__dirname, '..', 'images', file);
    // 1) 规范到模板尺寸
    const base = await sharp(src).resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'fill' }).toBuffer();

    // 2) 采样面板底色（逐通道取中位数）——面板内擦除与热力图覆盖都要用它
    const samples = await Promise.all(PANEL_SAMPLE_POINTS.map(async ([x, y]) => {
      const { data } = await sharp(base).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    }));
    const panelColor = toHex(...[0, 1, 2].map((ch) => median(samples.map((s) => s[ch]))));

    // 3) 擦除占位元素：面板底是平色/缓渐变，每条擦除区先在区内采集中位色（虚线/圆点占比小，
    //    中位数即本地底色）再实心填充——无鬼影且自适应渐变；只有头图虚线坐在星空渐变上，
    //    必须用中值滤波+模糊做内容感知擦除
    async function stripMedianColor(strip) {
      const { data, info } = await sharp(base).extract(strip).raw().toBuffer({ resolveWithObject: true });
      const picked = [];
      for (let offset = 0; offset + info.channels <= data.length; offset += info.channels * 7) {
        picked.push([data[offset], data[offset + 1], data[offset + 2]]);
      }
      return toHex(...[0, 1, 2].map((ch) => median(picked.map((p) => p[ch]))));
    }
    const solidStrips = [
      ...statRowStrips(L),
      ...langRowStrips(L),
      ...miniRowStrips(L),
      ...bulletStrips(L),
      L.capsule,
      chartTickStrip(L),
      heatTickStrip(L),
    ];
    const patches = await Promise.all(solidStrips.map(async (strip) => ({
      input: await sharp({ create: { width: strip.width, height: strip.height, channels: 3, background: await stripMedianColor(strip) } }).png().toBuffer(),
      ...strip,
    })));
    patches.push(...(await Promise.all(heroStrips(L).map(async (strip) => ({
      input: await sharp(base).extract(strip).median(15).blur(6).toBuffer(),
      ...strip,
    })))));

    // 热力图占位网格：实心覆盖（区域内取中位色，占位圆点占比小不影响中位数）
    const grid = heatGridCover(L);
    patches.push({
      input: await sharp({ create: { width: grid.width, height: grid.height, channels: 3, background: await stripMedianColor(grid) } }).png().toBuffer(),
      ...grid,
    });

    // 4) 压缩内嵌
    const jpeg = await sharp(base).composite(patches).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    entries.push({ theme, panelColor, base64: jpeg.toString('base64'), kb: jpeg.length / 1024 });
    console.log(theme.padEnd(16), file.padEnd(12), 'panel', panelColor, `${entries.at(-1).kb.toFixed(0)}KB jpeg`);
  }

  const body = entries.map(({ theme, panelColor, base64 }) => `  '${theme}': { panelColor: '${panelColor}', dataUri: 'data:image/jpeg;base64,${base64}' },`).join('\n');
  const ts = `// 由 scripts/build-bg.js 从 images/ 各主题设计稿自动生成，请勿手改。
// 全部主题共用的设计稿底图（已统一到 1024×1536 并按 src/card-layouts.ts 擦除占位元素），
// 内嵌进 SVG 保证卡片自包含。panelColor 为设计稿面板底色采样值（热力图分级色由它派生）。
import type { ThemeName } from './types';

export interface ThemeBackground {
  dataUri: string;
  panelColor: string;
}

export const themeBackgrounds: Record<ThemeName, ThemeBackground> = {
${body}
};
`;
  const out = path.join(__dirname, '..', 'src', 'theme-bgs.ts');
  fs.writeFileSync(out, ts);
  console.log('written:', out, (ts.length / 1024).toFixed(0) + 'KB');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
