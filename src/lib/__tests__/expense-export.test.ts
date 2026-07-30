import { describe, expect, it } from "vitest";
import {
  DETAIL_SHEET,
  NOT_COUNTED_SUFFIX,
  buildExpenseWorkbook,
  colLetter,
  detailRows,
  monthCellFormula,
} from "@/lib/expense-export";
import { UNCATEGORIZED_LABEL, type CategoryMappingInput, type ExpenseEntry } from "@/lib/expense-report";

const entry = (over: Partial<ExpenseEntry> = {}): ExpenseEntry => ({
  date: "2026-01-15",
  description: "Makro",
  amount: -100,
  ...over,
});

const mapping = (over: Partial<CategoryMappingInput> = {}): CategoryMappingInput => ({
  category: "Makro",
  item: "Makro",
  counted: true,
  note: "",
  ...over,
});

describe("detailRows — ชีตรายละเอียด", () => {
  it("กรองเฉพาะรายจ่ายในช่วงที่เลือก เรียงตามวันที่ ยอดเป็นค่าบวก", () => {
    const rows = detailRows(
      [
        entry({ date: "2026-03-01", amount: -20 }),
        entry({ date: "2026-01-05", amount: -10 }),
        entry({ date: "2025-12-31", amount: -99 }), // นอกช่วง
        entry({ date: "2026-02-01", amount: 500 }), // รายรับ
      ],
      [mapping({ note: "โน้ต" })],
      "2026-01-01",
      "2026-12-31",
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-01-05", "2026-03-01"]);
    expect(rows[0]).toEqual({
      category: "Makro",
      date: "2026-01-05",
      description: "Makro",
      amount: 10,
      note: "โน้ต",
    });
  });

  it("ไม่ match → ยังไม่จัดหมวด; counted=false → ต่อท้ายป้ายไม่นับ", () => {
    const rows = detailRows(
      [
        entry({ description: "ของแปลก" }),
        entry({ description: "โอนคืนลูกค้า" }),
      ],
      [mapping({ category: "หักจากรายได้", item: "โอนคืนลูกค้า", counted: false })],
      "2026-01-01",
      "2026-12-31",
    );
    expect(rows.map((r) => r.category).sort()).toEqual(
      [`หักจากรายได้${NOT_COUNTED_SUFFIX}`, UNCATEGORIZED_LABEL].sort(),
    );
  });
});

describe("สูตรในชีตสรุป", () => {
  it("colLetter รองรับเกิน Z", () => {
    expect(colLetter(1)).toBe("A");
    expect(colLetter(26)).toBe("Z");
    expect(colLetter(27)).toBe("AA");
    expect(colLetter(28)).toBe("AB");
  });

  it("SUMIFS อ้างหัวคอลัมน์แบบ col$1 และช่วงเดือนจาก DATE/EDATE ของเดือนนั้น", () => {
    const f = monthCellFormula("B", 2026, 3);
    expect(f).toContain(`'${DETAIL_SHEET}'!$D:$D`);
    expect(f).toContain(`'${DETAIL_SHEET}'!$A:$A,B$1`);
    expect(f).toContain('">="&DATE(2026,3,1)');
    expect(f).toContain('"<"&EDATE(DATE(2026,3,1),1)');
  });
});

describe("buildExpenseWorkbook — ไฟล์ .xlsx", () => {
  const bytes = buildExpenseWorkbook(
    [
      entry(),
      entry({ description: "ของแปลก", amount: -5 }),
      entry({ description: "โอนคืนลูกค้า", amount: -7 }),
    ],
    [
      mapping(),
      mapping({ category: "หักจากรายได้", item: "โอนคืนลูกค้า", counted: false }),
    ],
    "2026-01-01",
    "2026-12-31",
  );
  // entry ทุกไฟล์เป็น STORED (ไม่บีบอัด) → decode ทั้งก้อนแล้วค้นข้อความ XML ได้ตรง ๆ
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  it("เป็นไฟล์ zip (ขึ้นต้น PK) และมีส่วนประกอบ xlsx ครบ", () => {
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    for (const name of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/styles.xml",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("มีชื่อชีตทั้งสอง สูตร SUMIFS และสั่งคำนวณใหม่ตอนเปิดไฟล์", () => {
    expect(text).toContain("สรุปค่าใช้จ่าย");
    expect(text).toContain(DETAIL_SHEET);
    expect(text).toContain("SUMIFS(");
    expect(text).toContain('fullCalcOnLoad="1"');
  });

  it("ชีตสรุปมีคอลัมน์ยังไม่จัดหมวด + แถวไม่นับเป็นค่าใช้จ่าย และข้อมูลลงชีตรายละเอียด", () => {
    expect(text).toContain(UNCATEGORIZED_LABEL);
    expect(text).toContain("ไม่นับเป็นค่าใช้จ่าย (หักจากรายได้)");
    expect(text).toContain("ของแปลก");
    expect(text).toContain("โอนคืนลูกค้า");
    // & ในสูตรต้อง escape เป็น &amp; (ไฟล์ต้องเป็น XML ที่ valid)
    expect(text).toContain("&amp;DATE(2026");
    expect(text).not.toMatch(/<f>[^<]*"&DATE/);
  });
});
