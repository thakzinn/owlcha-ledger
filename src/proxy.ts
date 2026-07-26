import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { env } from "@/lib/env";
import { absoluteMaxSec } from "@/lib/constants";

/**
 * ชั้นป้องกัน "เสริม" สำหรับ page routes + ตั้ง CSP ต่อ request เท่านั้น —
 * การตรวจสิทธิ์จริงของ API ทุกเส้นอยู่ใน lib/guard.ts ซึ่ง route handler
 * ต้องเรียกเองเสมอ (กัน pattern ของ CVE-2025-29927: ห้ามพึ่ง proxy/middleware
 * เป็นด่านตรวจสิทธิ์เพียงด่านเดียว)
 *
 * CSP ใช้ nonce ต่อ request → ทุกหน้าเป็น dynamic render โดยตั้งใจ (ADR-001 §11.4)
 */

const PUBLIC_PAGES = new Set(["/login"]);

function buildCsp(nonce: string): string {
  return [
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
}

async function sessionAllowsPage(request: NextRequest): Promise<boolean> {
  const secureCookie = request.nextUrl.protocol === "https:";
  const cookieName = secureCookie
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  try {
    const token = await getToken({
      req: request,
      secret: env.AUTH_SECRET,
      secureCookie,
      cookieName,
      salt: cookieName,
    });
    if (!token || token.error === "RefreshTokenError") return false;
    const now = Math.floor(Date.now() / 1000);
    return !!token.authTime && now - token.authTime < absoluteMaxSec();
  } catch {
    return false;
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // page routes (ไม่ใช่ /api) ที่ไม่ public → ต้องมี session ที่ยังไม่ชน absolute cap
  const isApi = pathname.startsWith("/api");
  if (!isApi && !PUBLIC_PAGES.has(pathname)) {
    if (!(await sessionAllowsPage(request))) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("reason", "session");
      return NextResponse.redirect(loginUrl);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

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
