import { z } from "zod";
import { dateSchema } from "@/lib/schema";

const draftSchema = z.object({
  date: dateSchema,
  version: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  latestDate: dateSchema.nullable(),
  entries: z.array(z.object({
    type: z.enum(["income", "expense"]), description: z.string().max(200),
    amount: z.string().max(64), channel: z.enum(["เงินสด", "โอน"]),
    gpPct: z.string().max(64).optional(), vatPct: z.string().max(64).optional(),
    gross: z.string().max(64).optional(),
  })).min(1).max(100),
});
export type LedgerDraft = z.infer<typeof draftSchema>;

export function readDraft(storage: Pick<Storage, "getItem">, key: string, date: string): LedgerDraft | null {
  const raw = storage.getItem(`${key}:${date}`) ?? storage.getItem(key);
  if (!raw) return null;
  const parsed = draftSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("ฉบับร่างมีรูปแบบไม่ถูกต้อง ข้อมูลบนชีตยังไม่เปลี่ยน");
  return parsed.data.date === date ? parsed.data : null;
}
