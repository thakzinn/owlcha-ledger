import { describe, expect, it } from "vitest";
import {
  dateSchema,
  entrySchema,
  saveEntriesSchema,
  notifySchema,
  rangeQuerySchema,
} from "@/lib/schema";
import { typeFromAmount, toSignedAmount } from "@/lib/entries";

const entry = { description: "ชาไข่มุก", amount: -55.5, channel: "เงินสด" as const };

describe("dateSchema", () => {
  it("รับเฉพาะ YYYY-MM-DD ที่เป็นวันจริง", () => {
    expect(dateSchema.safeParse("2026-07-26").success).toBe(true);
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateSchema.safeParse("26-07-2026").success).toBe(false);
    expect(dateSchema.safeParse("2026-07-26T00:00").success).toBe(false);
  });
});

describe("entrySchema", () => {
  it("amount ทศนิยม ≤2 ตำแหน่ง", () => {
    expect(entrySchema.safeParse({ ...entry, amount: -55.55 }).success).toBe(true);
    expect(entrySchema.safeParse({ ...entry, amount: -55.555 }).success).toBe(false);
    // float noise ของ 0.30 (0.1+0.2 = 0.30000000000000004) ต้องถูกยอมรับ ไม่ใช่ reject
    expect(entrySchema.safeParse({ ...entry, amount: 0.1 + 0.2 }).success).toBe(true);
  });
  it("description ถูก trim และจำกัด 200 ตัวอักษร", () => {
    const r = entrySchema.safeParse({ ...entry, description: "  ชา  " });
    expect(r.success && r.data.description).toBe("ชา");
    expect(entrySchema.safeParse({ ...entry, description: "ก".repeat(201) }).success).toBe(false);
  });
  it("channel รับเฉพาะ เงินสด/โอน", () => {
    expect(entrySchema.safeParse({ ...entry, channel: "บัตร" }).success).toBe(false);
  });
});

describe("saveEntriesSchema", () => {
  const base = {
    date: "2026-07-26",
    entries: [entry],
    baseVersion: "a".repeat(64),
  };
  it("ครบถ้วน → ผ่าน", () => {
    expect(saveEntriesSchema.safeParse(base).success).toBe(true);
  });
  it("จำกัด ≤100 รายการ (กัน payload ระเบิด)", () => {
    expect(
      saveEntriesSchema.safeParse({ ...base, entries: Array(101).fill(entry) }).success,
    ).toBe(false);
    expect(saveEntriesSchema.safeParse({ ...base, entries: [] }).success).toBe(false);
  });
  it("baseVersion ต้องเป็น sha256 hex", () => {
    expect(saveEntriesSchema.safeParse({ ...base, baseVersion: "xyz" }).success).toBe(false);
  });
});

describe("rangeQuerySchema (GET /api/entries/range — ADR §11.8)", () => {
  it("ช่วงถูกต้อง → ผ่าน (รวมวันเดียวกัน)", () => {
    expect(rangeQuerySchema.safeParse({ from: "2026-01-01", to: "2026-06-30" }).success).toBe(true);
    expect(rangeQuerySchema.safeParse({ from: "2026-01-01", to: "2026-01-01" }).success).toBe(true);
  });
  it("from > to → ไม่ผ่าน", () => {
    expect(rangeQuerySchema.safeParse({ from: "2026-06-30", to: "2026-01-01" }).success).toBe(false);
  });
  it("รูปแบบวันที่ผิด → ไม่ผ่าน", () => {
    expect(rangeQuerySchema.safeParse({ from: "01/01/2026", to: "2026-06-30" }).success).toBe(false);
    expect(rangeQuerySchema.safeParse({ from: "2026-02-30", to: "2026-06-30" }).success).toBe(false);
  });
  it("ช่วงเกิน 366 วัน → ไม่ผ่าน (ปีเต็มยังผ่าน)", () => {
    expect(rangeQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    expect(rangeQuerySchema.safeParse({ from: "2025-01-01", to: "2026-06-30" }).success).toBe(false);
  });
});

describe("notifySchema", () => {
  it("ต้องขึ้นต้น data:image/png;base64,", () => {
    expect(
      notifySchema.safeParse({ date: "2026-07-26", imageBase64: "data:image/png;base64,AAAA" })
        .success,
    ).toBe(true);
    expect(
      notifySchema.safeParse({ date: "2026-07-26", imageBase64: "data:text/html;base64,AAAA" })
        .success,
    ).toBe(false);
  });
});

describe("เครื่องหมายเงิน ↔ ประเภทรายการ (data contract คอลัมน์ D)", () => {
  it("ติดลบ = รายจ่าย, บวก/ศูนย์ = รายรับ", () => {
    expect(typeFromAmount(-1)).toBe("expense");
    expect(typeFromAmount(1)).toBe("income");
    expect(typeFromAmount(0)).toBe("income");
  });
  it("toSignedAmount บังคับเครื่องหมายตามประเภทเสมอ", () => {
    expect(toSignedAmount("expense", 55)).toBe(-55);
    expect(toSignedAmount("expense", -55)).toBe(-55);
    expect(toSignedAmount("income", 55)).toBe(55);
    expect(toSignedAmount("income", -55)).toBe(55);
  });
  it("round-trip: type → signed → type เดิม (ยกเว้น 0)", () => {
    expect(typeFromAmount(toSignedAmount("expense", 10))).toBe("expense");
    expect(typeFromAmount(toSignedAmount("income", 10))).toBe("income");
  });
});
