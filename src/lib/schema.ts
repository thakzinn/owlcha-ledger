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
  /** คอลัมน์ F: ยอดขายบนแอป (ก่อนหัก GP) — เฉพาะรายรับเดลิเวอรี (ADR §11.7) */
  gross: z
    .number()
    .finite()
    .min(0, "ยอดขายบนแอปต้องไม่ติดลบ")
    .max(99_999_999.99, "ยอดขายบนแอปเกินขอบเขตที่รองรับ")
    .refine(
      (a) => Math.abs(a * 100 - Math.round(a * 100)) < 1e-6,
      "ยอดขายบนแอปต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
    )
    .optional(),
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

/** query ของ GET /api/entries/range — ช่วงวันที่สำหรับหน้ารายงาน ภ.ง.ด.94 (ADR §11.8) */
export const rangeQuerySchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((r) => r.from <= r.to, "ช่วงวันที่ไม่ถูกต้อง (from ต้องไม่เกิน to)")
  .refine(
    (r) =>
      (new Date(`${r.to}T00:00:00Z`).getTime() -
        new Date(`${r.from}T00:00:00Z`).getTime()) /
        86_400_000 <=
      366,
    "ช่วงวันที่ต้องไม่เกิน 366 วัน",
  );

/** ~8MB ของ PNG จริง ≈ base64 ~11M ตัวอักษร */
export const notifySchema = z.object({
  date: dateSchema,
  imageBase64: z
    .string()
    .startsWith("data:image/png;base64,", "รูปต้องเป็น PNG แบบ data URL")
    .max(11_000_000, "รูปมีขนาดใหญ่เกินไป"),
});

// ---------- แท็บหมวดหมู่ค่าใช้จ่าย (/api/expense-categories) ----------

const trimmedName = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, `${label}ต้องไม่ว่าง`)
        .max(max, `${label}ยาวเกิน ${max} ตัวอักษร`),
    );

/** เพิ่ม mapping ใหม่ 1 แถว (POST) */
export const categoryMappingSchema = z.object({
  category: trimmedName(100, "ชื่อหมวดหมู่"),
  item: trimmedName(200, "ชื่อรายการ"),
  /** false = ไม่นับเป็นค่าใช้จ่าย (คอลัมน์ C = FALSE) */
  counted: z.boolean().optional().default(true),
  note: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(200, "หมายเหตุยาวเกิน 200 ตัวอักษร"))
    .optional()
    .default(""),
});

/** แก้ mapping ของรายการเดิม (PATCH) — ต้องส่ง field ที่จะแก้อย่างน้อย 1 อย่าง */
export const categoryPatchSchema = z
  .object({
    item: trimmedName(200, "ชื่อรายการ"),
    category: trimmedName(100, "ชื่อหมวดหมู่").optional(),
    counted: z.boolean().optional(),
    note: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().max(200, "หมายเหตุยาวเกิน 200 ตัวอักษร"))
      .optional(),
  })
  .refine(
    (p) => p.category !== undefined || p.counted !== undefined || p.note !== undefined,
    "ต้องระบุข้อมูลที่ต้องการแก้ไขอย่างน้อย 1 อย่าง",
  );

/** query ของ DELETE /api/expense-categories?item= */
export const categoryItemQuerySchema = z.object({
  item: trimmedName(200, "ชื่อรายการ"),
});

export type SaveEntriesInput = z.infer<typeof saveEntriesSchema>;
export type EntryInput = z.infer<typeof entrySchema>;
export type CategoryMappingInputBody = z.infer<typeof categoryMappingSchema>;
export type CategoryPatchInput = z.infer<typeof categoryPatchSchema>;
