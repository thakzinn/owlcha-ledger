"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { todayBangkok, thaiDateLabel } from "@/lib/date";
import {
  CHANNELS,
  DEFAULT_GP_RATES,
  type GpRates,
  type Pnd94Channel,
  type SalesEntry,
  gpForward,
  grossFromNet,
  summarize,
  presetRange,
  type RangePreset,
  summaryToCsv,
  parsePasted,
  channelFromDescription,
  isDeliveryChannel,
  fmtBaht,
} from "@/lib/pnd94";

/**
 * หน้ารายงานสรุปยอดขายยื่นภาษีครึ่งปี ภ.ง.ด.94 (ADR §11.8)
 * ข้อมูลทั้งหมดอยู่ใน state ของหน้า (in-memory) — จงใจไม่ใช้ localStorage
 * เพราะเป็นข้อมูลชั่วคราวประกอบการยื่นภาษี ไม่ใช่สมุดบัญชี
 */

/** แถวใน UI เก็บ gross เป็น string ตามที่พิมพ์ (แบบเดียวกับ LedgerApp) — แปลงตัวเลขตอนคำนวณ */
interface UiRow {
  id: string;
  date: string;
  channel: Pnd94Channel;
  gross: string;
  description?: string;
  estimated?: boolean;
  sheetNet?: number;
}

type PresetChoice = RangePreset | "CUSTOM";

interface ApiError {
  error?: { code?: string; message?: string };
}

const sanitizeAmount = (v: string): string => {
  let s = v.replace(/[^0-9.]/g, "");
  const parts = s.split(".");
  if (parts.length > 2) s = `${parts[0]}.${parts[1]}`;
  const [i, f] = s.split(".");
  return f !== undefined ? `${i}.${f.slice(0, 2)}` : s;
};

const sanitizePct = (v: string): string => sanitizeAmount(v);

const uid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

/** "2026-01" → "มกราคม 2569" (th-TH ให้ปี พ.ศ. อัตโนมัติ) */
const thaiMonthLabel = (ym: string): string =>
  new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${ym}-01T00:00:00Z`));

const PRESETS: { key: PresetChoice; label: string }[] = [
  { key: "H1", label: "ครึ่งปีแรก (ม.ค.–มิ.ย.)" },
  { key: "H2", label: "ครึ่งปีหลัง (ก.ค.–ธ.ค.)" },
  { key: "FULL", label: "ทั้งปี" },
  { key: "CUSTOM", label: "กำหนดเอง" },
];

export default function Pnd94Report() {
  const router = useRouter();
  const today = todayBangkok();

  const [preset, setPreset] = useState<PresetChoice>("H1");
  const [range, setRange] = useState(() => presetRange("H1", todayBangkok()));
  const [rateInputs, setRateInputs] = useState<Record<Pnd94Channel, string>>(
    () =>
      Object.fromEntries(
        CHANNELS.map((c) => [c, String(DEFAULT_GP_RATES[c])]),
      ) as Record<Pnd94Channel, string>,
  );
  const [rows, setRows] = useState<UiRow[]>([]);

  const [addDate, setAddDate] = useState(today);
  const [addChannel, setAddChannel] = useState<Pnd94Channel>("Grab");
  const [addGross, setAddGross] = useState("");

  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteErrors, setPasteErrors] = useState<
    { line: number; reason: string }[]
  >([]);
  const [importNote, setImportNote] = useState("");
  const [pulling, setPulling] = useState(false);

  const rates = useMemo<GpRates>(
    () =>
      Object.fromEntries(
        CHANNELS.map((c) => [c, Number(rateInputs[c]) || 0]),
      ) as GpRates,
    [rateInputs],
  );

  /** ช่องทางที่ติ๊กเลือกให้รวมในสรุป — un-check = ตัดออกจากตาราง/กล่องภาษี/CSV */
  const [selectedChannels, setSelectedChannels] = useState<
    Record<Pnd94Channel, boolean>
  >(
    () =>
      Object.fromEntries(CHANNELS.map((c) => [c, true])) as Record<
        Pnd94Channel,
        boolean
      >,
  );

  const entries = useMemo<SalesEntry[]>(
    () => rows.map((r) => ({ ...r, gross: Number(r.gross) || 0 })),
    [rows],
  );

  /** สรุปครบทุกช่องทาง — ใช้แสดงแถวในตาราง (แถวที่ un-check ต้องยังเห็น แค่ blur) */
  const fullSummary = useMemo(
    () => summarize(entries, rates, range.from, range.to),
    [entries, rates, range],
  );

  /** สรุปเฉพาะช่องทางที่ติ๊กเลือก — ใช้กับแถวรวม, กล่องภาษี, หมายเหตุประมาณการ และ CSV */
  const summary = useMemo(
    () =>
      summarize(
        entries.filter((e) => selectedChannels[e.channel]),
        rates,
        range.from,
        range.to,
      ),
    [entries, rates, range, selectedChannels],
  );

  const inRange = useMemo(
    () => rows.filter((r) => r.date >= range.from && r.date <= range.to),
    [rows, range],
  );
  const hiddenCount = rows.length - inRange.length;

  /** จัดกลุ่ม เดือน → วัน (เรียงตามเวลา) — รายการเยอะเป็นร้อยแถว ต้องพับสองชั้นไว้ก่อน */
  const months = useMemo(() => {
    const byDate = new Map<string, UiRow[]>();
    for (const r of inRange) {
      const list = byDate.get(r.date) ?? [];
      list.push(r);
      byDate.set(r.date, list);
    }
    const days = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, list]) => ({
        date,
        rows: list,
        gross: list.reduce((sum, r) => sum + (Number(r.gross) || 0), 0),
        estimatedCount: list.filter((r) => r.estimated).length,
      }));

    const byMonth = new Map<string, typeof days>();
    for (const d of days) {
      const key = d.date.slice(0, 7); // YYYY-MM
      const list = byMonth.get(key) ?? [];
      list.push(d);
      byMonth.set(key, list);
    }
    return [...byMonth.entries()].map(([key, dayList]) => ({
      key,
      days: dayList,
      count: dayList.reduce((sum, d) => sum + d.rows.length, 0),
      gross: dayList.reduce((sum, d) => sum + d.gross, 0),
      estimatedCount: dayList.reduce((sum, d) => sum + d.estimatedCount, 0),
    }));
  }, [inRange]);

  const example = gpForward(100, rates.Grab);

  // ---------- actions ----------

  const applyPreset = (p: PresetChoice) => {
    setPreset(p);
    if (p !== "CUSTOM") setRange(presetRange(p, todayBangkok()));
  };

  const addRow = () => {
    if (!addDate) return;
    setRows((prev) => [
      ...prev,
      { id: uid(), date: addDate, channel: addChannel, gross: addGross || "0" },
    ]);
    setAddGross("");
  };

  const updateRow = (id: string, patch: Partial<UiRow>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? // แก้ยอดเองแล้วไม่ใช่ค่าประมาณการอีกต่อไป — คำเตือนต้องหายไปด้วย
            {
              ...r,
              ...patch,
              ...(patch.gross !== undefined ? { estimated: false } : {}),
            }
          : r,
      ),
    );
  };

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const importPasted = () => {
    const { entries: parsed, errors } = parsePasted(pasteText);
    setPasteErrors(errors);
    if (parsed.length) {
      setRows((prev) => [
        ...prev,
        ...parsed.map((e) => ({ ...e, id: uid(), gross: String(e.gross) })),
      ]);
      setImportNote(
        `นำเข้า ${parsed.length} รายการ, รวมทั้งหมด ${rows.length + parsed.length} รายการ`,
      );
      setPasteText("");
    } else if (!errors.length) {
      setImportNote("ไม่พบข้อมูลที่นำเข้าได้");
    }
  };

  const pullFromSheet = async () => {
    if (rows.length) {
      const ok = await Swal.fire({
        icon: "warning",
        title: "แทนที่รายการที่มีอยู่?",
        text: `มี ${rows.length} รายการอยู่แล้ว การดึงข้อมูลจะแทนที่ทั้งหมด`,
        showCancelButton: true,
        confirmButtonText: "แทนที่",
        cancelButtonText: "ยกเลิก",
      });
      if (!ok.isConfirmed) return;
    }
    setPulling(true);
    try {
      const res = await fetch(
        `/api/entries/range?from=${range.from}&to=${range.to}`,
      );
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login?reason=expired");
          return;
        }
        const body = (await res.json().catch(() => ({}))) as ApiError;
        void Swal.fire({
          icon: "error",
          title: "ดึงข้อมูลไม่สำเร็จ",
          text: body.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่",
        });
        return;
      }
      const data = (await res.json()) as {
        entries: {
          date: string;
          description: string;
          amount: number;
          channel: string;
          gross: number | null;
        }[];
      };
      const mapped: UiRow[] = data.entries.map((r) => {
        const channel = channelFromDescription(r.description);
        const isDelivery = isDeliveryChannel(channel);
        if (isDelivery && r.gross != null) {
          // คอลัมน์ F มีค่า = ยอดขายบนแอปก่อนหัก GP (ADR §11.7)
          return {
            id: uid(),
            date: r.date,
            channel,
            gross: String(r.gross),
            description: r.description,
            sheetNet: r.amount,
          };
        }
        if (isDelivery) {
          // F ว่าง → ประมาณยอดขายเต็มย้อนจากยอดสุทธิ — ผู้ใช้ต้องตรวจกับ statement
          const g = grossFromNet(r.amount, rates[channel]);
          return {
            id: uid(),
            date: r.date,
            channel,
            gross: String(g ?? r.amount),
            description: r.description,
            estimated: true,
            sheetNet: r.amount,
          };
        }
        return {
          id: uid(),
          date: r.date,
          channel,
          gross: String(r.amount),
          description: r.description,
          sheetNet: r.amount,
        };
      });
      setRows(mapped);
      setImportNote(
        `ดึงจากสมุดบัญชี ${mapped.length} รายการ (รายรับทุกแถวในช่วง)`,
      );
    } finally {
      setPulling(false);
    }
  };

  const downloadCsv = () => {
    const csv = summaryToCsv(summary, range.from, range.to);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pnd94-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- render ----------

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none";

  return (
    <div className="space-y-4">
      {/* 1. ช่วงวันที่ */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">ช่วงวันที่</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                preset === p.key
                  ? "bg-amber-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-600">
            วันที่เริ่มต้น
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                setPreset("CUSTOM");
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            วันที่สิ้นสุด
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => {
                setPreset("CUSTOM");
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
              className={inputCls}
            />
          </label>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {thaiDateLabel(range.from)} – {thaiDateLabel(range.to)}
        </p>
      </section>

      {/* 2. ตั้งค่า GP */}
      <details className="rounded-xl bg-white p-4 shadow">
        <summary className="cursor-pointer font-semibold text-gray-800">
          ตั้งค่าอัตรา GP (%)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CHANNELS.map((c) => (
            <label key={c} className="block text-sm text-gray-600">
              {c}
              <input
                inputMode="decimal"
                value={rateInputs[c]}
                onChange={(e) =>
                  setRateInputs((prev) => ({
                    ...prev,
                    [c]: sanitizePct(e.target.value),
                  }))
                }
                className={inputCls}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          ตัวอย่าง: ขาย 100.00 บาท ผ่าน Grab ({fmtBaht(rates.Grab)}%) → ค่า GP{" "}
          {fmtBaht(example.gp)} + VAT 7% ของ GP {fmtBaht(example.vat)} = หักรวม{" "}
          {fmtBaht(example.deduction)} → ร้านได้รับสุทธิ{" "}
          <b>{fmtBaht(example.net)}</b> บาท
        </p>
      </details>

      {/* 3. เพิ่มรายการ */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">เพิ่มรายการขาย</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-sm text-gray-600">
            วันที่ขาย
            <input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            ช่องทาง
            <select
              value={addChannel}
              onChange={(e) => setAddChannel(e.target.value as Pnd94Channel)}
              className={inputCls}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-600">
            ยอดขาย (ก่อนหัก)
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={addGross}
              onChange={(e) => setAddGross(sanitizeAmount(e.target.value))}
              className={inputCls}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={addRow}
              className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              เพิ่ม
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPaste((s) => !s)}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            วางจาก Excel/CSV
          </button>
          <button
            type="button"
            onClick={pullFromSheet}
            disabled={pulling}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pulling ? "กำลังดึงข้อมูล…" : "ดึงข้อมูลจากสมุดบัญชี"}
          </button>
        </div>

        {showPaste && (
          <div className="mt-3">
            <textarea
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={
                "วันที่\tช่องทาง\tยอดขาย\n15/01/2569\tGrab\t1,250.00"
              }
              className={`${inputCls} font-mono`}
            />
            <button
              type="button"
              onClick={importPasted}
              className="mt-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              นำเข้า
            </button>
            {pasteErrors.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-red-600">
                {pasteErrors.map((e) => (
                  <li key={e.line}>
                    บรรทัด {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {importNote && (
          <p className="mt-2 text-sm text-emerald-700">{importNote}</p>
        )}
      </section>

      {/* 4. รายการขาย */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">
          รายการขายในช่วง ({inRange.length} รายการ)
          {hiddenCount > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">
              ซ่อน {hiddenCount} รายการนอกช่วงวันที่
            </span>
          )}
        </h2>
        {inRange.length === 0 ? (
          <p className="text-sm text-gray-500">
            ยังไม่มีรายการในช่วงวันที่ที่เลือก
          </p>
        ) : (
          <div className="space-y-2">
            {months.map((month) => (
              <details
                key={month.key}
                className="rounded-lg border border-gray-300"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800 hover:bg-gray-100">
                  <b>{thaiMonthLabel(month.key)}</b>
                  <span className="text-gray-500">
                    · {month.count} รายการ · ขายรวม {fmtBaht(month.gross)} ฿
                  </span>
                  {month.estimatedCount > 0 && (
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                      ประมาณการ {month.estimatedCount}
                    </span>
                  )}
                </summary>
                <div className="space-y-2 border-t border-gray-200 p-3">
                  {month.days.map((day) => (
                    <details
                      key={day.date}
                      className="rounded-lg border border-gray-200"
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        <b>{thaiDateLabel(day.date)}</b>
                        <span className="text-gray-500">
                          · {day.rows.length} รายการ · ขายรวม{" "}
                          {fmtBaht(day.gross)} ฿
                        </span>
                        {day.estimatedCount > 0 && (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                            ประมาณการ {day.estimatedCount}
                          </span>
                        )}
                      </summary>
                      <ul className="space-y-2 border-t border-gray-100 p-3">
                        {day.rows.map((r) => {
                          const b = gpForward(
                            Number(r.gross) || 0,
                            rates[r.channel],
                          );
                          const mismatch =
                            r.estimated &&
                            r.sheetNet !== undefined &&
                            b.net !== r.sheetNet;
                          return (
                            <li
                              key={r.id}
                              className={`rounded-lg border p-3 ${
                                r.estimated
                                  ? "border-yellow-400 bg-yellow-50"
                                  : "border-gray-200"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="date"
                                  value={r.date}
                                  onChange={(e) =>
                                    updateRow(r.id, { date: e.target.value })
                                  }
                                  className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                                />
                                <select
                                  value={r.channel}
                                  onChange={(e) =>
                                    updateRow(r.id, {
                                      channel: e.target.value as Pnd94Channel,
                                    })
                                  }
                                  className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                                >
                                  {CHANNELS.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  inputMode="decimal"
                                  value={r.gross}
                                  onChange={(e) =>
                                    updateRow(r.id, {
                                      gross: sanitizeAmount(e.target.value),
                                    })
                                  }
                                  className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm"
                                />
                                <span className="text-sm text-gray-600">
                                  → สุทธิ <b>{fmtBaht(b.net)}</b>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeRow(r.id)}
                                  aria-label="ลบรายการ"
                                  className="ml-auto rounded-lg px-2 py-1 text-sm text-red-500 hover:bg-red-50"
                                >
                                  ลบ
                                </button>
                              </div>
                              {r.description && (
                                <p className="mt-1 text-xs text-gray-500">
                                  จากชีต: {r.description}
                                </p>
                              )}
                              {r.estimated && (
                                <p className="mt-1 text-xs text-yellow-700">
                                  ยอดขายเต็มประมาณจากยอดสุทธิ (ชีตไม่มียอดบนแอป)
                                  {mismatch &&
                                    ` — สุทธิจากชีต ${fmtBaht(r.sheetNet!)} / คำนวณย้อน ${fmtBaht(
                                      b.net,
                                    )} โปรดตรวจกับ statement`}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* 5. ตารางสรุปตามช่องทาง */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">สรุปตามช่องทาง</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border border-gray-300 text-sm">
            <thead>
              <tr className="bg-gray-100">
                {[
                  "ช่องทาง",
                  "จำนวนรายการ",
                  "ยอดขายรวม (ก่อนหัก GP)",
                  "ค่า GP รวม",
                  "VAT ของ GP รวม",
                  "ยอดหักรวม",
                  "ยอดรับสุทธิรวม",
                ].map((h) => (
                  <th key={h} className="border border-gray-300 px-2 py-1">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fullSummary.rows.map((r) => {
                const on = selectedChannels[r.channel];
                // แถวที่ un-check ต้องยังเห็นอยู่ (แค่ blur) — ห้ามหายจากตาราง
                const numCls = `border border-gray-300 px-2 py-1 text-right ${
                  on ? "" : "opacity-40 blur-[1.5px] select-none"
                }`;
                return (
                  <tr key={r.channel} className={on ? "" : "bg-gray-50"}>
                    <td className="border border-gray-300 px-2 py-1">
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setSelectedChannels((prev) => ({
                              ...prev,
                              [r.channel]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 accent-amber-500"
                        />
                        <span className={on ? "" : "text-gray-400 line-through"}>
                          {r.channel}
                        </span>
                      </label>
                    </td>
                    <td
                      className={`border border-gray-300 px-2 py-1 text-center ${
                        on ? "" : "opacity-40 blur-[1.5px] select-none"
                      }`}
                    >
                      {r.count}
                    </td>
                    <td className={numCls}>{fmtBaht(r.gross)}</td>
                    <td className={numCls}>{fmtBaht(r.gp)}</td>
                    <td className={numCls}>{fmtBaht(r.vat)}</td>
                    <td className={numCls}>{fmtBaht(r.deduction)}</td>
                    <td className={numCls}>{fmtBaht(r.net)}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50 font-semibold">
                <td className="border border-gray-300 px-2 py-1">รวมทั้งหมด</td>
                <td className="border border-gray-300 px-2 py-1 text-center">
                  {summary.total.count}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right">
                  {fmtBaht(summary.total.gross)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right">
                  {fmtBaht(summary.total.gp)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right">
                  {fmtBaht(summary.total.vat)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right">
                  {fmtBaht(summary.total.deduction)}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right">
                  {fmtBaht(summary.total.net)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {summary.estimated.count > 0 && (
          <p className="mt-2 text-xs text-yellow-700">
            มี {summary.estimated.count} แถวประมาณการ — สุทธิตามชีตรวม{" "}
            {fmtBaht(summary.estimated.sheetNet)}, ตามคำนวณรวม{" "}
            {fmtBaht(summary.estimated.computedNet)} (ต่าง{" "}
            {fmtBaht(
              Math.abs(
                summary.estimated.sheetNet - summary.estimated.computedNet,
              ),
            )}
            )
          </p>
        )}
      </section>

      {/* 6. กล่องสรุปภาษี */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">สรุปสำหรับยื่นภาษี</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4">
            <p className="text-sm text-gray-700">
              เงินได้พึงประเมิน (ยอดขายเต็ม ก่อนหัก GP)
            </p>
            <p className="text-2xl font-bold text-amber-700">
              {fmtBaht(summary.total.gross)} ฿
            </p>
            <p className="mt-1 text-xs text-gray-500">
              ใช้ตัวเลขนี้กรอกใน ภ.ง.ด.94
            </p>
          </div>
          <div className="rounded-lg border border-gray-300 p-4">
            <p className="text-sm text-gray-700">ยอดรับสุทธิหลังหัก GP</p>
            <p className="text-2xl font-bold text-gray-800">
              {fmtBaht(summary.total.net)} ฿
            </p>
            <p className="mt-1 text-xs text-gray-500">
              ใช้ดูกระแสเงินสดจริง และเป็นหลักฐานค่าใช้จ่าย (ค่า GP = รายจ่าย)
              กรณีเลือกหักค่าใช้จ่ายตามจริง
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
          ⚠️ การยื่น ภ.ง.ด.94 ต้องใช้ยอดขายเต็มเป็นเงินได้ ห้ามใช้ยอดหลังหัก GP
          เป็นเงินได้ เพราะค่า GP ถือเป็นรายจ่าย ไม่ใช่ส่วนลดเงินได้
        </p>
        <button
          type="button"
          onClick={downloadCsv}
          className="mt-3 w-full rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 sm:w-auto"
        >
          ดาวน์โหลด CSV
        </button>
      </section>
    </div>
  );
}
