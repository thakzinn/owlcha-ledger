import { cookies } from "next/headers";
import { getToken, type JWT } from "next-auth/jwt";
import { env } from "@/lib/env";

/**
 * อ่าน JWT ดิบจาก cookie ภายใน Server Component (ใช้กับหน้า /setup ที่ต้องส่ง
 * access token ให้ Google Picker ฝั่ง browser — Accepted Risk R-6:
 * ส่งเฉพาะหน้านั้น, ห้ามลง localStorage/URL)
 */
export async function getServerToken(): Promise<JWT | null> {
  const cookieStore = await cookies();
  const secureName = "__Secure-authjs.session-token";
  const plainName = "authjs.session-token";
  const secure = cookieStore.has(secureName);
  const cookieName = secure ? secureName : plainName;
  try {
    return await getToken({
      req: new Request("http://localhost", {
        headers: { cookie: cookieStore.toString() },
      }),
      secret: env.AUTH_SECRET,
      secureCookie: secure,
      cookieName,
      salt: cookieName,
    });
  } catch {
    return null;
  }
}
