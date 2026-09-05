// 头像拉取：把 GitHub 头像下载成 data URI 供卡片内嵌（GitHub README 里的 SVG 不能引外链图）。
// 失败永不抛错——卡片宁可没有头像也不能渲染失败；正/负结果分别缓存，避免每个请求都打一次 CDN。
const AVATAR_CACHE_TTL = 60 * 60 * 1000;
const AVATAR_FAILURE_TTL = 5 * 60 * 1000;
const AVATAR_TIMEOUT_MS = 5000;
// 小于该字节数基本是错误页/空响应而非头像
const AVATAR_MIN_BYTES = 64;

const avatarCache = new Map<string, { value: string | null; expires: number }>();

// GitHub 头像只可能是这几种格式，按魔数识别；识别不出当作失败处理
function sniffImageMime(buffer: Buffer): string {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buffer.length > 4 && buffer.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return '';
}

export async function fetchAvatarDataUri(url: string): Promise<string | undefined> {
  if (!url.startsWith('https://')) return undefined;
  const now = Date.now();
  const cached = avatarCache.get(url);
  if (cached && cached.expires > now) return cached.value ?? undefined;
  try {
    const sized = `${url}${url.includes('?') ? '&' : '?'}size=256`;
    const response = await fetch(sized, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`avatar HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = sniffImageMime(buffer);
    if (!mime || buffer.length < AVATAR_MIN_BYTES) throw new Error('avatar is not a recognizable image');
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    avatarCache.set(url, { value: dataUri, expires: now + AVATAR_CACHE_TTL });
    return dataUri;
  } catch {
    avatarCache.set(url, { value: null, expires: now + AVATAR_FAILURE_TTL });
    return undefined;
  }
}
