// 本地预览脚本：抓取真实 GitHub 用户数据并渲染霓虹星空卡片（node scripts/render-user.js <用户名>）
// 数据落在 data/<用户名>.json（已 gitignore），已存在则直接复用；输出 data/.preview/ 下的 PNG/SVG
// 示例：node scripts/render-user.js DaWesen
const sharp = require(process.cwd() + '/node_modules/sharp');
const fs = require('fs');
const path = require('path');
require('dotenv/config');
require('tsx/cjs');

const { crawlUser, toUserStats } = require(path.join(process.cwd(), 'src', 'crawler', 'crawler.ts'));
const { renderStatsCard } = require(path.join(process.cwd(), 'src', 'card.ts'));
const { fetchAvatarDataUri } = require(path.join(process.cwd(), 'src', 'avatar.ts'));

const PREVIEW_DIR = path.join(__dirname, '..', 'data', '.preview');
const username = process.argv[2] || 'DaWesen';

(async () => {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const jsonPath = path.join(process.cwd(), 'data', `${username}.json`);
  let detail;
  if (fs.existsSync(jsonPath)) {
    console.log('using cached:', jsonPath);
    detail = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else {
    // 与 pnpm crawler 相同的数据引擎：无 Token 走 REST+HTML，GITHUB_TOKEN 走 GraphQL
    const { GithubHttpClient } = require(path.join(process.cwd(), 'src', 'crawler', 'http.ts'));
    const client = new GithubHttpClient({
      token: process.env.GITHUB_TOKEN || undefined,
      apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
      cachePath: path.join(process.cwd(), 'data', '.cache', 'etags.json'),
    });
    detail = await crawlUser(username, { client, reposScanLimit: 100, includeEvents: false, includeMisc: false, deepLanguages: true, deepLanguagesCoverage: 0.9 });
    fs.writeFileSync(jsonPath, JSON.stringify(detail, null, 2));
    console.log('crawled fresh data');
  }

  const stats = toUserStats(detail);
  const avatarDataUri = await fetchAvatarDataUri(stats.profile.avatarUrl);
  console.log('avatar fetched:', avatarDataUri ? avatarDataUri.slice(0, 40) + '...' : '(failed, decorative ring)');
  const svg = renderStatsCard(stats, 'neon-starlight', { font: 'sans', avatarDataUri, motto: '仰望星空，脚踏实地' });
  fs.writeFileSync(path.join(process.cwd(), 'card-preview-neon-starlight.svg'), svg);
  await sharp(Buffer.from(svg), { density: 72 }).png().toFile(path.join(process.cwd(), 'card-preview-neon-starlight.png'));
  console.log('rendered:', (svg.length / 1024).toFixed(0) + 'KB svg →', 'card-preview-neon-starlight.png');
  console.log('hero:', stats.profile.name || stats.profile.login, '| contributions:', stats.stats.contributionsLastYear, '| languages:', stats.languages.length);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
