import { round2 } from "@/lib/pnd94";

/**
 * Logic ล้วนของหน้ารายงานค่าใช้จ่ายรายเดือน × หมวดหมู่ — ห้าม import React/server
 *
 * กติกาจับคู่: description ของแถวรายจ่าย (amount < 0) trim แล้วเทียบกับชื่อ
 * "รายการ" ในแท็บหมวดหมู่แบบ exact + case-sensitive; ชื่อซ้ำหลายแถวใช้แถวบนสุด
 * (first-wins) และรายงานชื่อนั้นใน duplicateItems ให้ UI เตือน
 * ปัดเศษด้วย round2 ระดับเซลล์หลังรวมยอดดิบ เพื่อให้ตารางบวกกันลงตัว
 */

export const EXPENSE_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

export const UNCATEGORIZED_LABEL = "ยังไม่จัดหมวด";
export const NOT_COUNTED_LABEL = "ไม่นับเป็นค่าใช้จ่าย (หักจากรายได้)";

/** subset ของ RangeEntry จาก /api/entries/range ที่รายงานนี้ใช้ */
export interface ExpenseEntry {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** มีเครื่องหมาย — รายจ่ายคือค่าติดลบ */
  amount: number;
}

export interface CategoryMappingInput {
  category: string;
  item: string;
  counted: boolean;
  note: string;
}

export interface UncategorizedCell {
  amount: number;
  count: number;
}

export interface MonthCells {
  /** ปี ค.ศ. ของเดือนนี้ */
  year: number;
  /** เดือน 1–12 */
  month: number;
  /** ป้ายแสดงผล เช่น "ม.ค." หรือ "ม.ค. 2026" เมื่อช่วงคร่อมหลายปี */
  label: string;
  /** ยอดต่อหมวด index ตรงกับ report.categories */
  cells: number[];
  uncategorized: UncategorizedCell;
  /** ยอดแถว mapping counted=false ของเดือนนั้น — ไม่รวมใน total */
  notCounted: number;
  /** รวมทุกหมวด + ยังไม่จัดหมวด (ไม่รวม notCounted) */
  total: number;
}

export interface UncategorizedItem {
  item: string;
  amount: number;
  count: number;
}

export interface ExpenseReport {
  /** เฉพาะหมวดที่มีแถว counted=true — ลำดับ = ปรากฏครั้งแรกในแท็บ (บน→ล่าง) */
  categories: string[];
  /** ทุกเดือนปฏิทินที่คาบเกี่ยวช่วง [from, to] เรียงตามเวลา เดือนไม่มีข้อมูล = 0 ทั้งแถว */
  months: MonthCells[];
  categoryTotals: number[];
  uncategorizedTotal: UncategorizedCell;
  notCountedTotal: number;
  /** รวมทั้งปี = หมวดทั้งหมด + ยังไม่จัดหมวด (ไม่รวม notCounted) */
  grandTotal: number;
  /** รายการติดลบที่ไม่ match mapping ใด (distinct หลัง trim) เรียงยอดมาก→น้อย */
  uncategorizedItems: UncategorizedItem[];
  /** ชื่อรายการที่ปรากฏ >1 แถวในแท็บ — ใช้แถวบนสุด และให้ UI แสดงคำเตือน */
  duplicateItems: string[];
}

/**
 * รายการเดือนปฏิทินทั้งหมดที่คาบเกี่ยว [from, to] (YYYY-MM-DD, from <= to)
 * ป้ายใส่ปีต่อท้ายเฉพาะเมื่อช่วงคร่อมมากกว่า 1 ปี ตารางปีเดียวจะได้อ่านโล่งเหมือนเดิม
 */
export function monthsInRange(
  from: string,
  to: string,
): { year: number; month: number; label: string }[] {
  const start = Number(from.slice(0, 4)) * 12 + (Number(from.slice(5, 7)) - 1);
  const end = Number(to.slice(0, 4)) * 12 + (Number(to.slice(5, 7)) - 1);
  const multiYear = from.slice(0, 4) !== to.slice(0, 4);
  const out: { year: number; month: number; label: string }[] = [];
  for (let i = start; i <= end; i++) {
    const year = Math.floor(i / 12);
    const month = (i % 12) + 1;
    const name = EXPENSE_MONTHS[month - 1]!;
    out.push({ year, month, label: multiYear ? `${name} ${year}` : name });
  }
  return out;
}

export function buildExpenseReport(
  entries: readonly ExpenseEntry[],
  mappings: readonly CategoryMappingInput[],
  from: string,
  to: string,
): ExpenseReport {
  // mapping แบบ first-wins ตามลำดับแถวในแท็บ + เก็บชื่อซ้ำไว้เตือน
  const byItem = new Map<string, CategoryMappingInput>();
  const duplicates = new Set<string>();
  for (const m of mappings) {
    const item = m.item.trim();
    if (!item) continue;
    if (byItem.has(item)) duplicates.add(item);
    else byItem.set(item, m);
  }

  // ลำดับคอลัมน์ = หมวดปรากฏครั้งแรกในแท็บ เฉพาะหมวดที่มีแถว counted=true
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  for (const m of byItem.values()) {
    if (!m.counted) continue;
    if (!catIndex.has(m.category)) {
      catIndex.set(m.category, categories.length);
      categories.push(m.category);
    }
  }

  const monthList = monthsInRange(from, to);
  const monthIndex = new Map(monthList.map((m, i) => [`${m.year}-${m.month}`, i]));
  const rawMonths = monthList.map(() => ({
    cells: categories.map(() => 0),
    uncategorized: { amount: 0, count: 0 },
    notCounted: 0,
  }));
  const uncatByItem = new Map<string, { amount: number; count: number }>();

  for (const e of entries) {
    if (e.amount >= 0 || e.date < from || e.date > to) continue;
    const mi = monthIndex.get(
      `${Number(e.date.slice(0, 4))}-${Number(e.date.slice(5, 7))}`,
    );
    const month = mi !== undefined ? rawMonths[mi] : undefined;
    if (!month) continue; // วันที่เพี้ยน (เดือนนอก 01–12) = ข้อมูลเสีย ข้ามไป
    const amount = Math.abs(e.amount);
    const key = e.description.trim();
    const mapping = byItem.get(key);

    if (!mapping) {
      month.uncategorized.amount += amount;
      month.uncategorized.count += 1;
      const agg = uncatByItem.get(key) ?? { amount: 0, count: 0 };
      agg.amount += amount;
      agg.count += 1;
      uncatByItem.set(key, agg);
    } else if (!mapping.counted) {
      month.notCounted += amount;
    } else {
      const ci = catIndex.get(mapping.category)!;
      month.cells[ci]! += amount;
    }
  }

  // ปัดเศษระดับเซลล์ก่อน แล้วรวมจากค่าที่ปัดแล้ว → ตารางบวกกันลงตัวทุกแถว/คอลัมน์
  const months: MonthCells[] = rawMonths.map((m, i) => {
    const cells = m.cells.map(round2);
    const uncategorized = {
      amount: round2(m.uncategorized.amount),
      count: m.uncategorized.count,
    };
    return {
      ...monthList[i]!,
      cells,
      uncategorized,
      notCounted: round2(m.notCounted),
      total: round2(cells.reduce((s, c) => s + c, 0) + uncategorized.amount),
    };
  });

  const categoryTotals = categories.map((_, ci) =>
    round2(months.reduce((s, m) => s + m.cells[ci]!, 0)),
  );
  const uncategorizedTotal = {
    amount: round2(months.reduce((s, m) => s + m.uncategorized.amount, 0)),
    count: months.reduce((s, m) => s + m.uncategorized.count, 0),
  };

  return {
    categories,
    months,
    categoryTotals,
    uncategorizedTotal,
    notCountedTotal: round2(months.reduce((s, m) => s + m.notCounted, 0)),
    grandTotal: round2(months.reduce((s, m) => s + m.total, 0)),
    uncategorizedItems: [...uncatByItem.entries()]
      .map(([item, agg]) => ({
        item,
        amount: round2(agg.amount),
        count: agg.count,
      }))
      .sort((a, b) => b.amount - a.amount || a.item.localeCompare(b.item, "th")),
    duplicateItems: [...duplicates],
  };
}
