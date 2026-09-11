import 'dotenv/config';
import { loadConfig } from '../src/config';

export const maxDuration = 60;

type AppType = ReturnType<typeof import('../src/app').createApp>;

// 模块初始化改为懒加载 + 错误自暴露：初始化失败时把真实错误以 JSON 返回，
// 浏览器直接可见，不用去 Vercel 后台翻运行日志
let appPromise: Promise<AppType> | null = null;

function loadApp(): Promise<AppType> {
  if (!appPromise) {
    appPromise = import('../src/app')
      .then(({ createApp }) => createApp({ config: loadConfig() }))
      .catch((error) => {
        appPromise = null;
        throw error;
      });
  }
  return appPromise;
}

export default async function handler(req: import('express').Request, res: import('express').Response) {
  let app: AppType;
  try {
    app = await loadApp();
  } catch (error) {
    const e = error as Error;
    res.status(500).json({
      error: 'Function init failed',
      message: e?.message ?? String(e),
      stack: e?.stack ? e.stack.split('\n').slice(0, 10) : undefined,
      node: process.version,
      region: process.env.VERCEL_REGION ?? null,
    });
    return;
  }
  app(req, res);
}
