import * as cheerio from 'cheerio';

/**
 * GitHub 公开页面的 HTML / 内嵌 JSON 解析器。
 * GitHub 近年在资料页、仓库列表页、贡献页大量改用 React + 内嵌 JSON 载荷，
 * 因此解析策略是「先挖内嵌 JSON（最完整、最稳定），再用 DOM 结构兜底」。
 */

// ------------------------------------------------------------- 基础工具 ---

/** 解析 GitHub 页面上的"人类可读"数字：'1.2k' -> 1200，'1,234' -> 1234，'3.4m' -> 3400000 */
export function parseHumanNumber(text: string | undefined | null): number | null {
  if (!text) return null;
  const normalized = text.replace(/,/g, '').trim();
  const match = normalized.match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  const suffix = match[2].toLowerCase();
  if (suffix === 'k') return Math.round(value * 1000);
  if (suffix === 'm') return Math.round(value * 1_000_000);
  return Math.round(value);
}

/** 从页面里提取所有 <script type="application/json"> 内嵌载荷（react-app.embeddedData 等） */
export function extractEmbeddedPayloads(html: string): unknown[] {
  const payloads: unknown[] = [];
  const pattern = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    try {
      payloads.push(JSON.parse(match[1]));
    } catch {
      // 个别 script 不是合法 JSON，跳过
    }
  }
  return payloads;
}

/** 在任意嵌套的 JSON 结构里做 BFS，找第一个满足条件的对象 */
export function deepFind<T = Record<string, unknown>>(
  node: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
  maxDepth = 12,
): T | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: node, depth: 0 }];
  while (queue.length > 0) {
    const { value, depth } = queue.shift() as { value: unknown; depth: number };
    if (depth > maxDepth) continue;
    if (Array.isArray(value)) {
      for (const item of value) queue.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (predicate(object)) return object as T;
      for (const child of Object.values(object)) queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function cleanText(value: string | undefined): string | null {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

// -------------------------------------------------------------- 资料页 ---

export interface HtmlProfile {
  login: string | null;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  company: string | null;
  email: string | null;
  website: string | null;
  twitter: string | null;
  joinedAt: string | null;
  type: 'User' | 'Organization' | null;
  followers: number | null;
  following: number | null;
  stars: number | null;
  orgs: Array<{ login: string; avatarUrl: string }>;
  pinned: Array<{ name: string; url: string; description: string | null; language: string | null; stars: number | null }>;
  achievements: string[];
  highlights: string[];
}

/** 解析 https://github.com/{username} 个人主页 */
export function parseProfilePage(html: string): HtmlProfile {
  const $ = cheerio.load(html);
  const profile: HtmlProfile = {
    login: cleanText($('.p-nickname.vcard-username').first().text()),
    name: cleanText($('.vcard-fullname').first().text()),
    bio: cleanText($('.user-profile-bio').first().text() || $('.p-note').first().text()),
    avatarUrl: $('img.avatar-user').first().attr('src') || null,
    location: cleanText($('[itemprop="homeLocation"]').first().text()),
    company: cleanText($('[itemprop="worksFor"]').first().text()),
    email: cleanText($('a[href^="mailto:"]').first().text()),
    website: null,
    twitter: null,
    joinedAt: $('[itemprop="joined"] relative-time').first().attr('datetime') || null,
    type: null,
    followers: null,
    following: null,
    stars: null,
    orgs: [],
    pinned: [],
    achievements: [],
    highlights: [],
  };

  // 主页链接：itemprop=url 里有多个链接，取第一个非 github.com 的
  $('[itemprop="url"] a[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    if (!profile.website && /^https?:\/\//.test(href) && !href.includes('github.com')) profile.website = href;
  });

  // Twitter / X
  $('a[href^="https://twitter.com/"], a[href^="https://x.com/"]').each((_, element) => {
    const href = $(element).attr('href') || '';
    if (!profile.twitter && /^https:\/\/(twitter|x)\.com\/[^/]+/.test(href)) profile.twitter = href;
  });

  // 组织类型判定：Organization 页面没有 p-nickname，hovercard 标记为 organization
  if (!profile.login && $('[data-hovercard-type="organization"]').length > 0) profile.type = 'Organization';
  else if (profile.login) profile.type = 'User';

  // 关注者 / 关注中 / 获得 Star（页面计数是 "1.2k followers" 这类缩写）
  const counterText = (tab: string): number | null => {
    const anchor = $(`a[href$="tab=${tab}"]`).first();
    if (anchor.length === 0) return null;
    return parseHumanNumber(anchor.find('.text-bold').first().text() || anchor.text().match(/[\d,.]+[kKmM]?/)?.[0]);
  };
  profile.followers = counterText('followers');
  profile.following = counterText('following');
  profile.stars = counterText('stars');

  // 公开组织
  $('a[data-hovercard-type="organization"], .avatar-group-item a[data-hovercard-type="organization"]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const login = href.replace(/^\//, '').split('/')[0];
    if (!login || profile.orgs.some((org) => org.login === login)) return;
    profile.orgs.push({ login, avatarUrl: $(element).find('img').attr('src') || '' });
  });

  // 置顶仓库（DOM 兜底；新版页面可能由 React 渲染，此时走 extractPinnedFromPayloads）
  $('li.pinned-item-list-item').each((_, element) => {
    const item = $(element);
    const name = cleanText(item.find('.repo, span[itemprop="name"]').first().text());
    const link = item.find('a').first().attr('href') || '';
    if (!name || !link) return;
    profile.pinned.push({
      name,
      url: link.startsWith('http') ? link : `https://github.com${link}`,
      description: cleanText(item.find('p.pinned-item-desc').first().text()),
      language: cleanText(item.find('span[itemprop="programmingLanguage"]').first().text()),
      stars: parseHumanNumber(item.find('a[href$="/stargazers"]').first().text()),
    });
  });

  // 成就徽章：img.achievement-badge-sidebar 的 alt 形如 "Achievement: Pull Shark"，同级的 tier 标签形如 "x2"。
  // 页面在桌面/移动端各渲染一份成就区，按基础名去重
  const seenAchievements = new Set<string>();
  $('img.achievement-badge-sidebar, img[data-hovercard-type="achievement"]').each((_, element) => {
    const image = $(element);
    const name = (image.attr('alt') || '').replace(/^Achievement:\s*/i, '').trim();
    if (!name || seenAchievements.has(name)) return;
    seenAchievements.add(name);
    const tierText = cleanText(image.siblings('.achievement-tier-label').first().text());
    const tierCount = tierText ? Number(tierText.replace(/^x/i, '')) : NaN;
    profile.achievements.push(Number.isInteger(tierCount) && tierCount > 1 ? `${name} ×${tierCount}` : name);
  });

  return profile;
}

/** 从个人主页的内嵌 JSON 载荷里补齐 pinned / 关注计数（DOM 拿不到时用） */
export function extractProfileFromPayloads(html: string): Partial<HtmlProfile> {
  const result: Partial<HtmlProfile> = {};
  const payloads = extractEmbeddedPayloads(html);

  const userNode = deepFind<Record<string, unknown>>(payloads, (node) => typeof node.login === 'string' && (node.followers !== undefined || node.following !== undefined));
  if (userNode) {
    if (typeof userNode.followers === 'number') result.followers = userNode.followers;
    if (typeof userNode.following === 'number') result.following = userNode.following;
  }

  const pinnedContainer = deepFind<Record<string, unknown>>(payloads, (node) => Array.isArray(node.pinnedItems) || Array.isArray(node.pinned));
  const pinnedList = (pinnedContainer?.pinnedItems || pinnedContainer?.pinned) as unknown;
  if (Array.isArray(pinnedList)) {
    const pinned: HtmlProfile['pinned'] = [];
    for (const item of pinnedList) {
      const repo = deepFind<Record<string, unknown>>(item, (node) => typeof node.name === 'string' && (node.owner !== undefined || node.stargazerCount !== undefined), 6);
      if (!repo || typeof repo.name !== 'string') continue;
      const owner = repo.owner as Record<string, unknown> | undefined;
      const ownerLogin = typeof owner?.login === 'string' ? owner.login : null;
      pinned.push({
        name: repo.name,
        url: ownerLogin ? `https://github.com/${ownerLogin}/${repo.name}` : `https://github.com/${repo.name}`,
        description: typeof repo.description === 'string' ? repo.description : null,
        language: (repo.primaryLanguage as { name?: string } | undefined)?.name || null,
        stars: typeof repo.stargazerCount === 'number' ? repo.stargazerCount : null,
      });
      if (pinned.length >= 6) break;
    }
    if (pinned.length > 0) result.pinned = pinned;
  }

  return result;
}

// ------------------------------------------------------------ 仓库列表 ---

export interface HtmlRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  primaryLanguage: string | null;
  stars: number;
  forks: number;
  openIssues: number | null;
  isFork: boolean;
  isArchived: boolean;
  topics: string[];
  updatedAt: string | null;
}

export interface HtmlRepoList {
  repos: HtmlRepo[];
  total: number | null;
  hasNextPage: boolean;
}

/** 解析 https://github.com/{username}?tab=repositories&page=N 单页 */
export function parseReposPage(html: string, username: string): HtmlRepoList {
  const $ = cheerio.load(html);
  const repos: HtmlRepo[] = [];

  $('li[itemprop="owns"]').each((_, element) => {
    const item = $(element);
    const link = item.find('a[itemprop="name codeRepository"]').first();
    const name = cleanText(link.text());
    if (!name) return;
    const href = link.attr('href') || `/${username}/${name}`;
    const itemText = item.text();
    repos.push({
      name,
      fullName: `${username}/${name}`,
      url: href.startsWith('http') ? href : `https://github.com${href}`,
      description: cleanText(item.find('p[itemprop="description"]').first().text()),
      primaryLanguage: cleanText(item.find('span[itemprop="programmingLanguage"]').first().text()),
      stars: parseHumanNumber(item.find('a[href$="/stargazers"]').first().text()) || 0,
      forks: parseHumanNumber(item.find('a[href$="/forks"]').first().text()) || 0,
      openIssues: parseHumanNumber(item.find('a[href$="/issues"]').first().text()),
      isFork: item.find('.octicon-repo-forked').length > 0 || /forked from/i.test(itemText),
      isArchived: /public archive|private archive/i.test(item.find('.Label').first().text()),
      topics: item.find('a.topic-tag').map((__, topic) => cleanText($(topic).text()) || '').get().filter(Boolean),
      updatedAt: item.find('relative-time').last().attr('datetime') || null,
    });
  });

  const totalMatch = html.match(/([\d,]+)\s+public repositor/i);
  const hasNextPage = $('a.next_page').length > 0 && !$('a.next_page').hasClass('disabled');

  return {
    repos,
    total: totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null,
    hasNextPage,
  };
}

// ------------------------------------------------------------- 贡献页 ---

export interface HtmlContributionDay {
  date: string;
  count: number;
  level: number | null;
}

export interface HtmlContributions {
  days: HtmlContributionDay[];
  total: number | null;
  source: 'embedded-json' | 'dom';
}

/** 解析 https://github.com/users/{username}/contributions 全年贡献日历 */
export function parseContributionsPage(html: string): HtmlContributions {
  // 1) 优先挖 react-app.embeddedData 里的 contributionCalendar（最完整，带贡献等级）
  const payloads = extractEmbeddedPayloads(html);
  const calendar = deepFind<Record<string, unknown>>(payloads, (node) => typeof node.contributionCalendar === 'object' && node.contributionCalendar !== null, 8);
  const calendarNode = (calendar?.contributionCalendar ?? null) as Record<string, unknown> | null;
  if (calendarNode && Array.isArray(calendarNode.weeks)) {
    const days: HtmlContributionDay[] = [];
    for (const week of calendarNode.weeks as Array<Record<string, unknown>>) {
      if (!Array.isArray(week.contributionDays)) continue;
      for (const day of week.contributionDays as Array<Record<string, unknown>>) {
        if (typeof day.date !== 'string') continue;
        days.push({
          date: day.date,
          count: typeof day.contributionCount === 'number' ? day.contributionCount : 0,
          level: typeof day.contributionLevel === 'string' ? levelToNumber(day.contributionLevel) : null,
        });
      }
    }
    if (days.length > 0) {
      return {
        days,
        total: typeof calendarNode.totalContributions === 'number' ? calendarNode.totalContributions : days.reduce((sum, day) => sum + day.count, 0),
        source: 'embedded-json',
      };
    }
  }

  // 2) DOM 兜底：<td class="ContributionCalendar-day" id="..." data-date="...">，
  //    每个单元格的数量在同页面 <tool-tip for="单元格id">N contributions on ...</tool-tip> 里
  const $ = cheerio.load(html);
  const tooltipTextById = new Map<string, string>();
  $('tool-tip[for]').each((_, element) => {
    const forId = $(element).attr('for');
    const text = $(element).text().trim();
    if (forId && text) tooltipTextById.set(forId, text);
  });

  const days: HtmlContributionDay[] = [];
  const cells = $('td.ContributionCalendar-day[data-date]').length > 0 ? $('td.ContributionCalendar-day[data-date]') : $('td[data-date]');
  cells.each((_, element) => {
    const cell = $(element);
    const date = cell.attr('data-date');
    if (!date) return;
    const label = tooltipTextById.get(cell.attr('id') || '') || cell.attr('aria-label') || '';
    const countMatch = label.match(/(\d+)\s+contribution/i);
    days.push({
      date,
      count: countMatch ? Number(countMatch[1]) : 0,
      level: Number(cell.attr('data-level') || 0),
    });
  });
  if (days.length === 0) return { days: [], total: null, source: 'dom' };

  const totalMatch = html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i);
  return {
    days,
    total: totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : days.reduce((sum, day) => sum + day.count, 0),
    source: 'dom',
  };
}

/** GraphQL 贡献等级（NONE/FIRST_QUARTILE/...）映射成 0-4 */
function levelToNumber(level: string): number {
  switch (level) {
    case 'FIRST_QUARTILE': return 1;
    case 'SECOND_QUARTILE': return 2;
    case 'THIRD_QUARTILE': return 3;
    case 'FOURTH_QUARTILE': return 4;
    default: return 0;
  }
}
