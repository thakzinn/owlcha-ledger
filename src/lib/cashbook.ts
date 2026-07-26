import {
  DEFAULT_GP_RATES,
  channelFromDescription,
  grossFromNet,
  isDeliveryChannel,
  round2,
} from "@/lib/pnd94";

/**
 * Logic ล้วนของหน้ารายงานเงินสดรับ-จ่าย (ตามแบบประกาศอธิบดีฯ ฉบับที่ 161
 * ประกอบการยื่น ภ.ง.ด.94/90 แบบหักค่าใช้จ่ายตามจริง) — ห้าม import React/server
 *
 * หลักสำคัญ: เงินได้พึงประเมินคือยอดขายเต็ม (gross) ไม่ใช่เงินเข้าบัญชีหลังหัก GP —
 * แถวรายรับ delivery จึงถูกแตกเป็น 2 แถว (รายรับ gross + รายจ่ายค่า GP) เพื่อให้
 * ยอดรายรับรวมของรายงานนี้ตรงกับเงินได้พึงประเมินของหน้า ภ.ง.ด.94 ช่วงเดียวกัน
 */

export type CashbookKind = "income" | "purchase" | "other";
// income → รายรับ, purchase → รายจ่าย: ซื้อสินค้า, other → รายจ่าย: อื่น ๆ

export interface CashbookRow {
  id: string;
  /** YYYY-MM-DD (ค.ศ. เสมอ) — แปลงเป็น พ.ศ. เฉพาะตอนแสดงผล */
  date: string;
  description: string;
  kind: CashbookKind;
  /** ค่าบวกเสมอ ปัด round2 แล้ว (รายจ่ายก็เป็นบวก — เครื่องหมายอยู่ที่คอลัมน์) */
  amount: number;
  note: string;
  /** จัดหมวด/แตกแถวโดย heuristic — แสดง badge ให้ผู้ใช้ตรวจ */
  auto?: boolean;
  /** gross มาจากการคำนวณย้อน (คอลัมน์ F ว่าง) — ต้องให้ผู้ใช้ตรวจ */
  estimated?: boolean;
}

// ---------- จำแนกรายจ่าย ----------

export const PURCHASE_KEYWORDS: readonly string[] = [
  "วัตถุดิบ",
  "ชา",
  "นม",
  "ไข่มุก",
  "น้ำตาล",
  "แก้ว",
  "ฝา",
  "หลอด",
  "ถุง",
  "แพ็กเกจ",
  "ซื้อของ",
  "makro",
  "แม็คโคร",
];

/** คำที่มี keyword สั้นซ้อนอยู่แต่ไม่ใช่การซื้อสินค้า — ตัดออกก่อน match กัน false positive */
export const PURCHASE_EXCLUSIONS: readonly string[] = [
  "ชาร์จ",
  "ฝาก",
  "หลอดไฟ",
  "ขนม",
];

/** จัดหมวดรายจ่ายจาก description: เจอ keyword ซื้อสินค้า = purchase, นอกนั้น other */
export function classifyExpense(description: string): "purchase" | "other" {
  let text = description.toLowerCase();
  for (const ex of PURCHASE_EXCLUSIONS) text = text.split(ex).join(" ");
  return PURCHASE_KEYWORDS.some((k) => text.includes(k)) ? "purchase" : "other";
}

// ---------- แปลงแถวจากชีตเป็นแถวรายงาน ----------

export interface CashbookSourceEntry {
  date: string;
  description: string;
  /** ยอดจากคอลัมน์ D — รายรับเป็นบวก (delivery = สุทธิหลังหัก GP) รายจ่ายเป็นลบ */
  amount: number;
  channel: string;
  /** คอลัมน์ F — ยอดขายบนแอปก่อนหัก GP (เฉพาะแถว delivery, อาจว่าง) */
  gross: number | null;
}

/**
 * แถวชีต 1 แถว → แถวรายงาน 1–2 แถว
 * - รายจ่าย (amount < 0): 1 แถว หมวดจาก classifyExpense
 * - รายรับทั่วไป/หน้าร้าน: 1 แถว income ตาม amount
 * - รายรับ delivery: 2 แถว — income = gross (เงินได้พึงประเมิน) + รายจ่าย "อื่น ๆ"
 *   ค่า GP+VAT = gross − net; F ว่างให้คำนวณย้อนด้วยอัตรา default + flag estimated
 * - guard ข้อมูล F ผิดปกติ (gross ≤ net): ไม่แตกแถว ใช้ amount ตรง ๆ + note ให้ตรวจ
 */
export function rowsFromRangeEntry(
  e: CashbookSourceEntry,
): Omit<CashbookRow, "id">[] {
  if (e.amount < 0) {
    return [
      {
        date: e.date,
        description: e.description,
        kind: classifyExpense(e.description),
        amount: round2(-e.amount),
        note: "",
        auto: true,
      },
    ];
  }

  const channel = channelFromDescription(e.description);
  const net = round2(e.amount);
  const income = (over: Partial<CashbookRow> = {}): Omit<CashbookRow, "id"> => ({
    date: e.date,
    description: e.description,
    kind: "income",
    amount: net,
    note: "",
    ...over,
  });

  if (!isDeliveryChannel(channel)) return [income()];

  let gross: number | null;
  let estimated = false;
  if (e.gross != null) {
    gross = round2(e.gross);
  } else {
    gross = grossFromNet(net, DEFAULT_GP_RATES[channel]);
    estimated = true;
  }
  // F ผิดปกติ (gross ≤ เงินเข้าจริง) หรือย้อน gross ไม่ได้ — อย่าแตกแถวเงียบ ๆ
  if (gross === null || gross <= net) {
    return [
      income(
        gross !== null && gross <= net
          ? { note: "ยอด F ผิดปกติ โปรดตรวจ" }
          : { estimated },
      ),
    ];
  }

  const fee = round2(gross - net);
  return [
    income({ amount: gross, estimated }),
    {
      date: e.date,
      description: `ค่า GP+VAT แพลตฟอร์ม (${channel})`,
      kind: "other",
      amount: fee,
      note: "",
      auto: true,
      estimated,
    },
  ];
}

// ---------- สรุปยอด ----------

export interface CashbookTotals {
  income: number;
  purchase: number;
  other: number;
}

export interface MonthGroup {
  /** YYYY-MM */
  key: string;
  rows: CashbookRow[];
  totals: CashbookTotals;
}

export interface CashbookReportData {
  months: MonthGroup[];
  grand: CashbookTotals;
}

const sumTotals = (rows: readonly CashbookRow[]): CashbookTotals => {
  const t = { income: 0, purchase: 0, other: 0 };
  for (const r of rows) t[r.kind] += r.amount;
  // ค่าที่รวมเป็นเลข 2 ตำแหน่งอยู่แล้ว — ปัดผลรวมกันเศษ float สะสม
  t.income = round2(t.income);
  t.purchase = round2(t.purchase);
  t.other = round2(t.other);
  return t;
};

/**
 * กรอง [from, to] (inclusive, string compare ได้เพราะ YYYY-MM-DD) แล้วจัดกลุ่มรายเดือน
 * เรียง key แบบ lexicographic — คร่อมปีเรียงถูกเพราะ YYYY-MM เรียงตามเวลาอยู่แล้ว
 * ช่วงว่าง → months ว่าง + ยอดรวมศูนย์ (ไม่มีทางเป็น NaN)
 */
export function buildReport(
  rows: readonly CashbookRow[],
  from: string,
  to: string,
): CashbookReportData {
  const byMonth = new Map<string, CashbookRow[]>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const key = r.date.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      );
      return { key, rows: sorted, totals: sumTotals(sorted) };
    });
  const grand = {
    income: round2(months.reduce((s, m) => s + m.totals.income, 0)),
    purchase: round2(months.reduce((s, m) => s + m.totals.purchase, 0)),
    other: round2(months.reduce((s, m) => s + m.totals.other, 0)),
  };
  return { months, grand };
}

// ---------- วันที่ พ.ศ. ----------

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

/** "2026-01-15" → "15/01/2569" — คำนวณเองไม่ใช้ Intl ให้ deterministic ใน test */
export function thaiBuddhistDate(dateStr: string): string {
  const [y = "", m = "", d = ""] = dateStr.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

/** "2026-01" → "มกราคม 2569" — ใช้กับแถวรวมรายเดือนและช่วงเวลาในหัวรายงาน */
export function thaiMonthYearLabel(ym: string): string {
  const [y = "", m = ""] = ym.split("-");
  return `${THAI_MONTHS[Number(m) - 1] ?? m} ${Number(y) + 543}`;
}

// ---------- หัวรายงาน ----------

export interface CashbookHeader {
  ownerName: string;
  shopName: string;
  taxId: string;
  address: string;
}

/** เลขประจำตัวผู้เสียภาษีบุคคลธรรมดา = เลขบัตรประชาชน 13 หลัก (checksum mod 11) */
export function isValidThaiTaxId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const sum = id
    .slice(0, 12)
    .split("")
    .reduce((s, ch, i) => s + Number(ch) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

// ---------- CSV ----------

export const CASHBOOK_CSV_HEADER = [
  "วัน/เดือน/ปี",
  "รายการ",
  "รายรับ",
  "รายจ่าย: ซื้อสินค้า",
  "รายจ่าย: อื่น ๆ",
  "หมายเหตุ",
] as const;

/** free text (รายการ/หมายเหตุ/หัวรายงาน) อาจมี comma/quote — ต้อง escape ตาม RFC 4180 */
const csvCell = (s: string): string =>
  /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

const amountCells = (t: CashbookTotals): string[] => [
  t.income.toFixed(2),
  t.purchase.toFixed(2),
  t.other.toFixed(2),
];

/** ขึ้นต้นด้วย BOM ให้ Excel เปิดภาษาไทยไม่เพี้ยน — ตัวเลข toFixed(2) ไม่คั่นหลักพัน */
export function cashbookToCsv(
  data: CashbookReportData,
  header: CashbookHeader,
  from: string,
  to: string,
): string {
  const lines = [
    "รายงานเงินสดรับ-จ่าย",
    `ชื่อผู้ประกอบการ,${csvCell(header.ownerName)}`,
    `ชื่อร้าน/กิจการ,${csvCell(header.shopName)}`,
    `เลขประจำตัวผู้เสียภาษี,${csvCell(header.taxId)}`,
    `ที่อยู่,${csvCell(header.address)}`,
    `ช่วงเวลา,${csvCell(
      `${thaiMonthYearLabel(from.slice(0, 7))} ถึง ${thaiMonthYearLabel(to.slice(0, 7))}`,
    )}`,
    "",
    CASHBOOK_CSV_HEADER.join(","),
  ];
  for (const month of data.months) {
    for (const r of month.rows) {
      lines.push(
        [
          thaiBuddhistDate(r.date),
          csvCell(r.description),
          r.kind === "income" ? r.amount.toFixed(2) : "",
          r.kind === "purchase" ? r.amount.toFixed(2) : "",
          r.kind === "other" ? r.amount.toFixed(2) : "",
          csvCell(r.note),
        ].join(","),
      );
    }
    lines.push(
      [
        "",
        csvCell(`รวมประจำเดือน ${thaiMonthYearLabel(month.key)}`),
        ...amountCells(month.totals),
        "",
      ].join(","),
    );
  }
  lines.push(["", "รวมทั้งสิ้น", ...amountCells(data.grand), ""].join(","));
  // สตริงตัวแรกคือ U+FEFF (BOM) ตัวเดียว — มองไม่เห็นในบรรทัดนี้แต่ต้องคงไว้
  return "﻿" + lines.join("\r\n");
}
