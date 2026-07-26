import { describe, expect, it } from "vitest";
import {
  type CashbookRow,
  PURCHASE_KEYWORDS,
  buildReport,
  cashbookToCsv,
  classifyExpense,
  isValidThaiTaxId,
  rowsFromRangeEntry,
  thaiBuddhistDate,
  thaiMonthYearLabel,
} from "@/lib/cashbook";
import { isDeliveryChannel } from "@/lib/pnd94";

const src = (
  over: Partial<Parameters<typeof rowsFromRangeEntry>[0]> = {},
) => ({
  date: "2026-03-15",
  description: "ขายหน้าร้าน",
  amount: 500,
  channel: "",
  gross: null,
  ...over,
});

const row = (over: Partial<CashbookRow> = {}): CashbookRow => ({
  id: "x",
  date: "2026-03-15",
  description: "รายการ",
  kind: "income",
  amount: 100,
  note: "",
  ...over,
});

describe("classifyExpense — heuristic จำแนกหมวดรายจ่าย", () => {
  it("ทุก keyword ซื้อสินค้าฝังในประโยค → purchase", () => {
    for (const k of PURCHASE_KEYWORDS) {
      expect(classifyExpense(`จ่ายค่า${k}ประจำสัปดาห์`)).toBe("purchase");
    }
  });
  it("ตัวละติน case-insensitive: Makro / MAKRO", () => {
    expect(classifyExpense("ซื้อของที่ Makro")).toBe("purchase");
    expect(classifyExpense("MAKRO สาขาปัตตานี")).toBe("purchase");
  });
  it("รายจ่ายอื่น ๆ: ค่าเช่า / string ว่าง → other", () => {
    expect(classifyExpense("ค่าเช่าร้าน")).toBe("other");
    expect(classifyExpense("")).toBe("other");
  });
  it("exclusion กัน false positive จาก substring สั้น", () => {
    expect(classifyExpense("ค่าชาร์จแบต")).toBe("other"); // "ชา" ใน "ชาร์จ"
    expect(classifyExpense("เงินฝากธนาคาร")).toBe("other"); // "ฝา" ใน "ฝาก"
    expect(classifyExpense("ซื้อหลอดไฟ")).toBe("other"); // "หลอด" ใน "หลอดไฟ"
    expect(classifyExpense("ขนมไหว้เจ้า")).toBe("other"); // "นม" ใน "ขนม"
  });
  it("strip exclusion แล้ว keyword จริงยังจับได้: ซื้อนมและขนม → purchase", () => {
    expect(classifyExpense("ซื้อนมและขนม")).toBe("purchase");
  });
});

describe("rowsFromRangeEntry — map แถวชีตเป็นแถวรายงาน", () => {
  it("รายรับหน้าร้าน → 1 แถว income ตาม amount", () => {
    expect(rowsFromRangeEntry(src())).toEqual([
      {
        date: "2026-03-15",
        description: "ขายหน้าร้าน",
        kind: "income",
        amount: 500,
        note: "",
      },
    ]);
  });
  it("รายจ่ายซื้อสินค้า -320 'ซื้อนมที่แม็คโคร' → purchase 320 (auto)", () => {
    const rows = rowsFromRangeEntry(
      src({ description: "ซื้อนมที่แม็คโคร", amount: -320 }),
    );
    expect(rows).toEqual([
      {
        date: "2026-03-15",
        description: "ซื้อนมที่แม็คโคร",
        kind: "purchase",
        amount: 320,
        note: "",
        auto: true,
      },
    ]);
  });
  it("รายจ่ายอื่น ๆ -100 'ค่าไฟ' → other 100 และทศนิยม float ปัด round2", () => {
    expect(rowsFromRangeEntry(src({ description: "ค่าไฟ", amount: -100 }))[0])
      .toMatchObject({ kind: "other", amount: 100 });
    expect(
      rowsFromRangeEntry(src({ description: "ค่าไฟ", amount: -2.055 }))[0]!
        .amount,
    ).toBe(2.06);
  });
  it("delivery มี F: net 70 gross 100 Grab → income 100 + other 30 (auto) และ income − other = net", () => {
    const rows = rowsFromRangeEntry(
      src({ description: "ยอดขาย Grab", amount: 70, gross: 100 }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "income", amount: 100 });
    expect(rows[1]).toMatchObject({
      kind: "other",
      amount: 30,
      description: "ค่า GP+VAT แพลตฟอร์ม (Grab)",
      auto: true,
    });
    // ห้าม strict === บนผลลบ float — เทียบที่ 2 ตำแหน่ง
    expect((rows[0]!.amount - rows[1]!.amount).toFixed(2)).toBe((70).toFixed(2));
  });
  it("delivery F ว่าง → gross คำนวณย้อนจาก net (30% GP + VAT 7%) + estimated ทั้งสองแถว", () => {
    // net 67.90 @ Grab 30% → gross 100 (สอดคล้อง gpForward(100, 30).net = 67.90)
    const rows = rowsFromRangeEntry(
      src({ description: "ยอดขาย Grab", amount: 67.9, gross: null }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "income",
      amount: 100,
      estimated: true,
    });
    expect(rows[1]).toMatchObject({
      kind: "other",
      amount: 32.1,
      estimated: true,
    });
    expect((rows[0]!.amount - rows[1]!.amount).toFixed(2)).toBe(
      (67.9).toFixed(2),
    );
  });
  it("delivery F ผิดปกติ (gross ≤ net) → ไม่แตกแถว income เดียว + note ให้ตรวจ", () => {
    const rows = rowsFromRangeEntry(
      src({ description: "ยอดขาย Grab", amount: 100, gross: 80 }),
    );
    expect(rows).toEqual([
      {
        date: "2026-03-15",
        description: "ยอดขาย Grab",
        kind: "income",
        amount: 100,
        note: "ยอด F ผิดปกติ โปรดตรวจ",
      },
    ]);
  });
  it("isDeliveryChannel (จาก pnd94): Grab/LINE MAN/ShopeeFood/egest → true, หน้าร้าน/อื่น ๆ → false", () => {
    expect(isDeliveryChannel("Grab")).toBe(true);
    expect(isDeliveryChannel("LINE MAN")).toBe(true);
    expect(isDeliveryChannel("ShopeeFood")).toBe(true);
    expect(isDeliveryChannel("egest")).toBe(true);
    expect(isDeliveryChannel("หน้าร้าน")).toBe(false);
    expect(isDeliveryChannel("อื่น ๆ")).toBe(false);
  });
});

describe("buildReport — สรุปยอดรายเดือน", () => {
  it("คร่อมเดือน: ม.ค./ก.พ. → 2 กลุ่ม ยอดถูกทุกคอลัมน์ และแถวรวมหลังแตกแถว delivery", () => {
    const rows = [
      ...rowsFromRangeEntry(
        src({ date: "2026-01-10", description: "ยอดขาย Grab", amount: 70, gross: 100 }),
      ),
      ...rowsFromRangeEntry(
        src({ date: "2026-01-20", description: "ซื้อชานม", amount: -50 }),
      ),
      ...rowsFromRangeEntry(
        src({ date: "2026-02-05", description: "ขายหน้าร้าน", amount: 200 }),
      ),
    ].map((r, i) => ({ ...r, id: String(i) }));
    const report = buildReport(rows, "2026-01-01", "2026-06-30");
    expect(report.months.map((m) => m.key)).toEqual(["2026-01", "2026-02"]);
    expect(report.months[0]!.totals).toEqual({
      income: 100, // gross ไม่ใช่ net 70
      purchase: 50,
      other: 30, // ค่า GP ที่แตกแถวออกมา
    });
    expect(report.months[1]!.totals).toEqual({
      income: 200,
      purchase: 0,
      other: 0,
    });
    expect(report.grand).toEqual({ income: 300, purchase: 50, other: 30 });
  });
  it("คร่อมปี: ธ.ค.2025 + ม.ค.2026 → key เรียงตามเวลา", () => {
    const report = buildReport(
      [
        row({ date: "2026-01-05", amount: 10 }),
        row({ date: "2025-12-20", amount: 20 }),
      ],
      "2025-12-01",
      "2026-01-31",
    );
    expect(report.months.map((m) => m.key)).toEqual(["2025-12", "2026-01"]);
  });
  it("แถวนอกช่วงถูกตัด และแถวในเดือนเรียงตามวันที่", () => {
    const report = buildReport(
      [
        row({ id: "a", date: "2026-03-20" }),
        row({ id: "b", date: "2026-03-05" }),
        row({ id: "c", date: "2026-07-01" }),
      ],
      "2026-03-01",
      "2026-06-30",
    );
    expect(report.months).toHaveLength(1);
    expect(report.months[0]!.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("การปัดเศษ: ผลบวกเลข 2 ตำแหน่งไม่มี float dust และ grand = ผลบวกยอดรายเดือน", () => {
    const report = buildReport(
      [
        row({ date: "2026-01-01", amount: 0.1 }),
        row({ date: "2026-01-02", amount: 0.2 }),
        row({ date: "2026-02-01", amount: 0.3 }),
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(report.months[0]!.totals.income).toBe(0.3); // ไม่ใช่ 0.30000000000000004
    expect(report.grand.income).toBe(0.6);
  });
  it("ช่วงว่าง → months ว่าง + grand ศูนย์ทุกช่อง ไม่ NaN", () => {
    const report = buildReport([], "2026-01-01", "2026-06-30");
    expect(report.months).toEqual([]);
    expect(report.grand).toEqual({ income: 0, purchase: 0, other: 0 });
    expect(Number.isNaN(report.grand.income)).toBe(false);
  });
});

describe("thaiBuddhistDate / thaiMonthYearLabel — แปลง พ.ศ.", () => {
  it("dd/mm/yyyy พ.ศ.", () => {
    expect(thaiBuddhistDate("2026-01-05")).toBe("05/01/2569");
    expect(thaiBuddhistDate("2025-12-31")).toBe("31/12/2568");
  });
  it("เดือน ปี พ.ศ.", () => {
    expect(thaiMonthYearLabel("2026-01")).toBe("มกราคม 2569");
    expect(thaiMonthYearLabel("2025-12")).toBe("ธันวาคม 2568");
  });
});

describe("isValidThaiTaxId — เลขบัตรประชาชน 13 หลัก", () => {
  it("checksum ถูก → true", () => {
    // 1234567890121: sum(หลัก 1–12 × น้ำหนัก 13–2) = 352, 352 mod 11 = 0, (11−0) mod 10 = 1 = หลักที่ 13
    expect(isValidThaiTaxId("1234567890121")).toBe(true);
  });
  it("checksum ผิด / สั้น / มีตัวอักษร → false", () => {
    expect(isValidThaiTaxId("1234567890120")).toBe(false);
    expect(isValidThaiTaxId("123456789012")).toBe(false);
    expect(isValidThaiTaxId("123456789012a")).toBe(false);
    expect(isValidThaiTaxId("")).toBe(false);
  });
});

describe("cashbookToCsv", () => {
  const header = {
    ownerName: "ผู้ทดสอบ ระบบ",
    shopName: "ร้านตัวอย่าง",
    taxId: "1101700230705",
    address: "1 ถนนทดสอบ, ตำบลทดสอบ",
  };
  const report = buildReport(
    [
      row({ date: "2026-01-10", description: "ขายหน้าร้าน", amount: 100 }),
      row({
        date: "2026-01-15",
        description: "ซื้อ ชา, นม",
        kind: "purchase",
        amount: 40,
      }),
      row({ date: "2026-02-01", description: "ค่าเช่า", kind: "other", amount: 30 }),
    ],
    "2026-01-01",
    "2026-06-30",
  );
  const csv = cashbookToCsv(report, header, "2026-01-01", "2026-06-30");
  const lines = csv.split("\r\n");

  it("ขึ้นต้นด้วย BOM และใช้ \\r\\n", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
  });
  it("มีหัวรายงานและหัวคอลัมน์ไทย 6 ช่อง", () => {
    expect(csv).toContain("ชื่อผู้ประกอบการ,ผู้ทดสอบ ระบบ");
    expect(csv).toContain("เลขประจำตัวผู้เสียภาษี,1101700230705");
    expect(csv).toContain("ช่วงเวลา,มกราคม 2569 ถึง มิถุนายน 2569");
    expect(lines).toContain(
      "วัน/เดือน/ปี,รายการ,รายรับ,รายจ่าย: ซื้อสินค้า,รายจ่าย: อื่น ๆ,หมายเหตุ",
    );
  });
  it("free text มี comma ถูก quote ทั้งแถวข้อมูลและหัวรายงาน (ที่อยู่)", () => {
    expect(csv).toContain('"ซื้อ ชา, นม"');
    expect(csv).toContain('ที่อยู่,"1 ถนนทดสอบ, ตำบลทดสอบ"');
  });
  it("วันที่เป็น พ.ศ. + ยอดลงคอลัมน์ตามหมวด", () => {
    expect(lines).toContain("10/01/2569,ขายหน้าร้าน,100.00,,,");
    expect(lines).toContain('15/01/2569,"ซื้อ ชา, นม",,40.00,,');
    expect(lines).toContain("01/02/2569,ค่าเช่า,,,30.00,");
  });
  it("มีแถวรวมรายเดือนครบทุกเดือน + รวมทั้งสิ้น toFixed(2)", () => {
    expect(lines).toContain(",รวมประจำเดือน มกราคม 2569,100.00,40.00,0.00,");
    expect(lines).toContain(",รวมประจำเดือน กุมภาพันธ์ 2569,0.00,0.00,30.00,");
    expect(lines[lines.length - 1]).toBe(",รวมทั้งสิ้น,100.00,40.00,30.00,");
  });
});
