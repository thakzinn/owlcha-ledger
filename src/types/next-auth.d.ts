import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** unix seconds ของการล็อกอินจริง (ไม่รีเซ็ตตาม activity) */
    authTime?: number;
    /** ตั้งค่าเมื่อ refresh token ใช้ไม่ได้ — ผู้ใช้ต้องล็อกอินใหม่ */
    error?: "RefreshTokenError";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** unix seconds ของการล็อกอินจริง — เขียนครั้งเดียวตอน sign-in ห้ามแก้ */
    authTime?: number;
    accessToken?: string;
    refreshToken?: string;
    /** unix seconds ที่ access token หมดอายุ */
    expiresAt?: number;
    error?: "RefreshTokenError";
  }
}
