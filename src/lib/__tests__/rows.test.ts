import { describe, expect, it } from "vitest";
import {
  normalizeRow,
  normalizeRows,
  computeVersion,
  shouldDrawBorder,
  type SheetRow,
} from "@/lib/rows";
import { dateStrToSerial } from "@/lib/date";

const D = "2026-07-26";
const serial = dateStrToSerial(D);

describe("normalizeRow — ragged rows (N13)", () => {
  it("แถวที่มีเฉพาะ B / B–C / เต็ม → เท่ากับแถวที่เติมค่าว่างครบ", () => {
    const onlyB = normalizeRow([serial]);
    const bc = normalizeRow([serial, ""]);
    const full = normalizeRow([serial, "", 0, ""]);
    expect(onlyB).toEqual(full);
    expect(bc).toEqual(full);
  });
  it("เซลล์วันที่ที่เป็นข้อความ (ไม่ใช่ serial) = ไม่ใช่วันที่ (ตรงพฤติกรรมเดิม instanceof Date)", () => {
    expect(normalizeRow(["2026-07-26", "x", 5, "เงินสด"]).date).toBeNull();
  });
  it("amount ที่ไม่ใช่ตัวเลข → 0", () => {
    expect(normalizeRow([serial, "x", "abc", "โอน"]).amount).toBe(0);
  });
});

describe("computeVersion — hash เฉพาะเนื้อหาแถวของวันนั้น ไม่ผสมเลขแถว (B3)", () => {
  const day = (over: Partial<SheetRow> = {}): SheetRow => ({
    date: D,
    description: "ชาไข่มุก",
    amount: -55,
    channel: "เงินสด",
    gross: null,
    ...over,
  });
  const other: SheetRow = {
    date: "2026-07-25",
    description: "น้ำแข็ง",
    amount: -100,
    channel: "โอน",
    gross: null,
  };

  it("แถวสั้น/เต็มที่ค่าเท่ากัน → hash เดียวกัน (ผ่าน normalize)", () => {
    const a = computeVersion(normalizeRows([[serial, "x", 1]]), D);
    const b = computeVersion(normalizeRows([[serial, "x", 1, ""]]), D);
    expect(a).toBe(b);
  });
  it("การแก้วันอื่น (แถวเลื่อน) ไม่เปลี่ยน version ของวันเรา", () => {
    const v1 = computeVersion([other, day()], D);
    const v2 = computeVersion([other, other, other, day()], D);
    expect(v1).toBe(v2);
  });
  it("เนื้อหาวันเราเปลี่ยน → version เปลี่ยน", () => {
    const v1 = computeVersion([day()], D);
    const v2 = computeVersion([day({ amount: -56 })], D);
    expect(v1).not.toBe(v2);
  });
  it("คอลัมน์ F (ยอดขายบนแอป) เปลี่ยน → version เปลี่ยน (ADR §11.7)", () => {
    const v1 = computeVersion([day({ gross: null })], D);
    const v2 = computeVersion([day({ gross: 2022.27 })], D);
    expect(v1).not.toBe(v2);
  });
  it("วันว่าง = hash ของ [] คงที่", () => {
    expect(computeVersion([], D)).toBe(computeVersion([other], D));
  });
});

describe("shouldDrawBorder (N5) — จำลองผลการลบก่อนตัดสินใจ", () => {
  const row = (date: string): SheetRow => ({
    date,
    description: "",
    amount: 0,
    channel: "",
    gross: null,
  });

  it("บันทึกวันล่าสุดซ้ำ: remaining ลงท้ายด้วยวันก่อนหน้า → วาดเส้น (เส้นไม่หาย)", () => {
    expect(shouldDrawBorder([row("2026-07-24"), row("2026-07-25")], "2026-07-26")).toBe(true);
  });
  it("วันใหม่ต่อจากวันเก่า → วาดเส้น", () => {
    expect(shouldDrawBorder([row("2026-07-25")], "2026-07-26")).toBe(true);
  });
  it("remaining ว่าง (ชีตเหลือแต่หัวตาราง) → วาดเส้น (กำหนดชัดในแผน N5)", () => {
    expect(shouldDrawBorder([], D)).toBe(true);
  });
  it("แถวสุดท้ายหลังลบเป็นวันเดียวกับ target (เคสทฤษฎี) → ไม่วาด", () => {
    expect(shouldDrawBorder([row(D)], D)).toBe(false);
  });
});
