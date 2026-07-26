import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import AppHeader from "@/components/AppHeader";
import Pnd94Report from "@/components/Pnd94Report";

// หน้ารายงานภาษีครึ่งปี — ตรวจ session ซ้ำในหน้าเองเสมอ เช่นเดียวกับหน้าหลัก
export default async function ReportPnd94Page() {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl p-4">
      <AppHeader
        name={session.user?.name ?? ""}
        email={session.user?.email ?? ""}
        signOutAction={signOutAction}
      />

      <h1 className="mb-4 text-center text-xl font-semibold text-gray-800">
        รายงานสรุปยอดขายยื่น ภ.ง.ด.94
      </h1>

      <Pnd94Report />
    </main>
  );
}
