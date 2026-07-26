/**
 * ทุกการคำนวณวันที่ของระบบผูกกับ timezone เดียว (Asia/Bangkok) ผ่านไฟล์นี้เท่านั้น
 * ห้ามใช้ new Date().toISOString().slice(0,10) ที่ใดในโค้ด — ให้ค่า UTC
 * ซึ่งที่กรุงเทพช่วง 00:00–07:00 จะได้วันที่ผิดเป็นวันวาน (หนี้เดิมข้อ 9)
 */

const TZ = process.env.NEXT_PUBLIC_APP_TZ || "Asia/Bangkok";

/** epoch ของ Google Sheets serial date = 1899-12-30 (วัน = serial, เวลา = เศษทศนิยม) */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** วันที่ "วันนี้" ตามเวลากรุงเทพ รูปแบบ YYYY-MM-DD (en-CA ให้ ISO format) */
export function todayBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** serial number ของ Sheets → YYYY-MM-DD (ตัดเศษเวลาออก — ใช้เฉพาะวันที่) */
export function serialToDateStr(serial: number): string {
  const d = new Date(SHEETS_EPOCH_UTC + Math.floor(serial) * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → serial number ของ Sheets (เที่ยงคืนของวันนั้น) */
export function dateStrToSerial(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return (Date.UTC(y!, m! - 1, d!) - SHEETS_EPOCH_UTC) / DAY_MS;
}

/** ตรวจว่าเป็น YYYY-MM-DD และเป็นวันที่จริง (ปฏิเสธ 2026-02-30) */
export function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}

/** ป้ายวันที่ภาษาไทยแบบเต็ม (พ.ศ.) สำหรับหัวรูปสรุป เช่น "วันอาทิตย์ที่ 26 กรกฎาคม พ.ศ. 2569" */
export function thaiDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
