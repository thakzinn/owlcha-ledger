import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { absoluteMaxSec } from "@/lib/constants";
import LedgerApp from "@/components/LedgerApp";
import SessionBanner from "@/components/SessionBanner";

// หน้าบันทึกรายการ — ตรวจ session ซ้ำในหน้าเองเสมอ ไม่พึ่ง proxy เป็นด่านเดียว
export default async function Home() {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");
  const email = session.user?.email ?? "";

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl p-4">
      <SessionBanner
        authTime={session.authTime ?? Math.floor(Date.now() / 1000)}
        capSec={absoluteMaxSec()}
      />

      <header className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-800">
            {session.user?.name ?? "ผู้ใช้"}
          </p>
          <p className="truncate text-sm text-gray-500">{email}</p>
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

      <h1 className="mb-4 text-center text-xl font-semibold text-gray-800">
        บันทึกรายการรายรับ-รายจ่าย 🦉🍵
      </h1>

      <LedgerApp email={email} />
    </main>
  );
}
