import { z } from "zod";

const nameSchema = z.string().trim().min(1, "กรุณาใส่ชื่อรายการ").max(200);
const normalize = (value: string) => value.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

export const catalogSchema = z.object({
  items: z.array(z.object({
    name: nameSchema,
    aliases: z.array(nameSchema).max(30),
    favorite: z.boolean(),
  })).max(100),
  recurring: z.array(z.object({
    description: nameSchema,
    type: z.enum(["income", "expense"]),
    channel: z.enum(["เงินสด", "โอน"]),
    amount: z.string().refine(v => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 99_999_999.99), "จำนวนเงินต้องเป็นค่าบวกหรือศูนย์ ทศนิยมไม่เกิน 2 ตำแหน่ง หรือเว้นว่าง"),
  })).max(100),
}).superRefine((catalog, ctx) => {
  const seen = new Set<string>();
  for (const [index, item] of catalog.items.entries()) {
    for (const label of [item.name, ...item.aliases]) {
      const key = normalize(label);
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items", index], message: `ชื่อหรือชื่อเรียกอื่นซ้ำกัน: ${label}` });
      seen.add(key);
    }
  }
  if (JSON.stringify(catalog).length > 45_000) ctx.addIssue({ code: "custom", message: "การตั้งค่ามีขนาดใหญ่เกินไป" });
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogItem = Catalog["items"][number];
export type RecurringItem = Catalog["recurring"][number];
export interface DescriptionUsage { name: string; count: number; type?: "income" | "expense"; channel?: "เงินสด" | "โอน" }
export interface CatalogData { catalog: Catalog; version: string; usage: DescriptionUsage[] }

export function defaultCatalog(): Catalog {
  return {
    items: [],
    recurring: [
      { type: "expense", description: "น้ำแข็ง", channel: "โอน", amount: "" },
      { type: "expense", description: "ค่าแรงพนักงาน", channel: "โอน", amount: "" },
      { type: "income", description: "ขายหน้าร้าน", channel: "เงินสด", amount: "" },
      { type: "income", description: "kshop", channel: "โอน", amount: "" },
      { type: "income", description: "grab", channel: "โอน", amount: "" },
    ],
  };
}

export function canonicalName(description: string, items: readonly CatalogItem[]): string {
  const key = normalize(description);
  return items.find(i => [i.name, ...i.aliases].some(n => normalize(n) === key))?.name ?? description.trim();
}

export interface Suggestion { name: string; reason: "alias" | "similar" | "name"; favorite: boolean }

export function suggestItems(query: string, items: readonly CatalogItem[], history: readonly string[]): Suggestion[] {
  const q = normalize(query);
  const candidates = new Map<string, CatalogItem>();
  for (const i of items) candidates.set(i.name, i);
  for (const name of history) {
    const canonical = canonicalName(name, items);
    if (!candidates.has(canonical)) candidates.set(canonical, { name: canonical, aliases: [], favorite: false });
  }
  const results: (Suggestion & { score: number })[] = [];
  for (const item of candidates.values()) {
    const labels = [item.name, ...item.aliases];
    let best = 0;
    let reason: Suggestion["reason"] = "name";
    for (const [index, label] of labels.entries()) {
      const key = normalize(label);
      const a = q.replace(/^ค่า/, "").replace(/\s/g, "");
      const b = key.replace(/^ค่า/, "").replace(/\s/g, "");
      const grams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
      const qa = grams(a), kb = grams(b);
      const overlap = [...qa].filter(g => kb.has(g)).length;
      const similarity = qa.size + kb.size ? 2 * overlap / (qa.size + kb.size) : 0;
      const score = !q ? (item.favorite ? 2 : 1) : key === q ? 5 : key.includes(q) ? 4 : a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)) ? 3 : similarity >= 0.55 && a.length >= 3 ? similarity : 0;
      if (score > best) {
        best = score;
        reason = index > 0 ? "alias" : score < 4 ? "similar" : "name";
      }
    }
    if (best > 0) results.push({ name: item.name, favorite: item.favorite, reason, score: best });
  }
  return results.sort((a, b) => b.score - a.score || Number(b.favorite) - Number(a.favorite)).slice(0, 6).map(({ name, reason, favorite }) => ({ name, reason, favorite }));
}

export function prepareReportEntries<T extends { description: string }>(entries: readonly T[], catalog: Catalog): (T & { originalDescription: string })[] {
  return entries.map(e => ({ ...e, description: canonicalName(e.description, catalog.items), originalDescription: e.description }));
}

export function expandCategoryMappings<T extends { item: string }>(mappings: readonly T[], catalog: Catalog): T[] {
  const result = [...mappings];
  for (const item of catalog.items) {
    const mapping = mappings.find(m => m.item.trim() === item.name) ??
      mappings.find(m => canonicalName(m.item, catalog.items) === item.name);
    if (mapping && !result.some(m => m.item.trim() === item.name)) result.push({ ...mapping, item: item.name });
  }
  return result;
}
