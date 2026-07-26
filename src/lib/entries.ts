/**
 * สัญญาข้อมูลของชีต (ADR data contract): ประเภทรายการ "ไม่ถูกเก็บ" ในชีต
 * อนุมานจากเครื่องหมายของคอลัมน์ D เท่านั้น — ติดลบ = รายจ่าย, บวก/ศูนย์ = รายรับ
 */

export type EntryType = "income" | "expense";

export function typeFromAmount(amount: number): EntryType {
  return amount < 0 ? "expense" : "income";
}

/** ค่าบวกจาก UI + ประเภท → ค่ามีเครื่องหมายสำหรับคอลัมน์ D */
export function toSignedAmount(type: EntryType, positiveAmount: number): number {
  const abs = Math.abs(positiveAmount);
  return type === "expense" ? -abs : abs;
}
