import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

// GitHub 风控/限流页面特征文案（沿用项目 github.ts 的判定，再补充两个常见变体）
const BLOCK_MARKERS = [
  'unusual traffic',
  'Access denied',
  'rate limit exceeded',
  'secondary rate limit',
  'Whoa there',
  'githb.com/captcha',
  'id="captcha"',
];

// 尽量模拟真实浏览器的完整请求头，降低 HTML 抓取被风控识别的概率（与项目 github.ts 保持一致）
const HTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Referer: 'https://github.com/',
  'Sec-Ch-Ua': '"Chromium";v="128", "Google Chrome";v="128", "Not=A?Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

export type RequestKind = 'rest' | 'search' | 'graphql' | 'html';

export class NotFoundError extends Error {
  constructor(url: string) {
    super(`Not found: ${url}`);
    this.name = 'NotFoundError';
  }
}

/** 用户不存在（REST/HTML 都确认 404）。服务端据此映射 HTTP 404 */
export class UserNotFoundError extends Error {
  constructor(username: string) {
    super(`GitHub 用户不存在：${username}`);
    this.name = 'UserNotFoundError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public resetAt: string | null) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterHeader?: unknown): number {
  if (typeof retryAfterHeader === 'string' && /^\d+$/.test(retryAfterHeader)) {
    // Retry-After 单位是秒，封顶 30s 避免单次等待过久
    return Math.min(Number(retryAfterHeader) * 1000, 30_000);
  }
  return Math.min(1200 * 2 ** (attempt - 1) + Math.random() * 600, 15_000);
}

function stableParams(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const sorted = Object.keys(params).sort().map((key) => `${key}=${String(params[key])}`);
  return sorted.join('&');
}

interface EtagEntry {
  etag: string;
  body: unknown;
  savedAt: number;
}

const ETAG_CACHE_MAX_ENTRIES = 200;
/** 缓存新鲜窗口：窗口内的缓存直接用本地副本，连 304 条件请求都不发 */
const ETAG_FRESH_WINDOW_MS = 5 * 60 * 1000;
/** 带缓存的请求大概率 304（不耗额度），走快速限速通道 */
const CACHED_REQUEST_PACE_MS = 500;

export interface HttpClientOptions {
  token?: string;
  apiBase?: string;
  /** ETag 条件请求缓存落盘路径；不传则只做内存缓存 */
  cachePath?: string;
  onProgress?: (message: string) => void;
  verbose?: boolean;
}

/**
 * GitHub HTTP 客户端：
 * - 按请求类别（rest/search/graphql/html）独立限速，未认证时遵守 60 次/小时与 10 次/分钟(Search)
 * - REST GET 全部走 ETag 条件请求，304 直接复用本地缓存，不消耗核心额度
 * - 429/403(次要限流)/5xx/网络错误 指数退避重试，额度用尽立即抛 RateLimitError
 * - HTML 抓取带风控页面检测，命中特征自动重试
 */
export class GithubHttpClient {
  readonly counters = { rest: 0, graphql: 0, search: 0, html: 0, cached: 0, failed: 0 };
  rateLimit: { limit: number | null; remaining: number | null; used: number | null; resetAt: string | null } | null = null;

  private readonly api: AxiosInstance;
  private readonly token: string;
  private readonly apiBase: string;
  private readonly lastAt: Record<RequestKind, number> = { rest: 0, search: 0, graphql: 0, html: 0 };
  private readonly htmlCache = new Map<string, { body: string; expires: number }>();
  private readonly etagCache: Map<string, EtagEntry>;
  private readonly cachePath: string | undefined;
  private readonly onProgress?: (message: string) => void;
  private readonly verbose: boolean;

  constructor(options: HttpClientOptions = {}) {
    this.token = options.token || '';
    this.apiBase = (options.apiBase || 'https://api.github.com').replace(/\/+$/, '');
    this.cachePath = options.cachePath;
    this.onProgress = options.onProgress;
    this.verbose = Boolean(options.verbose);
    this.etagCache = this.loadEtagCache();
    this.api = axios.create({
      timeout: 20_000,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'my-github-stats-crawler/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
  }

  private log(message: string): void {
    if (this.verbose) this.onProgress?.(message);
  }

  private minIntervalMs(kind: RequestKind): number {
    switch (kind) {
      case 'graphql':
        return 200;
      case 'search':
        // 官方限额：认证 30 次/分钟，未认证 10 次/分钟
        return this.token ? 2_500 : 7_000;
      case 'html':
        return 800;
      case 'rest': {
        if (this.token) return 120;
        const remaining = this.rateLimit?.remaining;
        // 未认证核心额度只有 60 次/小时，快用完时放慢脚步
        if (typeof remaining === 'number' && remaining <= 3) return 10_000;
        return 1_400;
      }
    }
  }

  private async pace(kind: RequestKind, minOverride?: number): Promise<void> {
    const elapsed = Date.now() - this.lastAt[kind];
    const min = minOverride ?? this.minIntervalMs(kind);
    const jitter = kind === 'html' ? Math.random() * 400 : Math.random() * 120;
    if (elapsed + jitter < min) await sleep(min - elapsed + jitter);
    this.lastAt[kind] = Date.now();
  }

  private updateRateLimit(headers: Record<string, unknown>): void {
    const read = (name: string): number | null => {
      const value = headers[name];
      return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
    };
    const limit = read('x-ratelimit-limit');
    const remaining = read('x-ratelimit-remaining');
    const used = read('x-ratelimit-used');
    const reset = read('x-ratelimit-reset');
    if (limit === null && remaining === null) return;
    this.rateLimit = {
      limit,
      remaining,
      used,
      resetAt: reset !== null ? new Date(reset * 1000).toISOString() : null,
    };
  }

  // ---------------------------------------------------------------- REST ---

  async rest<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const { data } = await this.restWithResponse<T>(path, params);
    return data;
  }

  /** 返回响应头的 REST 请求（用于从 Link 头读分页总数等场景） */
  async restWithResponse<T>(path: string, params?: Record<string, unknown>): Promise<{ data: T; headers: Record<string, unknown> }> {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const cacheKey = `GET ${url} ${stableParams(params)}`;
    const cachedEntry = this.etagCache.get(cacheKey);

    // 缓存还在新鲜窗口内：零请求直接复用，重复抓取几乎零成本
    if (cachedEntry && Date.now() - cachedEntry.savedAt < ETAG_FRESH_WINDOW_MS) {
      this.counters.cached += 1;
      this.log(`[rest] 缓存新鲜（${Math.round((Date.now() - cachedEntry.savedAt) / 1000)}s 前），直接复用 ${path}`);
      return { data: cachedEntry.body as T, headers: {} };
    }

    let retryAfter: unknown;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      if (attempt > 1) {
        const wait = backoffMs(attempt, retryAfter);
        this.log(`[rest] 第 ${attempt} 次重试 ${path}，等待 ${Math.round(wait)}ms`);
        await sleep(wait);
      }
      // 带缓存条目的请求大概率 304（不消耗额度），走快速限速通道
      await this.pace('rest', cachedEntry ? CACHED_REQUEST_PACE_MS : undefined);
      try {
        const response = await this.api.get<T>(url, {
          params,
          ...(cachedEntry
            ? {
                headers: { 'If-None-Match': cachedEntry.etag },
                validateStatus: (status: number) => (status >= 200 && status < 300) || status === 304,
              }
            : {}),
        });
        this.counters.rest += 1;
        this.updateRateLimit(response.headers as Record<string, unknown>);
        const entry = this.etagCache.get(cacheKey);
        if (response.status === 304 && entry) {
          this.counters.cached += 1;
          this.log(`[rest] 304 命中 ETag 缓存 ${path}`);
          return { data: entry.body as T, headers: {} };
        }
        const etag = response.headers.etag;
        if (typeof etag === 'string') {
          this.etagCache.set(cacheKey, { etag, body: response.data, savedAt: Date.now() });
          this.saveEtagCache();
        }
        this.log(`[rest] GET ${path}`);
        return { data: response.data, headers: response.headers as Record<string, unknown> };
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
        if (headers) this.updateRateLimit(headers);
        this.counters.failed += 1;
        if (status === 404) throw new NotFoundError(url);
        if (status === 403 || status === 429) {
          const remaining = headers?.['x-ratelimit-remaining'];
          retryAfter = headers?.['retry-after'];
          if (remaining === '0') {
            const reset = headers?.['x-ratelimit-reset'];
            const resetAt = typeof reset === 'string' && /^\d+$/.test(reset) ? new Date(Number(reset) * 1000).toISOString() : null;
            throw new RateLimitError('GitHub REST 核心额度已用尽', resetAt);
          }
          continue; // 次要限流：退避后重试
        }
        if ((status && status >= 500) || !status) continue; // 5xx / 网络错误
        throw error;
      }
    }
    throw new Error(`REST 请求多次失败: ${path}`);
  }

  // ------------------------------------------------------------- GraphQL ---

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) await sleep(backoffMs(attempt));
      await this.pace('graphql');
      try {
        const response = await this.api.post<{ data?: T; errors?: Array<{ message: string }> }>(
          `${this.apiBase}/graphql`,
          { query, variables },
        );
        this.counters.graphql += 1;
        this.updateRateLimit(response.headers as Record<string, unknown>);
        if (response.data.errors?.length) {
          throw new Error(`GraphQL 错误: ${response.data.errors.map((item) => item.message).join('; ')}`);
        }
        this.log('[graphql] 查询成功');
        return response.data.data as T;
      } catch (error) {
        lastError = error;
        const status = (error as { response?: { status?: number } })?.response?.status;
        this.counters.failed += 1;
        if (status === 401) throw new Error('GitHub Token 无效（401），请检查 GITHUB_TOKEN');
        if (status === 403 || status === 429 || status === 502 || !status) continue;
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('GraphQL 请求多次失败');
  }

  // -------------------------------------------------------------- Search ---

  async search<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) await sleep(backoffMs(2));
      await this.pace('search');
      try {
        const response = await this.api.get<T>(`${this.apiBase}${path}`, { params });
        this.counters.search += 1;
        this.updateRateLimit(response.headers as Record<string, unknown>);
        this.log(`[search] ${path} ${stableParams(params)}`);
        return response.data;
      } catch (error) {
        lastError = error;
        this.counters.failed += 1;
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 403 || status === 429) throw new RateLimitError('GitHub Search 限流', null);
        if (!status) continue;
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Search 请求失败');
  }

  // ---------------------------------------------------------------- HTML ---

  /** 主机熔断：连接级失败的主机在本轮内直接短路，避免每个 URL 都傻等超时 */
  private readonly hostDownUntil = new Map<string, number>();
  private static readonly HOST_DOWN_COOLDOWN_MS = 180_000;

  async html(url: string): Promise<string> {
    const host = new URL(url).host;
    const downUntil = this.hostDownUntil.get(host);
    if (downUntil && Date.now() < downUntil) {
      throw new BlockedError(`主机 ${host} 本轮已熔断（连接失败），跳过 HTML 抓取`);
    }
    const cached = this.htmlCache.get(url);
    if (cached && cached.expires > Date.now()) {
      this.counters.cached += 1;
      return cached.body;
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) await sleep(backoffMs(attempt));
      await this.pace('html');
      try {
        const response = await this.api.get<string>(url, {
          headers: HTML_HEADERS,
          timeout: 10_000,
          responseType: 'text',
          maxRedirects: 5,
        });
        this.counters.html += 1;
        const body = response.data;
        if (BLOCK_MARKERS.some((marker) => body.includes(marker))) {
          throw new BlockedError('GitHub HTML 页面被风控拦截');
        }
        this.htmlCache.set(url, { body, expires: Date.now() + 5 * 60 * 1000 });
        this.log(`[html] GET ${url}`);
        return body;
      } catch (error) {
        this.counters.failed += 1;
        if (error instanceof BlockedError) {
          lastError = error;
          continue; // 风控拦截：退避后换口气再试，最后一次直接抛出
        }
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) throw new NotFoundError(url);
        lastError = error;
        // 连接级失败（超时/拒绝/重置）：本请求内重试也不会好转，立即跳出触发主机熔断，
        // 避免每个 HTML 页面都傻等 3 轮超时（api.github.com 通常仍正常，不影响 REST）
        if (!status) break;
      }
    }
    // 连接级失败（超时/拒绝/重置）说明主机当前不可达，触发熔断
    const status = (lastError as { response?: { status?: number } } | undefined)?.response?.status;
    if (!status) {
      this.hostDownUntil.set(host, Date.now() + GithubHttpClient.HOST_DOWN_COOLDOWN_MS);
      throw new BlockedError(`主机 ${host} 连接失败（${lastError instanceof Error ? lastError.message : '未知错误'}），已熔断本轮 HTML 抓取`);
    }
    throw lastError instanceof Error ? lastError : new Error('HTML 抓取失败');
  }

  // ------------------------------------------------------- ETag 磁盘缓存 ---

  private loadEtagCache(): Map<string, EtagEntry> {
    if (!this.cachePath) return new Map();
    try {
      const raw = fs.readFileSync(this.cachePath, 'utf8');
      const parsed = JSON.parse(raw) as { entries?: Record<string, EtagEntry> };
      return new Map(Object.entries(parsed.entries || {}));
    } catch {
      return new Map();
    }
  }

  private saveEtagCache(): void {
    if (!this.cachePath) return;
    if (this.etagCache.size > ETAG_CACHE_MAX_ENTRIES) {
      const entries = [...this.etagCache.entries()].sort((left, right) => right[1].savedAt - left[1].savedAt);
      this.etagCache.clear();
      for (const [key, value] of entries.slice(0, ETAG_CACHE_MAX_ENTRIES)) this.etagCache.set(key, value);
    }
    try {
      fs.mkdirSync(nodePath.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify({ version: 1, entries: Object.fromEntries(this.etagCache) }));
    } catch {
      // 缓存写失败不影响主流程
    }
  }
}

export type { AxiosResponse };
