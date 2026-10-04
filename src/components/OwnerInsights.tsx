"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { todayBangkok } from "@/lib/date";
import { ISSUE_LABELS, type IssueKind, type InsightsData } from "@/lib/insights";
import { rangeQuerySchema } from "@/lib/schema";
import { requestJson } from "@/lib/client-api";

const money = (amount: number) => amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Data = InsightsData & { categoriesAvailable: boolean };

export default function OwnerInsights({ mode }: { mode: "dashboard" | "quality" }) {
  const [today] = useState(todayBangkok);
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<IssueKind | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const parsed = rangeQuerySchema.safeParse(range);
  const invalid = parsed.success ? "" : parsed.error.issues[0]?.message ?? "ช่วงวันที่ไม่ถูกต้อง";
  useEffect(() => {
    setPage(1); setData(null); setError("");
    if (invalid) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void requestJson<Data>(`/api/insights?from=${range.from}&to=${range.to}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range.from, range.to, invalid, reload]);
  const issues = useMemo(() => (data?.issues ?? []).filter(i =>
    (kind === "all" || i.kind === kind) &&
    `${i.date} ${i.description} ${i.detail}`.toLowerCase().includes(search.trim().toLowerCase()),
  ), [data, kind, search]);
  const pages = Math.max(1, Math.ceil(issues.length / 50));
  const safePage = Math.min(page, pages);
  const change = (current: number, previous: number) =>
    previous === 0 ? "ไม่มีฐานเดือนก่อนสำหรับเทียบ %" : `${((current - previous) / Math.abs(previous) * 100).toFixed(1)}% เทียบช่วงวันเดียวกันเดือนก่อน`;
  const heading = mode === "dashboard" ? "ภาพรวมเดือนนี้" : "ตรวจข้อมูลในช่วง";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{heading}</h2>
        <button className="rounded-lg border bg-white px-3 py-2 text-sm" disabled={loading} onClick={() => setReload(n => n + 1)}>โหลดข้อมูลใหม่</button>
      </div>
      {mode === "quality" && <div className="flex flex-wrap gap-3 rounded-xl bg-white p-4 shadow">
        <label className="text-sm">วันที่เริ่มต้น<input type="date" className="block rounded-lg border p-2" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></label>
        <label className="text-sm">วันที่สิ้นสุด<input type="date" className="block rounded-lg border p-2" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></label>
        <button className="self-end rounded-lg border px-3 py-2 text-sm" onClick={() => setRange({ from: `${today.slice(0, 7)}-01`, to: today })}>เดือนนี้ถึงวันนี้</button>
      </div>}
      {invalid && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{invalid}</p>}
      {loading && <p role="status" className="rounded-lg bg-blue-50 p-3 text-blue-800">กำลังโหลดข้อมูล…</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error} — กดโหลดข้อมูลใหม่เพื่อลองอีกครั้ง</p>}
      {data && <>
        {!data.categoriesAvailable && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">ยังไม่มีแท็บหมวดหมู่ ค่าใช้จ่ายจะแสดงเป็นยังไม่จัดหมวด <Link className="underline" href="/report-expenses">จัดหมวดค่าใช้จ่าย</Link></p>}
        {mode === "dashboard" && <>
          <p className="text-sm text-gray-600">{data.dashboard.window.currentStart} ถึง {data.today} · เดือนก่อนเทียบถึง {data.dashboard.window.comparableEnd} ไม่ใช่เทียบเดือนที่ยังไม่จบกับทั้งเดือน</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: "เงินรับจริง", amount: data.dashboard.current.received, previous: data.dashboard.previous.received, color: "text-green-700" },
              { title: "เงินจ่ายจริง", amount: data.dashboard.current.spent, previous: data.dashboard.previous.spent, color: "text-red-700" },
              { title: "รายรับ–รายจ่ายสุทธิ", amount: data.dashboard.current.balance, previous: data.dashboard.previous.balance, color: "text-blue-700" },
            ].map(card => <section key={card.title} className="rounded-xl bg-white p-4 shadow">
              <h3 className="text-sm text-gray-600">{card.title}</h3>
              <p className={`my-2 text-2xl font-semibold ${card.color}`}>{money(card.amount)} ฿</p>
              <p className="text-xs text-gray-500">{change(card.amount, card.previous)}</p>
            </section>)}
          </div>
          <section className="rounded-xl bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">ยอดขายเต็ม กับเงินเข้าจริง</h2>
            <p>ยอดขายเต็มที่มีข้อมูล: <strong>{money(data.dashboard.current.knownGross)} ฿</strong></p>
            <p>ส่วนต่างยอดขายเต็ม − เงินรับจริง ของเดลิเวอรี: <strong>{money(data.dashboard.current.fees)} ฿</strong></p>
            <p className="mt-2 text-sm text-gray-600">ยอดขายเต็มไม่นับเดลิเวอรีที่ไม่มี F หรือ F น้อยกว่าเงินรับจริง ({data.dashboard.current.missingGross} รายการ) จึงอาจไม่ครบ ไม่ใช้ค่าประมาณเติมยอด ส่วนต่างอาจรวมค่าธรรมเนียมหรือรายการปรับปรุงจากแพลตฟอร์ม ไม่ใช่กำไรบัญชีหรือยอดภาษีที่ยืนยันแล้ว</p>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { title: "รายรับแยกช่องทาง (ยอดรับจริง)", rows: data.dashboard.incomeChannels },
              { title: "ค่าใช้จ่ายหลักแยกหมวด", rows: data.dashboard.expenseCategories },
            ].map(section => <section key={section.title} className="rounded-xl bg-white p-4 shadow">
              <h2 className="mb-3 font-semibold">{section.title}</h2>
              {!section.rows.length && <p className="text-sm text-gray-500">ไม่มีรายการในช่วงนี้</p>}
              <ul className="space-y-2">{section.rows.slice(0, 8).map(row => <li key={row.name} className="flex justify-between gap-3 border-b pb-2 text-sm"><span>{row.name}</span><span className="whitespace-nowrap tabular-nums">{money(row.amount)} ฿</span></li>)}</ul>
              {section.title === "ค่าใช้จ่ายหลักแยกหมวด" && <p className="mt-3 text-xs text-gray-500">ใช้กติกา counted ของหมวดเดิม อาจต่างจากเงินจ่ายจริงซึ่งรวมเงินออกทุกแถว</p>}
            </section>)}
          </div>
          <Link className="block rounded-xl bg-amber-50 p-4 text-amber-800" href="/data-quality">พบ {data.issues.filter(i => i.kind !== "alias").length} จุดที่ควรตรวจในเดือนนี้ → เปิดศูนย์ตรวจข้อมูล</Link>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-blue-700 underline" href="/report-income">รายงานรายได้ / Excel</Link>
            <Link className="text-blue-700 underline" href="/report-expenses">รายงานค่าใช้จ่าย / Excel</Link>
            <Link className="text-blue-700 underline" href="/settings">จัดการชื่อและรายการประจำ</Link>
          </div>
        </>}
        {mode === "quality" && <>
          <p className="text-sm text-gray-600">นี่คือข้อสังเกตให้ตรวจ ไม่ใช่ข้อผิดพลาดที่ยืนยันแล้ว วันไม่มีข้อมูลอาจเป็นวันหยุดและรายการคล้ายซ้ำอาจเป็นคนละธุรกรรม ระบบไม่แก้หรือลบให้อัตโนมัติ และไม่ตรวจวันในอนาคต</p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(ISSUE_LABELS) as [IssueKind, string][]).map(([key, label]) => <button key={key} className={`rounded-full border px-3 py-2 text-sm ${kind === key ? "bg-amber-100" : "bg-white"}`} onClick={() => { setKind(key); setPage(1); }}>{label} ({data.issues.filter(i => i.kind === key).length})</button>)}
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="min-w-0 flex-1 text-sm">ค้นหาจุดที่ควรตรวจ<input className="block w-full rounded-lg border p-2" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
            <button className="self-end rounded-lg border bg-white p-2 text-sm" onClick={() => { setKind("all"); setSearch(""); setPage(1); }}>ดูทั้งหมด</button>
          </div>
          <p role="status" className="text-sm text-gray-600">พบ {issues.length} จุด · หน้า {safePage}/{pages}</p>
          {!issues.length && <p className="rounded-xl bg-green-50 p-4 text-green-800">ไม่พบข้อสังเกตตามเงื่อนไขนี้</p>}
          <ul className="space-y-3">{issues.slice((safePage - 1) * 50, safePage * 50).map(issue => <li key={issue.id} className="rounded-xl bg-white p-4 shadow">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{ISSUE_LABELS[issue.kind]} · {issue.date}</strong><Link className="text-sm text-blue-700 underline" href={`/?date=${issue.date}`}>เปิดวันนั้น</Link></div>
            <p className="mt-1 font-medium">{issue.description || "(ไม่มีชื่อรายการ)"}</p>
            <p className="mt-1 text-sm text-gray-600">{issue.detail}</p>
            {(issue.kind === "alias" || issue.kind === "unnamed") && <Link className="mt-2 inline-block text-sm text-amber-700 underline" href="/settings">จัดการชื่อมาตรฐาน</Link>}
            {issue.kind === "uncategorized" && <Link className="mt-2 inline-block text-sm text-amber-700 underline" href={issue.report === "income" ? "/report-income" : "/report-expenses"}>{issue.report === "income" ? "ตรวจรายงานรายได้" : "จัดหมวดค่าใช้จ่าย"}</Link>}
          </li>)}</ul>
          <div className="flex justify-between"><button className="rounded-lg border p-2 text-sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>ก่อนหน้า</button><button className="rounded-lg border p-2 text-sm" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>ถัดไป</button></div>
        </>}
      </>}
    </div>
  );
}
