// 本地预览脚本：用逼真的离线假数据渲染霓虹星空卡片（node scripts/render-fixture.js）
// 输出 data/.preview/neon-card.png（正常数据）与 neon-card-bare.png（极端数据：空语言/无贡献/超长字段）
const sharp = require(process.cwd() + '/node_modules/sharp');
const fs = require('fs');
const path = require('path');

// tsx 现场转译 card.ts 与其依赖
require('tsx/cjs');
const { renderStatsCard } = require(path.join(process.cwd(), 'src', 'card.ts'));

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
  const svg = renderStatsCard(makeFixture(), 'neon-starlight', { font: 'sans', motto: '仰望星空，脚踏实地' });
  fs.writeFileSync(path.join(PREVIEW_DIR, 'neon-card.svg'), svg);
  await sharp(Buffer.from(svg), { density: 72 }).png().toFile(path.join(PREVIEW_DIR, 'neon-card.png'));
  console.log('svg size:', (fs.statSync(path.join(PREVIEW_DIR, 'neon-card.svg')).size / 1024).toFixed(0) + 'KB');

  // 极端数据：无语言/无贡献/超长字段/满分评级，确认不越界不破版
  const bare = makeFixture();
  bare.profile = { ...bare.profile, login: 'a-very-long-github-login-name', name: 'Christopher Alexander Maximilian', bio: null, location: null, joinedAt: '' };
  bare.languages = [];
  bare.contributionDays = [];
  bare.contributionWeeks = [];
  bare.stats = { ...bare.stats, stars: 1234567, followers: 999999, rating: 100, currentStreak: 0, longestStreak: 0 };
  const svg2 = renderStatsCard(bare, 'neon-starlight', {});
  await sharp(Buffer.from(svg2), { density: 72 }).png().toFile(path.join(PREVIEW_DIR, 'neon-card-bare.png'));
  console.log('bare card done');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
