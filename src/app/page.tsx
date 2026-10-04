import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { absoluteMaxSec } from "@/lib/constants";
import { signOutAction } from "@/app/actions";
import AppHeader from "@/components/AppHeader";
import LedgerApp from "@/components/LedgerApp";
import SessionBanner from "@/components/SessionBanner";
import { dateSchema } from "@/lib/schema";

// หน้าบันทึกรายการ — ตรวจ session ซ้ำในหน้าเองเสมอ ไม่พึ่ง proxy เป็นด่านเดียว
export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const query = await searchParams;
  const parsedDate = dateSchema.safeParse(query.date);
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");
  const email = session.user?.email ?? "";

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl p-4">
      <SessionBanner
        authTime={session.authTime ?? Math.floor(Date.now() / 1000)}
        capSec={absoluteMaxSec()}
      />

      <AppHeader
        name={session.user?.name ?? ""}
        email={email}
        signOutAction={signOutAction}
      />

      <h1 className="mb-4 text-center text-xl font-semibold text-gray-800">
        บันทึกรายการรายรับ-รายจ่าย
      </h1>

      <LedgerApp key={parsedDate.success ? parsedDate.data : "default"} email={email} initialDate={parsedDate.success ? parsedDate.data : undefined} />
    </main>
  );
}
