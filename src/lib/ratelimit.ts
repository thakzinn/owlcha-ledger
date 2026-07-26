/**
 * Rate limit แบบ in-memory (sliding window)
 *
 * ⚠️ best-effort เท่านั้น — ไม่ทำงานข้าม instance บน Vercel serverless
 * (แต่ละ invocation อาจอยู่คนละ instance และรีเซ็ตทุก cold start)
 * อย่าไว้ใจเป็นด่านความปลอดภัย — ด่านจริงคือ auth + allowlist ใน guard.ts
 * (Accepted Risk R-8 ใน ADR-001)
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
