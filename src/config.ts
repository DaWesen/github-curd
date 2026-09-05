import type { AppConfig } from './types';

const DEFAULT_PORT = 3000;

function parsePort(value: string | undefined): number {
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    githubToken: env.GITHUB_TOKEN || '',
    githubApiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    defaultUsername: (env.DEFAULT_USERNAME || '').trim(),
  };
}