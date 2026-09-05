import 'dotenv/config';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

// 无 Token 时爬虫要完整跑一轮 REST+Search+HTML（自带限速），给函数放宽执行时限；
// 各套餐上限不同，Vercel 会自动取当前套餐允许的最大值
export const maxDuration = 60;

export default createApp({ config: loadConfig() });
