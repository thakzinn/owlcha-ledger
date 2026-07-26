import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerToken } from "@/lib/server-token";
import { env } from "@/lib/env";
import SetupPicker from "@/components/SetupPicker";

/**
 * ครั้งแรกของผู้ใช้แต่ละคน: เลือกไฟล์ชีตผ่าน Google Picker เพื่อให้สิทธิ์
 * scope drive.file กับไฟล์ของร้าน (ADR D5) — access token ถูกส่งให้ browser
 * เฉพาะหน้านี้เท่านั้น (R-6)
 */
export default async function SetupPage() {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");

  const token = await getServerToken();
  const accessToken = token?.accessToken;
  if (!accessToken) redirect("/login?reason=expired");

  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="mb-2 text-4xl">🗂️</p>
        <h1 className="mb-2 text-2xl font-semibold text-gray-800">
          ตั้งค่าครั้งแรก: เลือกไฟล์ชีตของร้าน
        </h1>
        <p className="mb-6 text-gray-500">
          กดปุ่มด้านล่างแล้วเลือกไฟล์ Google Sheet ที่ใช้บันทึกรายรับ-รายจ่าย
          (ทำครั้งเดียวต่อคน) — ระบบจะเข้าถึงได้เฉพาะไฟล์ที่คุณเลือกเท่านั้น
        </p>
        <SetupPicker
          accessToken={accessToken}
          apiKey={env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY}
          expectedSheetId={env.SHEET_ID}
          nonce={nonce}
        />
      </div>
    </main>
  );
}
