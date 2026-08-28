import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// เลข commit + เวลา build ถูก inline ตอน next build เพื่อแปะ footer ทุกหน้า
// ถ้าเครื่อง build ไม่มี .git (เช่น Docker copy เฉพาะ source) ให้ fallback เป็น env
function resolveCommitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return (
      process.env.GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      "unknown"
    );
  }
}

// CSP (มี nonce ต่อ request) ถูกตั้งใน proxy.ts — ที่นี่มีเฉพาะ header ที่เป็นค่าคงที่
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
