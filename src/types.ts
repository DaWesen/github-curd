export interface AppConfig {
  port: number;
  githubToken: string;
  githubApiUrl: string;
  /** 根路径重定向的默认用户名（环境变量 DEFAULT_USERNAME）；未配置时根路径落到主题列表 */
  defaultUsername: string;
}

export interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  bio: string | null;
  email: string | null;
  location: string | null;
  company: string | null;
  website: string | null;
  joinedAt: string;
}

export interface GithubStats {
  publicRepositories: number;
  followers: number;
  following: number;
  stars: number;
  forks: number;
  /** 给别人的仓库点 Star 的数量（对外贡献） */
  starsGiven: number;
  pullRequests: number;
  /** 近一年为他人 PR 写下的评审数（reviews） */
  reviews: number;
  issues: number;
  contributedTo: number;
  rating: number;
  contributionsLastYear: number;
  contributionFrequency: number;
  currentStreak: number;
  longestStreak: number;
}

export interface GithubRepository {
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  forks: number;
}

export interface UserStats {
  profile: GithubProfile;
  stats: GithubStats;
  repositories: GithubRepository[];
  languages: Array<{ name: string; percentage: number }>;
  contributionWeeks: Array<{ label: string; contributions: number }>;
  contributionDays: Array<{ date: string; contributions: number }>;
}

// 可选项：卡片字体（通过 ?font= 查询参数切换，例如 /api/card/DaWesen?font=mono）
// 后续下载新字体时：1) 在 CardFont 联合类型里加名字；2) 在 cardFontStacks 里加对应字体栈（第一个填下载的字体名）
export type CardFont = 'sans' | 'serif' | 'mono' | 'rounded';

export interface CardOptions {
  font: CardFont;
  /** 已转成 data URI 的用户头像（服务端拉取后注入）；霓虹星空主题会把它嵌进头像环，缺省时环保持纯装饰 */
  avatarDataUri?: string;
  /** 座右铭：霓虹星空主题显示在卡片最上方的星空区域，最长 40 字符 */
  motto?: string;
}

export const cardFontStacks: Record<CardFont, string> = {
  sans: "'Segoe UI', 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  serif: "'Georgia', 'Times New Roman', 'Noto Serif SC', serif",
  mono: "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  rounded: "'Comic Sans MS', 'Segoe UI', 'Chalkboard SE', sans-serif",
};

export type ThemeName =
  | 'dreamy-galaxy'
  | 'neon-cyber'
  | 'neon-starlight'
  | 'aurora-nebula'
  | 'summer-lemon'
  | 'sakura-story'
  | 'deep-sea-blue'
  | 'amber-sun'
  | 'emerald-forest'
  | 'midnight-count'
  | 'minimal-white'
  | 'polar-starlight'
  | 'blue-archive';

export interface CardTheme {
  name: ThemeName;
  label: string;
  background: string;
  accent: string;
  initialText: string;
  title: string;
  muted: string;
  body: string;
  divider: string;
  panelBorder: string;
  panelTitle: string;
  chart: string;
  glow: string;
}