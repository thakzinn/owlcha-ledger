import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Pnd94Report from "@/components/Pnd94Report";

// หน้ารายงานภาษีครึ่งปี — ตรวจ session ซ้ำในหน้าเองเสมอ เช่นเดียวกับหน้าหลัก
export default async function ReportPnd94Page() {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl p-4">
      <header className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow">
        <Link
          href="/"
          className="text-sm font-medium text-amber-600 hover:text-amber-700"
        >
          ← กลับหน้าบันทึก
        </Link>
        <p className="truncate text-sm text-gray-500">
          {session.user?.email ?? ""}
        </p>
      </header>

      <h1 className="mb-4 text-center text-xl font-semibold text-gray-800">
        รายงานสรุปยอดขายยื่น ภ.ง.ด.94 🦉🍵
      </h1>

      <Pnd94Report />
    </main>
  );
}
