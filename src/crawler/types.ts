import type { UserStats } from '../types';

// ---------------------------------------------------------------------------
// 爬虫报告顶层结构：一个用户一份 DetailedStats，JSON 序列化后直接落盘
// ---------------------------------------------------------------------------

export interface CrawlRequestStats {
  rest: number;
  graphql: number;
  search: number;
  html: number;
  cached: number;
  failed: number;
}

export interface CrawlRateLimit {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
}

export interface CrawlError {
  source: string;
  message: string;
}

export interface CrawlMeta {
  username: string;
  crawledAt: string;
  durationMs: number;
  /** graphql+rest / rest+html / rest / html 等，反映实际用到的数据通道 */
  mode: string;
  tokenUsed: boolean;
  requests: CrawlRequestStats;
  rateLimit: CrawlRateLimit | null;
  errors: CrawlError[];
  sources: string[];
}

// ---------------------------------------------------------------------------
// 基本资料
// ---------------------------------------------------------------------------

export interface CrawlOrg {
  login: string;
  avatarUrl: string;
}

export interface CrawlPinnedRepo {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
}

export interface CrawlGist {
  description: string | null;
  files: number;
  isPublic: boolean;
  url: string;
  createdAt: string | null;
}

export interface CrawlProfile {
  login: string;
  name: string | null;
  type: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  bio: string | null;
  email: string | null;
  location: string | null;
  company: string | null;
  website: string | null;
  twitter: string | null;
  joinedAt: string | null;
  hireable: boolean | null;
  highlights: string[];
  achievements: string[];
  orgs: CrawlOrg[];
  pinned: CrawlPinnedRepo[];
}

// ---------------------------------------------------------------------------
// 计数总览（每个字段标注数据来源，便于判断可信度）
// ---------------------------------------------------------------------------

export interface CrawlCounts {
  publicRepos: number;
  followers: number;
  following: number;
  starsEarned: number;
  forksEarned: number;
  starsGiven: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  contributedTo: number;
  gists: number;
  organizations: number;
  /** 字段名 -> 数据来源：graphql / rest / search / html / events / aggregated */
  sources: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 仓库
// ---------------------------------------------------------------------------

export interface CrawlRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  primaryLanguage: string | null;
  stars: number;
  forks: number;
  watchers: number | null;
  openIssues: number | null;
  isFork: boolean;
  isArchived: boolean;
  topics: string[];
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
  sizeKb: number | null;
  license: string | null;
}

export interface CrawlRepoMeta {
  /** 用户公开仓库总数（优先来自 API 的权威值） */
  total: number | null;
  scanned: number;
  truncated: boolean;
  scanCap: number;
  topStarred: Array<{ name: string; stars: number }>;
}

// ---------------------------------------------------------------------------
// 语言
// ---------------------------------------------------------------------------

export interface CrawlLanguage {
  name: string;
  percentage: number;
  /** 按字节统计时有值（GraphQL / languages_url） */
  bytes: number | null;
  /** 按仓库数统计时有值（无字节来源时） */
  repoCount: number | null;
  source: 'bytes' | 'bytes-partial' | 'repo-count';
}

// ---------------------------------------------------------------------------
// 贡献
// ---------------------------------------------------------------------------

export interface CrawlContributionDay {
  date: string;
  count: number;
  level: number | null;
}

export interface CrawlContributionType {
  commits: number | null;
  pullRequests: number | null;
  issues: number | null;
  reviews: number | null;
  repositories: number | null;
}

export interface CrawlContributions {
  totalLastYear: number;
  /** graphql=官方日历；html=页面日历；search-estimate=Search Commits 估算（提交+PR+Issue+评审）；none=未取得 */
  source: 'graphql' | 'html' | 'search-estimate' | 'none';
  byType: CrawlContributionType;
  days: CrawlContributionDay[];
  months: Array<{ month: string; count: number }>;
  weekdays: Array<{ weekday: string; count: number }>;
  activeDays: number;
  averagePerDay: number;
  averagePerActiveDay: number;
  currentStreak: number;
  longestStreak: number;
  longestStreakRange: { from: string; to: string } | null;
  busiestDay: { date: string; count: number } | null;
}

// ---------------------------------------------------------------------------
// 近期动态（来自 public events，最多回溯 90 天 / 300 条）
// ---------------------------------------------------------------------------

export interface CrawlActivity {
  windowDays: number;
  fetchedEvents: number;
  truncated: boolean;
  commitsPushed: number;
  pullRequestsOpened: number;
  pullRequestsMerged: number;
  reviewsWritten: number;
  issuesOpened: number;
  reposStarred: number;
  reposForked: number;
  reposCreated: number;
  releasesPublished: number;
  contributedTo: string[];
  topActiveRepos: Array<{ name: string; events: number }>;
}

// ---------------------------------------------------------------------------
// 评级（与项目 computeRating 同权重，展开为明细）
// ---------------------------------------------------------------------------

export interface RatingBreakdown {
  score: number;
  weights: string;
  breakdown: Array<{ key: string; label: string; value: number; weight: number; score: number }>;
}

// ---------------------------------------------------------------------------
// 顶层
// ---------------------------------------------------------------------------

export interface DetailedStats {
  meta: CrawlMeta;
  profile: CrawlProfile;
  counts: CrawlCounts;
  repositories: CrawlRepo[];
  repoMeta: CrawlRepoMeta;
  languages: CrawlLanguage[];
  contributions: CrawlContributions;
  activity: CrawlActivity | null;
  gists: CrawlGist[];
  rating: RatingBreakdown;
  /** 与本项目卡片服务完全兼容的结构，可直接喂给 renderStatsCard / /api/card */
  card: UserStats;
}

// ---------------------------------------------------------------------------
// 内部：REST / GraphQL 响应类型
// ---------------------------------------------------------------------------

export interface RestUserResponse {
  login: string;
  name: string | null;
  type: string;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  email: string | null;
  location: string | null;
  company: string | null;
  blog: string;
  twitter_username: string | null;
  created_at: string;
  public_repos: number;
  followers: number;
  following: number;
  hireable: boolean | null;
}

export interface RestRepoResponse {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  fork: boolean;
  archived: boolean;
  topics?: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  size: number;
  license: { spdx_id: string | null } | null;
  languages_url: string;
}

export interface RestEventResponse {
  id: string;
  type: string;
  created_at: string;
  repo?: { name: string };
  payload?: {
    size?: number;
    commits?: unknown[];
    action?: string;
    ref_type?: string;
    pull_request?: { merged?: boolean };
  };
}

export interface RestGistResponse {
  description: string | null;
  public: boolean;
  html_url: string;
  created_at: string;
  files: Record<string, unknown>;
}

export interface GraphqlUserResponse {
  user: {
    login: string;
    name: string | null;
    bio: string | null;
    avatarUrl: string;
    url: string;
    websiteUrl: string | null;
    location: string | null;
    company: string | null;
    email: string | null;
    twitterUsername: string | null;
    createdAt: string;
    followers: { totalCount: number };
    following: { totalCount: number };
    starredRepositories: { totalCount: number };
    gists: { totalCount: number } | null;
    organizations: { totalCount: number } | null;
    pullRequests: { totalCount: number };
    issues: { totalCount: number };
    repositoriesContributedTo: { totalCount: number } | null;
    contributionsCollection: {
      totalCommitContributions: number;
      totalPullRequestContributions: number;
      totalIssueContributions: number;
      totalPullRequestReviewContributions: number;
      totalRepositoryContributions: number;
      contributionCalendar: {
        totalContributions: number;
        weeks: Array<{
          firstDay: string;
          contributionDays: Array<{ date: string; contributionCount: number; contributionLevel: string }>;
        }>;
      };
    } | null;
  } | null;
}

export interface GraphqlReposResponse {
  user: {
    repositories: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        name: string;
        nameWithOwner: string;
        description: string | null;
        url: string;
        primaryLanguage: { name: string } | null;
        stargazerCount: number;
        forkCount: number;
        watchers: { totalCount: number } | null;
        issues: { totalCount: number } | null;
        isFork: boolean;
        isArchived: boolean;
        createdAt: string;
        updatedAt: string;
        pushedAt: string | null;
        licenseInfo: { spdxId: string | null } | null;
        repositoryTopics: { nodes: Array<{ topic: { name: string } }> } | null;
        languages: { edges: Array<{ size: number; node: { name: string } } | null> | null } | null;
      }> | null;
    } | null;
  } | null;
}

export interface SearchResultResponse {
  total_count: number;
  items: Array<{ repository_url?: string }>;
}
