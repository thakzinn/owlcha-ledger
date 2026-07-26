import { NextRequest, NextResponse } from "next/server";

/**
 * ชั้นป้องกันเสริมสำหรับ page routes เท่านั้น — การตรวจ session จริงอยู่ใน
 * lib/guard.ts ซึ่งทุก route handler ต้องเรียกเองเสมอ (กัน pattern ของ
 * CVE-2025-29927: ห้ามพึ่ง proxy/middleware เป็นด่านตรวจสิทธิ์เพียงด่านเดียว)
 *
 * CSP ใช้ nonce ต่อ request → ทุกหน้าเป็น dynamic render โดยตั้งใจ
 * (ทุกหน้าอยู่หลัง auth จึงเป็น dynamic โดยธรรมชาติอยู่แล้ว — ดู ADR-001 §11.4)
 */
export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    `default-src 'self'`,
    // nonce + strict-dynamic คือด่านกัน XSS จริง; apis.google.com สำหรับ Google Picker
    // (browser ที่รองรับ strict-dynamic จะ ignore host allowlist — script ของ Picker
    //  ต้องใส่ nonce ที่แท็ก ส่วน host คงไว้เป็น fallback ของ browser เก่า)
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://apis.google.com`,
    // 'unsafe-inline' เฉพาะ style — จำเป็นสำหรับ SweetAlert2 (Accepted Risk R-10 ใน ADR-001)
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://lh3.googleusercontent.com`,
    `font-src 'self'`,
    `connect-src 'self'`,
    // Google Picker เปิด iframe จาก docs.google.com
    `frame-src https://docs.google.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // ยกเว้น static assets — nonce ไม่จำเป็นและจะทำลาย cache
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
