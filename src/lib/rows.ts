import { createHash } from "node:crypto";
import { serialToDateStr } from "@/lib/date";

/**
 * ชั้นข้อมูลแถวของชีต (server เท่านั้น) — ทุกอย่างทำงานกับแถวที่ normalize แล้ว
 *
 * N13: values.get คืน "ragged rows" (แถวที่มีข้อมูลแค่ B–C จะได้ array ยาว 2)
 * และตัดแถวว่างท้ายทิ้ง → normalize ให้ยาว 4 ช่องที่จุดเดียวตรงนี้ ก่อนส่งไป
 * logic ใดก็ตาม (อ่านปกติ / version hash / เส้นคั่น) — กัน 409 ปลอมจากแถวสั้น
 * กับแถวเต็มที่ค่าว่างได้ hash ต่างกัน
 */

/** แถวข้อมูลเริ่มที่แถว 3 ของชีต (แถว 1–2 เป็นหัวตาราง) — ค่าคงที่ตัวเดียว ห้ามคำนวณกระจาย (N7) */
export const DATA_START_ROW = 3;

export interface SheetRow {
  /** YYYY-MM-DD ถ้าเซลล์เป็นวันที่จริง (serial number) — อื่น ๆ = null (ตรงพฤติกรรมเดิม: instanceof Date เท่านั้น) */
  date: string | null;
  description: string;
  amount: number;
  channel: string;
}

export function normalizeRow(raw: readonly unknown[]): SheetRow {
  const [rawDate, rawDesc, rawAmount, rawChannel] = raw;
  const date =
    typeof rawDate === "number" && Number.isFinite(rawDate)
      ? serialToDateStr(rawDate)
      : null;
  const amount =
    typeof rawAmount === "number" && Number.isFinite(rawAmount)
      ? rawAmount
      : Number(rawAmount) || 0;
  return {
    date,
    description: rawDesc == null ? "" : String(rawDesc),
    amount,
    channel: rawChannel == null ? "" : String(rawChannel),
  };
}

export function normalizeRows(raw: readonly unknown[][]): SheetRow[] {
  return raw.map(normalizeRow);
}

/**
 * version สำหรับ optimistic concurrency = SHA-256 ของ "เนื้อหา" แถวของวันนั้น
 * เท่านั้น (เรียงตามลำดับที่ปรากฏ) — จงใจไม่ผสมเลขแถว เพราะการแก้วันอื่น
 * ทำเลขแถวเลื่อนได้ จะเกิด 409 ปลอมทั้งที่ข้อมูลวันนี้ไม่เปลี่ยน (B3)
 */
export function computeVersion(rows: readonly SheetRow[], date: string): string {
  const day = rows
    .filter((r) => r.date === date)
    .map((r) => [r.description, r.amount, r.channel]);
  return createHash("sha256").update(JSON.stringify(day)).digest("hex");
}

/**
 * ตัดสินใจวาดเส้นคั่นดำบนแถวแรกของกลุ่มใหม่ (N5) — pure function มี unit test
 *
 * batchUpdate ก้อนเดียวมองไม่เห็นสถานะกลางทาง จึงต้อง "จำลองผลการลบก่อน":
 * เทียบวันที่ของแถวสุดท้ายหลังลบ (remaining) กับวันที่เป้าหมาย
 * - remaining ว่าง (ชีตเหลือแต่หัวตาราง) → วาดเส้น เหมือนเริ่มกลุ่มวันใหม่
 *   (จุดเดียวที่ต่างจากโค้ดเดิมซึ่ง skip เมื่อชีตว่าง — ตัดสินใจไว้ในแผน N5)
 */
export function shouldDrawBorder(
  remaining: readonly SheetRow[],
  targetDate: string,
): boolean {
  const lastDateAfterDelete = remaining.at(-1)?.date ?? null;
  return lastDateAfterDelete !== targetDate;
}
