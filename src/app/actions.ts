"use server";

import { signOut } from "@/lib/auth";

// server action กลาง ให้ AppHeader (client component) เรียกออกจากระบบได้ทุกหน้า
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
