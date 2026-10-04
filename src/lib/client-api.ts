"use client";

import { signOut } from "next-auth/react";

let sheetAccessSignOut: Promise<unknown> | undefined;

export async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 403 && response.headers.get("content-type")?.includes("application/json")) {
    const body: unknown = await response.clone().json();
    if (
      typeof body === "object" && body !== null && "error" in body &&
      typeof body.error === "object" && body.error !== null &&
      "code" in body.error && body.error.code === "SHEET_ACCESS"
    ) {
      // Several requests can fail together when a page first loads.
      sheetAccessSignOut ??= signOut({ redirectTo: "/login?reason=sheet-access" });
      try {
        await sheetAccessSignOut;
      } catch (error) {
        sheetAccessSignOut = undefined;
        throw error;
      }
    }
  }
  return response;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await request(url, init);
  if (!response.ok) {
    if (response.status === 401) {
      window.location.assign("/login?reason=expired");
      throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    }
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `คำขอล้มเหลว (${response.status}) กรุณาลองใหม่`);
  }
  return response.json() as Promise<T>;
}
