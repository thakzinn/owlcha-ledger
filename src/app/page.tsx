// M0 placeholder — หน้าบันทึกรายการจริง (ต้องล็อกอิน) จะถูก implement ใน M1–M4
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="mb-2 text-4xl">🦉🍵</p>
        <h1 className="mb-2 text-2xl font-semibold text-gray-800">
          บันทึกรายรับ-รายจ่าย Owl Cha
        </h1>
        <p className="text-gray-500">
          กำลังติดตั้งระบบ (M0) — หน้าบันทึกรายการจะเปิดใช้เมื่อระบบล็อกอินพร้อม
        </p>
      </div>
    </main>
  );
}
