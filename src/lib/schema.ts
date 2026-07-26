import { z } from "zod";
import { DATE_RE, isValidDateStr } from "@/lib/date";

/** zod schemas — ตรวจ input ทุกจุดที่รับจากภายนอก (API contract ข้อ 6) */

export const dateSchema = z
  .string()
  .regex(DATE_RE, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD")
  .refine(isValidDateStr, "วันที่ไม่ถูกต้อง");

/** จำนวนเงินมีเครื่องหมาย (คอลัมน์ D): ทศนิยมไม่เกิน 2 ตำแหน่ง */
export const amountSchema = z
  .number()
  .finite()
  .refine(
    (a) => Math.abs(a * 100 - Math.round(a * 100)) < 1e-6,
    "จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
  )
  .refine((a) => Math.abs(a) <= 99_999_999.99, "จำนวนเงินเกินขอบเขตที่รองรับ");

export const entrySchema = z.object({
  description: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(200, "คำอธิบายยาวเกิน 200 ตัวอักษร")),
  amount: amountSchema,
  channel: z.enum(["เงินสด", "โอน"]),
});

export const saveEntriesSchema = z.object({
  date: dateSchema,
  entries: z
    .array(entrySchema)
    .min(1, "ต้องมีอย่างน้อย 1 รายการ")
    .max(100, "บันทึกได้ไม่เกิน 100 รายการต่อครั้ง"),
  /** SHA-256 hex ของข้อมูลวันนั้นตอนผู้ใช้โหลด — ใช้ตรวจ conflict */
  baseVersion: z.string().regex(/^[0-9a-f]{64}$/, "baseVersion ไม่ถูกต้อง"),
});

/** ~8MB ของ PNG จริง ≈ base64 ~11M ตัวอักษร */
export const notifySchema = z.object({
  date: dateSchema,
  imageBase64: z
    .string()
    .startsWith("data:image/png;base64,", "รูปต้องเป็น PNG แบบ data URL")
    .max(11_000_000, "รูปมีขนาดใหญ่เกินไป"),
});

export type SaveEntriesInput = z.infer<typeof saveEntriesSchema>;
export type EntryInput = z.infer<typeof entrySchema>;
