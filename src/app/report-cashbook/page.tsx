import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import AppHeader from "@/components/AppHeader";
import CashbookReport from "@/components/CashbookReport";

// หน้ารายงานเงินสดรับ-จ่าย — ตรวจ session ซ้ำในหน้าเองเสมอ เช่นเดียวกับหน้าหลัก
export default async function ReportCashbookPage() {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");

  // ค่า default หัวรายงานจาก env ฝั่ง server เท่านั้น (PII — ห้าม NEXT_PUBLIC_ เพราะจะฝังลง bundle)
  const defaultHeader = {
    ownerName: process.env.CASHBOOK_OWNER_NAME ?? "",
    shopName: process.env.CASHBOOK_SHOP_NAME ?? "",
    taxId: process.env.CASHBOOK_TAX_ID ?? "",
    address: process.env.CASHBOOK_ADDRESS ?? "",
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl p-4">
      <div className="print:hidden">
        <AppHeader
          name={session.user?.name ?? ""}
          email={session.user?.email ?? ""}
          signOutAction={signOutAction}
        />

        <h1 className="mb-4 text-center text-xl font-semibold text-gray-800">
          รายงานเงินสดรับ-จ่าย
        </h1>
      </div>

      <CashbookReport defaultHeader={defaultHeader} />
    </main>
  );
}
