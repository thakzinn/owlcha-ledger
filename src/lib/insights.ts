import { canonicalName, type Catalog, expandCategoryMappings, prepareReportEntries } from "@/lib/catalog";
import { nextDateStr } from "@/lib/date";
import type { RangeEntry } from "@/lib/sheets";
import type { CategoryMappingInput } from "@/lib/expense-report";
import { buildExpenseReport } from "@/lib/expense-report";
import { buildIncomeReport, classifyIncome } from "@/lib/income-report";
import { round2 } from "@/lib/pnd94";

export function monthWindow(today: string) {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const previousStart = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}-01`;
  const previousEnd = `${previousStart.slice(0, 7)}-${String(new Date(Date.UTC(year, month - 1, 0)).getUTCDate()).padStart(2, "0")}`;
  const comparableEnd = `${previousStart.slice(0, 7)}-${String(Math.min(Number(today.slice(8)), Number(previousEnd.slice(8)))).padStart(2, "0")}`;
  return { currentStart: `${today.slice(0, 7)}-01`, previousStart, previousEnd, comparableEnd };
}

function summarizeMoney(entries: readonly RangeEntry[], from: string, to: string) {
  let received = 0, spent = 0, knownGross = 0, fees = 0, missingGross = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    if (e.amount < 0) { spent -= e.amount; continue; }
    received += e.amount;
    if (classifyIncome(e.description, e.channel) === "delivery") {
      if (e.gross == null || e.gross < e.amount) missingGross++;
      else { knownGross += e.gross; fees += e.gross - e.amount; }
    } else knownGross += e.amount;
  }
  return { received: round2(received), spent: round2(spent), balance: round2(received - spent), knownGross: round2(knownGross), fees: round2(fees), missingGross };
}

export function buildDashboard(entries: readonly RangeEntry[], mappings: readonly CategoryMappingInput[], today: string) {
  const window = monthWindow(today);
  const expenses = buildExpenseReport(entries, mappings, window.currentStart, today);
  const income = buildIncomeReport(entries, window.currentStart, today);
  return {
    window,
    current: summarizeMoney(entries, window.currentStart, today),
    previous: summarizeMoney(entries, window.previousStart, window.comparableEnd),
    previousFull: summarizeMoney(entries, window.previousStart, window.previousEnd),
    expenseCategories: expenses.categories.map((name, i) => ({ name, amount: expenses.categoryTotals[i] ?? 0 }))
      .concat([{ name: "ยังไม่จัดหมวด", amount: expenses.uncategorizedTotal.amount }])
      .sort((a, b) => b.amount - a.amount).filter(c => c.amount !== 0),
    incomeChannels: [
      { name: "เงินสดหน้าร้าน", amount: income.cashTotal },
      { name: "โอนสุทธิ (หักคืนลูกค้า)", amount: income.transferTotal },
      { name: "เดลิเวอรี: เงินรับจริง", amount: income.deliveryTotal },
      { name: "ยังไม่จัดประเภท", amount: income.uncategorizedTotal.amount },
    ],
  };
}

export type IssueKind = "missing-day" | "duplicate" | "zero" | "unnamed" | "uncategorized" | "alias" | "estimated" | "gross-invalid";
export interface Anomaly {
  id: string; kind: IssueKind; date: string; description: string; detail: string;
  report?: "income" | "expenses";
}
export const ISSUE_LABELS: Record<IssueKind, string> = {
  "missing-day": "วันไม่มีข้อมูล", duplicate: "รายการอาจซ้ำ", zero: "ยอดเป็นศูนย์",
  unnamed: "ไม่มีชื่อรายการ", uncategorized: "ยังไม่จัดหมวด/ประเภท", alias: "ชื่อเรียกอื่นที่รวมแล้ว",
  estimated: "ยอดขายเต็มยังไม่ยืนยัน", "gross-invalid": "ยอดขายเต็มผิดปกติ",
};

export function findAnomalies(entries: readonly RangeEntry[], mappings: readonly CategoryMappingInput[], catalog: Catalog, from: string, to: string, today: string): Anomaly[] {
  const end = to < today ? to : today;
  const rows = entries.filter(e => e.date >= from && e.date <= end);
  const result: Anomaly[] = [];
  const add = (kind: IssueKind, date: string, description: string, detail: string, report?: Anomaly["report"]) =>
    result.push({ id: `${kind}:${result.length}`, kind, date, description, detail, report });
  const dates = new Set(rows.map(e => e.date));
  for (let d = from; d <= end; d = nextDateStr(d)) {
    if (!dates.has(d)) add("missing-day", d, "", "ไม่มีรายการในวันนั้น อาจเป็นวันหยุดร้าน ไม่ได้ยืนยันว่าลืมบันทึก");
  }
  const expanded = expandCategoryMappings(mappings, catalog);
  const countedNames = new Set(expanded.map(m => m.item.trim()));
  const duplicates = new Map<string, number>();
  for (const e of rows) {
    const name = canonicalName(e.description, catalog.items);
    const key = JSON.stringify([e.date, name, e.amount, e.channel]);
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }
  const shown = new Set<string>();
  for (const e of rows) {
    const name = canonicalName(e.description, catalog.items);
    const key = JSON.stringify([e.date, name, e.amount, e.channel]);
    if ((duplicates.get(key) ?? 0) > 1 && !shown.has(key)) {
      add("duplicate", e.date, name, `${duplicates.get(key)} รายการชื่อ ยอด และช่องทางตรงกัน อาจเป็นคนละธุรกรรม ต้องตรวจเอง`);
      shown.add(key);
    }
    if (!e.description.trim()) add("unnamed", e.date, "", "กรอกชื่อรายการเพื่อให้ค้นหาและจัดหมวดได้");
    if (e.amount === 0) add("zero", e.date, name, "ยอด 0 บาท โปรดยืนยันว่าเป็นข้อมูลที่ตั้งใจบันทึก");
    if (e.amount < 0 && !countedNames.has(name)) add("uncategorized", e.date, name, "ยังไม่มี mapping หมวดหมู่สำหรับชื่อมาตรฐานนี้", "expenses");
    if (e.amount > 0 && classifyIncome(name, e.channel) === "uncategorized") add("uncategorized", e.date, name, "รายรับยังไม่เข้ากติกาจัดช่องทาง ตรวจชื่อมาตรฐานและประเภทของรายการ", "income");
    if (name !== e.description.trim()) add("alias", e.date, e.description, `รวมในรายงานเป็น “${name}” แล้ว ข้อความต้นฉบับในชีตไม่เปลี่ยน`);
    if (e.amount > 0 && classifyIncome(name, e.channel) === "delivery") {
      if (e.gross == null) add("estimated", e.date, name, "ไม่มียอดขายเต็มจาก statement รายงานภาษีอาจใช้ค่าประมาณ");
      else if (e.gross < e.amount) add("gross-invalid", e.date, name, "ยอดขายเต็มน้อยกว่าเงินรับจริง");
    }
  }
  return result;
}

export function buildInsights(entries: readonly RangeEntry[], mappings: readonly CategoryMappingInput[], catalog: Catalog, from: string, to: string, today: string) {
  return {
    today, from, to,
    dashboard: buildDashboard(prepareReportEntries(entries, catalog), expandCategoryMappings(mappings, catalog), today),
    issues: findAnomalies(entries, mappings, catalog, from, to, today),
  };
}
export type InsightsData = ReturnType<typeof buildInsights>;
