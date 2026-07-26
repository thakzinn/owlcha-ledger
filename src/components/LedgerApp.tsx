"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { todayBangkok } from "@/lib/date";
import { typeFromAmount, toSignedAmount, type EntryType } from "@/lib/entries";
import SummaryCard, { type SummaryEntry } from "@/components/SummaryCard";

interface UiEntry {
  id: number;
  type: EntryType;
  description: string;
  /** ค่าบวกเป็น string ตามที่พิมพ์ — แปลงเครื่องหมายตอน submit เท่านั้น */
  amount: string;
  channel: "เงินสด" | "โอน";
}

interface ApiError {
  error?: { code?: string; message?: string };
}

let nextId = 1;
const newRow = (): UiEntry => ({
  id: nextId++,
  type: "expense",
  description: "",
  amount: "",
  channel: "เงินสด",
});

/** วันที่ยังไม่มีข้อมูล → prefill รายการประจำของร้าน (จำนวนเงินเว้นว่างให้กรอก) */
const templateRows = (): UiEntry[] =>
  (
    [
      ["expense", "น้ำแข็ง", "โอน"],
      ["expense", "ค่าแรงพนักงาน", "โอน"],
      ["income", "ขายหน้าร้าน", "เงินสด"],
      ["income", "kshop", "โอน"],
      ["income", "grab", "โอน"],
    ] as const
  ).map(([type, description, channel]) => ({
    id: nextId++,
    type,
    description,
    amount: "",
    channel,
  }));

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sanitizeAmount = (v: string): string => {
  let s = v.replace(/[^0-9.]/g, "");
  const parts = s.split(".");
  if (parts.length > 2) s = `${parts[0]}.${parts[1]}`;
  const [i, f] = s.split(".");
  return f !== undefined ? `${i}.${f.slice(0, 2)}` : s;
};

export default function LedgerApp({ email }: { email: string }) {
  const router = useRouter();
  const draftKey = `owlcha:draft:${email}`; // แยก key ตามผู้ใช้ — กันข้อมูลปนบนเครื่องร่วม

  const [date, setDate] = useState(() => todayBangkok());
  const [entries, setEntries] = useState<UiEntry[]>(() => [newRow()]);
  const [version, setVersion] = useState<string | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [restored, setRestored] = useState(false);

  const [captureData, setCaptureData] = useState<{
    date: string;
    entries: SummaryEntry[];
  } | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  // ---------- โหลด/แคช ----------

  const handleApiFailure = useCallback(
    async (res: Response): Promise<string> => {
      const body = (await res.json().catch(() => ({}))) as ApiError;
      if (res.status === 401) {
        router.push("/login?reason=expired");
        return "";
      }
      return body.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่";
    },
    [router],
  );

  const loadDay = useCallback(
    async (d: string, { silent = false } = {}) => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/entries?date=${d}`);
        if (!res.ok) {
          const msg = await handleApiFailure(res);
          if (msg) void Swal.fire({ icon: "error", title: "โหลดไม่สำเร็จ", text: msg });
          return;
        }
        const data = (await res.json()) as {
          entries: SummaryEntry[];
          version: string;
          latestDate: string | null;
        };
        setVersion(data.version);
        setLatestDate(data.latestDate);
        if (data.entries.length) {
          setEntries(
            data.entries.map((e) => ({
              id: nextId++,
              type: typeFromAmount(e.amount),
              description: e.description,
              amount: String(Math.abs(e.amount)),
              channel: e.channel === "โอน" ? "โอน" : "เงินสด",
            })),
          );
          if (!silent) {
            void Swal.fire({
              icon: "success",
              title: `พบ ${data.entries.length} รายการ`,
              timer: 1200,
              showConfirmButton: false,
            });
          }
        } else {
          setEntries(templateRows());
          if (!silent) {
            void Swal.fire({
              icon: "info",
              title: "ยังไม่มีข้อมูล — เตรียมรายการประจำให้แล้ว",
              timer: 1500,
              showConfirmButton: false,
            });
          }
        }
      } catch {
        void Swal.fire({
          icon: "error",
          title: "โหลดไม่สำเร็จ",
          text: "เชื่อมต่อไม่ได้ กรุณาลองใหม่",
        });
      } finally {
        setStatus("idle");
      }
    },
    [handleApiFailure],
  );

  // mount: กู้ draft ของผู้ใช้คนนี้ (ถ้ามี) ไม่งั้นโหลดวันนี้ + ดึง autocomplete แบบ non-blocking
  useEffect(() => {
    let draftUsed = false;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          date?: string;
          entries?: UiEntry[];
          version?: string | null;
          latestDate?: string | null;
        };
        if (draft.date && Array.isArray(draft.entries) && draft.entries.length) {
          setDate(draft.date);
          setEntries(draft.entries.map((e) => ({ ...e, id: nextId++ })));
          setVersion(draft.version ?? null);
          setLatestDate(draft.latestDate ?? null);
          draftUsed = true;
        }
      }
    } catch {
      /* draft เสีย → เริ่มใหม่ */
    }
    if (!draftUsed) void loadDay(todayBangkok(), { silent: true });
    setRestored(true);

    void fetch("/api/descriptions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { descriptions?: string[] } | null) => {
        if (d?.descriptions) setDescriptions(d.descriptions);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // เก็บ draft ทุกครั้งที่แก้ (หลัง restore แล้วเท่านั้น)
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ date, entries, version, latestDate }),
      );
    } catch {
      /* storage เต็ม/ปิด — draft เป็น best-effort */
    }
  }, [restored, draftKey, date, entries, version, latestDate]);

  // ---------- แก้ไขรายการ ----------

  const update = (id: number, patch: Partial<UiEntry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addRow = () => setEntries((prev) => [...prev, newRow()]);

  const removeRow = async (row: UiEntry) => {
    if (entries.length <= 1) return;
    const hasContent = row.description.trim() !== "" || row.amount !== "";
    if (hasContent) {
      const res = await Swal.fire({
        icon: "warning",
        title: "ลบรายการนี้?",
        text: row.description.trim() || "(ไม่มีคำอธิบาย)",
        showCancelButton: true,
        confirmButtonText: "ลบ",
        cancelButtonText: "ยกเลิก",
        confirmButtonColor: "#dc2626",
      });
      if (!res.isConfirmed) return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== row.id));
  };

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of entries) {
      const a = parseFloat(e.amount) || 0;
      if (e.type === "expense") expense += a;
      else income += a;
    }
    return { income, expense, balance: income - expense };
  }, [entries]);

  // ---------- บันทึก ----------

  /** แถว template ที่ไม่ได้กรอกจำนวนเงิน (ช่องว่าง) จะไม่ถูกบันทึก — กันแถว 0 ขยะลงชีต */
  const buildPayload = (): SummaryEntry[] =>
    entries
      .filter((e) => e.amount.trim() !== "")
      .map((e) => ({
        description: e.description.trim(),
        amount: toSignedAmount(e.type, parseFloat(e.amount) || 0),
        channel: e.channel,
      }));

  /** N12: แนบ element เข้า DOM ก่อน → fonts.load ทุกน้ำหนักที่ใช้ → fonts.ready → capture */
  const captureImage = async (): Promise<string | null> => {
    const el = captureRef.current;
    if (!el) return null;
    try {
      const kanit = getComputedStyle(document.body).fontFamily;
      await Promise.all(
        ["300", "400", "500", "600"].map((w) =>
          document.fonts.load(`${w} 16px ${kanit}`),
        ),
      );
      await document.fonts.ready;
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const notifyTelegram = async (payload: SummaryEntry[]): Promise<boolean> => {
    setCaptureData({ date, entries: payload });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const img = await captureImage();
    setCaptureData(null);
    if (!img) return false;
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, imageBase64: img }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const doSave = async (payload: SummaryEntry[], baseVersion: string) => {
    setStatus("saving");
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, entries: payload, baseVersion }),
      });

      if (res.status === 409) {
        setStatus("idle");
        await handleConflict(payload);
        return;
      }
      if (!res.ok) {
        const msg = await handleApiFailure(res);
        if (msg) void Swal.fire({ icon: "error", title: "บันทึกไม่สำเร็จ", text: msg });
        return;
      }

      Swal.fire({
        title: "⏳ กำลังส่งรูปสรุปเข้า Telegram…",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });
      const sent = await notifyTelegram(payload);

      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      await Swal.fire({
        icon: sent ? "success" : "warning",
        title: "บันทึกลงชีตสำเร็จ",
        text: sent
          ? "ส่งรูปสรุปเข้า Telegram แล้ว"
          : "แต่ส่งรูปเข้า Telegram ไม่สำเร็จ — ข้อมูลบันทึกแล้ว ลองส่งใหม่ได้จากการบันทึกซ้ำ",
      });
      await loadDay(date, { silent: true });
    } finally {
      setStatus("idle");
    }
  };

  /** 409: ข้อมูลบนเซิร์ฟเวอร์เปลี่ยน — แสดงของเซิร์ฟเวอร์เทียบก่อน, ห้ามเขียนทับเงียบ ๆ,
   *  ปุ่ม "เขียนทับ" ไม่ใช่ default, ข้อมูลที่พิมพ์ค้างอยู่ไม่หาย (อยู่ใน state+draft) */
  const handleConflict = async (payload: SummaryEntry[]) => {
    const res = await fetch(`/api/entries?date=${date}`);
    if (!res.ok) {
      void Swal.fire({ icon: "error", title: "ตรวจสอบข้อมูลล่าสุดไม่สำเร็จ" });
      return;
    }
    const server = (await res.json()) as {
      entries: SummaryEntry[];
      version: string;
    };

    // สร้างรายการเปรียบเทียบด้วย DOM API + textContent เท่านั้น (กัน XSS)
    const box = document.createElement("div");
    box.style.textAlign = "left";
    const head = document.createElement("p");
    head.textContent = `ข้อมูลวันนี้บนชีตตอนนี้ (${server.entries.length} รายการ):`;
    head.style.fontWeight = "600";
    box.appendChild(head);
    const ul = document.createElement("ul");
    ul.style.margin = "8px 0 12px 20px";
    ul.style.listStyle = "disc";
    for (const e of server.entries.slice(0, 15)) {
      const li = document.createElement("li");
      li.textContent = `${e.amount < 0 ? "รายจ่าย" : "รายรับ"} ${
        e.description || "(ไม่มีคำอธิบาย)"
      } ${fmt(e.amount)} ฿ (${e.channel})`;
      ul.appendChild(li);
    }
    if (server.entries.length > 15) {
      const li = document.createElement("li");
      li.textContent = `…และอีก ${server.entries.length - 15} รายการ`;
      ul.appendChild(li);
    }
    if (!server.entries.length) {
      const p = document.createElement("p");
      p.textContent = "(ไม่มีรายการ — ข้อมูลของวันนี้ถูกลบไปแล้ว)";
      box.appendChild(p);
    } else {
      box.appendChild(ul);
    }
    const mine = document.createElement("p");
    mine.textContent = `ของคุณที่กำลังจะบันทึก: ${payload.length} รายการ — ถ้า "เขียนทับ" ข้อมูลบนชีตด้านบนจะถูกแทนที่ทั้งหมด`;
    box.appendChild(mine);

    const choice = await Swal.fire({
      icon: "warning",
      title: "ข้อมูลถูกแก้ไขจากที่อื่น",
      html: box,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: "โหลดข้อมูลล่าสุด",
      denyButtonText: "เขียนทับ",
      cancelButtonText: "ยกเลิก",
      focusConfirm: true,
    });

    if (choice.isConfirmed) {
      await loadDay(date);
    } else if (choice.isDenied) {
      await doSave(payload, server.version);
    }
  };

  const onSaveClick = async () => {
    if (!version) {
      void Swal.fire({
        icon: "error",
        title: "ยังโหลดข้อมูลเดิมไม่สำเร็จ",
        text: "กรุณารีเฟรชหรือเลือกวันที่ใหม่ก่อนบันทึก",
      });
      return;
    }
    const bad = entries.find(
      (e) => e.amount !== "" && Number.isNaN(parseFloat(e.amount)),
    );
    if (bad) {
      void Swal.fire({ icon: "error", title: "จำนวนเงินไม่ถูกต้อง" });
      return;
    }
    const payload = buildPayload();
    if (!payload.length) {
      void Swal.fire({
        icon: "warning",
        title: "ยังไม่ได้กรอกจำนวนเงิน",
        text: "กรอกจำนวนเงินอย่างน้อย 1 รายการก่อนบันทึก (แถวที่เว้นว่างจะไม่ถูกบันทึก)",
      });
      return;
    }

    // preview จาก React render (escape อัตโนมัติ) → clone ให้ SweetAlert2
    setCaptureData({ date, entries: payload });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clone = captureRef.current?.cloneNode(true) as HTMLElement | undefined;
    setCaptureData(null);

    const res = await Swal.fire({
      title: "ตรวจสอบข้อมูลก่อนบันทึก",
      html: clone ?? "",
      showCancelButton: true,
      confirmButtonText: "บันทึก",
      cancelButtonText: "ยกเลิก",
      width: 700,
    });
    if (res.isConfirmed) await doSave(payload, version);
  };

  // ---------- render ----------

  const busy = status !== "idle";
  const backdated = latestDate !== null && date < latestDate;

  return (
    <div>
      {/* D11: เตือนเมื่อแก้วันย้อนหลัง */}
      {backdated && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ คุณกำลังแก้ไขวันย้อนหลัง — รายการของวันนี้จะถูกย้ายไปอยู่ท้ายชีต
        </div>
      )}

      <div className="mb-4 rounded-xl bg-white p-4 shadow">
        <label htmlFor="date" className="mb-1 block text-sm font-medium text-gray-700">
          วันที่ดำเนินการ
        </label>
        <input
          id="date"
          type="date"
          value={date}
          disabled={busy}
          onChange={(e) => {
            const d = e.target.value;
            setDate(d);
            if (d) void loadDay(d);
          }}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-400 focus:outline-none"
        />
      </div>

      {status === "loading" && (
        <div className="mb-4 rounded-lg bg-blue-50 p-3 text-center text-sm text-blue-700">
          ⏳ กำลังโหลดข้อมูล…
        </div>
      )}

      {/* การ์ดต่อรายการ — mobile-first */}
      <div className="space-y-3">
        {entries.map((e) => (
          <div key={e.id} className="rounded-xl bg-white p-4 shadow">
            <div className="mb-3 flex gap-2">
              <select
                aria-label="ประเภท"
                value={e.type}
                disabled={busy}
                onChange={(ev) => update(e.id, { type: ev.target.value as EntryType })}
                className={`rounded-lg border px-3 py-2 font-medium ${
                  e.type === "expense"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-green-200 bg-green-50 text-green-700"
                }`}
              >
                <option value="expense">รายจ่าย</option>
                <option value="income">รายรับ</option>
              </select>
              <select
                aria-label="ช่องทาง"
                value={e.channel}
                disabled={busy}
                onChange={(ev) =>
                  update(e.id, { channel: ev.target.value as "เงินสด" | "โอน" })
                }
                className="rounded-lg border border-gray-300 px-3 py-2"
              >
                <option>เงินสด</option>
                <option>โอน</option>
              </select>
              <button
                type="button"
                aria-label="ลบรายการ"
                disabled={busy || entries.length <= 1}
                onClick={() => void removeRow(e)}
                className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-500 shadow-sm enabled:hover:bg-red-200 disabled:opacity-40"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
              <input
                type="text"
                placeholder="รายการ เช่น ชาไข่มุก"
                value={e.description}
                disabled={busy}
                maxLength={200}
                list="desc-list"
                autoComplete="off"
                onChange={(ev) => update(e.id, { description: ev.target.value })}
                className="rounded-lg border border-gray-300 px-3 py-2"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={e.amount}
                disabled={busy}
                onChange={(ev) => update(e.id, { amount: sanitizeAmount(ev.target.value) })}
                className={`rounded-lg border border-gray-300 px-3 py-2 text-right ${
                  e.type === "expense" ? "text-red-700" : "text-green-700"
                }`}
              />
            </div>
          </div>
        ))}
      </div>
      {/* datalist เดียวทั้งหน้า (ปิดหนี้ id ซ้ำข้อ 10) */}
      <datalist id="desc-list">
        {descriptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {/* ยอดสรุปสด */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-white p-4 text-center shadow">
        <div>
          <p className="text-xs text-gray-500">รายรับ</p>
          <p className="font-semibold text-green-600">{fmt(totals.income)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">รายจ่าย</p>
          <p className="font-semibold text-red-600">{fmt(totals.expense)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">คงเหลือ</p>
          <p
            className={`font-semibold ${totals.balance < 0 ? "text-red-600" : "text-blue-600"}`}
          >
            {fmt(totals.balance)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-3 pb-8">
        <button
          type="button"
          onClick={addRow}
          disabled={busy}
          className="flex-1 rounded-lg bg-green-500 py-3 text-lg font-semibold text-white enabled:hover:bg-green-600 disabled:opacity-50"
        >
          + เพิ่มรายการ
        </button>
        <button
          type="button"
          onClick={() => void onSaveClick()}
          disabled={busy}
          className="flex-1 rounded-lg bg-blue-500 py-3 text-lg font-semibold text-white enabled:hover:bg-blue-600 disabled:opacity-50"
        >
          {status === "saving" ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}
        </button>
      </div>

      {/* พื้นที่ render สรุปนอกจอ — ใช้ทั้ง preview (clone) และ capture รูป */}
      {captureData && (
        <div
          style={{ position: "fixed", top: "-9999px", left: "-9999px", width: 620 }}
        >
          <div ref={captureRef}>
            <SummaryCard date={captureData.date} entries={captureData.entries} />
          </div>
        </div>
      )}
    </div>
  );
}
