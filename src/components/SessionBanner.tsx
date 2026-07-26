"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

/**
 * เตือนก่อน session ชน absolute cap ≥5 นาที (สเปค UI ข้อ 10) —
 * โฟกัสที่ absolute cap เพราะผู้ใช้ที่ active อยู่จะเห็นจริง
 * (idle timeout ไม่เตือน — คน idle ไม่ได้มองจอ)
 */
export default function SessionBanner({
  authTime,
  capSec,
}: {
  authTime: number;
  capSec: number;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const r = authTime + capSec - Math.floor(Date.now() / 1000);
      setRemaining(r);
      if (r <= 0) {
        void signOut({ callbackUrl: "/login?reason=session" });
      }
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [authTime, capSec]);

  if (remaining === null || remaining > 300) return null;

  const mm = Math.floor(Math.max(0, remaining) / 60);
  const ss = Math.max(0, remaining) % 60;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow">
      <span>
        ⏰ เซสชันจะหมดอายุในอีก {mm}:{String(ss).padStart(2, "0")} นาที
        — บันทึกงานให้เรียบร้อยแล้วล็อกอินใหม่
      </span>
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: "/login" })}
        className="rounded bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
      >
        ล็อกอินใหม่ตอนนี้
      </button>
    </div>
  );
}
