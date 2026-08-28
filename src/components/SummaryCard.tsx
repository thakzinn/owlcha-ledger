import { thaiDateLabel } from "@/lib/date";

export interface SummaryEntry {
  description: string;
  /** ค่ามีเครื่องหมาย (ลบ = รายจ่าย) */
  amount: number;
  channel: string;
  /** หมวดหมู่ค่าใช้จ่าย — เฉพาะรายจ่าย (รายรับไม่มีหมวด) */
  category?: string;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
            <th className="border border-gray-300 px-2 py-1">ประเภท</th>
            <th className="border border-gray-300 px-2 py-1">รายการ</th>
            <th className="border border-gray-300 px-2 py-1">หมวดหมู่</th>
            <th className="border border-gray-300 px-2 py-1">จำนวน (฿)</th>
            <th className="border border-gray-300 px-2 py-1">ช่องทาง</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td className="border border-gray-300 px-2 py-1 text-center">
                {e.amount < 0 ? "รายจ่าย" : "รายรับ"}
              </td>
              <td className="border border-gray-300 px-2 py-1">{e.description}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">
                {(e.amount < 0 && e.category) || "—"}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-right">
                {fmt(e.amount)}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-center">
                {e.channel}
              </td>
            </tr>
          ))}
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
