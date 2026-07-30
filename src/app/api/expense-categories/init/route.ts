import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import {
  CategoryTabExistsError,
  SheetAccessError,
  createCategoryTab,
} from "@/lib/sheets";

/**
 * สร้างแท็บหมวดหมู่ค่าใช้จ่าย + seed ข้อมูลตั้งต้น — เรียกจากปุ่มยืนยันใน
 * หน้ารายงานเท่านั้น (R1: เขียนลงชีตจริงของร้าน ห้ามสร้างอัตโนมัติเงียบ ๆ;
 * rollback = ลบแท็บนี้ทิ้งในชีต ไม่กระทบข้อมูลสมุดบัญชี)
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`expcat:init:${guard.email}`, 15)) return rateLimitedResponse();

  try {
    const { seeded } = await createCategoryTab(guard.token.accessToken ?? "");
    return NextResponse.json({ ok: true, seeded });
  } catch (err) {
    if (err instanceof CategoryTabExistsError) {
      return jsonError(409, "TAB_EXISTS", `${err.message} — โหลดหน้าใหม่อีกครั้ง`);
    }
    if (err instanceof SheetAccessError) {
      return jsonError(403, "SHEET_ACCESS", err.message);
    }
    const status =
      typeof err === "object" && err !== null
        ? (err as { status?: number }).status
        : undefined;
    console.error(`[expcat:init] sheet error status=${status ?? "unknown"}`);
    return jsonError(500, "INTERNAL", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}
