import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { rangeQuerySchema } from "@/lib/schema";
import { getRange, SheetAccessError, SheetNotFoundError } from "@/lib/sheets";

/**
 * GET /api/entries/range?from=YYYY-MM-DD&to=YYYY-MM-DD[&include=all]
 * รายรับทุกแถวในช่วง สำหรับหน้ารายงาน ภ.ง.ด.94 (read-only — ADR §11.8)
 * include=all → รวมรายจ่ายด้วย สำหรับหน้ารายงานเงินสดรับ-จ่าย; ค่าอื่น/ไม่ส่ง = รายรับเท่านั้น
 */

function mapSheetError(err: unknown): NextResponse {
  if (err instanceof SheetAccessError) {
    return jsonError(403, "SHEET_ACCESS", err.message);
  }
  if (err instanceof SheetNotFoundError) {
    return jsonError(500, "SHEET_NAME_MISMATCH", err.message);
  }
  const status =
    typeof err === "object" && err !== null
      ? ((err as { status?: number; code?: number }).status ??
        (err as { code?: number }).code)
      : undefined;
  console.error(`[entries:range] sheet error status=${status ?? "unknown"}`);
  return jsonError(500, "INTERNAL", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
}

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`entries:range:${guard.email}`)) return rateLimitedResponse();

  const parsed = rangeQuerySchema.safeParse({
    from: req.nextUrl.searchParams.get("from") ?? "",
    to: req.nextUrl.searchParams.get("to") ?? "",
  });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "ช่วงวันที่ไม่ถูกต้อง";
    return jsonError(400, "BAD_REQUEST", message);
  }

  try {
    const includeAll = req.nextUrl.searchParams.get("include") === "all";
    const data = await getRange(
      guard.token.accessToken ?? "",
      parsed.data.from,
      parsed.data.to,
      { includeAll },
    );
    return NextResponse.json(data);
  } catch (err) {
    return mapSheetError(err);
  }
}
