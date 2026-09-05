import 'dotenv/config';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { crawlUser } from './crawler';
import type { DetailedStats } from './types';

// ------------------------------------------------------------- 参数解析 ---

interface CliArgs {
  username: string;
  out: string;
  token?: string;
  repos: number;
  deepLanguages: boolean;
  deepCoverage: number;
  deepMinRepos: number;
  search: boolean;
  events: boolean;
  html: boolean;
  misc: boolean;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
}

const USAGE = `
用法: pnpm crawler <username> [选项]

参数:
  <username>            GitHub 用户名（必填）

选项:
  --out <dir>           输出目录（默认 ./data）
  --token <token>       覆盖 GITHUB_TOKEN 环境变量（配置后走 GraphQL，数据最全）
  --repos <n>           仓库扫描上限（默认 1000）
  --deep-languages      无 Token 时逐仓库统计语言字节（每仓库耗 1 次核心额度）
  --deep-coverage <n>   字节深扫的覆盖目标 0.1~1（默认 1 全扫；0.9 表示扫到剩余仓库即使全按观测到的最大字节密度贡献也无法撼动 90% 覆盖即停）
  --deep-min-repos <n>  字节深扫的最少仓库数（默认 10，防止覆盖上界被大体积低代码量仓库拉低导致提前停）
  --no-search           跳过 Search API（PR/Issue 计数）
  --no-events           跳过公开事件流（近期动态）
  --no-html             跳过 HTML 增补（置顶仓库/成就/贡献日历兜底）
  --no-misc             跳过组织/Gists/给出 Star/代码评审（卡片用不到的增补字段，更快）
  --quiet               只写 JSON 文件，不打印报告
  --verbose             打印每个请求的细节
  --help                显示帮助
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    username: '',
    out: nodePath.join(process.cwd(), 'data'),
    repos: 1000,
    deepLanguages: false,
    deepCoverage: 1,
    deepMinRepos: 10,
    search: true,
    events: true,
    html: true,
    misc: true,
    quiet: false,
    verbose: false,
    help: false,
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--out': args.out = nodePath.resolve(argv[++index] || ''); break;
      case '--token': args.token = argv[++index]; break;
      case '--repos': args.repos = Math.max(1, Number(argv[++index]) || 1000); break;
      case '--deep-languages': args.deepLanguages = true; break;
      case '--deep-coverage': args.deepCoverage = Math.min(1, Math.max(0.1, Number(argv[++index]) || 1)); break;
      case '--deep-min-repos': args.deepMinRepos = Math.max(0, Number(argv[++index]) || 10); break;
      case '--no-search': args.search = false; break;
      case '--no-events': args.events = false; break;
      case '--no-html': args.html = false; break;
      case '--no-misc': args.misc = false; break;
      case '--quiet': args.quiet = true; break;
      case '--verbose': args.verbose = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`未知参数: ${arg}\n${USAGE}`);
        }
        positional.push(arg);
    }
  }
  if (args.help) return args;
  if (positional.length === 0) throw new Error('缺少用户名\n' + USAGE);
  args.username = positional[0];
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(args.username)) throw new Error(`非法 GitHub 用户名: ${args.username}`);
  return args;
}

// ------------------------------------------------------------ 报告渲染 ---

const BAR_WIDTH = 20;

function bar(percentage: number, width = BAR_WIDTH): string {
  const filled = Math.round((Math.min(100, Math.max(0, percentage)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function line(text = ''): string {
  return text;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '未知';
}

function renderSummary(detail: DetailedStats): string {
  const { meta, profile, counts, repoMeta, languages, contributions, activity, rating } = detail;
  const out: string[] = [];

  out.push('══════════════════════════════════════════════════');
  out.push(`  GitHub 爬虫报告 · ${profile.login}${profile.name ? ` (${profile.name})` : ''}`);
  out.push('══════════════════════════════════════════════════');
  const requestStats = meta.requests;
  out.push(line(`模式 ${meta.mode} · 耗时 ${(meta.durationMs / 1000).toFixed(1)}s · 请求 REST ${requestStats.rest} / GraphQL ${requestStats.graphql} / Search ${requestStats.search} / HTML ${requestStats.html}（缓存命中 ${requestStats.cached}，失败 ${requestStats.failed}）`));
  if (meta.rateLimit && meta.rateLimit.remaining !== null) {
    out.push(line(`REST 额度剩余 ${meta.rateLimit.remaining}/${meta.rateLimit.limit ?? '?'}${meta.rateLimit.resetAt ? `，重置于 ${meta.rateLimit.resetAt.slice(11, 19)} UTC` : ''}`));
  }
  out.push(line());

  out.push('【基本资料】');
  out.push(line(`  名称      ${profile.name || profile.login}   类型 ${profile.type || '未知'}`));
  if (profile.bio) out.push(line(`  简介      ${profile.bio}`));
  const contactParts = [`位置 ${profile.location || '未知'}`, `公司 ${profile.company || '未知'}`, `网站 ${profile.website || '无'}`, `邮箱 ${profile.email || '无'}`];
  out.push(line(`  ${contactParts.join('  ·  ')}`));
  out.push(line(`  加入时间  ${formatDate(profile.joinedAt)}   Twitter ${profile.twitter || '无'}   可雇佣 ${profile.hireable === null ? '未知' : profile.hireable ? '是' : '否'}`));
  if (profile.highlights.length > 0) out.push(line(`  徽章      ${profile.highlights.join('、')}`));
  if (profile.achievements.length > 0) out.push(line(`  成就      ${profile.achievements.join('、')}`));
  if (profile.orgs.length > 0) out.push(line(`  组织      ${profile.orgs.map((org) => org.login).join('、')}`));
  if (profile.pinned.length > 0) {
    out.push(line('  置顶仓库  '));
    for (const pinned of profile.pinned) {
      out.push(line(`    · ${pinned.name}${pinned.stars !== null ? ` ★${pinned.stars}` : ''}${pinned.language ? ` [${pinned.language}]` : ''}${pinned.description ? ` — ${pinned.description}` : ''}`));
    }
  }
  out.push(line());

  out.push('【数据总览】（每项末尾为数据来源）');
  out.push(line(`  公开仓库 ${formatNumber(counts.publicRepos)} [${counts.sources.publicRepos}]   获 Star ${formatNumber(counts.starsEarned)}   获 Fork ${formatNumber(counts.forksEarned)}`));
  out.push(line(`  关注者 ${formatNumber(counts.followers)} [${counts.sources.followers}]   关注中 ${formatNumber(counts.following)}   给出 Star ${formatNumber(counts.starsGiven)}`));
  out.push(line(`  Pull Request ${formatNumber(counts.pullRequests)} [${counts.sources.pullRequests}]   Issue ${formatNumber(counts.issues)} [${counts.sources.issues}]   代码评审 ${formatNumber(counts.reviews)}`));
  out.push(line(`  Contributed to ${counts.contributedTo} [${counts.sources.contributedTo}]   Gists ${counts.gists}   组织 ${counts.organizations}`));
  out.push(line());

  out.push(`【综合评级】${rating.score}/100`);
  out.push(line(`  ${rating.breakdown.map((item) => `${item.label} ${item.score}/${item.weight}`).join(' · ')}`));
  out.push(line());

  out.push(`【语言占比】（${languages[0]?.source === 'bytes' ? '按代码字节' : languages[0]?.source === 'bytes-partial' ? '按代码字节，部分仓库未深扫' : '按仓库主语言计数'}，共 ${languages.length} 种）`);
  for (const language of languages.slice(0, 8)) {
    out.push(line(`  ${language.name.padEnd(14)} ${String(language.percentage).padStart(5)}% ${bar(language.percentage)}`));
  }
  if (languages.length > 8) out.push(line(`  … 另有 ${languages.length - 8} 种语言，详见 JSON`));
  out.push(line());

  out.push(`【近一年贡献】${formatNumber(contributions.totalLastYear)} 次（来源 ${contributions.source}，周均 ${Math.round(contributions.totalLastYear / 52)}）`);
  out.push(line(`  当前连击 ${contributions.currentStreak} 天 · 最长连击 ${contributions.longestStreak} 天${contributions.longestStreakRange ? `（${contributions.longestStreakRange.from.slice(5)} → ${contributions.longestStreakRange.to.slice(5)}）` : ''}`));
  out.push(line(`  活跃天数 ${contributions.activeDays}/${contributions.days.length} · 日均 ${contributions.averagePerDay}（活跃日均 ${contributions.averagePerActiveDay}）`));
  if (contributions.busiestDay) out.push(line(`  最活跃一天 ${contributions.busiestDay.date}（${contributions.busiestDay.count} 次）`));
  if (contributions.byType.commits !== null) {
    const byType = contributions.byType;
    out.push(line(`  按类型    提交 ${formatNumber(byType.commits || 0)} · PR ${formatNumber(byType.pullRequests || 0)} · Issue ${formatNumber(byType.issues || 0)} · 评审 ${formatNumber(byType.reviews || 0)}`));
  }
  const maxMonth = Math.max(...contributions.months.map((month) => month.count), 1);
  out.push('  月度分布（近 12 个月）');
  for (const month of contributions.months) {
    out.push(line(`    ${month.month}  ${bar((month.count / maxMonth) * 100, 14)} ${formatNumber(month.count)}`));
  }
  const maxWeekday = Math.max(...contributions.weekdays.map((weekday) => weekday.count), 1);
  out.push('  星期分布');
  for (const weekday of contributions.weekdays) {
    out.push(line(`    ${weekday.weekday}  ${bar((weekday.count / maxWeekday) * 100, 14)} ${formatNumber(weekday.count)}`));
  }
  out.push(line());

  if (activity) {
    out.push(`【近期动态】（公开事件流，覆盖约 ${activity.windowDays} 天，${activity.fetchedEvents} 条${activity.truncated ? '，已达 GitHub 300 条上限' : ''}）`);
    out.push(line(`  推送 ${activity.commitsPushed} 次提交 · 开 PR ${activity.pullRequestsOpened}（合并 ${activity.pullRequestsMerged}）· 评审 ${activity.reviewsWritten} · 开 Issue ${activity.issuesOpened}`));
    out.push(line(`  Star ${activity.reposStarred} · Fork ${activity.reposForked} · 新建仓库 ${activity.reposCreated} · 发布 Release ${activity.releasesPublished}`));
    if (activity.topActiveRepos.length > 0) {
      out.push(line(`  最活跃仓库 ${activity.topActiveRepos.map((repo) => `${repo.name}(${repo.events})`).join('、')}`));
    }
    if (activity.contributedTo.length > 0) {
      out.push(line(`  参与的外部仓库 ${activity.contributedTo.length} 个：${activity.contributedTo.slice(0, 8).join('、')}${activity.contributedTo.length > 8 ? ' …' : ''}`));
    }
    out.push(line());
  }

  out.push(`【Top 仓库】（按 Star，共 ${repoMeta.total ?? repoMeta.scanned} 个公开仓库，已扫描 ${repoMeta.scanned}${repoMeta.truncated ? '，未扫全' : ''}）`);
  for (const repo of detail.repositories.slice(0, 8)) {
    const tags = [repo.primaryLanguage, repo.isFork ? 'fork' : null, repo.isArchived ? 'archived' : null, repo.license].filter(Boolean).join(' · ');
    out.push(line(`  ★${String(repo.stars).padStart(6)}  ${repo.fullName}${tags ? `  [${tags}]` : ''}`));
    if (repo.description) out.push(line(`          ${repo.description.slice(0, 72)}`));
  }
  if (detail.gists.length > 0) {
    out.push(line());
    out.push(`【Gists】（前 ${detail.gists.length} 个${counts.sources.gists === 'rest' ? '，未认证分页计数' : ''}）`);
    for (const gist of detail.gists.slice(0, 5)) {
      out.push(line(`  · ${gist.description || '(无描述)'}  ${gist.files} 个文件${gist.isPublic ? '' : ' · 私密'}`));
    }
  }
  if (meta.errors.length > 0) {
    out.push(line());
    out.push('【抓取警告】');
    for (const error of meta.errors) {
      out.push(line(`  · ${error.source}: ${error.message}`));
    }
  }
  out.push(line());
  out.push('  card 字段为本项目 UserStats 结构，可直接渲染 /api/card 图表');
  return out.join('\n');
}

// ---------------------------------------------------------------- 主流程 ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE.trim());
    return;
  }

  const token = args.token || process.env.GITHUB_TOKEN || undefined;
  if (!token) {
    console.error('提示：未配置 GITHUB_TOKEN，将使用 REST + HTML 混合模式（额度 60 次/小时，数据仍相当完整）。');
    console.error('配置 Token 后走 GraphQL 模式，更快、更全、额度 5000 次/小时。\n');
  }

  const detail = await crawlUser(args.username, {
    token,
    apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
    reposScanLimit: args.repos,
    deepLanguages: args.deepLanguages,
    deepLanguagesCoverage: args.deepCoverage,
    deepLanguagesMinRepos: args.deepMinRepos,
    includeSearch: args.search,
    includeEvents: args.events,
    includeHtml: args.html,
    includeMisc: args.misc,
    cachePath: nodePath.join(args.out, '.cache', 'etags.json'),
    onProgress: (message) => {
      if (!args.quiet) console.error(`· ${message}`);
    },
    verbose: args.verbose,
  });

  fs.mkdirSync(args.out, { recursive: true });
  const outputFile = nodePath.join(args.out, `${args.username}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(detail, null, 2));

  if (!args.quiet) {
    console.log(renderSummary(detail));
    console.log(`\n已保存: ${outputFile}`);
  } else {
    console.log(outputFile);
  }
}

main().catch((error: unknown) => {
  console.error(`\n抓取失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
