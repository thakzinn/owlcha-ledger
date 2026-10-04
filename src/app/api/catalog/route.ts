import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { catalogSchema } from "@/lib/catalog";
import { ConflictError, SheetAccessError, descriptionUsage, readCatalog, saveCatalog } from "@/lib/sheets";

function failure(err: unknown) {
  if (err instanceof SheetAccessError) return jsonError(403, "SHEET_ACCESS", err.message);
  if (err instanceof ConflictError) return jsonError(409, "CONFLICT", "การตั้งค่าถูกเปลี่ยนจากที่อื่น กรุณาโหลดใหม่ก่อนบันทึก");
  console.error("[catalog] read/write failed");
  return jsonError(500, "INTERNAL", "โหลดหรือบันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่ หากข้อมูลตั้งค่าเสียหายให้ตรวจแท็บตั้งค่ารายการ");
}

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`catalog:get:${guard.email}`)) return rateLimitedResponse();
  try {
    const token = guard.token.accessToken ?? "";
    const [data, usage] = await Promise.all([readCatalog(token), descriptionUsage(token)]);
    return NextResponse.json({ ...data, usage });
  } catch (err) { return failure(err); }
}

export async function PUT(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`catalog:put:${guard.email}`, 15)) return rateLimitedResponse();
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, "BAD_REQUEST", "รูปแบบข้อมูลไม่ถูกต้อง"); }
  const parsed = z.object({ catalog: catalogSchema, baseVersion: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(body);
  if (!parsed.success) return jsonError(400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "การตั้งค่าไม่ถูกต้อง");
  try {
    return NextResponse.json(await saveCatalog(guard.token.accessToken ?? "", parsed.data.catalog, parsed.data.baseVersion));
  } catch (err) { return failure(err); }
}
