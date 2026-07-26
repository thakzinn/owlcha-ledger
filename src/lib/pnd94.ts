import { isValidDateStr } from "@/lib/date";

/**
 * Logic ล้วนของหน้ารายงานภาษีครึ่งปี ภ.ง.ด.94 (ADR §11.8) — ห้าม import React/server
 *
 * สูตร GP (ทิศทางไปข้างหน้า gross → net — คนละทิศกับ gpBreakdownFromNet ใน LedgerApp):
 *   GP = gross × อัตรา GP, VAT = GP × 7%, ยอดหัก = GP + VAT, สุทธิ = gross − ยอดหัก
 * ปัดเศษ half-up 2 ตำแหน่ง "ระดับรายการ" แล้วจึงรวม — deduction/net ต้องคำนวณจาก
 * component ที่ปัดแล้วเสมอ เพื่อให้ตัวเลขในตารางบวกกันลงตัวทุกแถว
 */

export const CHANNELS = [
  "Grab",
  "LINE MAN",
  "ShopeeFood",
  "egest",
  "หน้าร้าน",
  "kshop",
  "คนละครึ่ง",
  "อื่น ๆ",
] as const;
export type Pnd94Channel = (typeof CHANNELS)[number];

/** ช่องทาง online delivery ที่โดนหัก GP — ที่เหลือคือรายรับเต็มจำนวน */
export function isDeliveryChannel(c: Pnd94Channel): boolean {
  return c === "Grab" || c === "LINE MAN" || c === "ShopeeFood" || c === "egest";
}

export interface SalesEntry {
  id: string;
  /** YYYY-MM-DD (ค.ศ. เสมอ) */
  date: string;
  channel: Pnd94Channel;
  /** ยอดขายเต็มก่อนหัก GP */
  gross: number;
  /** รายละเอียดจากชีต (เฉพาะแถวที่ดึงจากสมุดบัญชี) — ให้ผู้ใช้แยกรายรับที่ไม่ใช่ยอดขายออกได้ */
  description?: string;
  /** true = คอลัมน์ F ว่าง gross มาจากการคำนวณย้อนจากยอดสุทธิ — ต้องให้ผู้ใช้ตรวจ */
  estimated?: boolean;
  /** ยอดสุทธิจริงจากชีต (คอลัมน์ D) — source of truth ของเงินเข้าบัญชี */
  sheetNet?: number;
}

export type GpRates = Record<Pnd94Channel, number>;
export const DEFAULT_GP_RATES: GpRates = {
  Grab: 30,
  "LINE MAN": 30,
  ShopeeFood: 30,
  egest: 30,
  หน้าร้าน: 0,
  kshop: 0,
  คนละครึ่ง: 0,
  "อื่น ๆ": 0,
};
export const VAT_PCT = 7;

/**
 * ปัดเศษ half-up 2 ตำแหน่งแบบ float-safe: toFixed(4) ล้าง representation error
 * ก่อน Math.round — ห้ามใช้ Math.round((n+EPSILON)*100)/100 เพราะ EPSILON เล็ก
 * เกินกว่าจะชดเชยเคสอย่าง 6.85×0.30 = 2.0549999999999997 (ต้องได้ 2.06 ไม่ใช่ 2.05)
 */
export function round2(n: number): number {
  return Math.round(Number((n * 100).toFixed(4))) / 100;
}

export interface GpBreakdown {
  gp: number;
  vat: number;
  deduction: number;
  net: number;
}

export function gpForward(
  gross: number,
  gpPct: number,
  vatPct: number = VAT_PCT,
): GpBreakdown {
  const gp = round2(gross * (gpPct / 100));
  const vat = round2(gp * (vatPct / 100));
  const deduction = round2(gp + vat);
  const net = round2(gross - deduction);
  return { gp, vat, deduction, net };
}

/** ย้อนกลับ net → gross สำหรับแถวชีตที่คอลัมน์ F ว่าง — factor ≤ 0 (อัตรารวมเกิน 100%) = null */
export function grossFromNet(
  net: number,
  gpPct: number,
  vatPct: number = VAT_PCT,
): number | null {
  const factor = 1 - (gpPct / 100) * (1 + vatPct / 100);
  if (factor <= 0) return null;
  return round2(net / factor);
}

export interface ChannelSummary {
  channel: Pnd94Channel;
  count: number;
  gross: number;
  gp: number;
  vat: number;
  deduction: number;
  net: number;
}

export interface Pnd94Summary {
  rows: ChannelSummary[];
  total: ChannelSummary;
  /** แถวประมาณการ (F ว่าง) ในช่วง — ใช้แสดงหมายเหตุเทียบเงินเข้าจริงใต้ตาราง */
  estimated: { count: number; sheetNet: number; computedNet: number };
}

/**
 * สรุปตามช่องทางในช่วง [from, to] (inclusive, string compare ได้เพราะ YYYY-MM-DD)
 * คอลัมน์สุทธิมาจาก gpForward เสมอ (tax view ล้วน — ไม่ใช้ sheetNet) เพื่อให้
 * gp/vat/deduction/net ในตาราง consistent; ความต่างกับเงินเข้าจริงอยู่ใน `estimated`
 */
export function summarize(
  entries: readonly SalesEntry[],
  rates: GpRates,
  from: string,
  to: string,
): Pnd94Summary {
  const zero = (channel: Pnd94Channel): ChannelSummary => ({
    channel,
    count: 0,
    gross: 0,
    gp: 0,
    vat: 0,
    deduction: 0,
    net: 0,
  });
  const byChannel = new Map<Pnd94Channel, ChannelSummary>();
  const total = zero(CHANNELS[0]);
  const estimated = { count: 0, sheetNet: 0, computedNet: 0 };

  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const b = gpForward(e.gross, rates[e.channel] ?? 0);
    const row = byChannel.get(e.channel) ?? zero(e.channel);
    row.count += 1;
    row.gross += e.gross;
    row.gp += b.gp;
    row.vat += b.vat;
    row.deduction += b.deduction;
    row.net += b.net;
    byChannel.set(e.channel, row);
    if (e.estimated) {
      estimated.count += 1;
      estimated.sheetNet += e.sheetNet ?? 0;
      estimated.computedNet += b.net;
    }
  }

  const rows = CHANNELS.filter((c) => byChannel.has(c)).map((c) => {
    const r = byChannel.get(c)!;
    // ปัดผลรวมกันเศษ float สะสม — ค่าที่รวมเป็นเลข 2 ตำแหน่งอยู่แล้ว
    return {
      ...r,
      gross: round2(r.gross),
      gp: round2(r.gp),
      vat: round2(r.vat),
      deduction: round2(r.deduction),
      net: round2(r.net),
    };
  });
  for (const r of rows) {
    total.count += r.count;
    total.gross += r.gross;
    total.gp += r.gp;
    total.vat += r.vat;
    total.deduction += r.deduction;
    total.net += r.net;
  }
  total.gross = round2(total.gross);
  total.gp = round2(total.gp);
  total.vat = round2(total.vat);
  total.deduction = round2(total.deduction);
  total.net = round2(total.net);
  estimated.sheetNet = round2(estimated.sheetNet);
  estimated.computedNet = round2(estimated.computedNet);

  return { rows, total, estimated };
}

// ---------- ช่วงวันที่ ----------

export type RangePreset = "H1" | "H2" | "FULL";

/** caller ต้องส่ง todayBangkok() เสมอ — กัน off-by-one ข้ามปีจาก timezone ฝั่ง client */
export function presetRange(
  preset: RangePreset,
  today: string,
): { from: string; to: string } {
  const y = today.slice(0, 4);
  switch (preset) {
    case "H1":
      return { from: `${y}-01-01`, to: `${y}-06-30` };
    case "H2":
      return { from: `${y}-07-01`, to: `${y}-12-31` };
    case "FULL":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

// ---------- CSV ----------

const CSV_HEADER = [
  "ช่องทาง",
  "จำนวนรายการ",
  "ยอดขายรวม (ก่อนหัก GP)",
  "ค่า GP รวม",
  "VAT ของ GP รวม",
  "ยอดหักรวม",
  "ยอดรับสุทธิรวม",
];

/** ขึ้นต้นด้วย BOM ให้ Excel เปิดภาษาไทยไม่เพี้ยน — ตัวเลข toFixed(2) ไม่คั่นหลักพัน */
export function summaryToCsv(
  summary: Pnd94Summary,
  from: string,
  to: string,
): string {
  const row = (label: string, r: ChannelSummary) =>
    [
      label,
      String(r.count),
      r.gross.toFixed(2),
      r.gp.toFixed(2),
      r.vat.toFixed(2),
      r.deduction.toFixed(2),
      r.net.toFixed(2),
    ].join(",");
  const lines = [
    `รายงานสรุปยอดขายยื่น ภ.ง.ด.94 ช่วง ${from} ถึง ${to}`,
    CSV_HEADER.join(","),
    ...summary.rows.map((r) => row(r.channel, r)),
    row("รวมทั้งหมด", summary.total),
  ];
  // สตริงตัวแรกคือ U+FEFF (BOM) ตัวเดียว — มองไม่เห็นในบรรทัดนี้แต่ต้องคงไว้
  return "﻿" + lines.join("\r\n");
}

// ---------- วาง bulk จาก Excel/CSV ----------

export interface ParseResult {
  entries: Omit<SalesEntry, "id">[];
  errors: { line: number; reason: string }[];
}

/** ปี ≥ 2400 ถือเป็น พ.ศ. → ลบ 543; คืน YYYY-MM-DD หรือ null ถ้าไม่ใช่วันที่จริง */
function normalizeDateCell(cell: string): string | null {
  const t = cell.trim();
  let y: number, m: string, d: string;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (iso) {
    y = Number(iso[1]);
    m = iso[2]!;
    d = iso[3]!;
  } else if (dmy) {
    y = Number(dmy[3]);
    m = dmy[2]!;
    d = dmy[1]!;
  } else {
    return null;
  }
  if (y >= 2400) y -= 543;
  const s = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isValidDateStr(s) ? s : null;
}

/** map ชื่อช่องทางแบบหลวม ๆ — ไม่รู้จักแต่ไม่ว่าง = อื่น ๆ, ว่าง = null (error) */
function normalizeChannelCell(cell: string): Pnd94Channel | null {
  const t = cell.trim();
  if (!t) return null;
  if (/grab|แกร็บ/i.test(t)) return "Grab";
  if (/line\s*man|ไลน์แมน/i.test(t)) return "LINE MAN";
  if (/shopee|ช้อปปี้/i.test(t)) return "ShopeeFood";
  if (/egest|อีเจส/i.test(t)) return "egest";
  if (/kshop|k\s*shop/i.test(t)) return "kshop";
  if (/คนละครึ่ง/.test(t)) return "คนละครึ่ง";
  if (/หน้าร้าน|เงินสด|walk/i.test(t)) return "หน้าร้าน";
  return "อื่น ๆ";
}

function parseGrossCell(cell: string): number | null {
  const t = cell.replace(/[,฿\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

/**
 * รับข้อความวางจาก Excel (TSV) หรือ CSV คอลัมน์: วันที่, ช่องทาง, ยอดขาย
 * - CSV ที่ยอดมี comma (1,234.50): สองคอลัมน์แรกคือวันที่/ช่องทาง ที่เหลือรวมเป็นยอด
 * - บรรทัดแรกที่ทั้งวันที่และยอดไม่ parse ได้ = หัวตาราง → ข้ามเงียบ ๆ
 * - บรรทัดผิดรายงานเลขบรรทัด (1-based) บรรทัดดีนำเข้าต่อ
 */
export function parsePasted(text: string): ParseResult {
  const entries: Omit<SalesEntry, "id">[] = [];
  const errors: { line: number; reason: string }[] = [];
  const lines = text.split(/\r?\n/);
  let firstDataSeen = false;

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    if (!rawLine.trim()) return;
    let cells: string[];
    if (rawLine.includes("\t")) {
      cells = rawLine.split("\t");
    } else {
      const parts = rawLine.split(",");
      // ยอดขายแบบ "1,234.50" ถูก comma ผ่าเป็นหลายช่อง — รวมส่วนเกินกลับเป็นช่องยอด
      cells =
        parts.length > 3
          ? [parts[0]!, parts[1]!, parts.slice(2).join(",")]
          : parts;
    }
    const [dateCell = "", channelCell = "", grossCell = ""] = cells.map((c) =>
      c.trim(),
    );

    const date = normalizeDateCell(dateCell);
    const gross = parseGrossCell(grossCell);

    if (!firstDataSeen && date === null && gross === null) return; // หัวตาราง
    if (date === null) {
      errors.push({ line: lineNo, reason: `วันที่ไม่ถูกต้อง: "${dateCell}"` });
      return;
    }
    const channel = normalizeChannelCell(channelCell);
    if (channel === null) {
      errors.push({ line: lineNo, reason: "ไม่ได้ระบุช่องทาง" });
      return;
    }
    if (gross === null) {
      errors.push({ line: lineNo, reason: `ยอดขายไม่ถูกต้อง: "${grossCell}"` });
      return;
    }
    firstDataSeen = true;
    entries.push({ date, channel, gross });
  });

  return { entries, errors };
}

// ---------- ดึงจากชีต ----------

/**
 * แยกช่องทางจาก description — delivery ตรงกับ isDeliveryDesc เดิมใน LedgerApp
 * (/grab|lineman|shopee/i); รายรับหน้าร้านแยกประเภทหลักของร้าน: kshop / คนละครึ่ง /
 * ที่เหลือ = ขายหน้าร้าน
 */
export function channelFromDescription(desc: string): Pnd94Channel {
  if (/grab/i.test(desc)) return "Grab";
  if (/line\s*man/i.test(desc)) return "LINE MAN";
  if (/shopee/i.test(desc)) return "ShopeeFood";
  if (/egest|อีเจส/i.test(desc)) return "egest";
  if (/kshop|k\s*shop/i.test(desc)) return "kshop";
  if (/คนละครึ่ง/.test(desc)) return "คนละครึ่ง";
  return "หน้าร้าน";
}

// ---------- แสดงผล ----------

export function fmtBaht(n: number): string {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
