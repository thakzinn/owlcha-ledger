import { NextResponse } from "next/server";

/** รูปแบบ error เดียวกันทุก endpoint: { error: { code, message } } — ไม่มี stack trace หลุดไป client */
export function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const rateLimitedResponse = () =>
  jsonError(429, "RATE_LIMITED", "ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
