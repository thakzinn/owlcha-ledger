# owlcha-ledger

ระบบบันทึกรายรับ-รายจ่ายร้าน Owl Cha — Next.js 16 (App Router) บน Vercel
แทนที่ระบบเดิมบน Google Apps Script (เก็บไว้ที่ [docs/legacy/](docs/legacy/) เพื่ออ้างอิงเท่านั้น)

สถาปัตยกรรมและเหตุผลการตัดสินใจทั้งหมด: [docs/ADR-001.md](docs/ADR-001.md)

## Stack

- Next.js 16.2.11 (App Router, Turbopack) / React 19.2 / TypeScript 5.9 `strict`
- Node.js 24.x (`.nvmrc`, `engines`)
- Tailwind CSS 4.3 (build จริง — ไม่ใช้ CDN)
- Auth.js v5 (`next-auth@5.0.0-beta.32` pin ตายตัว — ดู ADR R-9)
- Google Sheets API ผ่าน token ของผู้ใช้ (scope `spreadsheets` — ดู ADR §11.6)
- zod / sweetalert2 / html2canvas-pro (dynamic import) / vitest

## เริ่มพัฒนา

```bash
# ใช้ Node 24 (nvm use หรือติดตั้งจาก nodejs.org)
npm install
cp .env.example .env.local   # เติมค่าจริง — ห้าม commit
npm run dev                  # http://localhost:3000
npm run build
npm test
```

แอปตรวจ environment variables ทั้งหมดตอนเริ่มทำงาน (`instrumentation.ts` → `src/lib/env.ts`)
ขาดคีย์ใดจะล้มทันทีพร้อมบอกชื่อคีย์ — รายชื่อคีย์ทั้งหมดอยู่ใน [.env.example](.env.example)

## หมายเหตุด้าน rendering และ performance

- **ทุกหน้าเป็น dynamic render โดยตั้งใจ** — CSP ใช้ nonce ต่อ request (ตั้งใน [proxy.ts](proxy.ts))
  ซึ่ง opt out จาก static generation; ทุกหน้าอยู่หลัง auth จึงเป็น dynamic โดยธรรมชาติอยู่แล้ว
  ไม่ใช่ regression (ADR-001 §11.4)
- **งบประมาณ bundle หน้าแรก (First Load JS): ≤ 170 kB** วัดบนพื้นฐาน dynamic render —
  ตัวเลขจริงหลัง build จะรายงานไว้ที่นี่ทุก milestone
  - M0 (placeholder): _จะอัปเดตหลัง build_
- `html2canvas-pro` โหลดแบบ dynamic import เฉพาะตอนกดบันทึก ไม่อยู่ใน bundle หลัก

## ความปลอดภัย (สรุป)

- ทุก API route ตรวจ session + allowlist เองเสมอ (`src/lib/guard.ts`) — proxy เป็นแค่ชั้นเสริม
- Session: idle 12 ชม. + absolute cap 5 วัน (บังคับทั้ง proxy และ guard — ADR D8)
- CSP: `script-src` ใช้ nonce (ห้าม unsafe-inline), `style-src` ผ่อน unsafe-inline (ADR R-10)
- ไม่มี secret ใดอยู่ในซอร์ส — อ่านจาก env เท่านั้น และห้าม log
