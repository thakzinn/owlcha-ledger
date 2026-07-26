export async function register() {
  // ตรวจ env ให้ล้มตั้งแต่แอปเริ่มทำงาน — ไม่ปล่อยให้รันไปแล้วพังกลางทาง
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./src/lib/env");
  }
}
