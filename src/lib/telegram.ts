import { env } from "@/lib/env";

/**
 * ส่งรูปสรุปเข้ากลุ่ม Telegram แบบ sendDocument (พฤติกรรมเดิม — ชื่อไฟล์เดิม)
 * ตรวจ response `ok` จริงเสมอ (หนี้เดิมข้อ 7) และห้าม log token/response ดิบ
 */
export async function sendSummaryImage(imageBase64: string): Promise<void> {
  const base64 = imageBase64.replace(/^data:image\/png;base64,/, "");
  const bytes = Buffer.from(base64, "base64");

  const form = new FormData();
  form.append("chat_id", env.TELEGRAM_CHAT_ID);
  form.append(
    "document",
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    "Expense-Owl-Cha.png",
  );

  let ok = false;
  let description = "";
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
      { method: "POST", body: form },
    );
    const data = (await res.json()) as { ok?: boolean; description?: string };
    ok = res.ok && data.ok === true;
    description = data.description ?? "";
  } catch {
    ok = false;
    description = "network error";
  }

  if (!ok) {
    // log เฉพาะ description ของ Telegram (ไม่มี token อยู่ในนั้น)
    console.error(`[telegram] send failed: ${description || "unknown"}`);
    throw new Error("ส่งรูปเข้า Telegram ไม่สำเร็จ");
  }
}
