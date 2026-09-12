// 最小探针：零导入、零逻辑，仅验证 Vercel 函数本身能否运行
export default async function handler(req: unknown, res: { statusCode: number; setHeader(k: string, v: string): void; end(s: string): void }) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('minimal probe v3 ok | node ' + process.version);
}
