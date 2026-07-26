"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

/**
 * Google Picker ฝั่ง browser — accessToken อยู่ใน memory ของหน้านี้เท่านั้น
 * ห้ามเก็บลง localStorage/sessionStorage/URL (Accepted Risk R-6)
 */
export default function SetupPicker({
  accessToken,
  apiKey,
  expectedSheetId,
  nonce,
}: {
  accessToken: string;
  apiKey: string;
  expectedSheetId: string;
  nonce: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoOpened = useRef(false);

  // เปิด Picker ให้อัตโนมัติเมื่อโหลดเสร็จ (ครั้งเดียว) — scope drive.file
  // บังคับให้ผู้ใช้ "กดเลือกไฟล์เอง" เป็นการให้สิทธิ์ auto-grant เงียบ ๆ ไม่ได้
  useEffect(() => {
    if (ready && !autoOpened.current) {
      autoOpened.current = true;
      openPicker();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function openPicker() {
    const g = window.google;
    if (!g?.picker) {
      setMessage("โหลดตัวเลือกไฟล์ไม่สำเร็จ กรุณารีเฟรชหน้า");
      return;
    }
    setBusy(true);
    // ไม่กรองด้วยชื่อ — SHEET_NAME เป็นชื่อ "แท็บ" ไม่ใช่ชื่อไฟล์ (ไฟล์อาจชื่ออะไรก็ได้)
    // การเลือกผิดไฟล์ถูกกันด้วยการเทียบ id กับ expectedSheetId ใน callback อยู่แล้ว
    const view = new g.picker.DocsView(g.picker.ViewId.SPREADSHEETS);
    const picker = new g.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setLocale("th")
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.CANCEL) {
          setBusy(false);
          return;
        }
        if (data.action !== g.picker.Action.PICKED) return;
        const picked = data.docs?.[0]?.id as string | undefined;
        if (picked === expectedSheetId) {
          setMessage("เชื่อมต่อไฟล์สำเร็จ กำลังพาไปหน้าบันทึกรายการ…");
          router.push("/");
          router.refresh();
        } else {
          setBusy(false);
          setMessage(
            "ไฟล์ที่เลือกไม่ใช่ชีตบันทึกรายรับ-รายจ่ายของร้าน กรุณาเลือกไฟล์ให้ตรง",
          );
        }
      })
      .build();
    picker.setVisible(true);
  }

  return (
    <div>
      <Script
        src="https://apis.google.com/js/api.js"
        nonce={nonce}
        onLoad={() => {
          window.gapi?.load("picker", () => setReady(true));
        }}
        onError={() =>
          setMessage("โหลดสคริปต์ของ Google ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรช")
        }
      />
      {message && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          {message}
        </div>
      )}
      <button
        type="button"
        onClick={openPicker}
        disabled={!ready || busy}
        className="w-full rounded-lg bg-blue-600 py-3 text-lg font-semibold text-white shadow enabled:hover:bg-blue-700 disabled:opacity-50"
      >
        {ready ? (busy ? "กำลังเปิดตัวเลือกไฟล์…" : "เลือกไฟล์ชีต") : "กำลังโหลด…"}
      </button>
    </div>
  );
}
