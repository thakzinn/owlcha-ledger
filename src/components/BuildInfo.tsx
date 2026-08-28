// แสดงเลข commit + เวลา deploy ท้ายทุกหน้า — ค่าถูก inline ตอน next build
// (ตั้งใน next.config.ts) จึงเท่ากันทั้ง server/client ไม่มีปัญหา hydration
export default function BuildInfo() {
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "unknown";
  const builtAt = process.env.NEXT_PUBLIC_BUILD_TIME;

  const deployedText = builtAt
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      }).format(new Date(builtAt))
    : "-";

  return (
    <footer className="mt-8 pb-4 text-center text-xs text-gray-400">
      version <span className="font-mono">{sha}</span> · deploy เมื่อ{" "}
      {deployedText}
    </footer>
  );
}
