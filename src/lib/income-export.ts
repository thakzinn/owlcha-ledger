import { dateStrToSerial } from "@/lib/date";
import {
  CASH_LABEL,
  DELIVERY_LABEL,
  INCOME_UNCATEGORIZED_LABEL,
  REFUND_ITEMS,
  TRANSFER_LABEL,
  buildIncomeReport,
  classifyIncome,
  type IncomeEntry,
  type IncomeMonth,
} from "@/lib/income-report";
import {
  colLetter,
  monthSumifsFormula,
  packWorkbook,
  rowXml,
  sheetXml,
} from "@/lib/xlsx";

/**
 * Export รายงานรายได้เป็นไฟล์ .xlsx (2 ชีต) — ห้าม import React/server
 *
 * ชีต 1 "สรุปรายได้": ตารางเดือน × ช่องทาง ทุกเซลล์เป็นสูตร SUMIFS ผูกกับชีต 2
 * ผ่านหัวคอลัมน์ (col$1) แบบเดียวกับไฟล์ค่าใช้จ่าย copy สูตรต่อในไฟล์ได้
 * ชีต 2 "รายละเอียดรายได้": ประเภท | วันที่ทำรายการ | รายการ | จำนวนเงิน (บาท) | ช่องทาง
 * (layout A–D ตรงกับฝั่งค่าใช้จ่าย จึงใช้ monthSumifsFormula ร่วมกันได้)
 *
 * ไฟล์เป็น layout มาตรฐาน 3 คอลัมน์ช่องทางเสมอ ไม่ขึ้นกับ checkbox เงินสดบนเว็บ
 * — ไฟล์ที่ส่งสำนักงานบัญชีต้อง reproducible ไม่ผูกกับสถานะจอตอนกดปุ่ม
 */

export const INCOME_SUMMARY_SHEET = "สรุปรายได้";
export const INCOME_DETAIL_SHEET = "รายละเอียดรายได้";

export interface IncomeDetailRow {
  /** ป้ายประเภท (คอลัมน์ A ที่ SUMIFS จับ) */
  category: string;
  /** YYYY-MM-DD (ไปเป็น date serial ตอนเขียนไฟล์) */
  date: string;
  description: string;
  /** มีเครื่องหมาย — แถวโอนคืนลูกค้าเป็นค่าลบใต้ป้ายช่องโอน ให้ SUMIFS หักให้เอง */
  amount: number;
  channel: string;
}

const BUCKET_LABEL = {
  transfer: TRANSFER_LABEL,
  delivery: DELIVERY_LABEL,
  cash: CASH_LABEL,
  uncategorized: INCOME_UNCATEGORIZED_LABEL,
} as const;

/**
 * แถวชีตรายละเอียด: รายรับทุกแถวในช่วง [from, to] + แถวโอนคืนลูกค้า (ติดลบ)
 * เรียงตามวันที่ — แถวลบอื่น ๆ เป็นรายจ่าย ไม่ลงชีตนี้เลย
 */
export function incomeDetailRows(
  entries: readonly IncomeEntry[],
  from: string,
  to: string,
): IncomeDetailRow[] {
  const out: IncomeDetailRow[] = [];
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const desc = e.description.trim();
    if (REFUND_ITEMS.includes(desc) && e.amount < 0) {
      // ลงเป็นค่าลบใต้ป้ายช่องโอน → SUMIFS ของคอลัมน์โอนหักให้อัตโนมัติ
      // ยอดชีตสรุปจึงตรงกับหน้าเว็บ (transfer สุทธิหลัง refund) เป๊ะ
      out.push({
        category: TRANSFER_LABEL,
        date: e.date,
        description: desc,
        amount: e.amount,
        channel: e.channel.trim(),
      });
      continue;
    }
    if (e.amount <= 0) continue;
    out.push({
      category: BUCKET_LABEL[classifyIncome(desc, e.channel)],
      date: e.date,
      description: desc,
      amount: e.amount,
      channel: e.channel.trim(),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function buildSummarySheet(
  months: readonly IncomeMonth[],
  hasUncategorized: boolean,
): string {
  // คอลัมน์: A=เดือน, โอน, เดลิ, เงินสด (+ยังไม่จัดประเภทเมื่อมี), สุดท้าย=รวมทั้งหมด
  const headers = [
    TRANSFER_LABEL,
    DELIVERY_LABEL,
    CASH_LABEL,
    ...(hasUncategorized ? [INCOME_UNCATEGORIZED_LABEL] : []),
  ];
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
          formula: monthSumifsFormula(
            INCOME_DETAIL_SHEET,
            colLetter(2 + i),
            m.year,
            m.month,
          ),
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
      // SUM คอลัมน์เดือน (ฝั่ง expense ใช้ SUMIFS ทั้งช่วงตรงนี้ — ผลเท่ากัน
      // เพราะชีตรายละเอียดถูกกรอง [from, to] แล้ว เลือก SUM เพราะสั้นกว่า)
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

  return sheetXml(rows, [10, ...Array.from({ length: headers.length + 1 }, () => 20)]);
}

function buildDetailSheet(rows: readonly IncomeDetailRow[]): string {
  const xml: string[] = [
    rowXml(1, [
      { ref: "A1", s: 1, text: "ประเภท" },
      { ref: "B1", s: 1, text: "วันที่ทำรายการ" },
      { ref: "C1", s: 1, text: "รายการ" },
      { ref: "D1", s: 1, text: "จำนวนเงิน (บาท)" },
      { ref: "E1", s: 1, text: "ช่องทาง" },
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
        { ref: `E${r}`, text: d.channel },
      ]),
    );
  });
  // ป้ายประเภทยาว ("ยอดเงินโอนเข้า (ไม่รวมยอดเดลิ)"), วันที่กว้างพอ dd/mm/yyyy
  return sheetXml(xml, [30, 14, 34, 16, 12]);
}

/** สร้างไฟล์ .xlsx ทั้งก้อน (bytes) สำหรับช่วง [from, to] ที่เลือก */
export function buildIncomeWorkbook(
  entries: readonly IncomeEntry[],
  from: string,
  to: string,
): Uint8Array<ArrayBuffer> {
  const report = buildIncomeReport(entries, from, to);
  const details = incomeDetailRows(entries, from, to);
  return packWorkbook(
    INCOME_SUMMARY_SHEET,
    INCOME_DETAIL_SHEET,
    buildSummarySheet(report.months, report.uncategorizedTotal.count > 0),
    buildDetailSheet(details),
  );
}
