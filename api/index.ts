// 诊断模式 v2：流式输出每个初始化步骤 + 进程级异常钩子。
// 任何 JS 层崩溃（含 uncaughtException / unhandledRejection）都会以文本写回响应；
// 若浏览器显示 ERR_EMPTY_RESPONSE 则为原生层硬崩溃（进程被直接杀死）。
let current: { end(chunk?: string): void; write(chunk: string): boolean } | null = null;

process.on('uncaughtException', (e) => {
  try { current?.end('\n[uncaughtException] ' + (e?.stack ?? String(e))); } catch { /* 忽略 */ }
});
process.on('unhandledRejection', (e) => {
  try { current?.end('\n[unhandledRejection] ' + String(e)); } catch { /* 忽略 */ }
});

export const maxDuration = 60;

export default async function handler(req: import('express').Request, res: import('express').Response) {
  current = res as unknown as { end(chunk?: string): void; write(chunk: string): boolean };
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  const log = (s: string) => { try { res.write(s + '\n'); } catch { /* 连接已断 */ } };

  log('probe start | node ' + process.version + ' | region ' + (process.env.VERCEL_REGION ?? '?') + ' | mem ' + Math.round(process.memoryUsage().rss / 1048576) + 'MB');

  try {
    log('step1: import src/config');
    const { loadConfig } = await import('../src/config');
    loadConfig();
    log('step1 ok');

    log('step2: import src/card（含 3.3MB 底图模块）');
    const card = await import('../src/card');
    log('step2 ok, exports: ' + Object.keys(card).join(','));

    log('step3: 用最小假数据实际渲染一张卡');
    const fake = {
      profile: { login: 'probe', name: 'probe', avatarUrl: '', htmlUrl: '', bio: null, email: null, location: null, company: null, website: null, joinedAt: '2020-01-01T00:00:00Z' },
      stats: { publicRepositories: 1, followers: 1, following: 1, stars: 1, forks: 1, starsGiven: 1, pullRequests: 1, reviews: 1, issues: 1, contributedTo: 1, rating: 50, contributionsLastYear: 50, contributionFrequency: 1, currentStreak: 1, longestStreak: 1 },
      repositories: [], languages: [{ name: 'TypeScript', percentage: 100 }],
      contributionWeeks: Array.from({ length: 53 }, (_, i) => ({ label: 'w' + i, contributions: 3 })),
      contributionDays: Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2025, 8, 12) + i * 86400000).toISOString().slice(0, 10), contributions: 1 })),
    } as unknown as import('../src/types').UserStats;
    const svg = card.renderStatsCard(fake, 'polar-starlight', { font: 'sans' });
    log('step3 ok, svg ' + (svg.length / 1024).toFixed(0) + 'KB');

    log('step4: import src/crawler/crawler');
    await import('../src/crawler/crawler');
    log('step4 ok');

    log('step5: import src/app + createApp');
    const { createApp } = await import('../src/app');
    const app = createApp({ config: loadConfig() });
    log('step5 ok — 全部初始化通过，交还真实应用');

    current = null;
    app(req, res);
  } catch (error) {
    const e = error as Error;
    log('FAILED @ ' + (e?.message ?? String(e)));
    log(e?.stack ? e.stack.split('\n').slice(0, 10).join('\n') : '');
    res.end('\n[diagnostic] 初始化在上述步骤失败');
  }
}
