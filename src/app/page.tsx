import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { absoluteMaxSec } from "@/lib/constants";

// หน้าหลัก (M1) — ตรวจ session ซ้ำในหน้าเองเสมอ ไม่พึ่ง proxy เป็นด่านเดียว
// ฟอร์มบันทึกรายการเต็มรูปแบบจะมาใน M4
export default async function Home() {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");

  const now = Math.floor(Date.now() / 1000);
  const authTime = session.authTime ?? now;
  const remainSec = Math.max(0, authTime + absoluteMaxSec() - now);
  const remainText =
    remainSec >= 86_400
      ? `${Math.floor(remainSec / 86_400)} วัน ${Math.floor((remainSec % 86_400) / 3_600)} ชม.`
      : remainSec >= 3_600
        ? `${Math.floor(remainSec / 3_600)} ชม. ${Math.floor((remainSec % 3_600) / 60)} นาที`
        : `${Math.floor(remainSec / 60)} นาที ${remainSec % 60} วินาที`;

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl p-4">
      <header className="mb-6 flex items-center justify-between rounded-xl bg-white p-4 shadow">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-800">
            {session.user?.name ?? "ผู้ใช้"}
          </p>
          <p className="truncate text-sm text-gray-500">{session.user?.email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            ออกจากระบบ
          </button>
        </form>
      </header>

      <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="mb-2 text-4xl">🦉🍵</p>
        <h1 className="mb-2 text-2xl font-semibold text-gray-800">
          บันทึกรายรับ-รายจ่าย Owl Cha
        </h1>
        <p className="text-gray-500">
          ล็อกอินสำเร็จ (M1) — ฟอร์มบันทึกรายการจะเปิดใช้ใน M4
        </p>
        <p className="mt-4 text-sm text-gray-400">
          เซสชันนี้จะครบกำหนดในอีก {remainText} (นโยบายความปลอดภัย 5 วัน)
        </p>
      </div>
    </main>
  );
}
