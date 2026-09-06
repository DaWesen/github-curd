// 本地预览脚本：用逼真的离线假数据渲染全部主题卡片（node scripts/render-fixture.js）
// 输出 data/.preview/<主题>.png 与 data/.preview/all-themes.png（拼接总览），
// 另有 neon-card-bare.png（极端数据：空语言/无贡献/超长字段）验证不破版
const sharp = require(process.cwd() + '/node_modules/sharp');
const fs = require('fs');
const path = require('path');

// tsx 现场转译 card.ts 与其依赖
require('tsx/cjs');
const { renderStatsCard } = require(path.join(process.cwd(), 'src', 'card.ts'));
const { themes } = require(path.join(process.cwd(), 'src', 'themes.ts'));

const PREVIEW_DIR = path.join(__dirname, '..', 'data', '.preview');

function makeFixture() {
  const today = new Date();
  const days = Array.from({ length: 365 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (364 - i)));
    const wave = Math.sin(i / 9) * 2 + Math.sin(i / 28) * 3;
    const spike = i % 37 === 0 ? 14 : 0;
    const c = Math.max(0, Math.round(wave + spike + (i % 7 === 0 ? -2 : 1)));
    return { date: d.toISOString().slice(0, 10), contributions: c };
  });
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const slice = days.slice(w * 7, w * 7 + 7);
    if (!slice.length) break;
    weeks.push({ label: slice[0].date.slice(5), contributions: slice.reduce((s, d) => s + d.contributions, 0) });
  }
  return {
    profile: {
      login: 'misono-mika',
      name: 'misono mika',
      avatarUrl: '',
      htmlUrl: 'https://github.com/misono-mika',
      bio: 'Building neon dreams after midnight',
      email: null,
      location: 'Neo Shanghai',
      company: null,
      website: 'misono.dev',
      joinedAt: '2019-03-02T00:00:00Z',
    },
    stats: {
      publicRepositories: 42, followers: 1284, following: 356, stars: 3204, forks: 512,
      pullRequests: 96, reviews: 18, issues: 41, contributedTo: 23, rating: 68, starsGiven: 210,
      contributionsLastYear: days.reduce((s, d) => s + d.contributions, 0),
      contributionFrequency: 3, currentStreak: 12, longestStreak: 87,
    },
    repositories: [],
    languages: [
      { name: 'TypeScript', percentage: 38 }, { name: 'Python', percentage: 21 },
      { name: 'Rust', percentage: 14 }, { name: 'Go', percentage: 9 },
      { name: 'Vue', percentage: 7 }, { name: 'CSS', percentage: 5 },
      { name: 'Shell', percentage: 4 }, { name: 'Lua', percentage: 2 },
    ],
    contributionWeeks: weeks,
    contributionDays: days,
  };
}

(async () => {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const names = Object.keys(themes);
  const thumbs = [];
  for (const name of names) {
    const svg = renderStatsCard(makeFixture(), name, { font: 'sans', motto: '仰望星空，脚踏实地' });
    fs.writeFileSync(path.join(PREVIEW_DIR, `${name}.svg`), svg);
    const png = await sharp(Buffer.from(svg), { density: 72 }).resize({ width: 500 }).png().toBuffer();
    await sharp(png).toFile(path.join(PREVIEW_DIR, `${name}.png`));
    thumbs.push(png);
    console.log('rendered:', name);
  }

  // 拼接总览：3 列 × 4 行
  const thumbWidth = 500;
  const thumbHeight = 750;
  const columns = 3;
  const rows = Math.ceil(thumbs.length / columns);
  const gap = 12;
  const composites = thumbs.map((input, index) => ({
    input,
    left: (index % columns) * (thumbWidth + gap),
    top: Math.floor(index / columns) * (thumbHeight + gap),
  }));
  await sharp({
    create: {
      width: columns * thumbWidth + (columns - 1) * gap,
      height: rows * thumbHeight + (rows - 1) * gap,
      channels: 3,
      background: '#202028',
    },
  }).composite(composites).png().toFile(path.join(PREVIEW_DIR, 'all-themes.png'));
  console.log('contact sheet: data/.preview/all-themes.png');

  // 极端数据：无语言/无贡献/超长字段/满分评级，确认不越界不破版
  const bare = makeFixture();
  bare.profile = { ...bare.profile, login: 'a-very-long-github-login-name', name: 'Christopher Alexander Maximilian', bio: null, location: null, joinedAt: '' };
  bare.languages = [];
  bare.contributionDays = [];
  bare.contributionWeeks = [];
  bare.stats = { ...bare.stats, stars: 1234567, followers: 999999, rating: 100, currentStreak: 0, longestStreak: 0 };
  for (const name of ['neon-starlight', 'minimal-white', 'amber-sun']) {
    const svg2 = renderStatsCard(bare, name, {});
    await sharp(Buffer.from(svg2), { density: 72 }).resize({ width: 500 }).png().toFile(path.join(PREVIEW_DIR, `${name}-bare.png`));
  }
  console.log('bare cards done');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
