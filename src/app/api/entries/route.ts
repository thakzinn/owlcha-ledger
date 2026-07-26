import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { dateSchema, saveEntriesSchema } from "@/lib/schema";
import {
  getDay,
  saveDay,
  ConflictError,
  NeedsPickerError,
  SheetNotFoundError,
} from "@/lib/sheets";

function mapSheetError(err: unknown): NextResponse {
  if (err instanceof NeedsPickerError) {
    return jsonError(
      403,
      "NEEDS_PICKER",
      "ยังไม่ได้ให้สิทธิ์เข้าถึงไฟล์ชีต กรุณาเลือกไฟล์ในหน้าตั้งค่า",
    );
  }
  if (err instanceof SheetNotFoundError) {
    return jsonError(500, "SHEET_NAME_MISMATCH", err.message);
  }
  console.error("[entries] sheet error"); // ไม่ log รายละเอียด — อาจมีข้อมูล request ปน
  return jsonError(500, "INTERNAL", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
}

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`entries:get:${guard.email}`)) return rateLimitedResponse();

  const parsed = dateSchema.safeParse(req.nextUrl.searchParams.get("date") ?? "");
  if (!parsed.success) {
    return jsonError(400, "BAD_REQUEST", "รูปแบบวันที่ต้องเป็น YYYY-MM-DD");
  }

  try {
    const data = await getDay(guard.token.accessToken ?? "", parsed.data);
    return NextResponse.json(data);
  } catch (err) {
    return mapSheetError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`entries:post:${guard.email}`, 15)) return rateLimitedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "BAD_REQUEST", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
  const parsed = saveEntriesSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
    return jsonError(400, "BAD_REQUEST", message);
  }

  try {
    const { date, entries, baseVersion } = parsed.data;
    const result = await saveDay(guard.token.accessToken ?? "", date, entries, baseVersion);
    return NextResponse.json({ ok: true, written: result.written });
  } catch (err) {
    if (err instanceof ConflictError) {
      return jsonError(
        409,
        "CONFLICT",
        "ข้อมูลของวันนี้ถูกแก้ไขไปแล้วจากที่อื่น กรุณาตรวจสอบก่อนบันทึกทับ",
      );
    }
    return mapSheetError(err);
  }
}
