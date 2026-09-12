export const maxDuration = 60;

// 诊断模式（二分探针）：初始化拆成 5 步逐步执行，任何一步失败都以 JSON 标明失败的步骤；
// 全部通过则把本次请求交还给真实应用。定位完成后恢复正常的静态导入版本。
const steps: Record<string, string> = {};

export default async function handler(req: import('express').Request, res: import('express').Response) {
  try {
    steps['0.node'] = process.version + ' @ ' + (process.env.VERCEL_REGION ?? 'local');

    const { loadConfig } = await import('../src/config');
    loadConfig();
    steps['1.config'] = 'ok';

    await import('../src/card');
    steps['2.card-import(含3.3MB底图)'] = 'ok';

    await import('../src/crawler/crawler');
    steps['3.crawler-import'] = 'ok';

    const { createApp } = await import('../src/app');
    steps['4.app-import(express)'] = 'ok';

    const app = createApp({ config: loadConfig() });
    steps['5.app-create'] = 'ok';

    // 全部通过 → 交还给真实应用处理本次请求
    app(req, res);
  } catch (error) {
    const e = error as Error;
    res.status(500).json({
      diagnostic: true,
      steps,
      failed: e?.message ?? String(e),
      stack: e?.stack ? e.stack.split('\n').slice(0, 8) : undefined,
    });
  }
}
