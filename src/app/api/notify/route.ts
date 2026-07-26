import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { notifySchema } from "@/lib/schema";
import { sendSummaryImage } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`notify:${guard.email}`, 10)) return rateLimitedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "BAD_REQUEST", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
  const parsed = notifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  }

  try {
    await sendSummaryImage(parsed.data.imageBase64);
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError(502, "TELEGRAM_FAILED", "ส่งรูปเข้า Telegram ไม่สำเร็จ (ข้อมูลบันทึกลงชีตแล้ว)");
  }
}
