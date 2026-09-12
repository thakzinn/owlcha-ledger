import { describe, expect, it } from "vitest";
import {
  todayBangkok,
  serialToDateStr,
  dateStrToSerial,
  isValidDateStr,
  thaiDateLabel,
  nextDateStr,
  firstUnsavedDate,
} from "@/lib/date";

describe("todayBangkok — timezone Asia/Bangkok ไม่ใช่ UTC (หนี้เดิมข้อ 9)", () => {
  it("UTC 18:00 ของวันก่อน = หลังเที่ยงคืนกรุงเทพ → ต้องได้วันถัดไป", () => {
    // 2026-01-01T18:30Z = 2026-01-02 01:30 ที่กรุงเทพ
    expect(todayBangkok(new Date("2026-01-01T18:30:00Z"))).toBe("2026-01-02");
  });
  it("UTC 16:59 = 23:59 กรุงเทพ → ยังเป็นวันเดิม", () => {
    expect(todayBangkok(new Date("2026-01-01T16:59:00Z"))).toBe("2026-01-01");
  });
  it("UTC 17:00 = เที่ยงคืนกรุงเทพพอดี → ข้ามวัน", () => {
    expect(todayBangkok(new Date("2026-01-01T17:00:00Z"))).toBe("2026-01-02");
  });
  it("รูปแบบเป็น YYYY-MM-DD", () => {
    expect(todayBangkok()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("serial ↔ dateStr (Google Sheets epoch 1899-12-30)", () => {
  it("ค่าอ้างอิงที่ทราบ: serial 1 = 1899-12-31, serial 60 = 1900-02-28 (บั๊ก Lotus ที่ Sheets สืบทอด)", () => {
    expect(serialToDateStr(1)).toBe("1899-12-31");
    expect(serialToDateStr(45_000)).toBe("2023-03-15");
  });
  it("round-trip ทุกทิศ", () => {
    for (const d of ["2026-07-26", "2026-01-01", "2025-12-31", "2024-02-29"]) {
      expect(serialToDateStr(dateStrToSerial(d))).toBe(d);
    }
  });
  it("เศษเวลาในเซลล์ (datetime) ถูกตัดทิ้ง — ไม่เลื่อนวัน", () => {
    const serial = dateStrToSerial("2026-07-26");
    expect(serialToDateStr(serial + 0.999)).toBe("2026-07-26");
  });
});

describe("isValidDateStr", () => {
  it("รับเฉพาะ YYYY-MM-DD ที่เป็นวันจริง", () => {
    expect(isValidDateStr("2026-07-26")).toBe(true);
    expect(isValidDateStr("2024-02-29")).toBe(true); // ปีอธิกสุรทิน
    expect(isValidDateStr("2026-02-30")).toBe(false);
    expect(isValidDateStr("2026-13-01")).toBe(false);
    expect(isValidDateStr("26/07/2026")).toBe(false);
    expect(isValidDateStr("2026-7-26")).toBe(false);
  });
});

describe("thaiDateLabel", () => {
  it("ภาษาไทย พ.ศ.", () => {
    const label = thaiDateLabel("2026-07-26");
    expect(label).toContain("2569");
    expect(label).toContain("กรกฎาคม");
  });
});

describe("nextDateStr", () => {
  it("ข้ามวัน/เดือน/ปี/อธิกสุรทินถูกต้อง", () => {
    expect(nextDateStr("2026-09-11")).toBe("2026-09-12");
    expect(nextDateStr("2026-09-30")).toBe("2026-10-01");
    expect(nextDateStr("2025-12-31")).toBe("2026-01-01");
    expect(nextDateStr("2024-02-28")).toBe("2024-02-29");
  });
});

describe("firstUnsavedDate — วันถัดจากวันล่าสุดที่บันทึก (max + 1)", () => {
  const today = "2026-09-12";
  it("วันล่าสุดคือ 09-11 → คืน 09-12 (ไม่สนวันโหว่กลางทาง)", () => {
    expect(
      firstUnsavedDate(["2026-09-08", "2026-09-10", "2026-09-11"], today),
    ).toBe("2026-09-12");
  });
  it("วันล่าสุดคือ 09-10 → คืน 09-11", () => {
    expect(firstUnsavedDate(["2026-09-09", "2026-09-10"], today)).toBe("2026-09-11");
  });
  it("บันทึกถึงวันนี้แล้ว → คืนวันนี้ (ไม่ชี้อนาคต)", () => {
    expect(
      firstUnsavedDate(["2026-09-10", "2026-09-11", "2026-09-12"], today),
    ).toBe(today);
  });
  it("ชีตว่าง → คืนวันนี้", () => {
    expect(firstUnsavedDate([], today)).toBe(today);
  });
  it("ข้อมูลล่าสุดเป็นวันอนาคต → คืนวันนี้", () => {
    expect(firstUnsavedDate(["2026-09-20"], today)).toBe(today);
  });
  it("ข้ามเดือน: วันล่าสุด 08-31 → คืน 09-01", () => {
    expect(firstUnsavedDate(["2026-08-31"], today)).toBe("2026-09-01");
  });
});
