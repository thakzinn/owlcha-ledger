import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { distinctDescriptions, SheetAccessError, SheetNotFoundError } from "@/lib/sheets";

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`descriptions:${guard.email}`)) return rateLimitedResponse();

  try {
    const descriptions = await distinctDescriptions(guard.token.accessToken ?? "");
    return NextResponse.json({ descriptions });
  } catch (err) {
    if (err instanceof SheetAccessError) {
      return jsonError(403, "SHEET_ACCESS", err.message);
    }
    if (err instanceof SheetNotFoundError) {
      return jsonError(500, "SHEET_NAME_MISMATCH", err.message);
    }
    console.error("[descriptions] sheet error");
    return jsonError(500, "INTERNAL", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}
