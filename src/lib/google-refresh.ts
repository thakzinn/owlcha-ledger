import { env } from "@/lib/env";

/**
 * แลก refresh token เป็น access token ใหม่จาก Google — ใช้ร่วมกันระหว่าง
 * jwt callback (auth.ts) และ requireSession (guard.ts ซึ่งอ่าน JWT ผ่าน getToken
 * ที่ "ไม่" รัน callback → ต้อง refresh เองเมื่อ token หมดอายุ)
 *
 * คืน null เมื่อ refresh ไม่ได้ (รวม invalid_grant: ผู้ใช้ถอนสิทธิ์/Google เพิกถอน)
 * — ห้าม log รายละเอียด response (log เฉพาะ error code)
 */
export interface RefreshedToken {
  accessToken: string;
  /** unix seconds ที่ access token ใหม่หมดอายุ */
  expiresAt: number;
  refreshToken?: string;
}

export async function refreshGoogleToken(
  refreshToken: string,
): Promise<RefreshedToken | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.AUTH_GOOGLE_ID,
        client_secret: env.AUTH_GOOGLE_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      const code =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: unknown }).error)
          : "unknown";
      console.error(`[auth] refresh token failed: ${code}`);
      return null;
    }
    const refreshed = data as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    return {
      accessToken: refreshed.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      refreshToken: refreshed.refresh_token,
    };
  } catch {
    console.error("[auth] refresh token failed: network error");
    return null;
  }
}
