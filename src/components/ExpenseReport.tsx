"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { isValidDateStr, todayBangkok } from "@/lib/date";
import { fmtBaht, presetRange } from "@/lib/pnd94";
import {
  NOT_COUNTED_LABEL,
  UNCATEGORIZED_LABEL,
  buildExpenseReport,
  type CategoryMappingInput,
  type ExpenseEntry,
} from "@/lib/expense-report";
import { buildExpenseWorkbook } from "@/lib/expense-export";

/**
 * หน้ารายงานค่าใช้จ่ายรายเดือน × หมวดหมู่ + ส่วนจัดการ mapping ของแท็บหมวดหมู่
 *
 * mapping ใช้ last-write-wins (ดู src/lib/sheets.ts): หลังแก้สำเร็จทุกครั้ง
 * re-fetch ทั้งชุดแทน state เดิม ไม่ patch เอง — สถานะบนจอสะท้อนชีตจริงเสมอ
 * ข้อมูลสมุดบัญชีอ่านผ่าน /api/entries/range (read-only) ตามช่วงวันที่ที่เลือก
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

type MappingState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; mappings: CategoryMappingInput[] };

const inputCls =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none";
const cellCls = "border border-gray-300 px-2 py-1";
const numCls = `${cellCls} whitespace-nowrap text-right tabular-nums`;

export default function ExpenseReport() {
  const router = useRouter();

  const [mappingState, setMappingState] = useState<MappingState>({ status: "loading" });
  // default = ทั้งปีปัจจุบัน (ตามที่เจ้าของร้านใช้ดูรายงานประจำปี)
  const [range, setRange] = useState(() => presetRange("FULL", todayBangkok()));
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loadingRange, setLoadingRange] = useState(false);
  const [initing, setIniting] = useState(false);
  const [mutatingItem, setMutatingItem] = useState<string | null>(null);
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [showManage, setShowManage] = useState(false);
  // ค่า "สร้างหมวดใหม่…" ต่อรายการ (key = ชื่อรายการ)
  const [newCategoryFor, setNewCategoryFor] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");

  const handleHttpError = useCallback(
    async (res: Response, title: string): Promise<void> => {
      if (res.status === 401) {
        router.push("/login?reason=expired");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as ApiError;
      if (body.error?.code === "TAB_NOT_FOUND") {
        // client ค้างสถานะเก่า แต่แท็บถูกลบไปแล้ว → กลับไปหน้าเสนอสร้างแท็บ
        setMappingState({ status: "missing" });
      }
      void Swal.fire({
        icon: "error",
        title,
        text: body.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่",
      });
    },
    [router],
  );

  const fetchMappings = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/expense-categories");
    if (!res.ok) {
      await handleHttpError(res, "โหลดหมวดหมู่ไม่สำเร็จ");
      return;
    }
    const data = (await res.json()) as
      | { exists: false }
      | { exists: true; mappings: CategoryMappingInput[] };
    setMappingState(
      data.exists ? { status: "ready", mappings: data.mappings } : { status: "missing" },
    );
  }, [handleHttpError]);

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
        const data = (await res.json()) as { entries: ExpenseEntry[] };
        setEntries(data.entries.filter((e) => e.amount < 0));
      } finally {
        setLoadingRange(false);
      }
    },
    [handleHttpError],
  );

  useEffect(() => {
    void fetchMappings();
  }, [fetchMappings]);

  useEffect(() => {
    // ดึงใหม่เมื่อช่วงเปลี่ยนและถูกต้องเท่านั้น (input type=date ยิง change เมื่อเลือกครบ)
    if (!rangeError(range.from, range.to)) void fetchRange(range.from, range.to);
  }, [range, fetchRange]);

  const mappings = mappingState.status === "ready" ? mappingState.mappings : [];
  const report = useMemo(
    () => buildExpenseReport(entries, mappings, range.from, range.to),
    [entries, mappings, range],
  );
  const categoryChoices = useMemo(() => {
    const seen = new Set<string>();
    for (const m of mappings) if (m.category) seen.add(m.category);
    return [...seen];
  }, [mappings]);

  // ---------- การแก้ไข mapping (ทุกตัว re-fetch ทั้งชุดหลังสำเร็จ) ----------

  const addMapping = async (item: string, category: string, opts?: { silent?: boolean }) => {
    setMutatingItem(item);
    try {
      const res = await fetch("/api/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, item }),
      });
      if (!res.ok) {
        await handleHttpError(res, "จัดหมวดไม่สำเร็จ");
        return;
      }
      await fetchMappings();
      if (!opts?.silent) {
        void Swal.fire({
          icon: "success",
          title: "จัดหมวดแล้ว",
          text: `"${item}" → ${category}`,
          timer: 1400,
          showConfirmButton: false,
        });
      }
    } finally {
      setMutatingItem(null);
      setNewCategoryFor(null);
      setNewCategoryName("");
    }
  };

  const moveMapping = async (item: string, category: string) => {
    setMutatingItem(item);
    try {
      const res = await fetch("/api/expense-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, category }),
      });
      if (!res.ok) {
        await handleHttpError(res, "ย้ายหมวดไม่สำเร็จ");
        return;
      }
      await fetchMappings();
    } finally {
      setMutatingItem(null);
    }
  };

  const deleteMapping = async (item: string) => {
    const confirm = await Swal.fire({
      icon: "warning",
      title: "ลบ mapping นี้?",
      text: `"${item}" จะกลับไปอยู่ใน "${UNCATEGORIZED_LABEL}"`,
      showCancelButton: true,
      confirmButtonText: "ลบ",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#dc2626",
    });
    if (!confirm.isConfirmed) return;
    setMutatingItem(item);
    try {
      const res = await fetch(
        `/api/expense-categories?item=${encodeURIComponent(item)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await handleHttpError(res, "ลบไม่สำเร็จ");
        return;
      }
      await fetchMappings();
    } finally {
      setMutatingItem(null);
    }
  };

  const initTab = async () => {
    // R1: เขียนแท็บใหม่ลงชีตจริงของร้าน — ต้องให้ผู้ใช้กดยืนยันเองเสมอ
    const confirm = await Swal.fire({
      icon: "question",
      title: "สร้างแท็บหมวดหมู่ค่าใช้จ่าย?",
      text: 'ระบบจะเพิ่มแท็บ "หมวดหมู่ค่าใช้จ่าย" พร้อมข้อมูลตั้งต้นลงในชีตของร้าน (ยกเลิกได้โดยลบแท็บทิ้ง ไม่กระทบข้อมูลสมุดบัญชี)',
      showCancelButton: true,
      confirmButtonText: "สร้างแท็บ",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#f59e0b",
    });
    if (!confirm.isConfirmed) return;
    setIniting(true);
    try {
      const res = await fetch("/api/expense-categories/init", { method: "POST" });
      if (!res.ok) {
        await handleHttpError(res, "สร้างแท็บไม่สำเร็จ");
        return;
      }
      const data = (await res.json()) as { seeded: number };
      await fetchMappings();
      void Swal.fire({
        icon: "success",
        title: "สร้างแท็บแล้ว",
        text: `เพิ่มข้อมูลตั้งต้น ${data.seeded} รายการ`,
        timer: 1800,
        showConfirmButton: false,
      });
    } finally {
      setIniting(false);
    }
  };

  // ชีตสรุปในไฟล์เป็นสูตร SUMIFS ผูกกับชีตรายละเอียด — แก้ตัวเลขในไฟล์แล้วสรุปคำนวณใหม่เอง
  const downloadExcel = () => {
    const bytes = buildExpenseWorkbook(entries, mappings, range.from, range.to);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${range.from}-${range.to}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- แถบเลือกหมวด (ใช้ทั้ง panel ยังไม่จัดหมวด และย้ายหมวด) ----------
  // เป็น render function ไม่ใช่ component — กัน React remount input ทุก re-render
  // (component ที่ประกาศใหม่ทุก render ทำให้ช่องพิมพ์ชื่อหมวดใหม่หลุดโฟกัสทุกตัวอักษร)

  const renderCategorySelect = (
    item: string,
    onPick: (category: string) => void,
    current?: string,
  ) => (
    <select
      className={inputCls}
      value={newCategoryFor === item ? "__new__" : (current ?? "")}
      disabled={mutatingItem === item}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__new__") {
          setNewCategoryFor(item);
          setNewCategoryName("");
        } else if (v && v !== current) {
          setNewCategoryFor(null);
          onPick(v);
        }
      }}
    >
      {current === undefined && <option value="">— เลือกหมวด —</option>}
      {categoryChoices.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value="__new__">+ สร้างหมวดใหม่…</option>
    </select>
  );

  const renderNewCategoryInput = (item: string, onSubmit: (c: string) => void) =>
    newCategoryFor === item ? (
      <span className="flex items-center gap-1">
        <input
          className={`${inputCls} w-40`}
          placeholder="ชื่อหมวดใหม่"
          value={newCategoryName}
          autoFocus
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newCategoryName.trim()) {
              onSubmit(newCategoryName.trim());
            }
          }}
        />
        <button
          type="button"
          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          disabled={!newCategoryName.trim() || mutatingItem === item}
          onClick={() => onSubmit(newCategoryName.trim())}
        >
          ตกลง
        </button>
      </span>
    ) : null;

  // ---------- render ----------

  if (mappingState.status === "loading") {
    return (
      <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow">
        กำลังโหลดหมวดหมู่…
      </div>
    );
  }

  if (mappingState.status === "missing") {
    return (
      <div className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-2 font-semibold text-gray-800">
          ยังไม่มีแท็บ &quot;หมวดหมู่ค่าใช้จ่าย&quot; ในชีต
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          รายงานนี้ต้องใช้แท็บเก็บการจับคู่ &quot;ชื่อรายการ → หมวดหมู่&quot;
          กดปุ่มด้านล่างเพื่อสร้างแท็บพร้อมข้อมูลตั้งต้นที่ตกลงกับเจ้าของร้านไว้
          (แก้ไขภายหลังได้ทั้งจากหน้านี้และในชีตโดยตรง)
        </p>
        <button
          type="button"
          onClick={() => void initTab()}
          disabled={initing}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {initing ? "กำลังสร้างแท็บ…" : "สร้างแท็บพร้อมข้อมูลตั้งต้น"}
        </button>
      </div>
    );
  }

  const uncatCol = report.uncategorizedTotal.count > 0;
  const grouped = new Map<string, CategoryMappingInput[]>();
  for (const m of mappings) {
    const list = grouped.get(m.category) ?? [];
    list.push(m);
    grouped.set(m.category, list);
  }

  return (
    <div className="space-y-4">
      {/* เลือกปี */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow">
        <label htmlFor="expense-from" className="text-sm font-medium text-gray-700">
          ช่วงวันที่
        </label>
        <input
          id="expense-from"
          type="date"
          className={inputCls}
          value={range.from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
        />
        <span className="text-sm text-gray-500">ถึง</span>
        <input
          id="expense-to"
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
        {!invalidRange && !loadingRange && entries.length === 0 && (
          <span className="text-sm text-gray-500">ช่วงนี้ไม่มีข้อมูลรายจ่าย</span>
        )}
      </section>

      {/* คำเตือนชื่อรายการซ้ำในแท็บ */}
      {report.duplicateItems.length > 0 && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          ⚠ ชื่อรายการซ้ำหลายแถวในแท็บหมวดหมู่ (ใช้แถวบนสุด):{" "}
          {report.duplicateItems.join(", ")} — แก้ได้โดยลบแถวซ้ำในชีต
        </div>
      )}

      {/* ตารางสรุปรายเดือน × หมวด */}
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 font-semibold text-gray-800">
          สรุปค่าใช้จ่ายรายเดือน {range.from} ถึง {range.to}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border border-gray-300 text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-700">
                <th className={`${cellCls} text-left`}>เดือน</th>
                {report.categories.map((c) => (
                  <th key={c} className={`${cellCls} text-right`}>
                    {c}
                  </th>
                ))}
                {uncatCol && (
                  <th className={`${cellCls} text-right text-orange-700`}>
                    {UNCATEGORIZED_LABEL}
                  </th>
                )}
                <th className={`${cellCls} text-right`}>รวมทั้งหมด</th>
              </tr>
            </thead>
            <tbody>
              {report.months.map((m) => {
                const label = m.label;
                return (
                  <tr key={`${m.year}-${m.month}`} className="odd:bg-white even:bg-gray-50">
                    <td className={cellCls}>{label}</td>
                    {m.cells.map((v, ci) => (
                      <td key={ci} className={numCls}>
                        {fmtBaht(v)}
                      </td>
                    ))}
                    {uncatCol && (
                      <td className={`${numCls} text-orange-700`}>
                        {m.uncategorized.count > 0 ? (
                          <button
                            type="button"
                            className="underline decoration-dotted underline-offset-2 hover:text-orange-900"
                            onClick={() => setShowUncategorized(true)}
                            title="ดูรายการที่ยังไม่จัดหมวด"
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
                {report.categoryTotals.map((v, ci) => (
                  <td key={ci} className={numCls}>
                    {fmtBaht(v)}
                  </td>
                ))}
                {uncatCol && (
                  <td className={`${numCls} text-orange-700`}>
                    {fmtBaht(report.uncategorizedTotal.amount)}{" "}
                    <span className="text-xs">({report.uncategorizedTotal.count})</span>
                  </td>
                )}
                <td className={numCls}>{fmtBaht(report.grandTotal)}</td>
              </tr>
              {report.notCountedTotal > 0 && (
                <tr className="bg-gray-50 text-gray-600">
                  <td className={cellCls} colSpan={1 + report.categories.length + (uncatCol ? 1 : 0)}>
                    {NOT_COUNTED_LABEL}
                  </td>
                  <td className={numCls}>{fmtBaht(report.notCountedTotal)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          นับเฉพาะแถวรายจ่าย (จำนวนเงินติดลบ) ในสมุดบัญชี — แถวที่ระบุ
          &quot;ไม่นับเป็นค่าใช้จ่าย&quot; แสดงแยกท้ายตารางและไม่รวมในยอดรวม
        </p>
        <button
          type="button"
          onClick={downloadExcel}
          disabled={loadingRange || entries.length === 0 || invalidRange !== null}
          className="mt-3 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
        >
          ดาวน์โหลด Excel (สรุป + รายละเอียด)
        </button>
        <p className="mt-1 text-xs text-gray-500">
          ไฟล์มี 2 ชีต: ชีตสรุปผูกสูตร SUMIFS กับชีต &quot;รายละเอียดค่าใช้จ่าย&quot;
          — แก้ตัวเลข/หมวดในชีตรายละเอียดแล้วตารางสรุปคำนวณใหม่อัตโนมัติ
        </p>
      </section>

      {/* รายการยังไม่จัดหมวด — จัดหมวดได้ทันที */}
      {report.uncategorizedItems.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-semibold text-gray-800"
            onClick={() => setShowUncategorized((v) => !v)}
          >
            <span>
              {UNCATEGORIZED_LABEL}ในช่วงที่เลือก ({report.uncategorizedItems.length} ชื่อรายการ
              · {fmtBaht(report.uncategorizedTotal.amount)} บาท)
            </span>
            <span aria-hidden>{showUncategorized ? "▲" : "▼"}</span>
          </button>
          {showUncategorized && (
            <ul className="mt-3 divide-y divide-gray-100">
              {report.uncategorizedItems.map((u) => (
                <li key={u.item} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-gray-800">{u.item}</span>{" "}
                    <span className="text-gray-500">
                      ({u.count} รายการ · {fmtBaht(u.amount)} บาท)
                    </span>
                  </span>
                  {renderCategorySelect(u.item, (c) => void addMapping(u.item, c))}
                  {renderNewCategoryInput(u.item, (c) => void addMapping(u.item, c))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* จัดการหมวดหมู่/รายการทั้งหมด */}
      <section className="rounded-xl bg-white p-4 shadow">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left font-semibold text-gray-800"
          onClick={() => setShowManage((v) => !v)}
        >
          <span>จัดการหมวดหมู่ ({mappings.length} รายการใน {grouped.size} หมวด)</span>
          <span aria-hidden>{showManage ? "▲" : "▼"}</span>
        </button>
        {showManage && (
          <div className="mt-3 space-y-4">
            <p className="text-xs text-gray-500">
              ย้ายลำดับหมวดในรายงาน = ย้ายลำดับแถวในแท็บ &quot;หมวดหมู่ค่าใช้จ่าย&quot;
              ของชีตโดยตรง · ลบ mapping แล้วรายการจะกลับไป &quot;{UNCATEGORIZED_LABEL}&quot;
            </p>
            {[...grouped.entries()].map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-1 text-sm font-semibold text-amber-700">
                  {category} <span className="font-normal text-gray-400">({items.length})</span>
                </h3>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {items.map((m) => (
                    <li
                      key={m.item}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-gray-800">{m.item}</span>
                        {!m.counted && (
                          <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                            ไม่นับเป็นค่าใช้จ่าย
                          </span>
                        )}
                        {m.note && (
                          <span className="ml-2 text-xs text-gray-400">{m.note}</span>
                        )}
                      </span>
                      {renderCategorySelect(
                        m.item,
                        (c) => void moveMapping(m.item, c),
                        m.category,
                      )}
                      {renderNewCategoryInput(m.item, (c) => void moveMapping(m.item, c))}
                      <button
                        type="button"
                        className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        disabled={mutatingItem === m.item}
                        onClick={() => void deleteMapping(m.item)}
                      >
                        ลบ
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
