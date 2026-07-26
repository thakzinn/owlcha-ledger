/**
 * Session policy ตาม ADR-001 D8:
 * - idle 12 ชม. (session.maxAge ของ Auth.js)
 * - absolute cap 5 วันนับจากเวลาล็อกอินจริง (authTime ใน JWT) — บังคับทั้งใน
 *   src/proxy.ts และ src/lib/guard.ts เสมอ ห้ามพึ่งชั้นเดียว
 */
export const IDLE_MAX_SEC = 43_200; // 12 ชั่วโมง

const HARD_ABSOLUTE_MAX_SEC = 432_000; // 5 วัน — เพดานเด็ดขาด ห้ามเกินนี้ทุกกรณี

/**
 * เพดานอายุ session เด็ดขาด — SESSION_ABSOLUTE_MAX_SEC เป็น test hook สำหรับ
 * dev เท่านั้น (เช่นตั้ง 120 เพื่อทดสอบ M1) และถูก clamp สองชั้น:
 * ใช้ได้เฉพาะนอก production + Math.min กับ 5 วันเสมอ → override ได้แค่ "สั้นลง"
 */
export function absoluteMaxSec(): number {
  const raw = process.env.SESSION_ABSOLUTE_MAX_SEC;
  if (!raw || process.env.NODE_ENV === "production") return HARD_ABSOLUTE_MAX_SEC;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return HARD_ABSOLUTE_MAX_SEC;
  return Math.min(Math.floor(n), HARD_ABSOLUTE_MAX_SEC);
}
