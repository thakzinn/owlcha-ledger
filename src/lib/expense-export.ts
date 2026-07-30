import { dateStrToSerial } from "@/lib/date";
import {
  UNCATEGORIZED_LABEL,
  buildExpenseReport,
  type CategoryMappingInput,
  type ExpenseEntry,
  type MonthCells,
} from "@/lib/expense-report";
import {
  colLetter,
  monthSumifsFormula,
  packWorkbook,
  rowXml,
  sheetXml,
} from "@/lib/xlsx";

/**
 * Export รายงานค่าใช้จ่ายเป็นไฟล์ .xlsx (2 ชีต) — ห้าม import React/server
 *
 * ชีต 1 "สรุปค่าใช้จ่าย": ตารางเดือน × หมวด โดย "ทุกเซลล์เป็นสูตร SUMIFS"
 * ผูกกับชีต 2 ผ่านหัวคอลัมน์ (B$1) + เดือนจาก DATE(ปี,เดือน,1) — ผู้ใช้แก้ตัวเลข/
 * ย้ายหมวดในชีตรายละเอียดแล้วสรุปคำนวณใหม่เอง และ copy สูตรต่อในไฟล์ได้
 * ชีต 2 "รายละเอียดค่าใช้จ่าย": หมวดหมู่ | วันที่ทำรายการ | รายการ | จำนวนเงิน (บาท) | หมายเหตุ
 *
 * plumbing สร้างไฟล์ (zip STORED + XML) อยู่ใน src/lib/xlsx.ts — แชร์กับ income-export
 */

export const SUMMARY_SHEET = "สรุปค่าใช้จ่าย";
export const DETAIL_SHEET = "รายละเอียดค่าใช้จ่าย";
/** ป้ายหมวดในชีตรายละเอียดของแถว "ไม่นับเป็นค่าใช้จ่าย" — ต่อท้ายชื่อหมวดจริง
 * เพื่อไม่ให้ SUMIFS ของคอลัมน์หมวดปกติเผลอรวมยอดพวกนี้เข้าไป */
export const NOT_COUNTED_SUFFIX = " (ไม่นับเป็นค่าใช้จ่าย)";

export { colLetter } from "@/lib/xlsx";

export interface DetailRow {
  category: string;
  /** YYYY-MM-DD (ไปเป็น date serial ตอนเขียนไฟล์) */
  date: string;
  description: string;
  /** ค่าบวกเสมอ (|amount|) */
  amount: number;
  note: string;
}

/** แถวชีตรายละเอียด: รายจ่ายทุกแถวในช่วง [from, to] เรียงตามวันที่ (first-wins เหมือนรายงาน) */
export function detailRows(
  entries: readonly ExpenseEntry[],
  mappings: readonly CategoryMappingInput[],
  from: string,
  to: string,
): DetailRow[] {
  const byItem = new Map<string, CategoryMappingInput>();
  for (const m of mappings) {
    const item = m.item.trim();
    if (item && !byItem.has(item)) byItem.set(item, m);
  }
  return entries
    .filter((e) => e.amount < 0 && e.date >= from && e.date <= to)
    .map((e) => {
      const m = byItem.get(e.description.trim());
      return {
        category: !m
          ? UNCATEGORIZED_LABEL
          : m.counted
            ? m.category
            : `${m.category}${NOT_COUNTED_SUFFIX}`,
        date: e.date,
        description: e.description.trim(),
        amount: Math.abs(e.amount),
        note: m?.note ?? "",
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** สูตรเซลล์สรุปรายเดือน ผูกกับชีตรายละเอียดของรายงานนี้ (ดู monthSumifsFormula) */
export function monthCellFormula(col: string, year: number, month: number): string {
  return monthSumifsFormula(DETAIL_SHEET, col, year, month);
}

function buildSummarySheet(
  categories: readonly string[],
  notCountedLabels: readonly string[],
  months: readonly MonthCells[],
): string {
  // คอลัมน์: A=เดือน, ต่อด้วยหมวดทุกหมวด + ยังไม่จัดหมวด, สุดท้าย=รวมทั้งหมด
  const headers = [...categories, UNCATEGORIZED_LABEL];
  const totalColNo = 2 + headers.length;
  const rows: string[] = [];

  rows.push(
    rowXml(1, [
      { ref: "A1", s: 1, text: "เดือน" },
      ...headers.map((h, i) => ({ ref: `${colLetter(2 + i)}1`, s: 1, text: h })),
      { ref: `${colLetter(totalColNo)}1`, s: 1, text: "รวมทั้งหมด" },
    ]),
  );

  months.forEach((m, mi) => {
    const r = mi + 2;
    rows.push(
      rowXml(r, [
        { ref: `A${r}`, text: m.label },
        ...headers.map((_, i) => ({
          ref: `${colLetter(2 + i)}${r}`,
          s: 3,
          formula: monthCellFormula(colLetter(2 + i), m.year, m.month),
        })),
        {
          ref: `${colLetter(totalColNo)}${r}`,
          s: 3,
          formula: `SUM(B${r}:${colLetter(totalColNo - 1)}${r})`,
        },
      ]),
    );
  });

  const lastMonthRow = 1 + months.length;
  const totalRow = lastMonthRow + 1;
  rows.push(
    rowXml(totalRow, [
      { ref: `A${totalRow}`, s: 1, text: "รวมทั้งช่วง" },
      ...Array.from({ length: headers.length + 1 }, (_, i) => {
        const col = colLetter(2 + i);
        return {
          ref: `${col}${totalRow}`,
          s: 4,
          formula: `SUM(${col}2:${col}${lastMonthRow})`,
        };
      }),
    ]),
  );

  if (notCountedLabels.length > 0) {
    const r = totalRow + 1;
    const formula = notCountedLabels
      .map(
        (l) =>
          `SUMIFS('${DETAIL_SHEET}'!$D:$D,'${DETAIL_SHEET}'!$A:$A,"${l}")`,
      )
      .join("+");
    rows.push(
      rowXml(r, [
        { ref: `A${r}`, text: "ไม่นับเป็นค่าใช้จ่าย (หักจากรายได้)" },
        { ref: `${colLetter(totalColNo)}${r}`, s: 3, formula },
      ]),
    );
  }

  // เดือนแคบ คอลัมน์เงินกว้างพอเลขหลักแสนพร้อม comma
  return sheetXml(rows, [10, ...Array.from({ length: headers.length + 1 }, () => 16)]);
}

function buildDetailSheet(rows: readonly DetailRow[]): string {
  const xml: string[] = [
    rowXml(1, [
      { ref: "A1", s: 1, text: "หมวดหมู่" },
      { ref: "B1", s: 1, text: "วันที่ทำรายการ" },
      { ref: "C1", s: 1, text: "รายการ" },
      { ref: "D1", s: 1, text: "จำนวนเงิน (บาท)" },
      { ref: "E1", s: 1, text: "หมายเหตุ" },
    ]),
  ];
  rows.forEach((d, i) => {
    const r = i + 2;
    xml.push(
      rowXml(r, [
        { ref: `A${r}`, text: d.category },
        { ref: `B${r}`, s: 2, num: dateStrToSerial(d.date) },
        { ref: `C${r}`, text: d.description },
        { ref: `D${r}`, s: 3, num: d.amount },
        { ref: `E${r}`, text: d.note },
      ]),
    );
  });
  // หมวด/รายการ/หมายเหตุ เป็นข้อความไทยยาว, วันที่ต้องกว้างพอ dd/mm/yyyy
  return sheetXml(xml, [26, 14, 34, 16, 34]);
}

/** สร้างไฟล์ .xlsx ทั้งก้อน (bytes) สำหรับช่วง [from, to] ที่เลือก */
export function buildExpenseWorkbook(
  entries: readonly ExpenseEntry[],
  mappings: readonly CategoryMappingInput[],
  from: string,
  to: string,
): Uint8Array<ArrayBuffer> {
  // ใช้ลำดับคอลัมน์เดียวกับตารางบนเว็บ (first appearance ของหมวดในแท็บ)
  const report = buildExpenseReport(entries, mappings, from, to);
  const details = detailRows(entries, mappings, from, to);
  const notCountedLabels = [
    ...new Set(
      details
        .filter((d) => d.category.endsWith(NOT_COUNTED_SUFFIX))
        .map((d) => d.category),
    ),
  ];

  return packWorkbook(
    SUMMARY_SHEET,
    DETAIL_SHEET,
    buildSummarySheet(report.categories, notCountedLabels, report.months),
    buildDetailSheet(details),
  );
}
