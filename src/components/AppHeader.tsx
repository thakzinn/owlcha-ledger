"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "บันทึกรายการ", icon: "📝" },
  { href: "/report-pnd94", label: "รายงานภาษี ภ.ง.ด.94", icon: "🧾" },
  { href: "/report-cashbook", label: "รายงานเงินสดรับ-จ่าย", icon: "📒" },
  { href: "/report-expenses", label: "รายงานค่าใช้จ่ายแยกหมวด", icon: "💸" },
] as const;

type Props = {
  name: string;
  email: string;
  signOutAction: () => Promise<void>;
};

export default function AppHeader({ name, email, signOutAction }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ปิดเมนูเมื่อคลิกนอกกรอบหรือกด Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // ปิดเมนูเมื่อเปลี่ยนหน้า
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="relative z-50 mb-4 flex items-center justify-between rounded-xl bg-white p-3 shadow">
      <Link href="/" className="flex min-w-0 items-center gap-2 pl-1">
        <span className="text-2xl" aria-hidden>
          🦉🍵
        </span>
        <span className="truncate font-semibold text-gray-800">
          Owlcha Ledger
        </span>
      </Link>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-gray-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-700">
            {initial}
          </span>
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.23 8.29a.75.75 0 010-1.08z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg"
          >
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="truncate font-medium text-gray-800">
                {name || "ผู้ใช้"}
              </p>
              <p className="truncate text-sm text-gray-500">{email}</p>
            </div>

            <nav className="py-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                      active
                        ? "bg-amber-50 font-medium text-amber-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                    {active && (
                      <span className="ml-auto text-amber-500" aria-hidden>
                        ●
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <form action={signOutAction} className="border-t border-gray-100 py-1">
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
              >
                <span aria-hidden>🚪</span>
                ออกจากระบบ
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
