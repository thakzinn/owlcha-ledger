import type { Metadata, Viewport } from "next";
import { Kanit } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const kanit = Kanit({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-kanit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "บันทึกรายรับ-รายจ่าย | Owl Cha",
  description: "ระบบบันทึกรายการรายรับ-รายจ่ายร้าน Owl Cha",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // อ่าน headers เพื่อบังคับ dynamic render ทุกหน้า — จำเป็นเพื่อให้ inline script
  // ของ Next ได้รับ nonce ตรงกับ CSP ที่ proxy.ts ตั้งต่อ request (ADR-001 §11.4)
  // ถ้าปล่อยเป็น static prerender, HTML จะไม่มี nonce แล้วโดน CSP บล็อกตอน hydrate
  await headers();
  return (
    <html lang="th" className={kanit.variable}>
      <body className="bg-gray-50 min-h-screen antialiased">{children}</body>
    </html>
  );
}
