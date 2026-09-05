import * as nodePath from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import express, { type ErrorRequestHandler } from 'express';
import { crawlUser, toUserStats } from './crawler/crawler';
import { GithubHttpClient, RateLimitError, UserNotFoundError } from './crawler/http';
import { renderLanguagesCard, renderStatsCard } from './card';
import { fetchAvatarDataUri } from './avatar';
import type { AppConfig, CardFont, CardOptions, UserStats } from './types';
import { themes } from './themes';

interface AppOptions {
  config: AppConfig;
  /** 缓存目录（ETag 缓存 + last-good 兜底），默认 data/.cache，Vercel 上落到 /tmp */
  cacheDir?: string;
  /** 统计数据加载器，默认走 src/crawler 爬虫；测试可注入替身 */
  fetchStats?: (username: string) => Promise<UserStats>;
}

const validUsername = /^[a-zA-Z0-9-]{1,39}$/;
const validFonts: CardFont[] = ['sans', 'serif', 'mono', 'rounded'];

// 同一用户名的统计结果短缓存：命中后同一实例内不重复请求 GitHub
const STATS_CACHE_TTL = 5 * 60 * 1000;
// last-good 磁盘兜底的最长可用时长：GitHub 完全不可达时卡片仍显示最近一次成功的数据
const LAST_GOOD_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// 后台刷新冷却：避免配额耗尽期间每个请求都触发一次注定失败的抓取
const REFRESH_COOLDOWN_MS = 60 * 1000;

function defaultCacheDir(): string {
  return process.env.VERCEL
    ? nodePath.join(os.tmpdir(), 'my-github-stats-cache')
    : nodePath.join(process.cwd(), 'data', '.cache');
}

function readUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readCardOptions(query: Record<string, unknown>): Partial<CardOptions> {
  const font = typeof query.font === 'string' ? query.font.trim() : '';
  const motto = typeof query.motto === 'string' ? query.motto.trim().slice(0, 40) : '';
  return {
    ...(validFonts.includes(font as CardFont) ? { font: font as CardFont } : {}),
    ...(motto ? { motto } : {}),
  };
}

function setSvgHeaders(response: express.Response): void {
  response.set('Content-Type', 'image/svg+xml; charset=utf-8');
  response.set('Cache-Control', 'public, max-age=300, s-maxage=300');
}

// 把爬虫抛出的错误映射成对外的状态码和文案
export function resolveGithubError(error: unknown, hasToken: boolean): { status: number; message: string } {
  if (error instanceof UserNotFoundError) return { status: 404, message: 'GitHub user not found' };
  if (error instanceof RateLimitError) {
    return { status: 429, message: `GitHub API rate limit exceeded${hasToken ? '' : ' (configure GITHUB_TOKEN to raise the rate limit)'}` };
  }
  return { status: 502, message: 'GitHub API request failed' };
}

// 默认数据源：src/crawler 爬虫（GraphQL/REST+HTML/HTML 三模式自动降级）。
// 进程内共享同一个 HTTP 客户端：限速节奏、HTML 缓存、主机熔断全局生效，并发多用户也不会各自全速发请求。
// 卡片用不到活动流与组织/Gists/评审等增补字段，关掉以明显缩短无 Token 冷抓时间；
// 语言占比按体积降序深扫 languages_url（实测字节反馈自适应停止），无 Token 也逼近 GraphQL 的字节级精确度。
function createCrawlerStatsLoader(config: AppConfig, cacheDir: string): (username: string) => Promise<UserStats> {
  const client = new GithubHttpClient({
    token: config.githubToken || undefined,
    apiBase: config.githubApiUrl,
    cachePath: nodePath.join(cacheDir, 'etags.json'),
  });
  return (username) => crawlUser(username, {
    client,
    reposScanLimit: 100,
    includeEvents: false,
    includeMisc: false,
    deepLanguages: true,
    deepLanguagesCoverage: 0.9,
  }).then(toUserStats);
}

function renderCardRoute(username: string, theme: unknown, statsLoader: (username: string) => Promise<UserStats>, response: express.Response, next: express.NextFunction, options: Partial<CardOptions> = {}) {
  if (!validUsername.test(username)) {
    return response.status(400).json({ error: 'Invalid GitHub username' });
  }

  return statsLoader(username)
    .then(async (stats) => {
      // 头像拉取失败返回 undefined，卡片自动退回无头像样式，不影响出图
      const avatarDataUri = await fetchAvatarDataUri(stats.profile.avatarUrl);
      setSvgHeaders(response);
      return response.send(renderStatsCard(stats, theme, { ...options, avatarDataUri }));
    })
    .catch(next);
}

export function createApp({ config, cacheDir = defaultCacheDir(), fetchStats = createCrawlerStatsLoader(config, cacheDir) }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  interface CacheEntry {
    value: Promise<UserStats>;
    expires: number;
    savedAt: number;
  }
  const statsCache = new Map<string, CacheEntry>();
  const refreshInFlight = new Map<string, Promise<void>>();
  const refreshStartedAt = new Map<string, number>();
  const lastGoodDir = nodePath.join(cacheDir, 'lastgood');

  function readLastGood(key: string): { stats: UserStats; savedAt: number } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(nodePath.join(lastGoodDir, `${key}.json`), 'utf8')) as { savedAt: number; stats: UserStats };
      return raw && raw.stats ? raw : null;
    } catch {
      return null;
    }
  }

  // 爬虫逐项降级意味着抓取"成功"也可能是全空兜底结果（REST/HTML 全挂时），
  // 这种数据不配写入 last-good，否则会顶掉之前的好数据
  function isSubstantialStats(stats: UserStats): boolean {
    return stats.profile.joinedAt !== '' || stats.stats.publicRepositories > 0;
  }

  function writeLastGood(key: string, stats: UserStats): void {
    if (!isSubstantialStats(stats)) return;
    try {
      fs.mkdirSync(lastGoodDir, { recursive: true });
      fs.writeFileSync(nodePath.join(lastGoodDir, `${key}.json`), JSON.stringify({ savedAt: Date.now(), stats }));
    } catch {
      // 写入失败不影响主流程（只读文件系统等）
    }
  }

  function fetchAndCache(key: string, username: string, mode: 'sync' | 'background' = 'sync'): Promise<UserStats> {
    const value = fetchStats(username).then((stats) => {
      // 完成时才发布结果：后台刷新期间主缓存里的旧值继续对外，不会被 pending promise 阻塞
      statsCache.set(key, { value: Promise.resolve(stats), expires: Date.now() + STATS_CACHE_TTL, savedAt: Date.now() });
      writeLastGood(key, stats);
      return stats;
    }).catch((error: unknown) => {
      // 同步路径失败不落缓存（404、限流等下次请求要重试）；后台刷新失败则保留旧值继续服务
      if (mode === 'sync') statsCache.delete(key);
      throw error;
    });
    if (mode === 'sync') statsCache.set(key, { value, expires: Date.now() + STATS_CACHE_TTL, savedAt: Date.now() });
    return value;
  }

  // 后台刷新：冷却期内不重复尝试，失败时保留旧值继续对外服务
  function scheduleRefresh(key: string, username: string): void {
    if (refreshInFlight.has(key)) return;
    const last = refreshStartedAt.get(key) || 0;
    if (Date.now() - last < REFRESH_COOLDOWN_MS) return;
    refreshStartedAt.set(key, Date.now());
    const task = fetchAndCache(key, username, 'background')
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => refreshInFlight.delete(key));
    refreshInFlight.set(key, task);
  }

  // 缓存分层：新鲜 → 直接回；过期 → 回旧值并后台刷新（stale-while-revalidate）；
  // 内存没有 → 回磁盘 last-good（GitHub 全挂时卡片仍不开天窗）；都没有 → 同步抓取
  function loadStats(username: string): Promise<UserStats> {
    const key = username.toLowerCase();
    const now = Date.now();
    const cached = statsCache.get(key);
    if (cached) {
      if (cached.expires > now) return cached.value;
      scheduleRefresh(key, username);
      return cached.value;
    }
    const lastGood = readLastGood(key);
    if (lastGood && now - lastGood.savedAt < LAST_GOOD_MAX_AGE) {
      statsCache.set(key, { value: Promise.resolve(lastGood.stats), expires: 0, savedAt: lastGood.savedAt });
      scheduleRefresh(key, username);
      return Promise.resolve(lastGood.stats);
    }
    if (statsCache.size > 500) statsCache.clear();
    return fetchAndCache(key, username);
  }

  // 根路径：配置了 DEFAULT_USERNAME 就展示该用户的卡片，否则落到主题列表
  app.get('/', (_request, response) => {
    const username = config.defaultUsername;
    response.redirect(username && validUsername.test(username) ? `/api/card/${encodeURIComponent(username)}?theme=neon-cyber` : '/api/themes');
  });

  app.get(['/health', '/api/health'], (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get(['/api/themes', '/themes'], (_request, response) => {
    response.json(Object.values(themes).map(({ name, label }) => ({ name, label })));
  });

  app.get(['/api/stats/:username', '/stats/:username'], async (request, response, next) => {
    const username = readUsername(request.params.username);
    if (!validUsername.test(username)) {
      return response.status(400).json({ error: 'Invalid GitHub username' });
    }

    try {
      return response.json(await loadStats(username));
    } catch (error) {
      return next(error);
    }
  });

  app.get(['/api/card/:username/languages.svg', '/card/:username/languages.svg', '/api/languages/:username.svg', '/languages/:username.svg'], (request, response, next) => {
    const username = readUsername(request.params.username);
    if (!validUsername.test(username)) return response.status(400).json({ error: 'Invalid GitHub username' });
    return loadStats(username)
      .then((stats) => {
        setSvgHeaders(response);
        return response.send(renderLanguagesCard(stats, request.query.theme));
      })
      .catch(next);
  });

  app.get(['/api/card/:username.svg', '/card/:username.svg', '/api/card/:username', '/card/:username'], (request, response, next) => {
    return renderCardRoute(readUsername(request.params.username), request.query.theme, loadStats, response, next, readCardOptions(request.query));
  });

  app.get(['/api/card', '/card'], (request, response, next) => {
    return renderCardRoute(readUsername(request.query.username), request.query.theme, loadStats, response, next, readCardOptions(request.query));
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const { status, message } = resolveGithubError(error, Boolean(config.githubToken));
    return response.status(status).json({ error: message });
  };
  app.use(errorHandler);

  return app;
}
