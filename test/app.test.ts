import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { createApp, resolveGithubError } from '../src/app';
import { summarizeContributions } from '../src/metrics';
import { toUserStats, shouldContinueLanguageScan } from '../src/crawler/crawler';
import { RateLimitError, UserNotFoundError } from '../src/crawler/http';
import { contributionAxisLabels, renderStatsCard } from '../src/card';
import { parseContributionsPage, parseHumanNumber } from '../src/crawler/parse';
import type { UserStats } from '../src/types';
import type { DetailedStats } from '../src/crawler/types';

const config = {
  port: 3000,
  githubToken: '',
  githubApiUrl: 'https://api.github.com',
  defaultUsername: '',
};

// 所有测试共享一个隔离的临时缓存目录，避免测试数据写进真实的 data/.cache
const testCacheDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stats-app-test-'));
test.after(() => fs.rmSync(testCacheDir, { recursive: true, force: true }));

function makeApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({ config, cacheDir: testCacheDir, ...overrides });
}

// -------------------------------------------------------------- 测试替身 ---

function makeStats(overrides: Partial<UserStats> = {}): UserStats {
  return {
    profile: {
      login: 'DaWesen',
      name: 'DaWesen',
      avatarUrl: 'avatar',
      htmlUrl: 'profile',
      bio: 'Build & share',
      email: null,
      location: 'Earth',
      company: null,
      website: null,
      joinedAt: '2020-01-01T00:00:00Z',
    },
    stats: {
      publicRepositories: 4,
      followers: 8,
      following: 2,
      stars: 3,
      forks: 1,
      starsGiven: 12,
      pullRequests: 7,
      reviews: 2,
      issues: 3,
      contributedTo: 5,
      rating: 42,
      contributionsLastYear: 120,
      contributionFrequency: 2,
      currentStreak: 3,
      longestStreak: 10,
    },
    repositories: [{ name: 'profile-card', description: 'Build & share', url: 'repo', language: 'TypeScript', stars: 3, forks: 1 }],
    languages: [{ name: 'TypeScript', percentage: 67 }, { name: 'CSS', percentage: 33 }],
    contributionWeeks: [{ label: '01-01', contributions: 4 }, { label: '02-01', contributions: 6 }],
    contributionDays: [{ date: '2026-01-01', contributions: 4 }, { date: '2026-02-01', contributions: 6 }],
    ...overrides,
  };
}

async function withServer(app: ReturnType<typeof createApp>, callback: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    await callback(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ------------------------------------------------------------------ 用例 ---

test('health endpoint reports service status', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

test('root path redirect follows DEFAULT_USERNAME configuration', async () => {
  // 未配置默认用户名：落到中性的主题列表
  await withServer(makeApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/api/themes');
  });
  // 配置了默认用户名：直接展示该用户的卡片
  await withServer(makeApp({ config: { ...config, defaultUsername: 'someone' } }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/api/card/someone?theme=neon-cyber');
  });
});

test('stats endpoint validates usernames before fetching', async () => {
  let called = false;
  const fetchStats = async () => {
    called = true;
    return makeStats();
  };
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/stats/not valid`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid GitHub username' });
    assert.equal(called, false);
  });
});

test('stats endpoint returns the card data as JSON', async () => {
  const fixture = makeStats();
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => fixture }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/stats/DaWesen`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), fixture);
  });
});

test('stats endpoint maps a missing GitHub user to 404', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => { throw new UserNotFoundError('ghost'); } }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/stats/ghost`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'GitHub user not found' });
  });
});

test('serves last-good stats from disk when fetching fails', async () => {
  const good = makeStats();
  try {
    // 第一个实例正常抓取，把 last-good 落盘
    await withServer(makeApp({ fetchStats: async () => good }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/stats/DaWesen`);
      assert.equal(response.status, 200);
    });
    // 第二个实例抓取必然失败（限流），应回退到磁盘上的 last-good
    await withServer(makeApp({ fetchStats: async () => { throw new RateLimitError('额度用尽', null); } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/stats/DaWesen`);
      assert.equal(response.status, 200, 'last-good fallback should keep the card alive');
      assert.deepEqual(await response.json(), good);
    });
    // 没有任何 last-good 的用户仍然正常报 404/429
    await withServer(makeApp({ fetchStats: async () => { throw new RateLimitError('额度用尽', null); } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/stats/nobody`);
      assert.equal(response.status, 429);
    });
  } finally {
    fs.rmSync(nodePath.join(testCacheDir, 'lastgood'), { recursive: true, force: true });
  }
});

test('stale stats are served instantly while a background refresh runs', async () => {
  const cacheDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stats-swr-'));
  try {
    const stale = makeStats();
    const fresh = makeStats({ stats: { ...makeStats().stats, stars: 999 } });
    // 第一个实例正常抓取，落盘 last-good
    await withServer(makeApp({ cacheDir, fetchStats: async () => stale }), async (baseUrl) => {
      await fetch(`${baseUrl}/api/stats/DaWesen`);
    });
    // 第二个实例的抓取被人为挂住：刷新期间请求应立即回旧值，完成后才切新值
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await withServer(makeApp({ cacheDir, fetchStats: async () => { await gate; return fresh; } }), async (baseUrl) => {
      const first = await (await fetch(`${baseUrl}/api/stats/DaWesen`)).json();
      assert.deepEqual(first, stale, 'first hit should serve last-good instantly');
      const second = await (await fetch(`${baseUrl}/api/stats/DaWesen`)).json();
      assert.deepEqual(second, stale, 'while the refresh is in flight, stale data keeps serving');
      release();
      await gate;
      const third = await (await fetch(`${baseUrl}/api/stats/DaWesen`)).json();
      assert.deepEqual(third, fresh, 'after the refresh completes, fresh data takes over');
    });
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('stats endpoint also works when Vercel strips the /api prefix', async () => {
  const fixture = makeStats({ profile: { ...makeStats().profile, name: null } });
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => fixture }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/stats/DaWesen`);
    assert.equal(response.status, 200);
  });
});

test('card endpoint returns an SVG for a GitHub user', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => makeStats() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/card/DaWesen.svg?theme=summer-lemon`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /image\/svg\+xml/);
    assert.match(body, /DaWesen/);
    assert.match(body, /#fffbea/);
    assert.match(body, /GitHub Stats/);
    assert.match(body, /width="773" height="766"/);
  });
});

test('card endpoint supports theme query without an .svg suffix', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => makeStats() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/card/DaWesen?theme=polar-starlight`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /image\/svg\+xml/);
  });
});

test('card endpoint supports username and theme query parameters', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => makeStats() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/card?username=DaWesen&theme=polar-starlight`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /image\/svg\+xml/);
  });
});

test('themes endpoint lists all available card themes', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/themes`);
    const themes = await response.json() as Array<{ name: string; label: string }>;
    assert.equal(response.status, 200);
    assert.equal(themes.length, 12);
    assert.deepEqual(themes.at(-1), { name: 'polar-starlight', label: '极地星光' });
  });
});

test('neon-starlight theme renders the artwork card with embedded background', () => {
  const card = renderStatsCard(makeStats(), 'neon-starlight', {});
  assert.match(card, /width="1024" height="1536"/);
  assert.match(card, /xlink:href="data:image\/jpeg;base64,/);
  assert.match(card, /Total Stars/);
  assert.match(card, /RATING/);
  assert.doesNotMatch(card, /neonAvatarClip/, 'no avatar option means the ring stays decorative');
});

test('neon-starlight theme clips the avatar into the hero ring when provided', () => {
  const card = renderStatsCard(makeStats(), 'neon-starlight', { avatarDataUri: 'data:image/png;base64,AAAA' });
  assert.match(card, /clip-path="url\(#neonAvatarClip\)"/);
  assert.match(card, /xlink:href="data:image\/png;base64,AAAA"/);
});

test('neon-starlight theme shows the motto at the top of the card', () => {
  const card = renderStatsCard(makeStats(), 'neon-starlight', { motto: 'Build & share' });
  assert.match(card, /font-style="italic"/);
  assert.ok(card.includes('“Build &amp; share”'), 'motto renders escaped inside curly quotes');
  // 超长座右铭兜底截断到 40 字符
  const long = renderStatsCard(makeStats(), 'neon-starlight', { motto: 'x'.repeat(60) });
  assert.match(long, /x{37}\.\.\./);
});

test('card endpoint renders stats, glow icons and the selected font', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => makeStats() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/card/DaWesen?theme=neon-cyber&font=mono`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /120 contributions/);
    assert.match(body, /Pull Requests/);
    assert.match(body, /polyline/);
    assert.match(body, /iconGlow/);
    assert.match(body, /Cascadia Code/);
    assert.doesNotMatch(body, /lanmei-dream/);
  });
});

test('languages endpoint returns a standalone languages card', async () => {
  await withServer(createApp({ config, cacheDir: testCacheDir, fetchStats: async () => makeStats() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/card/DaWesen/languages.svg?theme=neon-cyber`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /Most Used Languages/);
    assert.match(body, /width="1000" height="533"/);
    assert.match(body, /TypeScript/);
    // GitHub 官方 linguist 语言色
    assert.match(body, /#3178c6/, 'TypeScript should use the official linguist color');
    assert.match(body, /#563d7c/, 'CSS should use the official linguist color');
  });
});

test('language colors are name-stable and never collide between different languages', () => {
  // 按名取色：Vue 即使不在色板里也不会复用相邻语言的颜色
  const card = renderStatsCard(makeStats({
    languages: [{ name: 'TypeScript', percentage: 50 }, { name: 'Vue', percentage: 50 }],
  }), 'neon-cyber', {});
  assert.match(card, /#3178c6/);
  assert.match(card, /#41b883/);
});

// -------------------------------------------------- toUserStats 映射单测 ---

function makeDetail(overrides: Partial<DetailedStats> = {}): DetailedStats {
  return {
    meta: {
      username: 'DaWesen',
      crawledAt: '2026-08-29T00:00:00.000Z',
      durationMs: 1000,
      mode: 'rest+html',
      tokenUsed: false,
      requests: { rest: 2, graphql: 0, search: 0, html: 2, cached: 0, failed: 0 },
      rateLimit: null,
      errors: [],
      sources: [],
    },
    profile: {
      login: 'DaWesen',
      name: 'DaWesen',
      type: 'User',
      avatarUrl: 'avatar',
      htmlUrl: 'https://github.com/DaWesen',
      bio: 'Build & share',
      email: null,
      location: 'Earth',
      company: null,
      website: null,
      twitter: null,
      joinedAt: '2020-01-01T00:00:00Z',
      hireable: null,
      highlights: [],
      achievements: [],
      orgs: [],
      pinned: [{ name: 'pinned-repo', url: 'https://github.com/DaWesen/pinned-repo', description: 'pinned', language: 'Go', stars: 5 }],
    },
    counts: {
      publicRepos: 2, followers: 10, following: 2, starsEarned: 9, forksEarned: 3, starsGiven: 1,
      pullRequests: 7, issues: 3, reviews: 0, contributedTo: 5, gists: 0, organizations: 0, sources: {},
    },
    repositories: [
      { name: 'small', fullName: 'DaWesen/small', url: 'https://github.com/DaWesen/small', description: null, primaryLanguage: 'Go', stars: 2, forks: 1, watchers: null, openIssues: null, isFork: false, isArchived: false, topics: [], createdAt: null, updatedAt: null, pushedAt: null, sizeKb: null, license: null },
      { name: 'big', fullName: 'DaWesen/big', url: 'https://github.com/DaWesen/big', description: 'big one', primaryLanguage: 'TypeScript', stars: 7, forks: 2, watchers: null, openIssues: null, isFork: false, isArchived: false, topics: [], createdAt: null, updatedAt: null, pushedAt: null, sizeKb: null, license: null },
    ],
    repoMeta: { total: 2, scanned: 2, truncated: false, scanCap: 1000, topStarred: [] },
    languages: [
      { name: 'TypeScript', percentage: 66.6, bytes: 666, repoCount: null, source: 'bytes' },
      { name: 'Go', percentage: 33.3, bytes: 333, repoCount: null, source: 'bytes' },
    ],
    contributions: {
      totalLastYear: 120,
      source: 'graphql',
      byType: { commits: 100, pullRequests: 7, issues: 3, reviews: 0, repositories: 5 },
      days: [{ date: '2026-01-01', count: 4, level: 2 }, { date: '2026-02-01', count: 6, level: 3 }],
      months: [],
      weekdays: [],
      activeDays: 2,
      averagePerDay: 5,
      averagePerActiveDay: 5,
      currentStreak: 2,
      longestStreak: 2,
      longestStreakRange: null,
      busiestDay: null,
    },
    activity: null,
    gists: [],
    rating: { score: 64, weights: '贡献 40 + Star 25 + PR/Issue 15 + Followers 10 + 仓库 5 + 连击 5', breakdown: [] },
    card: { profile: { login: '', name: null, avatarUrl: '', htmlUrl: '', bio: null, email: null, location: null, company: null, website: null, joinedAt: '' }, stats: { publicRepositories: 0, followers: 0, following: 0, stars: 0, forks: 0, starsGiven: 0, pullRequests: 0, reviews: 0, issues: 0, contributedTo: 0, rating: 0, contributionsLastYear: 0, contributionFrequency: 0, currentStreak: 0, longestStreak: 0 }, repositories: [], languages: [], contributionWeeks: [], contributionDays: [] },
    ...overrides,
  };
}

test('toUserStats maps crawler detail into the card structure', () => {
  const card = toUserStats(makeDetail());
  assert.deepEqual(card.profile, {
    login: 'DaWesen',
    name: 'DaWesen',
    avatarUrl: 'avatar',
    htmlUrl: 'https://github.com/DaWesen',
    bio: 'Build & share',
    email: null,
    location: 'Earth',
    company: null,
    website: null,
    joinedAt: '2020-01-01T00:00:00Z',
  });
  assert.deepEqual(card.stats, {
    publicRepositories: 2,
    followers: 10,
    following: 2,
    stars: 9,
    forks: 3,
    starsGiven: 1,
    pullRequests: 7,
    reviews: 0,
    issues: 3,
    contributedTo: 5,
    contributionsLastYear: 120,
    contributionFrequency: 2,
    currentStreak: 2,
    longestStreak: 2,
    rating: 64,
  });
  // 仓库按 Star 降序
  assert.deepEqual(card.repositories.map((repo) => repo.name), ['big', 'small']);
  // 语言百分比取整
  assert.deepEqual(card.languages, [{ name: 'TypeScript', percentage: 67 }, { name: 'Go', percentage: 33 }]);
  // 贡献天数保持升序（旧→新），周聚合由 summarizeContributions 派生
  assert.deepEqual(card.contributionDays, [{ date: '2026-01-01', contributions: 4 }, { date: '2026-02-01', contributions: 6 }]);
  assert.deepEqual(card.contributionWeeks, [{ label: '01-01', contributions: 10 }]);
});

test('toUserStats falls back to pinned repos when repositories are empty', () => {
  const detail = makeDetail({ repositories: [] });
  detail.repoMeta = { ...detail.repoMeta, total: 0, scanned: 0 };
  const card = toUserStats(detail);
  assert.deepEqual(card.repositories, [{ name: 'pinned-repo', description: 'pinned', url: 'https://github.com/DaWesen/pinned-repo', language: 'Go', stars: 5, forks: 0 }]);
});

test('shouldContinueLanguageScan stops once remaining repos cannot change the coverage', () => {
  // 一字节未扫：必须至少扫一个
  assert.equal(shouldContinueLanguageScan(0, 1000, 0.5, 0.9), true);
  // 已扫 900KB，剩余 100KB 体积最多再贡献 100×0.5=50KB → 900/950 ≥ 0.9，可以停
  assert.equal(shouldContinueLanguageScan(900, 100, 0.5, 0.9), false);
  // 已扫 900KB，剩余 1000KB 体积最多再贡献 1000×0.5=500KB → 900/1400 < 0.9，继续扫
  assert.equal(shouldContinueLanguageScan(900, 1000, 0.5, 0.9), true);
  // 字节密度上界封顶为 1（语言字节不会超过仓库体积）
  assert.equal(shouldContinueLanguageScan(900, 100, 5, 0.9), false);
  // coverage 1 只有在剩余上界归零时才停（全扫语义）
  assert.equal(shouldContinueLanguageScan(900, 100, 0.5, 1), true);
  assert.equal(shouldContinueLanguageScan(900, 0, 0.5, 1), false);
});

// ------------------------------------------------------ 指标计算单元测 ---

function isoDate(start: string, offset: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function todayOffset(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test('summarizeContributions keeps the streak alive when today has no contributions yet', () => {
  const summary = summarizeContributions([
    { date: todayOffset(0), contributions: 0 },
    { date: todayOffset(-1), contributions: 3 },
    { date: todayOffset(-3), contributions: 2 },
    { date: todayOffset(-4), contributions: 2 },
    { date: todayOffset(-2), contributions: 0 },
  ]);
  assert.equal(summary.currentStreak, 1);
  assert.equal(summary.longestStreak, 2);
  assert.equal(summary.contributionsLastYear, 7);
});

test('contributionAxisLabels derives month labels from the contribution window', () => {
  const labels = contributionAxisLabels({
    contributionDays: [
      { date: '2025-09-01', contributions: 1 },
      { date: '2026-08-28', contributions: 1 },
    ],
  } as unknown as UserStats);
  assert.deepEqual(labels.map(({ label }) => label), ["Sep '25", "Dec '25", "Apr '26", "Aug '26"]);
  assert.equal(labels.at(-1)?.fraction, 1);
});

test('contributionAxisLabels falls back to the last 12 months without data', () => {
  const labels = contributionAxisLabels({ contributionDays: [] } as unknown as UserStats);
  assert.equal(labels.length, 4);
  assert.deepEqual(labels.map(({ fraction }) => fraction), [0, 1 / 3, 2 / 3, 1]);
});

// ---------------------------------------------------------- 错误映射单测 ---

test('crawler errors map to proper HTTP statuses with a token hint', () => {
  assert.deepEqual(resolveGithubError(new UserNotFoundError('ghost'), false), { status: 404, message: 'GitHub user not found' });
  const limited = resolveGithubError(new RateLimitError('GitHub REST 核心额度已用尽', null), false);
  assert.equal(limited.status, 429);
  assert.match(limited.message, /GITHUB_TOKEN/);
  assert.doesNotMatch(resolveGithubError(new RateLimitError('额度用尽', null), true).message, /GITHUB_TOKEN/);
  assert.deepEqual(resolveGithubError(new Error('boom'), true), { status: 502, message: 'GitHub API request failed' });
});

// ------------------------------------------------------ HTML 解析单元测 ---

test('parseHumanNumber handles abbreviated, grouped and invalid numbers', () => {
  assert.equal(parseHumanNumber('1.2k'), 1200);
  assert.equal(parseHumanNumber('3.4m'), 3_400_000);
  assert.equal(parseHumanNumber('1,234'), 1234);
  assert.equal(parseHumanNumber('42'), 42);
  assert.equal(parseHumanNumber('nope'), null);
  assert.equal(parseHumanNumber(''), null);
  assert.equal(parseHumanNumber(undefined), null);
});

test('parseContributionsPage reads the embedded JSON calendar payload', () => {
  const html = `<html><body><script type="application/json">{"payload":{"contributionCalendar":{"totalContributions":10,"weeks":[{"contributionDays":[{"date":"2026-01-01","contributionCount":4,"contributionLevel":"SECOND_QUARTILE"},{"date":"2026-01-02","contributionCount":6,"contributionLevel":"THIRD_QUARTILE"}]}]}}}</script></body></html>`;
  const parsed = parseContributionsPage(html);
  assert.equal(parsed.source, 'embedded-json');
  assert.equal(parsed.total, 10);
  assert.deepEqual(parsed.days, [
    { date: '2026-01-01', count: 4, level: 2 },
    { date: '2026-01-02', count: 6, level: 3 },
  ]);
});

test('parseContributionsPage falls back to DOM cells matched with tool-tips', () => {
  const html = `<html><body><table><tr>
    <td class="ContributionCalendar-day" id="c1" data-date="2026-02-01" data-level="1"></td>
    <tool-tip for="c1">3 contributions on February 1</tool-tip>
    <td class="ContributionCalendar-day" id="c2" data-date="2026-02-02" data-level="0"></td>
    <tool-tip for="c2">No contributions on February 2</tool-tip>
  </tr></table></body></html>`;
  const parsed = parseContributionsPage(html);
  assert.equal(parsed.source, 'dom');
  assert.equal(parsed.total, 3);
  assert.deepEqual(parsed.days, [
    { date: '2026-02-01', count: 3, level: 1 },
    { date: '2026-02-02', count: 0, level: 0 },
  ]);
});
