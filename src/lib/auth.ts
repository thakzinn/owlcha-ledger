import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env, allowedEmails } from "@/lib/env";
import { IDLE_MAX_SEC } from "@/lib/constants";

/**
 * Auth.js v5 — Google provider เท่านั้น (ADR-001 D3–D8)
 *
 * - scope `drive.file` (non-sensitive) — เข้าถึงเฉพาะไฟล์ที่ผู้ใช้เลือกผ่าน Picker
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
            "openid email profile https://www.googleapis.com/auth/drive.file",
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
      if (!token.refreshToken) {
        token.error = "RefreshTokenError";
        return token;
      }
      try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.AUTH_GOOGLE_ID,
            client_secret: env.AUTH_GOOGLE_SECRET,
            grant_type: "refresh_token",
            refresh_token: token.refreshToken,
          }),
        });
        const data: unknown = await res.json();
        if (!res.ok) {
          // ห้าม log รายละเอียด (อาจมี token ปน) — log เฉพาะ error code
          const code =
            typeof data === "object" && data !== null && "error" in data
              ? String((data as { error: unknown }).error)
              : "unknown";
          console.error(`[auth] refresh token failed: ${code}`);
          token.error = "RefreshTokenError";
          return token;
        }
        const refreshed = data as {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
        };
        token.accessToken = refreshed.access_token;
        token.expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
        if (refreshed.refresh_token) token.refreshToken = refreshed.refresh_token;
        delete token.error;
        return token;
      } catch {
        console.error("[auth] refresh token failed: network error");
        token.error = "RefreshTokenError";
        return token;
      }
    },

    // สิ่งที่ client เห็นผ่าน /api/auth/session — จงใจ "ไม่" ใส่ access/refresh token
    // (token ใช้ฝั่ง server ผ่าน getToken ใน guard.ts; ส่งให้ browser เฉพาะหน้า /setup
    //  ผ่าน server component ตาม Accepted Risk R-6)
    session({ session, token }) {
      session.authTime = token.authTime;
      if (token.error) session.error = token.error;
      return session;
    },
  },
});
