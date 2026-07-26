import { NextRequest, NextResponse } from "next/server";
import { getToken, type JWT } from "next-auth/jwt";
import { env, allowedEmails } from "@/lib/env";
import { absoluteMaxSec } from "@/lib/constants";
import { refreshGoogleToken } from "@/lib/google-refresh";

/**
 * ด่านตรวจสิทธิ์ "จริง" ของทุก API route — ทุก handler ต้องเรียกเองเสมอ
 * ห้ามพึ่ง proxy.ts เป็นด่านเดียว (CVE-2025-29927: middleware-only session
 * protection ถูก bypass ได้)
 *
 * ลำดับตรวจ: มี session → refresh token ยังใช้ได้ → email อยู่ใน allowlist
 * → ยังไม่ชน absolute cap (5 วันนับจาก authTime — activity ไม่รีเซ็ต)
 */

export type GuardResult =
  | { ok: true; token: JWT; email: string }
  | { ok: false; response: NextResponse };

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function requireSession(req: NextRequest): Promise<GuardResult> {
  const secureCookie = req.nextUrl.protocol === "https:";
  const cookieName = secureCookie
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  let token: JWT | null = null;
  try {
    token = await getToken({
      req,
      secret: env.AUTH_SECRET,
      secureCookie,
      cookieName,
      salt: cookieName,
    });
  } catch {
    token = null; // cookie เสีย/ถอดรหัสไม่ได้ → ปฏิบัติเหมือนไม่มี session
  }

  if (!token) {
    return {
      ok: false,
      response: errorResponse(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบก่อนใช้งาน"),
    };
  }

  if (token.error === "RefreshTokenError") {
    return {
      ok: false,
      response: errorResponse(
        401,
        "SESSION_EXPIRED",
        "การเชื่อมต่อกับ Google หมดอายุ กรุณาเข้าสู่ระบบใหม่",
      ),
    };
  }

  const email = token.email?.toLowerCase();
  if (!email || !allowedEmails().has(email)) {
    // 403 ตรง ๆ พร้อมข้อความไทย — ห้าม redirect กลับหน้า login (กัน loop)
    return {
      ok: false,
      response: errorResponse(
        403,
        "FORBIDDEN",
        "บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบ กรุณาติดต่อผู้ดูแลเพื่อขอเพิ่มสิทธิ์",
      ),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!token.authTime || now - token.authTime >= absoluteMaxSec()) {
    return {
      ok: false,
      response: errorResponse(
        401,
        "SESSION_EXPIRED",
        "เซสชันครบกำหนดตามนโยบายความปลอดภัย กรุณาเข้าสู่ระบบใหม่",
      ),
    };
  }

  // access token ของ Google อายุ ~1 ชม. — getToken ไม่รัน jwt callback ของ Auth.js
  // จึงต้อง refresh เองที่นี่ (per-request, ไม่เขียนกลับ cookie — ต้นทุน ~200ms
  // เฉพาะ request แรกหลังหมดอายุ ยอมรับได้สำหรับผู้ใช้ 5 คน)
  if (!token.accessToken || !token.expiresAt || now >= token.expiresAt - 60) {
    if (!token.refreshToken) {
      return {
        ok: false,
        response: errorResponse(
          401,
          "SESSION_EXPIRED",
          "การเชื่อมต่อกับ Google หมดอายุ กรุณาเข้าสู่ระบบใหม่",
        ),
      };
    }
    const refreshed = await refreshGoogleToken(token.refreshToken);
    if (!refreshed) {
      return {
        ok: false,
        response: errorResponse(
          401,
          "SESSION_EXPIRED",
          "การเชื่อมต่อกับ Google หมดอายุ กรุณาเข้าสู่ระบบใหม่",
        ),
      };
    }
    token.accessToken = refreshed.accessToken;
    token.expiresAt = refreshed.expiresAt;
  }

  return { ok: true, token, email };
}
