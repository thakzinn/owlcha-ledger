"use client";

import { useMemo, useState } from "react";

/**
 * เครื่องคิดเลขค่า GP สำหรับรายรับจากแอปเดลิเวอรี (grab/lineman ฯลฯ)
 * สูตร: GP = ยอดขายบนแอป × GP%, VAT = GP × VAT%, สุทธิ = ยอดขาย − GP − VAT
 * ย้อนกลับ: ยอดขาย = สุทธิ ÷ (1 − GP% × (1 + VAT%))
 * เป็นเครื่องมือ UI เท่านั้น — ชีตยังเก็บ "ยอดรับสุทธิ" คอลัมน์ D ตาม data contract เดิม
 */

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseNum = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const sanitize = (v: string): string => {
  let s = v.replace(/[^0-9.]/g, "");
  const parts = s.split(".");
  if (parts.length > 2) s = `${parts[0]}.${parts[1]}`;
  return s;
};

export default function GpCalculator({
  onApply,
  onClose,
}: {
  /** รับยอดรับสุทธิ (2 ทศนิยม) ไปเติมช่องจำนวนเงิน */
  onApply: (net: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"gross" | "net">("gross");
  const [value, setValue] = useState("");
  const [gpPct, setGpPct] = useState("30");
  const [vatPct, setVatPct] = useState("7");

  const calc = useMemo(() => {
    const v = parseNum(value);
    const gp = parseNum(gpPct) / 100;
    const vat = parseNum(vatPct) / 100;
    const factor = 1 - gp * (1 + vat);
    if (v <= 0 || factor <= 0) return null;
    const gross = mode === "gross" ? v : v / factor;
    const gpAmt = gross * gp;
    const vatAmt = gpAmt * vat;
    const net = gross - gpAmt - vatAmt;
    return { gross, gpAmt, vatAmt, net };
  }, [mode, value, gpPct, vatPct]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">🧮 คำนวณค่า GP</h2>

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("gross")}
            className={`rounded-md py-2 font-medium ${mode === "gross" ? "bg-white shadow text-blue-700" : "text-gray-600"}`}
          >
            กรอกยอดขายบนแอป
          </button>
          <button
            type="button"
            onClick={() => setMode("net")}
            className={`rounded-md py-2 font-medium ${mode === "net" ? "bg-white shadow text-blue-700" : "text-gray-600"}`}
          >
            กรอกยอดรับสุทธิ
          </button>
        </div>

        <label className="mb-1 block text-sm text-gray-600">
          {mode === "gross" ? "ยอดขายบนแอป (ก่อนหัก GP)" : "ยอดรับสุทธิ (หลังหัก GP)"}
        </label>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(e) => setValue(sanitize(e.target.value))}
          placeholder="0.00"
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-right text-lg"
        />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">GP (%)</label>
            <input
              type="text"
              inputMode="decimal"
              value={gpPct}
              onChange={(e) => setGpPct(sanitize(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-right"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">VAT บนค่า GP (%)</label>
            <input
              type="text"
              inputMode="decimal"
              value={vatPct}
              onChange={(e) => setVatPct(sanitize(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-right"
            />
          </div>
        </div>

        <div className="mb-4 space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          {calc ? (
            <>
              <p className="flex justify-between text-gray-600">
                <span>ยอดขายบนแอป</span>
                <span>{fmt(calc.gross)} ฿</span>
              </p>
              <p className="flex justify-between text-red-600">
                <span>ค่า GP ({gpPct || 0}%)</span>
                <span>−{fmt(calc.gpAmt)} ฿</span>
              </p>
              <p className="flex justify-between text-red-600">
                <span>VAT {vatPct || 0}% บนค่า GP</span>
                <span>−{fmt(calc.vatAmt)} ฿</span>
              </p>
              <p className="flex justify-between border-t border-gray-200 pt-1 font-semibold text-green-700">
                <span>ยอดที่ร้านได้รับสุทธิ</span>
                <span>{fmt(calc.net)} ฿</span>
              </p>
            </>
          ) : (
            <p className="text-center text-gray-400">กรอกยอดเงินเพื่อคำนวณ</p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-gray-100 py-2.5 font-medium text-gray-700 hover:bg-gray-200"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!calc}
            onClick={() => calc && onApply(calc.net.toFixed(2))}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 font-semibold text-white enabled:hover:bg-blue-700 disabled:opacity-50"
          >
            ใช้ยอดสุทธิ
          </button>
        </div>
      </div>
    </div>
  );
}
