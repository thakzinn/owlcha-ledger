import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env, allowedEmails } from "@/lib/env";
import { IDLE_MAX_SEC } from "@/lib/constants";
import { refreshGoogleToken } from "@/lib/google-refresh";

/**
 * Auth.js v5 — Google provider เท่านั้น (ADR-001 D3–D8, D4 แก้ไขตาม §11.6)
 *
 * - scope `spreadsheets` (sensitive) — เจ้าของระบบตัดสินใจสลับจาก `drive.file`
 *   เมื่อ 2026-07-26 เพื่อตัดขั้นตอน Picker; ใช้ได้ใต้สถานะ Testing โดยไม่ต้อง
 *   ผ่าน verification (ดู ADR-001 §11.6)
 * - access_type=offline + prompt=consent ทุกครั้ง — มิฉะนั้น Google ไม่ออก
 *   refresh token ตัวใหม่ในการอนุญาตครั้งถัดไป (จำเป็นต่อ session policy D8)
 * - authTime ถูกเขียน "ครั้งเดียว" ตอน sign-in และห้ามแก้ — เป็นฐานของ absolute cap
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  // จำเป็นสำหรับ next start บน localhost และ Vercel (host มาจาก proxy ของแพลตฟอร์ม)
  // ปลอดภัยเพราะแอปนี้ deploy หลัง reverse proxy ที่ควบคุม Host header เสมอ
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: IDLE_MAX_SEC, // idle timeout 12 ชม. — absolute cap บังคับแยกใน proxy + guard
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/spreadsheets",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    // ชั้น authorization ที่ 2 (ชั้นแรกคือ Google Test users list ซึ่งตั้งนอกโค้ด):
    // อีเมลไม่อยู่ใน ALLOWED_EMAILS → ปฏิเสธตั้งแต่ sign-in → /login?error=AccessDenied
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      return !!email && allowedEmails().has(email);
    },

    async jwt({ token, account }) {
      // ล็อกอินครั้งแรก: บันทึกเวลา + token ทั้งชุด — authTime เขียนที่นี่ที่เดียว
      if (account) {
        token.authTime = Math.floor(Date.now() / 1000);
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        delete token.error;
        return token;
      }

      // access token ยังไม่หมดอายุ (เผื่อ 60 วิ) → ใช้ต่อ
      if (token.expiresAt && Date.now() < (token.expiresAt - 60) * 1000) {
        return token;
      }

      // refresh access token — ล้มเหลว (รวม invalid_grant: ผู้ใช้ถอนสิทธิ์/
      // Google เพิกถอน/เปลี่ยนรหัสผ่าน) → ทำเครื่องหมายให้ guard พาไปล็อกอินใหม่
      // (guard.ts ก็ refresh เองด้วยผ่าน helper เดียวกัน เพราะ getToken ไม่รัน callback นี้)
      if (!token.refreshToken) {
        token.error = "RefreshTokenError";
        return token;
      }
      const refreshed = await refreshGoogleToken(token.refreshToken);
      if (!refreshed) {
        token.error = "RefreshTokenError";
        return token;
      }
      token.accessToken = refreshed.accessToken;
      token.expiresAt = refreshed.expiresAt;
      if (refreshed.refreshToken) token.refreshToken = refreshed.refreshToken;
      delete token.error;
      return token;
    },

    // สิ่งที่ client เห็นผ่าน /api/auth/session — จงใจ "ไม่" ใส่ access/refresh token
    // (token ใช้เฉพาะฝั่ง server ผ่าน getToken ใน guard.ts — ไม่มีเหตุให้ browser เห็นอีก
    //  หลังตัด Picker ออกตาม ADR §11.6)
    session({ session, token }) {
      session.authTime = token.authTime;
      if (token.error) session.error = token.error;
      return session;
    },
  },
});
