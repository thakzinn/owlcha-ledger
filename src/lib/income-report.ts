import { round2 } from "@/lib/pnd94";
import { monthsInRange } from "@/lib/expense-report";

/**
 * Logic ล้วนของหน้ารายงานรายได้รายเดือน — ห้าม import React/server
 *
 * กติกาจัดประเภทเป็น hardcoded constants ไม่ทำแท็บแก้ได้เหมือนฝั่งค่าใช้จ่าย:
 * กติการายได้เป็น substring/prefix + เงื่อนไข channel ซึ่งถ้าให้ผู้ใช้แก้เอง
 * คำสั้น ๆ คำเดียวจับผิดได้ทั้งชีต ช่องทางรายรับของร้านนิ่งกว่ารายจ่ายมาก
 * และ bucket "ยังไม่จัดประเภท" ทำให้เห็นของแปลกใหม่ก่อนแล้วค่อยเพิ่ม keyword ในโค้ด
 */

// ⚠ dependency ข้ามรายงาน: รายการใน REFUND_ITEMS ต้องมีแถว counted=FALSE
// ในแท็บ "หมวดหมู่ค่าใช้จ่าย" เสมอ (seed หมวด "หักจากรายได้") — ถ้าแถวนั้นถูกลบ
// ยอดจะถูกหักฝั่งรายได้ และโผล่เป็น "ยังไม่จัดหมวด" ฝั่งรายจ่ายพร้อมกัน
// = นับซ้ำสองรายงาน
export const REFUND_ITEMS = ["โอนคืนลูกค้า"]; // exact match หลัง trim, เฉพาะ amount < 0

// ตัวสะกดผิด (robihood, foodpand, e- gest ฯลฯ) มีจริงในข้อมูล ห้ามตัดออก
// "food" ไม่ชน "foodstory" เพราะ foodstory เป็นรายจ่าย (ติดลบ) ถูกกรองออกก่อนถึงขั้น keyword
export const DELIVERY_KEYWORDS = [
  "grab", "lineman", "line man", "shopee", "ช้อปปี้", "robinhood", "robihood",
  "foodpanda", "foodpand", "panda", "food", "เดลิเวอรี่", "egest", "e- gest",
];

export const TRANSFER_KEYWORDS = ["kshop", "คนละครึ่ง", "true"];

// prefix สะกดเพี้ยน (ขานหน้าร้าน/ขายน้าร้าน) มีจริงในข้อมูล ห้ามตัดออก
export const STOREFRONT_PREFIXES = ["ขายหน้าร้าน", "ขานหน้าร้าน", "ขายน้าร้าน"];

export const CASH_CHANNELS = ["สด", "เงินสด"];

export const INCOME_UNCATEGORIZED_LABEL = "ยังไม่จัดประเภท";
export const TRANSFER_LABEL = "ยอดเงินโอนเข้า (ไม่รวมยอดเดลิ)";
export const DELIVERY_LABEL = "ยอดขายจากแอพเดลิ ทุกแบรนด์";
export const CASH_LABEL = "เงินสดหน้าร้าน";

/** subset ของ RangeEntry จาก /api/entries/range ที่รายงานนี้ใช้ */
export interface IncomeEntry {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** มีเครื่องหมาย — รายรับคือค่าบวก (ลบเฉพาะโอนคืนลูกค้าที่นำมาหักช่องโอน) */
  amount: number;
  channel: string;
}

export type IncomeBucket = "transfer" | "delivery" | "cash" | "uncategorized";

/**
 * จัดประเภทแถวรายรับ (amount > 0 เท่านั้น — refund เช็คแยกก่อนใน buildIncomeReport)
 * ลำดับ priority สำคัญมาก ห้ามสลับ:
 * 1. keyword เดลิเวอรี่ (substring บน lowercase)
 * 2. keyword โอน — ลำดับนี้ทำให้ "ขายหน้าร้าน true money" ลงช่องโอน
 *    (เจ้าของยืนยันแล้วว่าถูกต้อง)
 * 3. ขึ้นต้น "ขายหน้าร้าน" (รวมสะกดเพี้ยน) → channel สด/เงินสด = เงินสด, อื่น = โอน
 * 4. ไม่เข้าเลย = ยังไม่จัดประเภท
 */
export function classifyIncome(description: string, channel: string): IncomeBucket {
  const desc = description.trim();
  const lower = desc.toLowerCase();
  if (DELIVERY_KEYWORDS.some((k) => lower.includes(k))) return "delivery";
  if (TRANSFER_KEYWORDS.some((k) => lower.includes(k))) return "transfer";
  if (STOREFRONT_PREFIXES.some((p) => desc.startsWith(p))) {
    return CASH_CHANNELS.includes(channel.trim()) ? "cash" : "transfer";
  }
  return "uncategorized";
}

export interface IncomeUncategorized {
  amount: number;
  count: number;
}

export interface IncomeMonth {
  /** ปี ค.ศ. ของเดือนนี้ */
  year: number;
  /** เดือน 1–12 */
  month: number;
  /** ป้ายแสดงผล เช่น "ม.ค." หรือ "ม.ค. 2026" เมื่อช่วงคร่อมหลายปี */
  label: string;
  /** ช่องโอนสุทธิหลังหักโอนคืนลูกค้าแล้ว — ติดลบได้ถ้า refund > รายรับโอน (ห้าม clamp) */
  transfer: number;
  delivery: number;
  cash: number;
  uncategorized: IncomeUncategorized;
  /** ยอดโอนคืนลูกค้าที่ถูกหักออกจาก transfer เดือนนี้ (ไว้แสดงเชิงอรรถ) */
  refund: number;
  /** transfer + delivery + cash + uncategorized (transfer หัก refund แล้ว) */
  total: number;
}

export interface IncomeUncategorizedItem {
  item: string;
  amount: number;
  count: number;
}

export interface IncomeReport {
  /** ทุกเดือนปฏิทินที่คาบเกี่ยวช่วง [from, to] เรียงตามเวลา เดือนไม่มีข้อมูล = 0 ทั้งแถว */
  months: IncomeMonth[];
  transferTotal: number;
  deliveryTotal: number;
  cashTotal: number;
  uncategorizedTotal: IncomeUncategorized;
  refundTotal: number;
  /** รวมทุกช่อง + ยังไม่จัดประเภท (transfer สุทธิหลัง refund) */
  grandTotal: number;
  /** แถวบวกที่ไม่ match กติกาใด (distinct หลัง trim) เรียงยอดมาก→น้อย */
  uncategorizedItems: IncomeUncategorizedItem[];
}

export function buildIncomeReport(
  entries: readonly IncomeEntry[],
  from: string,
  to: string,
): IncomeReport {
  const monthList = monthsInRange(from, to);
  const monthIndex = new Map(monthList.map((m, i) => [`${m.year}-${m.month}`, i]));
  const rawMonths = monthList.map(() => ({
    transfer: 0,
    delivery: 0,
    cash: 0,
    uncategorized: { amount: 0, count: 0 },
    refund: 0,
  }));
  const uncatByItem = new Map<string, { amount: number; count: number }>();

  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const mi = monthIndex.get(
      `${Number(e.date.slice(0, 4))}-${Number(e.date.slice(5, 7))}`,
    );
    const month = mi !== undefined ? rawMonths[mi] : undefined;
    if (!month) continue; // วันที่เพี้ยน (เดือนนอก 01–12) = ข้อมูลเสีย ข้ามไป

    const desc = e.description.trim();

    // ลำดับ priority ห้ามสลับ — ข้อ 1 ต้องมาก่อนการกรองเครื่องหมาย
    // 1. โอนคืนลูกค้า (ติดลบ) → หักออกจากช่องโอนของเดือนนั้น
    //    (ฝั่งรายงานค่าใช้จ่ายแถวนี้ถูก exclude ด้วย counted=FALSE อยู่แล้ว ไม่นับซ้ำ)
    //    ที่บันทึกเป็นบวก = เครื่องหมายผิด → ตกไปข้อ 3–6 แล้วลงยังไม่จัดประเภท
    if (REFUND_ITEMS.includes(desc) && e.amount < 0) {
      const amount = Math.abs(e.amount);
      month.refund += amount;
      month.transfer -= amount;
      continue;
    }

    // 2. จากนี้เอาเฉพาะรายรับ — แถวลบทั่วไป (รวม lineman ติดลบ) เป็นรายจ่าย
    //    อยู่ในรายงานค่าใช้จ่ายแล้ว ห้ามเอามาหักช่องเดลิของรายงานนี้
    if (e.amount <= 0) continue;

    const bucket = classifyIncome(desc, e.channel);
    if (bucket === "uncategorized") {
      month.uncategorized.amount += e.amount;
      month.uncategorized.count += 1;
      const agg = uncatByItem.get(desc) ?? { amount: 0, count: 0 };
      agg.amount += e.amount;
      agg.count += 1;
      uncatByItem.set(desc, agg);
    } else {
      month[bucket] += e.amount;
    }
  }

  // ปัดเศษระดับเดือนก่อน แล้วรวมจากค่าที่ปัดแล้ว → ตารางบวกกันลงตัวทุกแถว/คอลัมน์
  const months: IncomeMonth[] = rawMonths.map((m, i) => {
    const transfer = round2(m.transfer);
    const delivery = round2(m.delivery);
    const cash = round2(m.cash);
    const uncategorized = {
      amount: round2(m.uncategorized.amount),
      count: m.uncategorized.count,
    };
    return {
      ...monthList[i]!,
      transfer,
      delivery,
      cash,
      uncategorized,
      refund: round2(m.refund),
      total: round2(transfer + delivery + cash + uncategorized.amount),
    };
  });

  return {
    months,
    transferTotal: round2(months.reduce((s, m) => s + m.transfer, 0)),
    deliveryTotal: round2(months.reduce((s, m) => s + m.delivery, 0)),
    cashTotal: round2(months.reduce((s, m) => s + m.cash, 0)),
    uncategorizedTotal: {
      amount: round2(months.reduce((s, m) => s + m.uncategorized.amount, 0)),
      count: months.reduce((s, m) => s + m.uncategorized.count, 0),
    },
    refundTotal: round2(months.reduce((s, m) => s + m.refund, 0)),
    grandTotal: round2(months.reduce((s, m) => s + m.total, 0)),
    uncategorizedItems: [...uncatByItem.entries()]
      .map(([item, agg]) => ({
        item,
        amount: round2(agg.amount),
        count: agg.count,
      }))
      .sort((a, b) => b.amount - a.amount || a.item.localeCompare(b.item, "th")),
  };
}
