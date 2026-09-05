// 与数据来源无关的指标计算：贡献聚合 + 综合评级。
// 服务端卡片渲染与 src/crawler 爬虫共用这里的公式，保证两处口径一致。

export interface ContributionDay {
  date: string;
  contributions: number;
}

// 连击从最新一天往前数连续非零天数；今天还没提交不应清零连击，跳过末尾“今天且为 0”
export function computeCurrentStreak(days: Array<{ date: string; contributions: number }>): number {
  const today = new Date().toISOString().slice(0, 10);
  const ordered = [...days].filter((day) => day.date <= today).sort((left, right) => left.date.localeCompare(right.date));
  let start = ordered.length - 1;
  if (start >= 0 && ordered[start].date === today && ordered[start].contributions === 0) start -= 1;
  let streak = 0;
  for (let index = start; index >= 0 && ordered[index].contributions > 0; index -= 1) streak += 1;
  return streak;
}

export function summarizeContributions(days: ContributionDay[]) {
  const today = new Date().toISOString().slice(0, 10);
  const normalizedDays = days
    .filter((day) => day.date <= today)
    .sort((left, right) => left.date.localeCompare(right.date));
  const contributionWeeks = normalizedDays.reduce<Array<{ label: string; contributions: number }>>((weeks, day, index) => {
    const weekIndex = Math.floor(index / 7);
    if (!weeks[weekIndex]) weeks[weekIndex] = { label: day.date.slice(5), contributions: 0 };
    weeks[weekIndex].contributions += day.contributions;
    return weeks;
  }, []).slice(-52);
  let longestStreak = 0;
  let runningStreak = 0;
  for (const day of normalizedDays) {
    runningStreak = day.contributions > 0 ? runningStreak + 1 : 0;
    longestStreak = Math.max(longestStreak, runningStreak);
  }
  const total = normalizedDays.reduce((sum, day) => sum + day.contributions, 0);
  return {
    contributionWeeks,
    contributionDays: normalizedDays,
    contributionsLastYear: total,
    contributionFrequency: Math.round(total / 52),
    currentStreak: computeCurrentStreak(normalizedDays),
    longestStreak,
  };
}

// 评级输入
export interface RatingInput {
  contributions: number;
  followers: number;
  stars: number;
  pullRequests: number;
  issues: number;
  publicRepositories: number;
  longestStreak: number;
}

// 对数归一化：数值越大，每多一分越难（如 100 -> 0.36, 1000 -> 0.56, 10000 -> 0.73）
function logScore(value: number, scale: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log10(1 + value) / Math.log10(1 + scale));
}

// 各维度权重（满分 100）
// 贡献 40 + Star 25 + PR/Issue 15 + Followers 10 + 仓库数 5 + 连击 5
export function computeRating(input: RatingInput): number {
  const contributionScore = logScore(input.contributions, 3000) * 40;
  const starScore = logScore(input.stars, 500) * 25;
  const prIssueScore = logScore(input.pullRequests + input.issues, 200) * 15;
  const followerScore = logScore(input.followers, 300) * 10;
  const repoScore = logScore(input.publicRepositories, 60) * 5;
  const streakScore = Math.min(input.longestStreak / 60, 1) * 5;
  return Math.round(
    contributionScore + starScore + prIssueScore + followerScore + repoScore + streakScore,
  );
}
