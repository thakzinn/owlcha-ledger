"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { todayBangkok } from "@/lib/date";
import { typeFromAmount, toSignedAmount, type EntryType } from "@/lib/entries";
import type { CategoryMappingInput } from "@/lib/expense-report";
import SummaryCard, { type SummaryEntry } from "@/components/SummaryCard";

interface UiEntry {
  id: number;
  type: EntryType;
  description: string;
  /** ค่าบวกเป็น string ตามที่พิมพ์ — แปลงเครื่องหมายตอน submit เท่านั้น */
  amount: string;
  channel: "เงินสด" | "โอน";
  /** เปอร์เซ็นต์หัก GP/VAT ของแถวเดลิเวอรี — แก้ได้รายแถว (default 30 / 7) */
  gpPct?: string;
  vatPct?: string;
  /** ยอดขายบนแอป (คอลัมน์ F) — แก้เองได้ ไม่คำนวณย้อนกลับไปกระทบค่าอื่น */
  gross?: string;
}

/** รายรับจากแอปเดลิเวอรีที่โดนหัก GP — แสดง breakdown อัตโนมัติ */
const isDeliveryDesc = (desc: string): boolean =>
  /grab|lineman|shopee/i.test(desc);

const DEFAULT_GP_PCT = "30";
const DEFAULT_VAT_PCT = "7";

/**
 * ช่องจำนวนเงินของแถวเดลิเวอรี = "ยอดที่ร้านได้รับสุทธิ" → คำนวณย้อนกลับ:
 * ยอดขายบนแอป = สุทธิ ÷ (1 − GP% × (1+VAT%)), GP = ยอดขาย × GP%, VAT = GP × VAT%
 * (แสดงบนการ์ดเท่านั้น — ชีตเก็บยอดสุทธิใน D ตาม data contract เดิม)
 */
function gpBreakdownFromNet(net: number, gpPct: number, vatPct: number) {
  const factor = 1 - (gpPct / 100) * (1 + vatPct / 100);
  if (factor <= 0) return null;
  const gross = net / factor;
  const gpAmt = gross * (gpPct / 100);
  const vatAmt = gpAmt * (vatPct / 100);
  return { gross, gpAmt, vatAmt };
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
  /** null = แท็บหมวดหมู่ยังไม่ถูกสร้าง/โหลดไม่สำเร็จ → ซ่อน UI หมวดหมู่ไปเลย */
  const [catMappings, setCatMappings] = useState<CategoryMappingInput[] | null>(null);
  /** ชื่อรายการที่กำลังบันทึกหมวด — กันกดซ้ำระหว่างรอ API */
  const [catBusyItem, setCatBusyItem] = useState<string | null>(null);
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

  /** โหลด mapping "รายการ → หมวดหมู่" — แท็บยังไม่มี/พลาดถือเป็นเรื่องปกติ แค่ไม่แสดง UI */
  const loadCategoryMappings = useCallback(async () => {
    try {
      const res = await fetch("/api/expense-categories");
      if (!res.ok) return;
      const data = (await res.json()) as
        | { exists: false }
        | { exists: true; mappings: CategoryMappingInput[] };
      setCatMappings(data.exists ? data.mappings : null);
    } catch {
      /* หมวดหมู่เป็นของเสริม — โหลดไม่ได้ก็ใช้งานส่วนอื่นต่อได้ */
    }
  }, []);

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
          entries: (SummaryEntry & { gross?: number | null })[];
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
              gross: e.gross != null ? String(e.gross) : undefined,
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
    void loadCategoryMappings();
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

  // ---------- หมวดหมู่ค่าใช้จ่าย ----------

  /** first-wins ตามลำดับแถวในแท็บ — กติกาเดียวกับ buildExpenseReport */
  const catByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of catMappings ?? []) {
      const item = m.item.trim();
      if (item && !map.has(item)) map.set(item, m.category);
    }
    return map;
  }, [catMappings]);

  const categoryChoices = useMemo(() => {
    const seen = new Set<string>();
    for (const m of catMappings ?? []) if (m.category) seen.add(m.category);
    return [...seen];
  }, [catMappings]);

  /** จัด/ย้ายหมวดของชื่อรายการ — picked === "__new__" คือขอตั้งชื่อหมวดใหม่ก่อน */
  const assignCategory = async (item: string, picked: string) => {
    let category = picked;
    if (picked === "__new__") {
      const res = await Swal.fire<string>({
        title: "สร้างหมวดใหม่",
        input: "text",
        inputLabel: `จัดหมวดให้ "${item}"`,
        inputPlaceholder: "ชื่อหมวดใหม่",
        inputAttributes: { maxlength: "100" },
        showCancelButton: true,
        confirmButtonText: "ตกลง",
        cancelButtonText: "ยกเลิก",
        inputValidator: (v) => (v.trim() ? null : "กรุณาใส่ชื่อหมวด"),
      });
      if (!res.isConfirmed || !res.value?.trim()) return;
      category = res.value.trim();
    }
    const current = catByItem.get(item);
    if (category === current) return;

    setCatBusyItem(item);
    try {
      const res = await fetch("/api/expense-categories", {
        // รายการที่ยังไม่เคย map = เพิ่มแถวใหม่, เคยแล้ว = ย้ายหมวดแถวเดิม
        method: current === undefined ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, category }),
      });
      if (!res.ok) {
        const msg = await handleApiFailure(res);
        if (msg) void Swal.fire({ icon: "error", title: "จัดหมวดไม่สำเร็จ", text: msg });
        // สถานะบนชีตอาจเปลี่ยนจากที่อื่น (เช่น ITEM_EXISTS) → sync ใหม่
        await loadCategoryMappings();
        return;
      }
      await loadCategoryMappings();
      void Swal.fire({
        icon: "success",
        title: "จัดหมวดแล้ว",
        text: `"${item}" → ${category}`,
        timer: 1400,
        showConfirmButton: false,
      });
    } catch {
      void Swal.fire({
        icon: "error",
        title: "จัดหมวดไม่สำเร็จ",
        text: "เชื่อมต่อไม่ได้ กรุณาลองใหม่",
      });
    } finally {
      setCatBusyItem(null);
    }
  };

  // ---------- บันทึก ----------

  /** แถว template ที่ไม่ได้กรอกจำนวนเงิน (ช่องว่าง) จะไม่ถูกบันทึก — กันแถว 0 ขยะลงชีต */
  const buildPayload = (): (SummaryEntry & { gross?: number })[] =>
    entries
      .filter((e) => e.amount.trim() !== "")
      .map((e) => {
        const base = {
          description: e.description.trim(),
          amount: toSignedAmount(e.type, parseFloat(e.amount) || 0),
          channel: e.channel,
        };
        // ยอดขายบนแอป (คอลัมน์ F): ใช้ค่าที่แก้เอง หรือค่าที่คำนวณจากยอดสุทธิ
        if (e.type === "income" && isDeliveryDesc(e.description)) {
          const manual = e.gross?.trim() ? parseFloat(e.gross) : NaN;
          const computed = gpBreakdownFromNet(
            parseFloat(e.amount) || 0,
            parseFloat(e.gpPct ?? DEFAULT_GP_PCT) || 0,
            parseFloat(e.vatPct ?? DEFAULT_VAT_PCT) || 0,
          );
          const gross = Number.isFinite(manual) ? manual : computed?.gross;
          if (gross != null && Number.isFinite(gross) && gross > 0) {
            return { ...base, gross: Math.round(gross * 100) / 100 };
          }
        }
        return base;
      });

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
      // ระบุ width/height ของ element ตรง ๆ (แบบเดียวกับ legacy) + ขยาย viewport ของ
      // clone ให้สูงเท่าการ์ด — ไม่งั้นการ์ดที่สูงกว่าจอ (รายการเยอะ) จะโดนตัดขอบล่าง
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        width: el.offsetWidth,
        height: el.offsetHeight,
        windowWidth: el.offsetWidth,
        windowHeight: el.offsetHeight,
        scrollX: 0,
        scrollY: 0,
      });
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

    // ตารางเปรียบเทียบเก่า/ใหม่ ด้วย DOM API + textContent เท่านั้น (กัน XSS)
    // แถวที่ค่าต่างกันถูกไฮไลต์ — ปุ่ม "เขียนทับ" ไม่ใช่ default
    const box = document.createElement("div");
    box.style.textAlign = "left";

    const entryText = (e?: SummaryEntry): string =>
      e
        ? `${e.amount < 0 ? "รายจ่าย" : "รายรับ"} · ${e.description || "(ไม่มีคำอธิบาย)"} · ${fmt(e.amount)} ฿ · ${e.channel}`
        : "—";
    const sameEntry = (a?: SummaryEntry, b?: SummaryEntry): boolean =>
      !!a &&
      !!b &&
      a.description === b.description &&
      a.amount === b.amount &&
      a.channel === b.channel;

    const table = document.createElement("table");
    table.className = "w-full border-collapse text-xs";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["#", "บนชีตตอนนี้", "ของคุณ (จะเขียนทับ)"]) {
      const th = document.createElement("th");
      th.textContent = label;
      th.className = "border border-gray-300 bg-gray-100 px-2 py-1 text-center";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const maxRows = Math.max(server.entries.length, payload.length);
    const shown = Math.min(maxRows, 20);
    for (let i = 0; i < shown; i++) {
      const s = server.entries[i];
      const m = payload[i];
      const same = sameEntry(s, m);
      const tr = document.createElement("tr");

      const num = document.createElement("td");
      num.textContent = String(i + 1);
      num.className = "border border-gray-300 px-2 py-1 text-center text-gray-500";
      tr.appendChild(num);

      for (const e of [s, m]) {
        const td = document.createElement("td");
        td.textContent = entryText(e);
        td.className = `border border-gray-300 px-2 py-1 ${
          same ? "text-gray-700" : "bg-amber-50 font-medium text-red-700"
        }`;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    if (maxRows > shown) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = `…และอีก ${maxRows - shown} แถว`;
      td.className = "border border-gray-300 px-2 py-1 text-center text-gray-500";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // แถวสรุปยอดคงเหลือของทั้งสองฝั่ง
    const sum = (list: SummaryEntry[]) => list.reduce((t, e) => t + e.amount, 0);
    const tfoot = document.createElement("tfoot");
    const footRow = document.createElement("tr");
    const footLabel = document.createElement("td");
    footLabel.textContent = "รวม";
    footLabel.className = "border border-gray-300 bg-gray-50 px-2 py-1 text-center font-semibold";
    footRow.appendChild(footLabel);
    for (const list of [server.entries, payload]) {
      const td = document.createElement("td");
      td.textContent = `${fmt(sum(list))} ฿ (${list.length} รายการ)`;
      td.className = "border border-gray-300 bg-gray-50 px-2 py-1 text-right font-semibold";
      footRow.appendChild(td);
    }
    tfoot.appendChild(footRow);
    table.appendChild(tfoot);

    const note = document.createElement("p");
    note.textContent =
      server.entries.length === 0
        ? "บนชีตไม่มีรายการของวันนี้แล้ว (ถูกลบจากที่อื่น) — เลือกว่าจะเขียนของคุณลงไปหรือโหลดใหม่"
        : 'แถวสีเหลือง = ค่าไม่ตรงกัน — "เขียนทับ" จะแทนที่ฝั่งซ้ายด้วยฝั่งขวาทั้งวัน';
    note.className = "mt-2 text-xs text-gray-600";

    box.appendChild(table);
    box.appendChild(note);

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

      {/* วันที่ — pin ติดขอบบนจอตลอด (คู่กับแถบสรุปที่ pin ล่าง) */}
      <div className="sticky top-0 z-40 -mx-4 mb-4 border-b border-gray-200 bg-gray-50/95 px-4 py-2 backdrop-blur">
        <div className="rounded-xl bg-white p-3 shadow">
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
            className="block w-full min-w-0 max-w-full appearance-none rounded-lg border border-gray-300 px-4 py-2.5 focus:ring-2 focus:ring-blue-400 focus:outline-none"
            style={{ WebkitAppearance: "none" }}
          />
        </div>
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
                className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-500 shadow-sm enabled:hover:bg-red-200 disabled:opacity-40"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px]">
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
                placeholder={
                  e.type === "income" && isDeliveryDesc(e.description)
                    ? "ยอดที่ร้านได้รับสุทธิ"
                    : "0.00"
                }
                value={e.amount}
                disabled={busy}
                onChange={(ev) => update(e.id, { amount: sanitizeAmount(ev.target.value) })}
                className={`rounded-lg border border-gray-300 px-3 py-2 text-right ${
                  e.type === "expense" ? "text-red-700" : "text-green-700"
                }`}
              />
            </div>

            {/* หมวดหมู่ค่าใช้จ่าย — โผล่เฉพาะแถวรายจ่ายที่มีชื่อรายการ และแท็บหมวดหมู่ถูกสร้างแล้ว */}
            {e.type === "expense" &&
              catMappings !== null &&
              e.description.trim() !== "" &&
              (() => {
                const item = e.description.trim();
                const current = catByItem.get(item);
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span>หมวดหมู่</span>
                    <select
                      aria-label="หมวดหมู่ค่าใช้จ่าย"
                      value={current ?? ""}
                      disabled={busy || catBusyItem === item}
                      onChange={(ev) => void assignCategory(item, ev.target.value)}
                      className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm ${
                        current === undefined
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-gray-300 bg-white text-gray-800"
                      }`}
                    >
                      {current === undefined && (
                        <option value="" disabled>
                          — ยังไม่จัดหมวด เลือกหมวด —
                        </option>
                      )}
                      {categoryChoices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__new__">+ สร้างหมวดใหม่…</option>
                    </select>
                  </div>
                );
              })()}

            {/* breakdown GP — แถบเต็มความกว้างของการ์ด (แก้ปัญหาซ้อนกันบนมือถือ) */}
            {e.type === "income" &&
              isDeliveryDesc(e.description) &&
              (parseFloat(e.amount) || 0) > 0 &&
              (() => {
                const gpPct = e.gpPct ?? DEFAULT_GP_PCT;
                const vatPct = e.vatPct ?? DEFAULT_VAT_PCT;
                const b = gpBreakdownFromNet(
                  parseFloat(e.amount),
                  parseFloat(gpPct) || 0,
                  parseFloat(vatPct) || 0,
                );
                const pctInput =
                  "w-12 rounded-lg border border-gray-300 bg-white px-1.5 py-1 text-right text-sm text-gray-800";
                return (
                  <div className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span>ยอดขายบนแอป (ลงคอลัมน์ F)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="ยอดขายบนแอป (บันทึกลงคอลัมน์ F)"
                        value={e.gross ?? (b ? b.gross.toFixed(2) : "")}
                        disabled={busy}
                        onChange={(ev) =>
                          // แก้เองได้ — ไม่คำนวณย้อนกลับไปกระทบยอดสุทธิ/GP/VAT
                          update(e.id, { gross: sanitizeAmount(ev.target.value) })
                        }
                        className="w-32 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-base font-medium text-gray-900"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
                      <span>ค่า GP</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="เปอร์เซ็นต์ GP"
                        value={gpPct}
                        disabled={busy}
                        onChange={(ev) =>
                          update(e.id, { gpPct: sanitizeAmount(ev.target.value) })
                        }
                        className={pctInput}
                      />
                      <span>% = {b ? fmt(b.gpAmt) : "—"}</span>
                      <span className="text-gray-400">·</span>
                      <span>VAT</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="เปอร์เซ็นต์ VAT บนค่า GP"
                        value={vatPct}
                        disabled={busy}
                        onChange={(ev) =>
                          update(e.id, { vatPct: sanitizeAmount(ev.target.value) })
                        }
                        className={pctInput}
                      />
                      <span>% = {b ? fmt(b.vatAmt) : "—"}</span>
                    </div>
                  </div>
                );
              })()}
          </div>
        ))}
      </div>
      {/* datalist เดียวทั้งหน้า (ปิดหนี้ id ซ้ำข้อ 10) */}
      <datalist id="desc-list">
        {descriptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {/* ยอดสรุปสด + ปุ่มหลัก — pin ติดขอบล่างจอตลอด เนื้อหาเลื่อนอยู่ด้านหลัง */}
      <div className="sticky bottom-0 z-40 -mx-4 mt-4 border-t border-gray-200 bg-gray-50/95 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-white p-3 text-center shadow">
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
        <div className="mt-2 flex gap-3">
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
      </div>

      {/* พื้นที่ render สรุปนอกจอ — ใช้ทั้ง preview (clone) และ capture รูป */}
      {captureData && (
        <div
          // absolute (ไม่ใช่ fixed) — html2canvas จะ clip element ใน fixed ที่สูงเกิน viewport
          style={{ position: "absolute", top: 0, left: "-9999px", width: 620 }}
        >
          <div ref={captureRef}>
            <SummaryCard date={captureData.date} entries={captureData.entries} />
          </div>
        </div>
      )}
    </div>
  );
}
