"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { isValidDateStr, todayBangkok } from "@/lib/date";
import { fmtBaht, presetRange, round2 } from "@/lib/pnd94";
import {
  CASH_LABEL,
  DELIVERY_LABEL,
  INCOME_UNCATEGORIZED_LABEL,
  TRANSFER_LABEL,
  buildIncomeReport,
  classifyIncome,
  type IncomeEntry,
} from "@/lib/income-report";
import { buildIncomeWorkbook } from "@/lib/income-export";

/**
 * หน้ารายงานรายได้รายเดือน (read-only) — จัดประเภทจาก description + channel
 * ตามกติกา hardcoded ใน src/lib/income-report.ts ไม่มีการเขียนชีตใด ๆ ทั้งงาน
 * ข้อมูลอ่านผ่าน /api/entries/range (include=all — ต้องเห็นแถวลบของ
 * "โอนคืนลูกค้า" เพื่อหักช่องโอน การกรองเครื่องหมายเป็นหน้าที่ pure lib)
 * default = ทั้งปีปัจจุบัน; API เดิมจำกัดช่วง ≤ 366 วัน จึงตรวจฝั่งนี้ก่อนยิง
 */

const MAX_RANGE_DAYS = 366;

const rangeError = (from: string, to: string): string | null => {
  if (!isValidDateStr(from) || !isValidDateStr(to)) return "กรุณาเลือกวันที่ให้ครบ";
  if (from > to) return "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด";
  const days =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
    86_400_000;
  if (days > MAX_RANGE_DAYS) return `ช่วงวันที่ต้องไม่เกิน ${MAX_RANGE_DAYS} วัน`;
  return null;
};

interface ApiError {
  error?: { code?: string; message?: string };
}

/** แถวจาก GET /api/entries?date= (ข้อมูลดิบของวันนั้นทั้งวัน + version สำหรับ 409) */
interface DayEntry {
  description: string;
  amount: number;
  channel: string;
  gross: number | null;
}

const inputCls =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none";
const cellCls = "border border-gray-300 px-2 py-1";
const numCls = `${cellCls} whitespace-nowrap text-right tabular-nums`;

export default function IncomeReport() {
  const router = useRouter();

  // default = ทั้งปีปัจจุบัน (ตามที่เจ้าของร้านใช้ส่งสำนักงานบัญชีประจำปี)
  const [range, setRange] = useState(() => presetRange("FULL", todayBangkok()));
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loadingRange, setLoadingRange] = useState(false);
  const [showUncategorized, setShowUncategorized] = useState(false);
  // key ของรายการที่กำลังปรับเครื่องหมาย: `${date}|${desc}|${amount}`
  const [fixingKey, setFixingKey] = useState<string | null>(null);
  // การแสดงผลบนเว็บล้วน ๆ: รวมคอลัมน์เงินสดเข้าช่องโอน (รวมทั้งหมดไม่เปลี่ยน)
  const [cashDeposited, setCashDeposited] = useState(false);

  const handleHttpError = useCallback(
    async (res: Response, title: string): Promise<void> => {
      if (res.status === 401) {
        router.push("/login?reason=expired");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as ApiError;
      void Swal.fire({
        icon: "error",
        title,
        text: body.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่",
      });
    },
    [router],
  );

  const invalidRange = rangeError(range.from, range.to);

  const fetchRange = useCallback(
    async (from: string, to: string): Promise<void> => {
      setLoadingRange(true);
      try {
        const res = await fetch(
          `/api/entries/range?from=${from}&to=${to}&include=all`,
        );
        if (!res.ok) {
          await handleHttpError(res, "ดึงข้อมูลสมุดบัญชีไม่สำเร็จ");
          return;
        }
        const data = (await res.json()) as { entries: IncomeEntry[] };
        // เก็บทั้งชุดไม่กรองเครื่องหมาย — lib ต้องเห็นแถวลบของโอนคืนลูกค้า
        setEntries(data.entries);
      } finally {
        setLoadingRange(false);
      }
    },
    [handleHttpError],
  );

  useEffect(() => {
    // ดึงใหม่เมื่อช่วงเปลี่ยนและถูกต้องเท่านั้น (input type=date ยิง change เมื่อเลือกครบ)
    if (!rangeError(range.from, range.to)) void fetchRange(range.from, range.to);
  }, [range, fetchRange]);

  const report = useMemo(
    () => buildIncomeReport(entries, range.from, range.to),
    [entries, range],
  );
  const hasIncome = useMemo(
    () => report.grandTotal !== 0 || report.refundTotal !== 0 || report.uncategorizedTotal.count > 0,
    [report],
  );

  // ไฟล์เป็น layout มาตรฐาน 3 คอลัมน์เสมอ ไม่สนสถานะ checkbox เงินสด —
  // ไฟล์ที่ส่งสำนักงานบัญชีต้อง reproducible ไม่ผูกกับสถานะจอตอนกดปุ่ม
  const downloadExcel = () => {
    const bytes = buildIncomeWorkbook(entries, range.from, range.to);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `income-${range.from}-${range.to}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // รายการยังไม่จัดประเภทแบบรายครั้ง (มีวันที่) จัดกลุ่มตามชื่อรายการ —
  // ใช้แสดงวันที่บันทึกและเป็นเป้าของปุ่ม "ปรับเป็นติดลบ"
  const uncategorizedOccurrences = useMemo(() => {
    const map = new Map<string, IncomeEntry[]>();
    for (const e of entries) {
      if (e.amount <= 0 || e.date < range.from || e.date > range.to) continue;
      const desc = e.description.trim();
      if (classifyIncome(desc, e.channel) !== "uncategorized") continue;
      const list = map.get(desc) ?? [];
      list.push(e);
      map.set(desc, list);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return map;
  }, [entries, range]);

  const occKey = (e: IncomeEntry) => `${e.date}|${e.description.trim()}|${e.amount}`;

  /**
   * ปรับรายการที่ใส่เครื่องหมายผิด (บวก) ให้เป็นติดลบในสมุดบัญชี —
   * ใช้ flow เดียวกับหน้าบันทึกรายการเป๊ะ ๆ: GET วันนั้นทั้งวัน (ได้ version)
   * → พลิกเครื่องหมายเฉพาะแถวเป้าหมาย → POST ทั้งวันพร้อม baseVersion
   * (กลไก 409 เดิมคุ้มครอง ถ้ามีคนแก้วันนั้นแทรกจะไม่เขียนทับ)
   * channel ถูก normalize "โอน"/อื่น ๆ→"เงินสด" แบบเดียวกับ LedgerApp
   * เพราะ schema ฝั่งเขียนรับสองค่านี้เท่านั้น (พฤติกรรมเดิมของการแก้วันเก่า)
   */
  const fixToNegative = async (occ: IncomeEntry) => {
    const desc = occ.description.trim();
    const confirm = await Swal.fire({
      icon: "warning",
      title: "ปรับเป็นรายจ่าย (ติดลบ)?",
      html: `"${desc}" วันที่ ${occ.date}<br/>${fmtBaht(occ.amount)} → <b>-${fmtBaht(occ.amount)}</b> ในสมุดบัญชี`,
      showCancelButton: true,
      confirmButtonText: "ปรับเป็นติดลบ",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#f59e0b",
    });
    if (!confirm.isConfirmed) return;
    setFixingKey(occKey(occ));
    try {
      const res = await fetch(`/api/entries?date=${occ.date}`);
      if (!res.ok) {
        await handleHttpError(res, "โหลดข้อมูลวันดังกล่าวไม่สำเร็จ");
        return;
      }
      const day = (await res.json()) as { entries: DayEntry[]; version: string };
      const idx = day.entries.findIndex(
        (e) => e.description.trim() === desc && e.amount === occ.amount,
      );
      if (idx === -1) {
        void Swal.fire({
          icon: "error",
          title: "ไม่พบรายการในสมุดบัญชี",
          text: "รายการอาจถูกแก้ไขไปแล้ว ระบบจะโหลดข้อมูลใหม่",
        });
        await fetchRange(range.from, range.to);
        return;
      }
      const payload = day.entries.map((e, i) => ({
        description: e.description,
        amount: i === idx ? -Math.abs(e.amount) : e.amount,
        channel: e.channel === "โอน" ? "โอน" : "เงินสด",
        ...(e.gross != null ? { gross: e.gross } : {}),
      }));
      const save = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: occ.date,
          entries: payload,
          baseVersion: day.version,
        }),
      });
      if (!save.ok) {
        await handleHttpError(save, "แก้ไขไม่สำเร็จ");
        return;
      }
      await fetchRange(range.from, range.to);
      void Swal.fire({
        icon: "success",
        title: "ปรับเป็นติดลบแล้ว",
        text: `"${desc}" วันที่ ${occ.date} ย้ายไปฝั่งรายจ่ายแล้ว`,
        timer: 1600,
        showConfirmButton: false,
      });
    } finally {
      setFixingKey(null);
    }
  };

  const uncatCol = report.uncategorizedTotal.count > 0;
  // เซลล์ช่องโอนต่อเดือน/ยอดรวม เมื่อ checkbox เปิดจะรวมเงินสดเข้าไป (แสดงผลเท่านั้น)
  const transferCell = (transfer: number, cash: number) =>
    cashDeposited ? round2(transfer + cash) : transfer;

  const refundMonths = report.months.filter((m) => m.refund > 0);

  return (
    <div className="space-y-4">
      {/* เลือกช่วงวันที่ */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow">
        <label htmlFor="income-from" className="text-sm font-medium text-gray-700">
          ช่วงวันที่
        </label>
        <input
          id="income-from"
          type="date"
          className={inputCls}
          value={range.from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
        />
        <span className="text-sm text-gray-500">ถึง</span>
        <input
          id="income-to"
          type="date"
          className={inputCls}
          value={range.to}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
        />
        <button
          type="button"
          className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50"
          onClick={() => setRange(presetRange("FULL", todayBangkok()))}
        >
          ทั้งปีนี้
        </button>
        {invalidRange && <span className="text-sm text-red-600">{invalidRange}</span>}
        {!invalidRange && loadingRange && (
          <span className="text-sm text-gray-500">กำลังดึงข้อมูล…</span>
        )}
        {!invalidRange && !loadingRange && !hasIncome && (
          <span className="text-sm text-gray-500">ช่วงนี้ไม่มีข้อมูลรายรับ</span>
        )}
      </section>

      {/* ตารางสรุปรายเดือน × ช่องทาง */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">
          สรุปรายได้รายเดือน {range.from} ถึง {range.to}
        </h2>

        <label className="mb-3 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5 accent-amber-500"
            checked={cashDeposited}
            onChange={(e) => setCashDeposited(e.target.checked)}
          />
          <span>
            เงินสดหน้าร้านฝากเข้าบัญชีทั้งหมด (รวมเข้าช่องโอน)
            <span className="block text-xs text-gray-500">
              เงินสดที่ไม่ได้นำฝากเข้าบัญชี ไม่ต้องแจ้ง /
              หากนำฝากเข้าบัญชี ให้รวมเป็นเงินโอน
            </span>
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border border-gray-300 text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-700">
                <th className={`${cellCls} text-left`}>เดือน</th>
                <th className={`${cellCls} text-right`}>{TRANSFER_LABEL}</th>
                <th className={`${cellCls} text-right`}>{DELIVERY_LABEL}</th>
                {!cashDeposited && (
                  <th className={`${cellCls} text-right`}>{CASH_LABEL}</th>
                )}
                {uncatCol && (
                  <th className={`${cellCls} text-right text-orange-700`}>
                    {INCOME_UNCATEGORIZED_LABEL}
                  </th>
                )}
                <th className={`${cellCls} text-right`}>รวมทั้งหมด</th>
              </tr>
            </thead>
            <tbody>
              {report.months.map((m) => {
                const transfer = transferCell(m.transfer, m.cash);
                return (
                  <tr key={`${m.year}-${m.month}`} className="odd:bg-white even:bg-gray-50">
                    <td className={cellCls}>{m.label}</td>
                    <td className={`${numCls} ${transfer < 0 ? "text-red-600" : ""}`}>
                      {fmtBaht(transfer)}
                    </td>
                    <td className={numCls}>{fmtBaht(m.delivery)}</td>
                    {!cashDeposited && <td className={numCls}>{fmtBaht(m.cash)}</td>}
                    {uncatCol && (
                      <td className={`${numCls} text-orange-700`}>
                        {m.uncategorized.count > 0 ? (
                          <button
                            type="button"
                            className="underline decoration-dotted underline-offset-2 hover:text-orange-900"
                            onClick={() => setShowUncategorized(true)}
                            title="ดูรายการที่ยังไม่จัดประเภท"
                          >
                            {fmtBaht(m.uncategorized.amount)}{" "}
                            <span className="text-xs">({m.uncategorized.count})</span>
                          </button>
                        ) : (
                          fmtBaht(0)
                        )}
                      </td>
                    )}
                    <td className={`${numCls} font-medium`}>{fmtBaht(m.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-amber-50 font-semibold text-gray-800">
                <td className={cellCls}>รวมทั้งช่วง</td>
                <td
                  className={`${numCls} ${
                    transferCell(report.transferTotal, report.cashTotal) < 0
                      ? "text-red-600"
                      : ""
                  }`}
                >
                  {fmtBaht(transferCell(report.transferTotal, report.cashTotal))}
                </td>
                <td className={numCls}>{fmtBaht(report.deliveryTotal)}</td>
                {!cashDeposited && <td className={numCls}>{fmtBaht(report.cashTotal)}</td>}
                {uncatCol && (
                  <td className={`${numCls} text-orange-700`}>
                    {fmtBaht(report.uncategorizedTotal.amount)}{" "}
                    <span className="text-xs">({report.uncategorizedTotal.count})</span>
                  </td>
                )}
                <td className={numCls}>{fmtBaht(report.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {refundMonths.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {refundMonths.map((m) => (
              <span key={`${m.year}-${m.month}`} className="block">
                เดือน {m.label} หักโอนคืนลูกค้า {fmtBaht(m.refund)} บาท
                ออกจากช่องโอนแล้ว
              </span>
            ))}
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          จัดประเภทจากชื่อรายการ + ช่องทางของแถวรายรับในสมุดบัญชี —
          แถวรายจ่าย (ติดลบ) ไม่ถูกนับ ยกเว้น &quot;โอนคืนลูกค้า&quot;
          ที่นำไปหักช่องโอนของเดือนนั้น
        </p>
        <button
          type="button"
          onClick={downloadExcel}
          disabled={loadingRange || !hasIncome || invalidRange !== null}
          className="mt-3 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
        >
          ดาวน์โหลด Excel (สรุป + รายละเอียด)
        </button>
        <p className="mt-1 text-xs text-gray-500">
          ไฟล์มี 2 ชีต: ชีตสรุปผูกสูตร SUMIFS กับชีต &quot;รายละเอียดรายได้&quot;
          — แก้ตัวเลข/ประเภทในชีตรายละเอียดแล้วตารางสรุปคำนวณใหม่อัตโนมัติ
          (ไฟล์เป็นคอลัมน์แยกเงินสดเสมอ ไม่ขึ้นกับ checkbox ด้านบน)
        </p>
      </section>

      {/* รายการยังไม่จัดประเภท — read-only ไม่มีปุ่มจัดประเภท */}
      {report.uncategorizedItems.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-semibold text-gray-800"
            onClick={() => setShowUncategorized((v) => !v)}
          >
            <span>
              {INCOME_UNCATEGORIZED_LABEL}ในช่วงที่เลือก (
              {report.uncategorizedItems.length} ชื่อรายการ ·{" "}
              {fmtBaht(report.uncategorizedTotal.amount)} บาท)
            </span>
            <span aria-hidden>{showUncategorized ? "▲" : "▼"}</span>
          </button>
          {showUncategorized && (
            <>
              <p className="mt-2 text-xs text-gray-500">
                มักเป็นการใส่เครื่องหมายผิด (รายจ่ายที่ถูกบันทึกเป็นบวก) —
                กด &quot;ปรับเป็นติดลบ&quot; เพื่อแก้ในสมุดบัญชีได้เลย
                หรือตรวจแก้เองในหน้าบันทึกรายการ
              </p>
              <ul className="mt-2 divide-y divide-gray-100">
                {report.uncategorizedItems.map((u) => (
                  <li key={u.item} className="py-2 text-sm">
                    <span className="font-medium text-gray-800">{u.item}</span>{" "}
                    <span className="text-gray-500">
                      ({u.count} รายการ · {fmtBaht(u.amount)} บาท)
                    </span>
                    <ul className="mt-1 space-y-1">
                      {(uncategorizedOccurrences.get(u.item) ?? []).map((occ, i) => (
                        <li
                          key={`${occKey(occ)}#${i}`}
                          className="flex flex-wrap items-center gap-2 pl-4"
                        >
                          <span className="text-gray-600 tabular-nums">
                            {occ.date} · {fmtBaht(occ.amount)} บาท · {occ.channel || "—"}
                          </span>
                          <button
                            type="button"
                            className="rounded-lg border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                            disabled={fixingKey !== null}
                            onClick={() => void fixToNegative(occ)}
                          >
                            {fixingKey === occKey(occ)
                              ? "กำลังปรับ…"
                              : "ปรับเป็นติดลบ"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
