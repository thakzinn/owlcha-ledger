"use client";

import { useId, useMemo, useState } from "react";
import { suggestItems, type CatalogItem } from "@/lib/catalog";

export default function ItemPicker({ value, onChange, disabled, items, history, category }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
  items: readonly CatalogItem[]; history: readonly string[];
  category: (name: string) => string | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = useMemo(() => suggestItems(value, items, history), [value, items, history]);
  const select = (name: string) => { onChange(name); setOpen(false); setActive(-1); };
  return <div className="relative min-w-0">
    <label htmlFor={id} className="mb-1 block text-xs text-gray-600">ชื่อรายการ</label>
    <input id={id} type="text" role="combobox" aria-expanded={open && suggestions.length > 0}
      aria-controls={`${id}-choices`} aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? `${id}-choice-${active}` : undefined}
      className="w-full rounded-lg border border-gray-300 px-3 py-2"
      placeholder="ค้นหาชื่อเดิมหรือชื่อเรียกอื่น" value={value} maxLength={200} disabled={disabled} autoComplete="off"
      onFocus={() => { setOpen(true); setActive(-1); }}
      onBlur={() => { setOpen(false); setActive(-1); }}
      onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={e => {
        if (e.key === "Escape") { setOpen(false); setActive(-1); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); setOpen(true);
          setActive(n => suggestions.length ? Math.max(0, Math.min(suggestions.length - 1, n + (e.key === "ArrowDown" ? 1 : -1))) : -1);
        }
        if (e.key === "Enter" && open && active >= 0 && suggestions[active]) {
          e.preventDefault(); select(suggestions[active].name);
        }
      }}
    />
    {open && suggestions.length > 0 && <ul id={`${id}-choices`} role="listbox" aria-label="รายการที่เคยใช้และชื่อมาตรฐาน" className="absolute top-full z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-white shadow-lg">
      {suggestions.map((s, index) => <li key={s.name} id={`${id}-choice-${index}`} role="option" aria-selected={active === index}
        className={`cursor-pointer px-3 py-2 text-sm ${active === index ? "bg-amber-100" : "hover:bg-amber-50"}`}
        onMouseDown={e => e.preventDefault()} onClick={() => select(s.name)}>
        <span className="font-medium">{s.favorite ? "★ " : ""}{s.name}</span>
        <span className="block text-xs text-gray-500">{category(s.name) ?? "ยังไม่จัดหมวด"} · {s.reason === "alias" ? "ตรงกับชื่อเรียกอื่น" : s.reason === "similar" ? "ชื่อใกล้เคียง โปรดตรวจความหมาย" : "ชื่อที่เคยใช้"}</span>
      </li>)}
    </ul>}
  </div>;
}
