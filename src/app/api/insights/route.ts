import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { rangeQuerySchema } from "@/lib/schema";
import { todayBangkok } from "@/lib/date";
import { buildInsights, findAnomalies, monthWindow } from "@/lib/insights";
import { getRange, readCatalog, readCategoryMappings, SheetAccessError, SheetNotFoundError } from "@/lib/sheets";

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`insights:${guard.email}`)) return rateLimitedResponse();
  const today = todayBangkok(), window = monthWindow(today);
  const parsed = rangeQuerySchema.safeParse({
    from: req.nextUrl.searchParams.get("from") ?? window.currentStart,
    to: req.nextUrl.searchParams.get("to") ?? today,
  });
  if (!parsed.success) return jsonError(400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "ช่วงวันที่ไม่ถูกต้อง");
  try {
    const token = guard.token.accessToken ?? "";
    const [range, monthly, settings, categories] = await Promise.all([
      getRange(token, parsed.data.from, parsed.data.to, { includeAll: true }),
      getRange(token, window.previousStart, today, { includeAll: true }),
      readCatalog(token), readCategoryMappings(token),
    ]);
    const mappings = categories.exists ? categories.rows : [];
    const data = buildInsights(monthly.entries, mappings, settings.catalog, parsed.data.from, parsed.data.to, today);
    data.issues = findAnomalies(range.entries, mappings, settings.catalog, parsed.data.from, parsed.data.to, today);
    return NextResponse.json({ ...data, categoriesAvailable: categories.exists });
  } catch (err) {
    if (err instanceof SheetAccessError) return jsonError(403, "SHEET_ACCESS", err.message);
    if (err instanceof SheetNotFoundError) return jsonError(500, "SHEET_NAME_MISMATCH", err.message);
    console.error("[insights] load failed");
    return jsonError(500, "INTERNAL", "โหลดข้อมูลภาพรวมไม่สำเร็จ กรุณาลองใหม่");
  }
}
