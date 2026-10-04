import { thaiDateLabel } from "@/lib/date";

export interface SummaryEntry {
  description: string;
  /** ค่ามีเครื่องหมาย (ลบ = รายจ่าย) */
  amount: number;
  channel: string;
  /** ยอดก่อนหัก GP/VAT ของรายรับเดลิเวอรี */
  gross?: number | null;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** รายรับเดลิเวอรีที่โดนหัก GP — เกณฑ์เดียวกับ isDeliveryDesc ใน LedgerApp */
const isDeliveryIncome = (e: SummaryEntry): boolean =>
  e.amount >= 0 && /grab|lineman|shopee/i.test(e.description);

/** ยอดก่อนหักและยอดที่ถูกหัก โดยใช้ค่าที่บันทึกจริงก่อน แล้วจึงคำนวณย้อนสำหรับข้อมูลเก่า */
export const deliveryDeduction = (
  e: SummaryEntry,
): { gross: number; deducted: number } | null => {
  if (!isDeliveryIncome(e)) return null;
  const gross =
    e.gross != null && Number.isFinite(e.gross) && e.gross > 0
      ? e.gross
      : e.amount > 0
        ? e.amount / (1 - 0.3 * 1.07)
        : null;
  return gross == null ? null : { gross, deducted: gross - e.amount };
};

/**
 * สรุปรายการสำหรับ dialog ยืนยัน + รูปที่ส่งเข้า Telegram
 * ใช้ JSX interpolation ปกติเท่านั้น — ห้าม dangerouslySetInnerHTML (ปิดหนี้ XSS ข้อ 8)
 */
export default function SummaryCard({
  date,
  entries,
}: {
  date: string;
  entries: SummaryEntry[];
}) {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    if (e.amount < 0) expense += Math.abs(e.amount);
    else income += e.amount;
  }
  const balance = income - expense;

  return (
    <div className="rounded-[10px] border-2 border-gray-300 bg-white p-6 text-left shadow-sm">
      <div className="mb-2 text-base font-medium text-gray-800">
        สรุปรายการ - {thaiDateLabel(date)}
      </div>
      <table className="mb-2 w-full border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-1 text-center">ประเภท</th>
            <th className="border border-gray-300 px-2 py-1 text-center">รายการ</th>
            <th className="border border-gray-300 px-2 py-1 text-center">จำนวน (฿)</th>
            <th className="border border-gray-300 px-2 py-1 text-center">ช่องทาง</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const deduction = deliveryDeduction(e);
            return (
            <tr key={i}>
              <td className="border border-gray-300 px-2 py-1 text-center">
                {e.amount < 0 ? "รายจ่าย" : deduction != null ? "รายรับ (หัก GP)" : "รายรับ"}
              </td>
              <td className="border border-gray-300 px-2 py-1">
                {e.description}
                {deduction != null && (
                  <span className="text-gray-500">
                    {" "}
                    (ก่อนหัก {fmt(deduction.gross)} · หัก {fmt(deduction.deducted)})
                  </span>
                )}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-right">
                {fmt(e.amount)}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-center">
                {e.channel}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span>
          รวมรายรับ: <b className="text-green-600">{fmt(income)}</b> ฿
        </span>
        <span>
          รวมรายจ่าย: <b className="text-red-600">{fmt(expense)}</b> ฿
        </span>
        <span>
          คงเหลือ: <b className="text-blue-600">{fmt(balance)}</b> ฿
        </span>
      </div>
    </div>
  );
}
