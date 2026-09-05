import { computeRating, summarizeContributions } from '../metrics';
import type { UserStats } from '../types';
import { GithubHttpClient, NotFoundError, RateLimitError, sleep, UserNotFoundError } from './http';
import { extractProfileFromPayloads, parseContributionsPage, parseProfilePage, parseReposPage } from './parse';
import type {
  CrawlActivity,
  CrawlContributions,
  CrawlCounts,
  CrawlError,
  CrawlGist,
  CrawlLanguage,
  CrawlProfile,
  CrawlRepo,
  CrawlRepoMeta,
  DetailedStats,
  GraphqlReposResponse,
  GraphqlUserResponse,
  RatingBreakdown,
  RestEventResponse,
  RestGistResponse,
  RestRepoResponse,
  RestUserResponse,
  SearchResultResponse,
} from './types';

const GRAPHQL_USER_QUERY = `
query UserOverview($login: String!) {
  user(login: $login) {
    login name bio avatarUrl url websiteUrl location company email twitterUsername createdAt
    followers { totalCount }
    following { totalCount }
    starredRepositories { totalCount }
    gists(first: 1) { totalCount }
    organizations(first: 1) { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositoriesContributedTo(first: 1, includeUserRepositories: false) { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      totalRepositoryContributions
      contributionCalendar {
        totalContributions
        weeks { firstDay contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

const GRAPHQL_REPOS_QUERY = `
query UserRepos($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name nameWithOwner description url
        primaryLanguage { name }
        stargazerCount forkCount
        watchers(first: 1) { totalCount }
        issues(first: 1) { totalCount }
        isFork isArchived
        createdAt updatedAt pushedAt
        licenseInfo { spdxId }
        repositoryTopics(first: 15) { nodes { topic { name } } }
        languages(first: 40, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
      }
    }
  }
}`;

export interface CrawlerOptions {
  /** 复用已有客户端（服务端进程内共享：限速节奏、HTML 缓存、主机熔断全局生效）；不传则新建 */
  client?: GithubHttpClient;
  token?: string;
  apiBase?: string;
  /** 仓库扫描上限（默认 1000） */
  reposScanLimit?: number;
  /** 无 Token 时逐仓库拉 languages_url 统计字节（每仓库耗 1 次核心额度，默认关） */
  deepLanguages?: boolean;
  /** 字节深扫的覆盖目标（0.1~1，默认 1 全扫）。按体积降序扫描，用实测字节反馈自适应停止：
   *  剩余仓库即使全按观测到的最大字节密度贡献也无法撼动目标覆盖时即停 */
  deepLanguagesCoverage?: number;
  /** 字节深扫的最少仓库数（默认 10）：覆盖目标的字节密度上界依赖观测值，
   *  大体积低代码量的仓库会把上界拉低导致提前停，扫满下限兜底 */
  deepLanguagesMinRepos?: number;
  includeEvents?: boolean;
  includeSearch?: boolean;
  /** HTML 增补（置顶仓库/成就/贡献日历兜底），默认开 */
  includeHtml?: boolean;
  /** 组织/Gists/给出 Star/代码评审等卡片用不到的增补字段，默认抓；卡片服务可关掉省约 4 个请求 */
  includeMisc?: boolean;
  cachePath?: string;
  onProgress?: (message: string) => void;
  verbose?: boolean;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearAgoIso(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

/** 与项目 github.ts computeRating 相同的权重公式，展开为明细 */
function buildRatingBreakdown(input: { contributions: number; followers: number; stars: number; pullRequests: number; issues: number; publicRepositories: number; longestStreak: number; score: number }): RatingBreakdown {
  const logScore = (value: number, scale: number): number => (value <= 0 ? 0 : Math.min(1, Math.log10(1 + value) / Math.log10(1 + scale)));
  const breakdown: RatingBreakdown['breakdown'] = [
    { key: 'contributions', label: '近一年贡献', value: input.contributions, weight: 40, score: logScore(input.contributions, 3000) * 40 },
    { key: 'stars', label: '获得 Star', value: input.stars, weight: 25, score: logScore(input.stars, 500) * 25 },
    { key: 'prIssue', label: 'PR + Issue', value: input.pullRequests + input.issues, weight: 15, score: logScore(input.pullRequests + input.issues, 200) * 15 },
    { key: 'followers', label: '关注者', value: input.followers, weight: 10, score: logScore(input.followers, 300) * 10 },
    { key: 'repos', label: '公开仓库', value: input.publicRepositories, weight: 5, score: logScore(input.publicRepositories, 60) * 5 },
    { key: 'streak', label: '最长连击', value: input.longestStreak, weight: 5, score: Math.min(input.longestStreak / 60, 1) * 5 },
  ];
  return {
    score: input.score,
    weights: '贡献 40 + Star 25 + PR/Issue 15 + Followers 10 + 仓库 5 + 连击 5（对数归一化，与项目卡片一致）',
    breakdown: breakdown.map((item) => ({ ...item, score: Math.round(item.score * 10) / 10 })),
  };
}

/** 把任意来源的日历天数聚合成月份 / 星期分布、连击区间、活跃天数等 */
function analyzeContributions(days: Array<{ date: string; count: number; level: number | null }>, totalLastYear: number, source: CrawlContributions['source']): CrawlContributions {
  const sorted = [...days].sort((left, right) => left.date.localeCompare(right.date));

  const monthMap = new Map<string, number>();
  const weekdayCounts = new Array<number>(7).fill(0);
  let activeDays = 0;
  let busiestDay: { date: string; count: number } | null = null;

  for (const day of sorted) {
    const date = new Date(`${day.date}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      // getUTCDay(): 0=周日 ... 6=周六；转换成周一起始
      weekdayCounts[(date.getUTCDay() + 6) % 7] += day.count;
    }
    const month = day.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) || 0) + day.count);
    if (day.count > 0) activeDays += 1;
    if (!busiestDay || day.count > busiestDay.count) busiestDay = { date: day.date, count: day.count };
  }

  // 最长连击及其区间
  let longestStreak = 0;
  let longestRange: { from: string; to: string } | null = null;
  let running = 0;
  let runStart = '';
  for (const day of sorted) {
    if (day.count > 0) {
      if (running === 0) runStart = day.date;
      running += 1;
      if (running > longestStreak) {
        longestStreak = running;
        longestRange = { from: runStart, to: day.date };
      }
    } else {
      running = 0;
    }
  }

  // 当前连击：从最新一天往前数；今天为 0 不清零
  const today = todayIso();
  let currentStreak = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const day = sorted[index];
    if (day.date > today) continue;
    if (day.count > 0) currentStreak += 1;
    else if (day.date === today) continue;
    else break;
  }

  const months = [...monthMap.entries()].sort((left, right) => left[0].localeCompare(right[0])).slice(-12)
    .map(([month, count]) => ({ month, count }));

  return {
    totalLastYear: totalLastYear || sorted.reduce((sum, day) => sum + day.count, 0),
    source,
    byType: { commits: null, pullRequests: null, issues: null, reviews: null, repositories: null },
    days: sorted,
    months,
    weekdays: WEEKDAY_LABELS.map((weekday, index) => ({ weekday, count: weekdayCounts[index] })),
    activeDays,
    averagePerDay: sorted.length > 0 ? Math.round((sorted.reduce((sum, day) => sum + day.count, 0) / sorted.length) * 10) / 10 : 0,
    averagePerActiveDay: activeDays > 0 ? Math.round((sorted.reduce((sum, day) => sum + day.count, 0) / activeDays) * 10) / 10 : 0,
    currentStreak,
    longestStreak,
    longestStreakRange: longestStreak > 0 ? longestRange : null,
    busiestDay,
  };
}

/**
 * 语言字节深扫的停止判定：已扫字节数是否已足够逼近目标覆盖。
 * 剩余仓库可能贡献的字节上界 = 剩余 sizeKb × 已观测到的最大 字节/体积 比（字节不会超过仓库体积），
 * 上界无法撼动目标覆盖时继续扫就是浪费额度。返回 true 表示还应继续扫。
 */
export function shouldContinueLanguageScan(scannedBytes: number, remainingSizeKb: number, maxBytesPerKb: number, coverage: number): boolean {
  if (scannedBytes <= 0) return true;
  const remainingPossible = remainingSizeKb * Math.min(1, Math.max(0, maxBytesPerKb));
  return scannedBytes / (scannedBytes + remainingPossible) < coverage - 1e-9;
}

/** 语言占比：优先按代码字节（GraphQL / languages_url），退而按仓库主语言计数 */
function buildLanguages(repos: CrawlRepo[], bytesByRepo: Map<string, Map<string, number>> | null, coverage: number): CrawlLanguage[] {  if (bytesByRepo && bytesByRepo.size > 0) {
    const totals = new Map<string, number>();
    for (const repoBytes of bytesByRepo.values()) {
      for (const [name, bytes] of repoBytes) totals.set(name, (totals.get(name) || 0) + bytes);
    }
    const grand = [...totals.values()].reduce((sum, value) => sum + value, 0);
    if (grand > 0) {
      return [...totals.entries()]
        .map(([name, bytes]) => ({
          name,
          percentage: Math.round((bytes / grand) * 1000) / 10,
          bytes,
          repoCount: null,
          source: (coverage >= 1 ? 'bytes' : 'bytes-partial') as CrawlLanguage['source'],
        }))
        .sort((left, right) => right.percentage - left.percentage);
    }
  }

  const counts = new Map<string, number>();
  for (const repo of repos) {
    if (!repo.primaryLanguage) continue;
    counts.set(repo.primaryLanguage, (counts.get(repo.primaryLanguage) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      percentage: Math.round((count / total) * 1000) / 10,
      bytes: null,
      repoCount: count,
      source: 'repo-count' as const,
    }))
    .sort((left, right) => right.percentage - left.percentage);
}

/** 把详尽数据转换为本项目卡片服务直接可用的 UserStats 结构 */
export function toUserStats(detail: DetailedStats): UserStats {
  const topRepositories = [...detail.repositories]
    .sort((left, right) => right.stars - left.stars)
    .slice(0, 6)
    .map((repo) => ({
      name: repo.name,
      description: repo.description,
      url: repo.url,
      language: repo.primaryLanguage,
      stars: repo.stars,
      forks: repo.forks,
    }));
  if (topRepositories.length === 0 && detail.profile.pinned.length > 0) {
    for (const pinned of detail.profile.pinned.slice(0, 6)) {
      topRepositories.push({
        name: pinned.name,
        description: pinned.description,
        url: pinned.url,
        language: pinned.language,
        stars: pinned.stars || 0,
        forks: 0,
      });
    }
  }

  return {
    profile: {
      login: detail.profile.login,
      name: detail.profile.name,
      avatarUrl: detail.profile.avatarUrl || `https://github.com/${detail.profile.login}.png?size=160`,
      htmlUrl: detail.profile.htmlUrl || `https://github.com/${detail.profile.login}`,
      bio: detail.profile.bio,
      email: detail.profile.email,
      location: detail.profile.location,
      company: detail.profile.company,
      website: detail.profile.website,
      joinedAt: detail.profile.joinedAt || '',
    },
    stats: {
      publicRepositories: detail.counts.publicRepos,
      followers: detail.counts.followers,
      following: detail.counts.following,
      stars: detail.counts.starsEarned,
      forks: detail.counts.forksEarned,
      starsGiven: detail.counts.starsGiven,
      pullRequests: detail.counts.pullRequests,
      reviews: detail.counts.reviews,
      issues: detail.counts.issues,
      contributedTo: detail.counts.contributedTo,
      contributionsLastYear: detail.contributions.totalLastYear,
      contributionFrequency: Math.round(detail.contributions.totalLastYear / 52),
      currentStreak: detail.contributions.currentStreak,
      longestStreak: detail.contributions.longestStreak,
      rating: detail.rating.score,
    },
    repositories: topRepositories,
    languages: detail.languages.map((language) => ({ name: language.name, percentage: Math.round(language.percentage) })),
    contributionWeeks: summarizeContributions(detail.contributions.days.map((day) => ({ date: day.date, contributions: day.count }))).contributionWeeks,
    contributionDays: detail.contributions.days.map((day) => ({ date: day.date, contributions: day.count })),
  };
}

/**
 * 主入口：抓取一个 GitHub 用户的全部公开数据。
 *
 * 模式自动选择：
 * - 配置了 Token：GraphQL（资料 + 贡献日历 + 全部计数 + 仓库明细含语言字节）+ REST 补充 + HTML 补充（置顶/成就）
 * - 无 Token：REST（资料 + 仓库分页 + 组织 + Gists + 事件流）+ Search（PR/Issue 计数）+ HTML（贡献日历 + 置顶/成就）
 * - REST 额度耗尽：自动降级为纯 HTML 模式
 */
export async function crawlUser(username: string, options: CrawlerOptions = {}): Promise<DetailedStats> {
  const startedAt = Date.now();
  const onProgress = options.onProgress;
  const client = options.client ?? new GithubHttpClient({
    token: options.token,
    apiBase: options.apiBase,
    cachePath: options.cachePath,
    onProgress,
    verbose: options.verbose,
  });

  const reposScanLimit = options.reposScanLimit ?? 1000;
  const errors: CrawlError[] = [];
  const sources: string[] = [];
  const record = (source: string): void => { if (!sources.includes(source)) sources.push(source); };
  const fail = (source: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ source, message });
  };

  let usedHtml = false;
  let usedRest = false;
  let usedGraphql = false;

  // ------------------------------------------------------- 1. 用户基础资料 ---
  onProgress?.('① 获取用户基础资料');
  let restUser: RestUserResponse | null = null;
  try {
    restUser = await client.rest<RestUserResponse>(`/users/${encodeURIComponent(username)}`);
    usedRest = true;
    record('rest:/users/:username');
  } catch (error) {
    if (error instanceof NotFoundError) throw new UserNotFoundError(username);
    if (error instanceof RateLimitError) fail('rest:/users/:username（额度用尽，降级 HTML 模式）', error);
    else fail('rest:/users/:username', error);
  }

  let gqlUser: GraphqlUserResponse['user'] | null = null;
  if (options.token) {
    onProgress?.('② GraphQL 查询（资料 + 贡献 + 全部计数）');
    try {
      const response = await client.graphql<GraphqlUserResponse>(GRAPHQL_USER_QUERY, { login: username });
      gqlUser = response?.user || null;
      if (gqlUser) {
        usedGraphql = true;
        record('graphql:user');
      }
    } catch (error) {
      fail('graphql:user', error);
    }
  }

  // HTML 资料页：补齐置顶仓库 / 成就 / 高亮 / 组织头像；纯 HTML 模式下也是资料主要来源
  let htmlProfile: ReturnType<typeof parseProfilePage> | null = null;
  if (options.includeHtml !== false || !restUser) {
    onProgress?.('③ 抓取个人主页 HTML（置顶仓库 / 成就 / 徽章）');
    try {
      const html = await client.html(`https://github.com/${encodeURIComponent(username)}`);
      htmlProfile = parseProfilePage(html);
      if (options.includeHtml !== false) {
        const payloadProfile = extractProfileFromPayloads(html);
        if (htmlProfile.pinned.length === 0 && payloadProfile.pinned) htmlProfile.pinned = payloadProfile.pinned;
        if (htmlProfile.followers === null && payloadProfile.followers !== undefined) htmlProfile.followers = payloadProfile.followers;
        if (htmlProfile.following === null && payloadProfile.following !== undefined) htmlProfile.following = payloadProfile.following;
      }
      usedHtml = true;
      record('html:profile');
    } catch (error) {
      fail('html:profile', error);
    }
  }

  const profile: CrawlProfile = {
    login: gqlUser?.login || restUser?.login || htmlProfile?.login || username,
    name: gqlUser?.name ?? restUser?.name ?? htmlProfile?.name ?? null,
    type: restUser?.type ?? (gqlUser ? 'User' : htmlProfile?.type) ?? null,
    avatarUrl: gqlUser?.avatarUrl || restUser?.avatar_url || htmlProfile?.avatarUrl || `https://github.com/${username}.png?size=160`,
    htmlUrl: gqlUser?.url || restUser?.html_url || `https://github.com/${username}`,
    bio: gqlUser?.bio ?? restUser?.bio ?? htmlProfile?.bio ?? null,
    email: gqlUser?.email ?? restUser?.email ?? htmlProfile?.email ?? null,
    location: gqlUser?.location ?? restUser?.location ?? htmlProfile?.location ?? null,
    company: gqlUser?.company ?? restUser?.company ?? htmlProfile?.company ?? null,
    website: gqlUser?.websiteUrl ?? (restUser?.blog ? restUser.blog : null) ?? htmlProfile?.website ?? null,
    twitter: gqlUser?.twitterUsername ? `https://x.com/${gqlUser.twitterUsername}` : restUser?.twitter_username ? `https://x.com/${restUser.twitter_username}` : htmlProfile?.twitter ?? null,
    joinedAt: gqlUser?.createdAt ?? restUser?.created_at ?? htmlProfile?.joinedAt ?? null,
    hireable: restUser?.hireable ?? null,
    highlights: htmlProfile?.highlights || [],
    achievements: htmlProfile?.achievements || [],
    orgs: [],
    pinned: htmlProfile?.pinned || [],
  };

  // ------------------------------------------------------------- 2. 仓库 ---
  onProgress?.('④ 抓取公开仓库列表');
  const repos: CrawlRepo[] = [];
  const bytesByRepo = new Map<string, Map<string, number>>();
  const languagesUrls = new Map<string, string>();
  let reposTotal: number | null = null;

  const pushRepo = (repo: CrawlRepo): void => {
    if (repos.length >= reposScanLimit) return;
    if (!repos.some((existing) => existing.name === repo.name)) repos.push(repo);
  };

  if (gqlUser) {
    // Token 模式：GraphQL 分页拉全部公开仓库，语言字节顺带返回
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext && repos.length < reposScanLimit) {
      try {
        const page: GraphqlReposResponse = await client.graphql<GraphqlReposResponse>(GRAPHQL_REPOS_QUERY, { login: username, cursor });
        const connection = page?.user?.repositories;
        if (!connection) break;
        reposTotal = connection.totalCount;
        for (const node of connection.nodes ?? []) {
          pushRepo({
            name: node.name,
            fullName: node.nameWithOwner,
            url: node.url,
            description: node.description,
            primaryLanguage: node.primaryLanguage?.name || null,
            stars: node.stargazerCount,
            forks: node.forkCount,
            watchers: node.watchers?.totalCount ?? null,
            openIssues: node.issues?.totalCount ?? null,
            isFork: node.isFork,
            isArchived: node.isArchived,
            topics: (node.repositoryTopics?.nodes ?? []).map((topic) => topic.topic.name),
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            pushedAt: node.pushedAt,
            sizeKb: null,
            license: node.licenseInfo?.spdxId || null,
          });
          if (node.languages?.edges?.length) {
            const repoBytes = new Map<string, number>();
            for (const edge of node.languages.edges) {
              if (edge && edge.node?.name) repoBytes.set(edge.node.name, (repoBytes.get(edge.node.name) || 0) + edge.size);
            }
            if (repoBytes.size > 0) bytesByRepo.set(node.name, repoBytes);
          }
        }
        hasNext = connection.pageInfo.hasNextPage;
        cursor = connection.pageInfo.endCursor;
      } catch (error) {
        fail('graphql:repositories', error);
        break;
      }
    }
    record('graphql:repositories');
  } else if (restUser) {
    // 无 Token：REST 分页（未认证 60 次/小时，最多 10 页 × 100 = 1000 个仓库）
    for (let page = 1; page <= 10 && repos.length < reposScanLimit; page += 1) {
      try {
        const list = await client.rest<RestRepoResponse[]>(`/users/${encodeURIComponent(username)}/repos`, {
          per_page: 100,
          page,
          sort: 'pushed',
        });
        if (!Array.isArray(list) || list.length === 0) break;
        reposTotal = restUser.public_repos;
        for (const item of list) {
          pushRepo({
            name: item.name,
            fullName: item.full_name,
            url: item.html_url,
            description: item.description,
            primaryLanguage: item.language,
            stars: item.stargazers_count,
            forks: item.forks_count,
            watchers: item.watchers_count,
            openIssues: item.open_issues_count,
            isFork: item.fork,
            isArchived: item.archived,
            topics: item.topics || [],
            createdAt: item.created_at,
            updatedAt: item.updated_at,
            pushedAt: item.pushed_at,
            sizeKb: item.size,
            license: item.license?.spdx_id || null,
          });
          languagesUrls.set(item.name, item.languages_url);
        }
        if (list.length < 100) break;
      } catch (error) {
        fail(`rest:/repos page=${page}`, error);
        break;
      }
    }
    record('rest:/users/:username/repos');
  } else {
    // 纯 HTML 模式：仓库列表页分页
    for (let page = 1; page <= 10 && repos.length < reposScanLimit; page += 1) {
      try {
        const pageHtml = await client.html(`https://github.com/${encodeURIComponent(username)}?tab=repositories&page=${page}`);
        const parsed = parseReposPage(pageHtml, username);
        if (parsed.total !== null) reposTotal = parsed.total;
        for (const item of parsed.repos) {
          pushRepo({ ...item, watchers: null, createdAt: null, pushedAt: null, sizeKb: null, license: null });
        }
        if (!parsed.hasNextPage || parsed.repos.length === 0) break;
        usedHtml = true;
      } catch (error) {
        fail(`html:repos page=${page}`, error);
        break;
      }
    }
    record('html:repositories');
  }

  // 无 Token 且要求深扫：逐仓库 languages_url 统计字节（每仓库 1 次核心请求）。
  // 按体积降序扫，用每次抓到的真实字节数做反馈：剩余仓库即使全按观测到的最大字节密度算
  // 也无法撼动覆盖目标时就停——头部密集仓库多扫、空壳仓库自动跳过，请求数自适应。
  // ETag 条件请求让重复抓取 304 命中、不消耗核心额度
  if (!gqlUser && options.deepLanguages && restUser && languagesUrls.size > 0) {
    const coverage = Math.min(1, Math.max(0.1, options.deepLanguagesCoverage ?? 1));
    const ordered = [...repos]
      .filter((repo) => languagesUrls.has(repo.name))
      .sort((left, right) => (right.sizeKb || 0) - (left.sizeKb || 0));
    const totalSizeKb = ordered.reduce((sum, repo) => sum + (repo.sizeKb || 0), 0);
    let consumedSizeKb = 0;
    let scannedBytes = 0;
    let maxBytesPerKb = 0;
    const scanned: string[] = [];
    for (const repo of ordered) {
      if (scanned.length >= (options.deepLanguagesMinRepos ?? 10) && !shouldContinueLanguageScan(scannedBytes, totalSizeKb - consumedSizeKb, maxBytesPerKb, coverage)) break;
      const url = languagesUrls.get(repo.name);
      if (!url) continue;
      try {
        const bytes = await client.rest<Record<string, number>>(url);
        const repoBytes = new Map<string, number>(Object.entries(bytes));
        if (repoBytes.size > 0) {
          bytesByRepo.set(repo.name, repoBytes);
          const repoTotal = [...repoBytes.values()].reduce((sum, value) => sum + value, 0);
          scannedBytes += repoTotal;
          if ((repo.sizeKb || 0) > 0 && repoTotal > 0) maxBytesPerKb = Math.max(maxBytesPerKb, repoTotal / (repo.sizeKb as number));
        }
        scanned.push(repo.name);
      } catch (error) {
        fail(`rest:languages ${repo.name}`, error);
        if (error instanceof RateLimitError) break;
      }
      consumedSizeKb += repo.sizeKb || 0;
      await sleep(150);
    }
    onProgress?.(`⑤ 深扫语言字节（${scanned.length} 个仓库，目标字节覆盖 ${Math.round(coverage * 100)}%）`);
    record('rest:languages_url');
  }

  // 字节覆盖度按体积计算：已扫仓库体积 / 总体积（GraphQL 模式全量返回，恒为 1）
  const totalSizeKb = repos.reduce((sum, repo) => sum + (repo.sizeKb || 0), 0);
  const scannedSizeKb = repos.reduce((sum, repo) => sum + (bytesByRepo.has(repo.name) ? repo.sizeKb || 0 : 0), 0);
  const languagesCoverage = totalSizeKb > 0 ? scannedSizeKb / totalSizeKb : 1;
  const starsEarned = repos.reduce((sum, repo) => sum + repo.stars, 0);
  const forksEarned = repos.reduce((sum, repo) => sum + repo.forks, 0);

  const repoMeta: CrawlRepoMeta = {
    total: reposTotal ?? restUser?.public_repos ?? repos.length,
    scanned: repos.length,
    truncated: reposTotal !== null ? repos.length < reposTotal : false,
    scanCap: reposScanLimit,
    topStarred: [...repos].sort((left, right) => right.stars - left.stars).slice(0, 5).map((repo) => ({ name: repo.name, stars: repo.stars })),
  };

  // ------------------------------------------------------------ 3. 贡献 ---
  onProgress?.('⑥ 获取近一年贡献日历');
  let contributionDays: Array<{ date: string; count: number; level: number | null }> = [];
  let contributionTotal = 0;
  let contributionSource: CrawlContributions['source'] = 'none';

  if (gqlUser?.contributionsCollection?.contributionCalendar) {
    const calendar = gqlUser.contributionsCollection.contributionCalendar;
    contributionDays = calendar.weeks.flatMap((week) => week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'].indexOf(day.contributionLevel),
    })));
    contributionTotal = calendar.totalContributions;
    contributionSource = 'graphql';
    record('graphql:contributionCalendar');
  } else if (options.includeHtml !== false) {
    try {
      const html = await client.html(`https://github.com/users/${encodeURIComponent(username)}/contributions`);
      const parsed = parseContributionsPage(html);
      contributionDays = parsed.days;
      contributionTotal = parsed.total || parsed.days.reduce((sum, day) => sum + day.count, 0);
      contributionSource = parsed.days.length > 0 ? 'html' : 'none';
      usedHtml = true;
      record(`html:contributions (${parsed.source})`);
    } catch (error) {
      fail('html:contributions', error);
    }
  }

  const contributions = analyzeContributions(contributionDays, contributionTotal, contributionSource);
  if (gqlUser?.contributionsCollection) {
    contributions.byType = {
      commits: gqlUser.contributionsCollection.totalCommitContributions,
      pullRequests: gqlUser.contributionsCollection.totalPullRequestContributions,
      issues: gqlUser.contributionsCollection.totalIssueContributions,
      reviews: gqlUser.contributionsCollection.totalPullRequestReviewContributions,
      repositories: gqlUser.contributionsCollection.totalRepositoryContributions,
    };
  }

  // ---------------------------------------------------------- 4. 事件流 ---
  onProgress?.('⑦ 获取公开事件流（近期动态）');
  let activity: CrawlActivity | null = null;
  const eventContributedTo = new Set<string>();
  if (options.includeEvents !== false && (usedRest || options.token)) {
    const events: RestEventResponse[] = [];
    try {
      for (let page = 1; page <= 3; page += 1) {
        const list = await client.rest<RestEventResponse[]>(`/users/${encodeURIComponent(username)}/events/public`, { per_page: 100, page });
        if (!Array.isArray(list) || list.length === 0) break;
        events.push(...list);
        if (list.length < 100) break;
      }
      record('rest:/users/:username/events/public');
    } catch (error) {
      fail('rest:/events/public', error);
    }

    if (events.length > 0) {
      const counters = { commitsPushed: 0, pullRequestsOpened: 0, pullRequestsMerged: 0, reviewsWritten: 0, issuesOpened: 0, reposStarred: 0, reposForked: 0, reposCreated: 0, releasesPublished: 0 };
      const repoEventCounts = new Map<string, number>();
      for (const event of events) {
        const payload = event.payload || {};
        const repoName = event.repo?.name || '';
        const isOwn = repoName.toLowerCase().startsWith(`${username.toLowerCase()}/`);
        if (!isOwn && ['PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent', 'IssuesEvent'].includes(event.type) && repoName) {
          eventContributedTo.add(repoName);
        }
        repoEventCounts.set(repoName, (repoEventCounts.get(repoName) || 0) + 1);
        switch (event.type) {
          case 'PushEvent':
            counters.commitsPushed += payload.commits?.length || payload.size || 1;
            break;
          case 'PullRequestEvent':
            if (payload.action === 'opened') counters.pullRequestsOpened += 1;
            if (payload.action === 'closed' && payload.pull_request?.merged) counters.pullRequestsMerged += 1;
            break;
          case 'PullRequestReviewEvent':
            counters.reviewsWritten += 1;
            break;
          case 'IssuesEvent':
            if (payload.action === 'opened') counters.issuesOpened += 1;
            break;
          case 'WatchEvent':
            counters.reposStarred += 1;
            break;
          case 'ForkEvent':
            counters.reposForked += 1;
            break;
          case 'CreateEvent':
            if (payload.ref_type === 'repository') counters.reposCreated += 1;
            break;
          case 'ReleaseEvent':
            counters.releasesPublished += 1;
            break;
        }
      }
      const oldest = events.reduce((min, event) => (event.created_at < min ? event.created_at : min), events[0].created_at);
      const windowDays = Math.min(90, Math.max(1, Math.ceil((Date.now() - new Date(oldest).getTime()) / 86_400_000)));
      activity = {
        windowDays,
        fetchedEvents: events.length,
        truncated: events.length >= 300,
        ...counters,
        contributedTo: [...eventContributedTo].sort(),
        topActiveRepos: [...repoEventCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([name, count]) => ({ name, events: count })),
      };
    }
  }

  // ------------------------------------------------- 5. Search 计数补齐 ---
  // Search API 有独立限流桶（未认证 10 次/分钟），核心额度耗尽时依然可用
  let searchPullRequests: number | null = null;
  let searchIssues: number | null = null;
  let searchReviews: number | null = null;
  let searchContributedTo = new Set<string>();
  let searchRateLimited = false;
  if (!gqlUser && options.includeSearch !== false) {
    onProgress?.('⑧ Search API 统计 PR / Issue（未认证限速较严，逐条间隔）');
    const fromDate = oneYearAgoIso();
    const searchItems: SearchResultResponse['items'] = [];
    const runSearch = async (qualifier: string): Promise<number | null> => {
      try {
        const result = await client.search<SearchResultResponse>('/search/issues', {
          q: `${qualifier} created:>=${fromDate}`,
          per_page: 100,
          advanced_search: 'true',
        });
        if (Array.isArray(result.items)) searchItems.push(...result.items);
        return result.total_count;
      } catch (error) {
        fail(`search:${qualifier}`, error);
        if (error instanceof RateLimitError) searchRateLimited = true;
        return null;
      }
    };
    searchPullRequests = await runSearch(`author:${username} is:pr`);
    searchIssues = await runSearch(`author:${username} is:issue`);
    if (options.includeMisc !== false) {
      searchReviews = await runSearch(`reviewed-by:${username} is:pr`);
    }
    record('search:/search/issues (PR/Issue 计数，近一年)');
    for (const item of searchItems) {
      if (item.repository_url) {
        const fullName = item.repository_url.replace('https://api.github.com/repos/', '');
        if (!fullName.toLowerCase().startsWith(`${username.toLowerCase()}/`)) searchContributedTo.add(fullName);
      }
    }
  }

  // 贡献日历（GraphQL/HTML）都没拿到时：用 Search Commits 估算近一年贡献（提交 + 已统计的 PR/Issue/评审）
  if (contributionSource === 'none' && !gqlUser && options.includeSearch !== false) {
    onProgress?.('… 贡献日历不可用，改用 Search Commits 估算近一年贡献');
    try {
      const result = await client.search<SearchResultResponse>('/search/commits', {
        q: `author:${username} committer-date:>=${oneYearAgoIso()}`,
        per_page: 1,
      });
      const estimated = (result.total_count || 0) + (searchPullRequests || 0) + (searchIssues || 0) + (searchReviews || 0);
      if (estimated > 0) {
        contributions.totalLastYear = estimated;
        contributions.source = 'search-estimate';
        record('search:/search/commits (贡献估算)');
      }
    } catch (error) {
      fail('search:/search/commits', error);
    }
  }

  // -------------------------------------------------- 6. 组织 / Gists ---
  onProgress?.('⑨ 获取组织与 Gists');
  let restOrgs: Array<{ login: string; avatarUrl: string }> = [];
  if (usedRest && options.includeMisc !== false) {
    try {
      const orgs = await client.rest<Array<{ login: string; avatar_url: string }>>(`/users/${encodeURIComponent(username)}/orgs`, { per_page: 100 });
      restOrgs = (orgs || []).map((org) => ({ login: org.login, avatarUrl: org.avatar_url }));
      record('rest:/users/:username/orgs');
    } catch (error) {
      fail('rest:/orgs', error);
    }
  }
  profile.orgs = restOrgs.length > 0 ? restOrgs : htmlProfile?.orgs || [];

  const gists: CrawlGist[] = [];
  let gistsTotal: number | null = null;
  if (gqlUser?.gists) {
    gistsTotal = gqlUser.gists.totalCount;
  } else if (usedRest && options.includeMisc !== false) {
    try {
      for (let page = 1; page <= 2; page += 1) {
        const list = await client.rest<RestGistResponse[]>(`/users/${encodeURIComponent(username)}/gists`, { per_page: 100, page });
        if (!Array.isArray(list) || list.length === 0) break;
        gistsTotal = (gistsTotal || 0) + list.length;
        for (const gist of list) {
          gists.push({
            description: gist.description,
            files: Object.keys(gist.files || {}).length,
            isPublic: gist.public,
            url: gist.html_url,
            createdAt: gist.created_at,
          });
        }
        if (list.length < 100) break;
      }
      record('rest:/users/:username/gists');
    } catch (error) {
      fail('rest:/gists', error);
    }
  }

  // 无 GraphQL/HTML 时的"给出 Star"：per_page=1 的 Link 头里就藏着总数
  let restStarsGiven: number | null = null;
  if (!gqlUser && usedRest && options.includeMisc !== false) {
    try {
      const { data, headers } = await client.restWithResponse<unknown[]>(`/users/${encodeURIComponent(username)}/starred`, { per_page: 1, page: 1 });
      const link = typeof headers.link === 'string' ? headers.link : '';
      const lastMatch = link.match(/[?&]page=(\d+)[^>]*>; rel="last"/);
      restStarsGiven = lastMatch ? Number(lastMatch[1]) : Array.isArray(data) ? data.length : 0;
      record('rest:/users/:username/starred (Link 头计数)');
    } catch (error) {
      fail('rest:/starred', error);
    }
  }

  // ------------------------------------------------------ 7. 汇总计数 ---
  const counts: CrawlCounts = {
    publicRepos: reposTotal ?? repos.length,
    followers: gqlUser?.followers.totalCount ?? restUser?.followers ?? htmlProfile?.followers ?? 0,
    following: gqlUser?.following.totalCount ?? restUser?.following ?? htmlProfile?.following ?? 0,
    starsEarned,
    forksEarned,
    starsGiven: gqlUser?.starredRepositories.totalCount ?? restStarsGiven ?? htmlProfile?.stars ?? 0,
    pullRequests: gqlUser?.pullRequests.totalCount ?? searchPullRequests ?? 0,
    issues: gqlUser?.issues.totalCount ?? searchIssues ?? 0,
    reviews: gqlUser?.contributionsCollection?.totalPullRequestReviewContributions ?? searchReviews ?? 0,
    contributedTo: gqlUser?.repositoriesContributedTo?.totalCount ?? (eventContributedTo.size + searchContributedTo.size > 0 ? new Set([...eventContributedTo, ...searchContributedTo]).size : 0),
    gists: gistsTotal ?? gqlUser?.gists?.totalCount ?? 0,
    organizations: gqlUser?.organizations?.totalCount ?? profile.orgs.length,
    sources: {},
  };
  counts.sources = {
    publicRepos: gqlUser ? 'graphql' : reposTotal !== null && usedRest ? 'rest' : usedHtml ? 'html' : 'aggregated',
    followers: gqlUser ? 'graphql' : restUser ? 'rest' : htmlProfile?.followers != null ? 'html' : '缺失',
    following: gqlUser ? 'graphql' : restUser ? 'rest' : htmlProfile?.following != null ? 'html' : '缺失',
    starsEarned: 'aggregated(仓库求和)',
    forksEarned: 'aggregated(仓库求和)',
    starsGiven: gqlUser ? 'graphql' : restStarsGiven !== null ? 'rest(Link 头)' : htmlProfile?.stars != null ? 'html' : '缺失',
    pullRequests: gqlUser ? 'graphql(累计)' : searchPullRequests !== null ? 'search(近一年)' : '缺失',
    issues: gqlUser ? 'graphql(累计)' : searchIssues !== null ? 'search(近一年)' : '缺失',
    reviews: gqlUser ? 'graphql' : searchReviews !== null ? 'search(近一年)' : '缺失',
    contributedTo: gqlUser ? 'graphql' : eventContributedTo.size > 0 || searchContributedTo.size > 0 ? 'events+search' : '缺失',
    gists: gqlUser ? 'graphql' : gistsTotal !== null ? 'rest' : '缺失',
    organizations: gqlUser ? 'graphql' : profile.orgs.length > 0 ? 'rest/html' : '缺失',
  };

  // ---------------------------------------------------- 8. 评级与卡片 ---
  onProgress?.('⑩ 计算评级与卡片数据');
  const ratingScore = computeRating({
    contributions: contributions.totalLastYear,
    followers: counts.followers,
    stars: starsEarned,
    pullRequests: counts.pullRequests,
    issues: counts.issues,
    publicRepositories: counts.publicRepos,
    longestStreak: contributions.longestStreak,
  });
  const rating = buildRatingBreakdown({
    contributions: contributions.totalLastYear,
    followers: counts.followers,
    stars: starsEarned,
    pullRequests: counts.pullRequests,
    issues: counts.issues,
    publicRepositories: counts.publicRepos,
    longestStreak: contributions.longestStreak,
    score: ratingScore,
  });

  const modeParts = [usedGraphql && 'graphql', (usedRest || usedGraphql) && 'rest', usedHtml && 'html'].filter(Boolean);
  const detail: DetailedStats = {
    meta: {
      username,
      crawledAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      mode: modeParts.join('+') || 'html',
      tokenUsed: Boolean(options.token),
      requests: { ...client.counters },
      rateLimit: client.rateLimit,
      errors,
      sources,
    },
    profile,
    counts,
    repositories: [...repos].sort((left, right) => right.stars - left.stars || (right.pushedAt || '').localeCompare(left.pushedAt || '')),
    repoMeta,
    languages: buildLanguages(repos, bytesByRepo.size > 0 ? bytesByRepo : null, languagesCoverage),
    contributions,
    activity,
    gists: gists.slice(0, 20),
    rating,
    card: { profile: { login: '', name: null, avatarUrl: '', htmlUrl: '', bio: null, email: null, location: null, company: null, website: null, joinedAt: '' }, stats: { publicRepositories: 0, followers: 0, following: 0, stars: 0, forks: 0, starsGiven: 0, pullRequests: 0, reviews: 0, issues: 0, contributedTo: 0, rating: 0, contributionsLastYear: 0, contributionFrequency: 0, currentStreak: 0, longestStreak: 0 }, repositories: [], languages: [], contributionWeeks: [], contributionDays: [] },
  };
  detail.card = toUserStats(detail);

  return detail;
}
