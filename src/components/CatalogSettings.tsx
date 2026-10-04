"use client";

import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { catalogSchema, canonicalName, type Catalog, type CatalogData } from "@/lib/catalog";
import { requestJson } from "@/lib/client-api";

const input = "w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm";
const button = "rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

export default function CatalogSettings() {
  const [data, setData] = useState<CatalogData | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [aliasTarget, setAliasTarget] = useState("");
  const [aliases, setAliases] = useState("");
  const dirty = !!data && !!catalog && JSON.stringify(data.catalog) !== JSON.stringify(catalog);
  const matchingUsage = data?.usage.filter(u => u.name.toLowerCase().includes(search.toLowerCase())) ?? [];

  const load = async () => {
    setBusy(true); setError("");
    try {
      const result = await requestJson<CatalogData>("/api/catalog");
      setData(result); setCatalog(result.catalog);
    } catch (err) { setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reload = async () => {
    if (dirty && !(await Swal.fire({ title: "ทิ้งการตั้งค่าที่ยังไม่บันทึก?", showCancelButton: true, confirmButtonText: "โหลดใหม่", cancelButtonText: "ยกเลิก" })).isConfirmed) return;
    setNotice(""); await load();
  };
  const save = async () => {
    if (!data || !catalog) return;
    const parsed = catalogSchema.safeParse(catalog);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง"); return; }
    const confirm = await Swal.fire({
      title: "บันทึกการตั้งค่าของร้าน?",
      text: "ชื่อเรียกอื่นจะถูกรวมเป็นชื่อมาตรฐานในรายงานทุกหน้า โดยไม่แก้รายการต้นฉบับในชีต การตั้งค่านี้ใช้ร่วมกันทุกอุปกรณ์",
      showCancelButton: true, confirmButtonText: "บันทึกการตั้งค่า", cancelButtonText: "ยกเลิก",
    });
    if (!confirm.isConfirmed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await requestJson<Pick<CatalogData, "catalog" | "version">>("/api/catalog", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalog: parsed.data, baseVersion: data.version }),
      });
      setData({ ...data, ...saved }); setCatalog(saved.catalog);
      setNotice("บันทึกแล้ว เปิดหน้าบันทึกหรือรายงานใหม่เพื่อใช้การตั้งค่าล่าสุด");
    } catch (err) { setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  const addName = (name: string) => {
    if (!catalog || !name.trim()) { setError("กรุณาใส่ชื่อรายการ"); return; }
    const next = { ...catalog, items: [...catalog.items, { name: name.trim(), aliases: [], favorite: true }] };
    const parsed = catalogSchema.safeParse(next);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "ชื่อซ้ำ"); return; }
    setCatalog(parsed.data); setNewName(""); setError("");
  };
  const addAliases = () => {
    if (!catalog || !aliasTarget || !aliases.trim()) { setError("เลือกชื่อมาตรฐานและกรอกชื่อเรียกอื่นก่อน"); return; }
    const next = { ...catalog, items: catalog.items.map(item => item.name === aliasTarget ? {
      ...item, aliases: [...item.aliases, ...aliases.split(/[,，\n]/).map(v => v.trim()).filter(Boolean)],
    } : item) };
    const parsed = catalogSchema.safeParse(next);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "ชื่อเรียกอื่นไม่ถูกต้อง"); return; }
    setCatalog(parsed.data); setAliases(""); setError("");
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">รวมชื่อที่หมายถึงรายการเดียวกัน เช่น ค่าเรียกรถ / เรียกรถ / ค่ารถ ต้องยืนยันเอง ไม่รวมจากความคล้ายอัตโนมัติ ชื่อมาตรฐานจะใช้จัดกลุ่มย้อนหลังโดยเก็บต้นฉบับไว้</p>
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className={button} disabled={busy || !dirty} onClick={() => void save()}>{busy ? "กำลังดำเนินการ…" : "บันทึกการตั้งค่า"}</button>
        <button className="rounded-lg border px-3 py-2 text-sm" disabled={busy} onClick={() => void reload()}>โหลดใหม่</button>
        <span role="status" className="text-sm text-gray-600">{dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : data ? "การตั้งค่าล่าสุด" : "กำลังโหลด…"}</span>
      </div>
      {catalog && data && <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="mb-3 font-semibold">รายการมาตรฐานและรายการโปรด ({catalog.items.length}/100)</h2>
          <form className="mb-4 flex gap-2" onSubmit={e => { e.preventDefault(); addName(newName); }}>
            <label className="min-w-0 flex-1 text-sm">ชื่อมาตรฐานใหม่<input className={input} value={newName} onChange={e => setNewName(e.target.value)} maxLength={200} /></label>
            <button className={`${button} self-end`} disabled={catalog.items.length >= 100}>เพิ่มชื่อ</button>
          </form>
          <div className="space-y-2">
            {catalog.items.map((item, index) => <div key={item.name} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="min-w-0 break-words">{item.name}</strong>
                <label className="flex items-center gap-2"><input type="checkbox" checked={item.favorite} onChange={e => setCatalog({ ...catalog, items: catalog.items.map((i, n) => n === index ? { ...i, favorite: e.target.checked } : i) })} />รายการโปรด</label>
                <button className="text-red-700" onClick={async () => {
                  if (!(await Swal.fire({ title: `เลิกรวมชื่อ “${item.name}”?`, text: "รายงานจะกลับมาใช้ชื่อเดิม ข้อมูลต้นฉบับไม่ถูกลบ", showCancelButton: true, confirmButtonText: "นำออก", cancelButtonText: "ยกเลิก" })).isConfirmed) return;
                  setCatalog(prev => prev ? { ...prev, items: prev.items.filter(i => i.name !== item.name) } : prev);
                }}>นำชื่อมาตรฐานออก</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">{item.aliases.length ? item.aliases.map(alias => <button key={alias} className="rounded-full bg-amber-50 px-3 py-1 text-amber-800" aria-label={`นำชื่อเรียกอื่น ${alias} ออก`} onClick={() => setCatalog({ ...catalog, items: catalog.items.map((i, n) => n === index ? { ...i, aliases: i.aliases.filter(a => a !== alias) } : i) })}>{alias} ×</button>) : <span className="text-gray-500">ยังไม่มีชื่อเรียกอื่น</span>}</div>
            </div>)}
          </div>
          <form className="mt-4 grid gap-2 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); addAliases(); }}>
            <label className="text-sm">รวมเข้าชื่อมาตรฐาน<select className={input} value={aliasTarget} onChange={e => setAliasTarget(e.target.value)}><option value="">เลือกชื่อมาตรฐาน</option>{catalog.items.map(i => <option key={i.name}>{i.name}</option>)}</select></label>
            <label className="text-sm">ชื่อเรียกอื่น (คั่นด้วย comma)<input className={input} value={aliases} onChange={e => setAliases(e.target.value)} placeholder="เรียกรถ, ค่ารถ" /></label>
            <button className={`${button} self-end`} disabled={!catalog.items.length}>เพิ่มชื่อเรียกอื่น</button>
          </form>
          <p className="mt-3 text-xs text-gray-500">หมวดหมู่เดิมจับคู่ด้วยชื่อมาตรฐานก่อน ถ้ายังไม่มีจะใช้ mapping ของชื่อเรียกอื่นที่มีอยู่ก่อน ควรตรวจและจัดหมวดของชื่อมาตรฐานในหน้ารายงานค่าใช้จ่าย</p>
        </section>
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold">ค้นหาชื่อที่เคยใช้ เพื่อไม่สร้างซ้ำ</h2>
          <label className="text-sm">ค้นหาประวัติชื่อ<input className={input} value={search} onChange={e => setSearch(e.target.value)} placeholder="รถ / ค่า / น้ำแข็ง" /></label>
          <p role="status" className="mt-2 text-xs text-gray-500">พบ {matchingUsage.length} ชื่อ · แสดงไม่เกิน 50 ชื่อแรก ค้นหาเพื่อเจาะจงชื่ออื่น</p>
          <ul className="mt-3 max-h-64 space-y-2 overflow-auto">
            {matchingUsage.slice(0, 50).map(u => <li key={u.name} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
              <span className="min-w-0 break-words">{u.name} · ใช้ {u.count} ครั้ง{canonicalName(u.name, catalog.items) !== u.name && ` → ${canonicalName(u.name, catalog.items)}`}</span>
              {!catalog.items.some(i => i.name === canonicalName(u.name, catalog.items)) && <button className="text-amber-700" onClick={() => addName(u.name)}>ใช้เป็นชื่อมาตรฐาน</button>}
              <button className="text-blue-700" onClick={() => setAliases(u.name)}>เลือกเป็นชื่อเรียกอื่น</button>
            </li>)}
          </ul>
        </section>
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold">รายการประจำ ({catalog.recurring.length}/100)</h2>
          <p className="mb-3 text-sm text-gray-600">ใช้เฉพาะวันที่ยังไม่มีรายการ ไม่เปลี่ยนข้อมูลวันที่บันทึกไว้แล้ว จำนวนเงินเว้นว่างได้ และแถวที่ไม่กรอกเงินจะไม่ถูกบันทึก</p>
          <div className="space-y-3">{catalog.recurring.map((row, index) => {
            const update = (patch: Partial<typeof row>) => setCatalog({ ...catalog, recurring: catalog.recurring.map((r, n) => n === index ? { ...r, ...patch } : r) });
            return <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-5">
              <label className="text-sm">รายการ {index + 1}<input className={input} list="settings-history" value={row.description} maxLength={200} onChange={e => update({ description: e.target.value })} /></label>
              <label className="text-sm">ประเภท<select className={input} value={row.type} onChange={e => update({ type: e.target.value === "income" ? "income" : "expense" })}><option value="expense">รายจ่าย</option><option value="income">รายรับ</option></select></label>
              <label className="text-sm">ช่องทาง<select className={input} value={row.channel} onChange={e => update({ channel: e.target.value === "โอน" ? "โอน" : "เงินสด" })}><option>เงินสด</option><option>โอน</option></select></label>
              <label className="text-sm">จำนวนเงินเริ่มต้น<input className={input} inputMode="decimal" value={row.amount} onChange={e => update({ amount: e.target.value })} placeholder="เว้นว่าง" /></label>
              <button className="self-end rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700" onClick={() => setCatalog({ ...catalog, recurring: catalog.recurring.filter((_, n) => n !== index) })}>นำแถว {index + 1} ออก</button>
            </div>;
          })}</div>
          <button className={`${button} mt-3`} disabled={catalog.recurring.length >= 100} onClick={() => setCatalog({ ...catalog, recurring: [...catalog.recurring, { description: "", type: "expense", channel: "เงินสด", amount: "" }] })}>+ เพิ่มรายการประจำ</button>
          <datalist id="settings-history">{data.usage.map(u => <option key={u.name} value={u.name} />)}</datalist>
        </section>
      </fieldset>}
    </div>
  );
}
