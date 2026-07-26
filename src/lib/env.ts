import { z } from "zod";

/**
 * ตรวจ environment variables ทั้งหมดตอนแอปเริ่มทำงาน (เรียกจาก instrumentation.ts)
 * ขาดตัวใด → ล้มทันทีพร้อม "ชื่อ" คีย์ที่ขาด — ห้าม log ค่าของคีย์ใด ๆ เด็ดขาด
 */
const envSchema = z.object({
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  ALLOWED_EMAILS: z.string().min(1),
  SHEET_ID: z.string().min(1),
  SHEET_NAME: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  NEXT_PUBLIC_APP_TZ: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
  throw new Error(
    `ตั้งค่า environment variables ไม่ครบ — ขาด: ${missing.join(", ")} (ดูรายชื่อคีย์ทั้งหมดใน .env.example)`,
  );
}

export const env = parsed.data;

export const allowedEmails = (): Set<string> =>
  new Set(
    env.ALLOWED_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
