// 一次性预处理脚本：把根目录 霓虹星空.png 处理成卡片底图
// 1) 头像右侧 4 条占位虚线位于星空渐变上，用中值滤波+模糊擦除（纯色矩形会破坏星空渐变）
// 2) 压缩为 JPEG q90 并生成 src/neon-starlight-bg.ts（base64 data URI，随卡片内嵌保证自包含）
// 3) 输出擦除区域预览到 data/.preview/ 供人工检查
// 用法：node scripts/build-bg.js   （换底图后必须同步重新测量 src/card.ts 里的 NEON_* 叠层坐标）
const sharp = require(process.cwd() + '/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '霓虹星空.png');
const OUT_TS = path.join(__dirname, '..', 'src', 'neon-starlight-bg.ts');
const PREVIEW_DIR = path.join(__dirname, '..', 'data', '.preview');

// 头像右侧 4 条占位虚线（含上下留白）
const HERO_DASH_STRIPS = [
  { left: 362, top: 252, width: 200, height: 22 },
  { left: 362, top: 296, width: 200, height: 22 },
  { left: 362, top: 340, width: 200, height: 22 },
  { left: 362, top: 382, width: 200, height: 22 },
];

(async () => {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  // 中值滤波擦除细虚线，再轻微模糊让补丁与周围星空过渡自然
  const patches = await Promise.all(HERO_DASH_STRIPS.map(async (strip) => ({
    input: await sharp(SRC).extract(strip).median(15).blur(6).toBuffer(),
    ...strip,
  })));

  const jpeg = await sharp(SRC)
    .composite(patches)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  const base64 = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const ts = `// 由 scripts/build-bg.js 从根目录 霓虹星空.png 自动生成，请勿手改。
// 霓虹星空主题的卡片底图（已擦除设计稿占位虚线），内嵌进 SVG 保证卡片自包含。
export const neonStarlightBackground: string = '${base64}';
`;
  fs.writeFileSync(OUT_TS, ts);
  console.log('bg written:', (jpeg.length / 1024).toFixed(0) + 'KB jpeg,', (ts.length / 1024).toFixed(0) + 'KB ts');

  // 输出擦除区域的预览供人工检查
  await sharp(jpeg).extract({ left: 300, top: 200, width: 400, height: 250 }).resize({ width: 800, kernel: 'nearest' }).png()
    .toFile(path.join(PREVIEW_DIR, 'bg-hero-cleaned.png'));
  console.log('preview: data/.preview/bg-hero-cleaned.png');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
