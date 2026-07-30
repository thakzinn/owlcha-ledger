import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/guard";
import { jsonError, rateLimitedResponse } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import {
  categoryItemQuerySchema,
  categoryMappingSchema,
  categoryPatchSchema,
} from "@/lib/schema";
import {
  CategoryItemExistsError,
  CategoryItemNotFoundError,
  CategoryTabMissingError,
  SheetAccessError,
  addCategoryMapping,
  deleteCategoryMapping,
  readCategoryMappings,
  updateCategoryMapping,
} from "@/lib/sheets";

/**
 * CRUD ของ mapping "รายการ → หมวดหมู่" ในแท็บหมวดหมู่ค่าใช้จ่าย
 * แท็บนี้ concurrency = last-write-wins (ดูคำอธิบายใน src/lib/sheets.ts)
 * — ไม่มี baseVersion/409 แบบสมุดบัญชี
 */

function mapSheetError(err: unknown, route: string): NextResponse {
  if (err instanceof SheetAccessError) {
    return jsonError(403, "SHEET_ACCESS", err.message);
  }
  if (err instanceof CategoryTabMissingError) {
    return jsonError(409, "TAB_NOT_FOUND", err.message);
  }
  if (err instanceof CategoryItemExistsError) {
    return jsonError(409, "ITEM_EXISTS", err.message);
  }
  if (err instanceof CategoryItemNotFoundError) {
    return jsonError(404, "ITEM_NOT_FOUND", err.message);
  }
  const status =
    typeof err === "object" && err !== null
      ? (err as { status?: number }).status
      : undefined;
  console.error(`[${route}] sheet error status=${status ?? "unknown"}`);
  return jsonError(500, "INTERNAL", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
}

export async function GET(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`expcat:get:${guard.email}`)) return rateLimitedResponse();

  try {
    const data = await readCategoryMappings(guard.token.accessToken ?? "");
    return NextResponse.json(
      data.exists ? { exists: true, mappings: data.rows } : { exists: false },
    );
  } catch (err) {
    return mapSheetError(err, "expcat:get");
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`expcat:post:${guard.email}`, 15)) return rateLimitedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "BAD_REQUEST", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
  const parsed = categoryMappingSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
    return jsonError(400, "BAD_REQUEST", message);
  }

  try {
    await addCategoryMapping(guard.token.accessToken ?? "", parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapSheetError(err, "expcat:post");
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`expcat:patch:${guard.email}`, 15)) return rateLimitedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "BAD_REQUEST", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
  const parsed = categoryPatchSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
    return jsonError(400, "BAD_REQUEST", message);
  }

  try {
    const { item, ...patch } = parsed.data;
    await updateCategoryMapping(guard.token.accessToken ?? "", item, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapSheetError(err, "expcat:patch");
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireSession(req);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`expcat:delete:${guard.email}`, 15)) return rateLimitedResponse();

  const parsed = categoryItemQuerySchema.safeParse({
    item: req.nextUrl.searchParams.get("item") ?? "",
  });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
    return jsonError(400, "BAD_REQUEST", message);
  }

  try {
    await deleteCategoryMapping(guard.token.accessToken ?? "", parsed.data.item);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapSheetError(err, "expcat:delete");
  }
}
