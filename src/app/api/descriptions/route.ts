import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { distinctDescriptions, NeedsPickerError, SheetNotFoundError } from "@/lib/sheets";

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`descriptions:${guard.email}`)) return rateLimitedResponse();

  try {
    const descriptions = await distinctDescriptions(guard.token.accessToken ?? "");
    return NextResponse.json({ descriptions });
  } catch (err) {
    if (err instanceof NeedsPickerError) {
      return jsonError(403, "NEEDS_PICKER", "ยังไม่ได้ให้สิทธิ์เข้าถึงไฟล์ชีต กรุณาเลือกไฟล์ในหน้าตั้งค่า");
    }
    if (err instanceof SheetNotFoundError) {
      return jsonError(500, "SHEET_NAME_MISMATCH", err.message);
    }
    console.error("[descriptions] sheet error");
    return jsonError(500, "INTERNAL", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}
