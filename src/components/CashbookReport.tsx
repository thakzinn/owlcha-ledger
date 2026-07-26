"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { todayBangkok, thaiDateLabel } from "@/lib/date";
import { presetRange, type RangePreset, fmtBaht, round2 } from "@/lib/pnd94";
import {
  type CashbookHeader,
  type CashbookKind,
  type CashbookRow,
  buildReport,
  cashbookToCsv,
  isValidThaiTaxId,
  rowsFromRangeEntry,
  thaiBuddhistDate,
  thaiMonthYearLabel,
} from "@/lib/cashbook";

/**
 * หน้ารายงานเงินสดรับ-จ่าย ตามแบบประกาศอธิบดีฯ ฉบับที่ 161 (ประกอบ ภ.ง.ด.94/90)
 * ข้อมูลทั้งหมดอยู่ใน state ของหน้า (in-memory) — จงใจไม่ใช้ localStorage
 * เช่นเดียวกับหน้า ภ.ง.ด.94 เพราะเป็นข้อมูลชั่วคราวประกอบการยื่นภาษี
 *
 * บนจอ = datatable (ค้นหา/กรอง/เรียง/แบ่งหน้า) เพื่อให้ตรวจรายการง่าย
 * ตอนพิมพ์/CSV = ตารางแบบทางการ 6 คอลัมน์เต็มช่วงเสมอ ไม่ถูก filter บนจอกระทบ
 */

/** แถวใน UI เก็บ amount เป็น string ตามที่พิมพ์ (แบบเดียวกับ Pnd94Report) — แปลงตัวเลขตอนคำนวณ */
interface UiCashbookRow {
  id: string;
  date: string;
  description: string;
  kind: CashbookKind;
  amount: string;
  note: string;
  auto?: boolean;
  estimated?: boolean;
}

type PresetChoice = RangePreset | "CUSTOM";
type KindFilter = "all" | CashbookKind;
type SortKey = "date" | "amount";
type SortDir = "asc" | "desc";

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

const uid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const PRESETS: { key: PresetChoice; label: string }[] = [
  { key: "H1", label: "ครึ่งปีแรก (ม.ค.–มิ.ย.)" },
  { key: "H2", label: "ครึ่งปีหลัง (ก.ค.–ธ.ค.)" },
  { key: "FULL", label: "ทั้งปี" },
  { key: "CUSTOM", label: "กำหนดเอง" },
];

const KIND_LABELS: Record<CashbookKind, string> = {
  income: "รายรับ",
  purchase: "รายจ่าย: ซื้อสินค้า",
  other: "รายจ่าย: อื่น ๆ",
};

const KIND_BADGE_CLS: Record<CashbookKind, string> = {
  income: "bg-emerald-100 text-emerald-800",
  purchase: "bg-blue-100 text-blue-800",
  other: "bg-gray-200 text-gray-700",
};

const PAGE_SIZES = [10, 25, 50, 100];

export default function CashbookReport({
  defaultHeader,
}: {
  defaultHeader: CashbookHeader;
}) {
  const router = useRouter();
  const today = todayBangkok();

  const [preset, setPreset] = useState<PresetChoice>("H1");
  const [range, setRange] = useState(() => presetRange("H1", todayBangkok()));
  const [header, setHeader] = useState<CashbookHeader>(defaultHeader);
  const [rows, setRows] = useState<UiCashbookRow[]>([]);

  const [addDate, setAddDate] = useState(today);
  const [addDescription, setAddDescription] = useState("");
  const [addKind, setAddKind] = useState<CashbookKind>("income");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");

  const [pulling, setPulling] = useState(false);
  const [importNote, setImportNote] = useState("");

  // ---------- ตัวกรอง/เรียง/แบ่งหน้า ของ datatable (ไม่กระทบพิมพ์/CSV) ----------
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<KindFilter>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const numericRows = useMemo<CashbookRow[]>(
    () => rows.map((r) => ({ ...r, amount: round2(Number(r.amount) || 0) })),
    [rows],
  );

  /** รายงานทางการเต็มช่วง — แหล่งเดียวของตารางพิมพ์, CSV และแถวใน datatable */
  const report = useMemo(
    () => buildReport(numericRows, range.from, range.to),
    [numericRows, range],
  );

  const flatRows = useMemo(
    () => report.months.flatMap((m) => m.rows),
    [report],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = flatRows.filter(
      (r) =>
        (filterKind === "all" || r.kind === filterKind) &&
        (filterMonth === "all" || r.date.startsWith(filterMonth)) &&
        (!q ||
          r.description.toLowerCase().includes(q) ||
          r.note.toLowerCase().includes(q)),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "amount") return (a.amount - b.amount) * dir;
      return a.date < b.date ? -dir : a.date > b.date ? dir : 0;
    });
  }, [flatRows, search, filterKind, filterMonth, sortKey, sortDir]);

  /**
   * จัดกลุ่มแถวในช่วงตามชื่อรายการ (สินค้า) × ประเภท — ไว้ตรวจ/แก้การจัดหมวด
   * ทีเดียวทั้งกลุ่มก่อนไปดูรายการละเอียด; กลุ่มที่มีหลายประเภทปน = "mixed"
   */
  const groups = useMemo(() => {
    const map = new Map<string, CashbookRow[]>();
    for (const r of flatRows) {
      const key = r.description.trim() || "(ไม่มีชื่อรายการ)";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([description, list]) => {
        const kinds = new Set(list.map((r) => r.kind));
        return {
          description,
          count: list.length,
          total: round2(list.reduce((s, r) => s + r.amount, 0)),
          kind: kinds.size === 1 ? list[0]!.kind : ("mixed" as const),
          autoCount: list.filter((r) => r.auto).length,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [flatRows]);

  const filteredTotals = useMemo(() => {
    const t = { income: 0, purchase: 0, other: 0 };
    for (const r of filtered) t[r.kind] += r.amount;
    return {
      income: round2(t.income),
      purchase: round2(t.purchase),
      other: round2(t.other),
    };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const inRangeCount = flatRows.length;
  const hiddenCount = rows.length - inRangeCount;
  const taxIdInvalid = header.taxId !== "" && !isValidThaiTaxId(header.taxId);
  const isFiltered =
    search.trim() !== "" || filterKind !== "all" || filterMonth !== "all";

  // ---------- actions ----------

  const applyPreset = (p: PresetChoice) => {
    setPreset(p);
    if (p !== "CUSTOM") setRange(presetRange(p, todayBangkok()));
    setPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const addRow = () => {
    if (!addDate) return;
    setRows((prev) => [
      ...prev,
      {
        id: uid(),
        date: addDate,
        description: addDescription,
        kind: addKind,
        amount: addAmount || "0",
        note: addNote,
      },
    ]);
    setAddDescription("");
    setAddAmount("");
    setAddNote("");
  };

  const updateRow = (id: string, patch: Partial<UiCashbookRow>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              // สลับหมวดเอง = ไม่ใช่การจัดหมวดอัตโนมัติอีกต่อไป — badge ต้องหาย
              ...(patch.kind !== undefined ? { auto: false } : {}),
              // แก้ยอดเองแล้วไม่ใช่ค่าประมาณการอีกต่อไป (ตรรกะเดียวกับ Pnd94Report)
              ...(patch.amount !== undefined ? { estimated: false } : {}),
            }
          : r,
      ),
    );
  };

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  /** เปลี่ยนประเภทให้ทุกแถวที่ชื่อรายการเดียวกัน — ถือเป็นการยืนยันด้วยมือ (auto หาย) */
  const setGroupKind = (description: string, kind: CashbookKind) => {
    const key = description === "(ไม่มีชื่อรายการ)" ? "" : description;
    setRows((prev) =>
      prev.map((r) =>
        r.description.trim() === key ? { ...r, kind, auto: false } : r,
      ),
    );
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
        `/api/entries/range?from=${range.from}&to=${range.to}&include=all`,
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
      // แถว delivery แตกเป็น 2 แถว (รายรับ gross + รายจ่ายค่า GP) — ดู rowsFromRangeEntry
      const mapped: UiCashbookRow[] = data.entries.flatMap((e) =>
        rowsFromRangeEntry(e).map((r) => ({
          ...r,
          id: uid(),
          amount: String(r.amount),
        })),
      );
      setRows(mapped);
      setPage(1);
      setImportNote(
        `ดึงจากสมุดบัญชี ${data.entries.length} รายการ → ${mapped.length} แถวรายงาน (รายรับและรายจ่ายทุกแถวในช่วง)`,
      );
    } finally {
      setPulling(false);
    }
  };

  const downloadCsv = () => {
    const csv = cashbookToCsv(report, header, range.from, range.to);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashbook-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => window.print();

  // ---------- render ----------

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none";
  const cellInputCls =
    "w-full rounded border border-gray-200 px-1.5 py-1 text-sm focus:border-amber-500 focus:outline-none";
  const sortIcon = (key: SortKey) =>
    sortKey !== key ? "↕" : sortDir === "asc" ? "▲" : "▼";
  const periodLabel = `${thaiMonthYearLabel(range.from.slice(0, 7))} ถึง ${thaiMonthYearLabel(range.to.slice(0, 7))}`;

  return (
    <div className="space-y-4">
      {/* 1. ช่วงวันที่ */}
      <section className="rounded-xl bg-white p-4 shadow print:hidden">
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
                setPage(1);
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
                setPage(1);
              }}
              className={inputCls}
            />
          </label>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {thaiDateLabel(range.from)} – {thaiDateLabel(range.to)}
        </p>
      </section>

      {/* 2. ข้อมูลผู้ประกอบการ */}
      <details className="rounded-xl bg-white p-4 shadow print:hidden">
        <summary className="cursor-pointer font-semibold text-gray-800">
          ข้อมูลผู้ประกอบการ (หัวรายงาน)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-gray-600">
            ชื่อผู้ประกอบการ
            <input
              value={header.ownerName}
              onChange={(e) =>
                setHeader((h) => ({ ...h, ownerName: e.target.value }))
              }
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            ชื่อร้าน/กิจการ
            <input
              value={header.shopName}
              onChange={(e) =>
                setHeader((h) => ({ ...h, shopName: e.target.value }))
              }
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            เลขประจำตัวผู้เสียภาษี
            <input
              inputMode="numeric"
              maxLength={13}
              value={header.taxId}
              onChange={(e) =>
                setHeader((h) => ({
                  ...h,
                  taxId: e.target.value.replace(/\D/g, ""),
                }))
              }
              className={`${inputCls} ${taxIdInvalid ? "border-red-400" : ""}`}
            />
            {taxIdInvalid && (
              <span className="mt-1 block text-xs text-red-600">
                เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (ต้องเป็นเลข 13 หลักตามบัตรประชาชน)
              </span>
            )}
          </label>
          <label className="block text-sm text-gray-600">
            ที่อยู่
            <input
              value={header.address}
              onChange={(e) =>
                setHeader((h) => ({ ...h, address: e.target.value }))
              }
              className={inputCls}
            />
          </label>
        </div>
      </details>

      {/* 3. เพิ่มรายการ + ดึงจากชีต */}
      <section className="rounded-xl bg-white p-4 shadow print:hidden">
        <h2 className="mb-3 font-semibold text-gray-800">เพิ่มรายการ</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <label className="block text-sm text-gray-600">
            วันที่
            <input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            รายการ
            <input
              value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            ประเภท
            <select
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as CashbookKind)}
              className={inputCls}
            >
              {(Object.keys(KIND_LABELS) as CashbookKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-600">
            จำนวนเงิน
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={addAmount}
              onChange={(e) => setAddAmount(sanitizeAmount(e.target.value))}
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            หมายเหตุ
            <input
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            เพิ่ม
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
        {importNote && (
          <p className="mt-2 text-sm text-emerald-700">{importNote}</p>
        )}
        {hiddenCount > 0 && (
          <p className="mt-1 text-sm text-gray-400">
            ซ่อน {hiddenCount} รายการนอกช่วงวันที่
          </p>
        )}
      </section>

      {/* 4. จัดกลุ่มสินค้า × ประเภท — ตรวจ/แก้การจัดหมวดทีเดียวทั้งกลุ่มก่อนออกรายการ */}
      {groups.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow print:hidden">
          <h2 className="mb-1 font-semibold text-gray-800">
            จัดกลุ่มสินค้า/รายการ × ประเภท ({groups.length} กลุ่ม)
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            ตรวจการจัดหมวดเป็นรายกลุ่มก่อนออกรายการ —
            เปลี่ยนประเภทตรงนี้จะเปลี่ยนทุกแถวที่ชื่อรายการเดียวกันพร้อมกัน
          </p>
          <div className="max-h-96 overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[560px] border border-gray-300 text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-1 text-left">
                    รายการ/สินค้า
                  </th>
                  <th className="w-20 border border-gray-300 px-2 py-1">
                    จำนวนแถว
                  </th>
                  <th className="w-28 border border-gray-300 px-2 py-1 text-right">
                    ยอดรวม
                  </th>
                  <th className="w-44 border border-gray-300 px-2 py-1">
                    ประเภท
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.description}>
                    <td className="border border-gray-300 px-2 py-1">
                      {g.description}
                      {g.autoCount > 0 && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                          อัตโนมัติ {g.autoCount} แถว
                        </span>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      {g.count}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right">
                      {fmtBaht(g.total)}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      <select
                        value={g.kind}
                        onChange={(e) =>
                          setGroupKind(
                            g.description,
                            e.target.value as CashbookKind,
                          )
                        }
                        className={`w-full rounded-full border-0 px-2 py-1 text-center text-xs font-medium ${
                          g.kind === "mixed"
                            ? "bg-orange-100 text-orange-800"
                            : KIND_BADGE_CLS[g.kind]
                        }`}
                      >
                        {g.kind === "mixed" && (
                          <option value="mixed" disabled>
                            — หลายประเภทปนกัน —
                          </option>
                        )}
                        {(Object.keys(KIND_LABELS) as CashbookKind[]).map(
                          (k) => (
                            <option key={k} value={k}>
                              {KIND_LABELS[k]}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 5. datatable รายการ (เฉพาะบนจอ) */}
      <section className="rounded-xl bg-white p-4 shadow print:hidden">
        <h2 className="mb-3 font-semibold text-gray-800">
          รายการในช่วง ({inRangeCount} แถว)
        </h2>

        {/* แถบตัวกรอง */}
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-sm text-gray-600 sm:col-span-2">
            ค้นหา
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาจากรายการ/หมายเหตุ…"
              className={inputCls}
            />
          </label>
          <label className="block text-sm text-gray-600">
            ประเภท
            <select
              value={filterKind}
              onChange={(e) => {
                setFilterKind(e.target.value as KindFilter);
                setPage(1);
              }}
              className={inputCls}
            >
              <option value="all">ทุกประเภท</option>
              {(Object.keys(KIND_LABELS) as CashbookKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-600">
            เดือน
            <select
              value={filterMonth}
              onChange={(e) => {
                setFilterMonth(e.target.value);
                setPage(1);
              }}
              className={inputCls}
            >
              <option value="all">ทุกเดือน</option>
              {report.months.map((m) => (
                <option key={m.key} value={m.key}>
                  {thaiMonthYearLabel(m.key)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {flatRows.length === 0 ? (
          <p className="text-sm text-gray-500">
            ยังไม่มีรายการในช่วงวันที่ที่เลือก
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border border-gray-300 text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="w-36 border border-gray-300 px-2 py-1">
                      <button
                        type="button"
                        onClick={() => toggleSort("date")}
                        className="w-full text-left font-semibold"
                      >
                        วัน/เดือน/ปี{" "}
                        <span className="text-gray-400">{sortIcon("date")}</span>
                      </button>
                    </th>
                    <th className="border border-gray-300 px-2 py-1 text-left">
                      รายการ
                    </th>
                    <th className="w-40 border border-gray-300 px-2 py-1">
                      ประเภท
                    </th>
                    <th className="w-28 border border-gray-300 px-2 py-1">
                      <button
                        type="button"
                        onClick={() => toggleSort("amount")}
                        className="w-full text-right font-semibold"
                      >
                        จำนวนเงิน{" "}
                        <span className="text-gray-400">
                          {sortIcon("amount")}
                        </span>
                      </button>
                    </th>
                    <th className="border border-gray-300 px-2 py-1 text-left">
                      หมายเหตุ
                    </th>
                    <th className="w-12 border border-gray-300 px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const ui = rows.find((u) => u.id === r.id);
                    return (
                      <tr
                        key={r.id}
                        className={r.estimated ? "bg-yellow-50" : ""}
                      >
                        <td className="border border-gray-300 px-2 py-1 whitespace-nowrap">
                          <input
                            type="date"
                            value={r.date}
                            onChange={(e) =>
                              updateRow(r.id, { date: e.target.value })
                            }
                            className={cellInputCls}
                          />
                          <span className="block text-center text-xs text-gray-400">
                            {thaiBuddhistDate(r.date)}
                          </span>
                        </td>
                        <td className="border border-gray-300 px-2 py-1">
                          <input
                            value={ui?.description ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, { description: e.target.value })
                            }
                            className={cellInputCls}
                          />
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {r.auto && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                                จัดหมวดอัตโนมัติ
                              </span>
                            )}
                            {r.estimated && (
                              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                                ประมาณการ
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center">
                          <select
                            value={r.kind}
                            onChange={(e) =>
                              updateRow(r.id, {
                                kind: e.target.value as CashbookKind,
                              })
                            }
                            className={`w-full rounded-full border-0 px-2 py-1 text-center text-xs font-medium ${KIND_BADGE_CLS[r.kind]}`}
                          >
                            {(Object.keys(KIND_LABELS) as CashbookKind[]).map(
                              (k) => (
                                <option key={k} value={k}>
                                  {KIND_LABELS[k]}
                                </option>
                              ),
                            )}
                          </select>
                        </td>
                        <td className="border border-gray-300 px-2 py-1">
                          <input
                            inputMode="decimal"
                            value={ui?.amount ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, {
                                amount: sanitizeAmount(e.target.value),
                              })
                            }
                            className={`${cellInputCls} text-right`}
                          />
                        </td>
                        <td className="border border-gray-300 px-2 py-1">
                          <input
                            value={ui?.note ?? ""}
                            onChange={(e) =>
                              updateRow(r.id, { note: e.target.value })
                            }
                            className={cellInputCls}
                          />
                        </td>
                        <td className="border border-gray-300 px-1 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeRow(r.id)}
                            aria-label="ลบรายการ"
                            className="rounded px-1.5 py-1 text-xs text-red-500 hover:bg-red-50"
                          >
                            ลบ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold">
                    <td
                      colSpan={3}
                      className="border border-gray-300 px-2 py-1"
                    >
                      {isFiltered
                        ? `รวมตามตัวกรอง (${filtered.length} แถว)`
                        : `รวมทั้งหมด (${filtered.length} แถว)`}
                    </td>
                    <td
                      colSpan={3}
                      className="border border-gray-300 px-2 py-1 text-sm font-normal"
                    >
                      รายรับ{" "}
                      <b className="text-emerald-700">
                        {fmtBaht(filteredTotals.income)}
                      </b>{" "}
                      · ซื้อสินค้า{" "}
                      <b className="text-blue-700">
                        {fmtBaht(filteredTotals.purchase)}
                      </b>{" "}
                      · อื่น ๆ <b>{fmtBaht(filteredTotals.other)}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* แบ่งหน้า */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
              <span>
                แสดง {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
                –{Math.min(safePage * pageSize, filtered.length)} จาก{" "}
                {filtered.length} แถว
              </span>
              <span className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-lg border border-gray-300 px-2 py-1"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} แถว/หน้า
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="rounded-lg bg-gray-100 px-3 py-1 font-medium hover:bg-gray-200 disabled:opacity-40"
                >
                  ‹ ก่อนหน้า
                </button>
                <span>
                  หน้า {safePage}/{totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="rounded-lg bg-gray-100 px-3 py-1 font-medium hover:bg-gray-200 disabled:opacity-40"
                >
                  ถัดไป ›
                </button>
              </span>
            </div>
          </>
        )}
      </section>

      {/* 6. สรุปยอดตามแบบรายงาน (บนจอ) */}
      <section className="rounded-xl bg-white p-4 shadow print:hidden">
        <h2 className="mb-3 font-semibold text-gray-800">สรุปยอดทั้งช่วง</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 p-3">
            <p className="text-sm text-gray-700">รายรับรวม</p>
            <p className="text-xl font-bold text-emerald-700">
              {fmtBaht(report.grand.income)} ฿
            </p>
          </div>
          <div className="rounded-lg border border-blue-300 bg-blue-50 p-3">
            <p className="text-sm text-gray-700">รายจ่าย: ซื้อสินค้า</p>
            <p className="text-xl font-bold text-blue-700">
              {fmtBaht(report.grand.purchase)} ฿
            </p>
          </div>
          <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
            <p className="text-sm text-gray-700">รายจ่าย: อื่น ๆ</p>
            <p className="text-xl font-bold text-gray-800">
              {fmtBaht(report.grand.other)} ฿
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ยอดรายรับรวมต้องตรงกับ &quot;เงินได้พึงประเมิน&quot; ของหน้ารายงาน
          ภ.ง.ด.94 ช่วงเดียวกัน — ตารางพิมพ์/CSV เป็นแบบทางการเต็มช่วงเสมอ
          ไม่ถูกตัวกรองด้านบนกระทบ
        </p>
      </section>

      {/* 7. ตารางแบบทางการ — แสดงเฉพาะตอนพิมพ์ */}
      <section className="hidden print:block">
        <table className="w-full border border-gray-300 text-sm">
          <thead>
            {/* หัวรายงานอยู่ใน thead เพื่อให้พิมพ์ซ้ำทุกหน้า (table-header-group) */}
            <tr>
              <td colSpan={6} className="border border-gray-300 px-3 py-2">
                <p className="text-center text-base font-bold">
                  รายงานเงินสดรับ-จ่าย
                </p>
                <div className="mt-1 grid grid-cols-2 gap-x-6 text-xs text-gray-700">
                  <p>ชื่อผู้ประกอบการ: {header.ownerName || "-"}</p>
                  <p>ชื่อร้าน/กิจการ: {header.shopName || "-"}</p>
                  <p>เลขประจำตัวผู้เสียภาษี: {header.taxId || "-"}</p>
                  <p>ที่อยู่: {header.address || "-"}</p>
                  <p className="col-span-2">ช่วงเวลา: {periodLabel}</p>
                </div>
              </td>
            </tr>
            <tr className="bg-gray-100">
              {[
                "วัน/เดือน/ปี",
                "รายการ",
                "รายรับ",
                "รายจ่าย: ซื้อสินค้า",
                "รายจ่าย: อื่น ๆ",
                "หมายเหตุ",
              ].map((h) => (
                <th key={h} className="border border-gray-300 px-2 py-1">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          {report.months.length === 0 ? (
            <tbody>
              <tr>
                <td
                  colSpan={6}
                  className="border border-gray-300 px-3 py-6 text-center text-gray-500"
                >
                  ยังไม่มีรายการในช่วงวันที่ที่เลือก
                </td>
              </tr>
            </tbody>
          ) : (
            <>
              {report.months.map((month) => (
                <tbody key={month.key}>
                  {month.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="border border-gray-300 px-2 py-1 text-center whitespace-nowrap">
                        {thaiBuddhistDate(r.date)}
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        {r.description}
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-right">
                        {r.kind === "income" ? fmtBaht(r.amount) : ""}
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-right">
                        {r.kind === "purchase" ? fmtBaht(r.amount) : ""}
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-right">
                        {r.kind === "other" ? fmtBaht(r.amount) : ""}
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        {r.note}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={2} className="border border-gray-300 px-2 py-1">
                      รวมประจำเดือน {thaiMonthYearLabel(month.key)}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right">
                      {fmtBaht(month.totals.income)}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right">
                      {fmtBaht(month.totals.purchase)}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right">
                      {fmtBaht(month.totals.other)}
                    </td>
                    <td className="border border-gray-300 px-2 py-1" />
                  </tr>
                </tbody>
              ))}
              <tbody>
                <tr className="font-bold">
                  <td colSpan={2} className="border border-gray-300 px-2 py-1">
                    รวมทั้งสิ้น
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-right">
                    {fmtBaht(report.grand.income)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-right">
                    {fmtBaht(report.grand.purchase)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-right">
                    {fmtBaht(report.grand.other)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1" />
                </tr>
              </tbody>
            </>
          )}
        </table>
      </section>

      {/* 8. ปุ่ม export */}
      <section className="flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
        >
          ดาวน์โหลด CSV
        </button>
        <button
          type="button"
          onClick={printReport}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          พิมพ์ / บันทึก PDF
        </button>
      </section>
    </div>
  );
}
