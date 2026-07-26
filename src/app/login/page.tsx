import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

const MESSAGES: Record<string, { title: string; detail: string }> = {
  AccessDenied: {
    title: "บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบ",
    detail:
      "อีเมลของคุณไม่อยู่ในรายชื่อผู้ใช้ที่ได้รับอนุญาต กรุณาติดต่อผู้ดูแลเพื่อขอเพิ่มสิทธิ์",
  },
  session: {
    title: "กรุณาเข้าสู่ระบบ",
    detail: "เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ",
  },
  expired: {
    title: "การเชื่อมต่อกับ Google หมดอายุ",
    detail: "กรุณาเข้าสู่ระบบใหม่เพื่อใช้งานต่อ",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>;
}) {
  const session = await auth();
  if (session && !session.error) redirect("/");

  const { error, reason } = await searchParams;
  const message = MESSAGES[error ?? ""] ?? MESSAGES[reason ?? ""] ?? null;
  const isDenied = error === "AccessDenied";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="mb-2 text-4xl">🦉🍵</p>
        <h1 className="mb-1 text-2xl font-semibold text-gray-800">
          บันทึกรายรับ-รายจ่าย Owl Cha
        </h1>
        <p className="mb-6 text-gray-500">สำหรับพนักงานร้านเท่านั้น</p>

        {message && (
          <div
            className={`mb-6 rounded-lg p-4 text-sm ${
              isDenied
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            <p className="font-semibold">{message.title}</p>
            <p>{message.detail}</p>
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-600 py-3 text-lg font-semibold text-white shadow hover:bg-blue-700 active:bg-blue-800"
          >
            เข้าสู่ระบบด้วย Google
          </button>
        </form>
      </div>
    </main>
  );
}
