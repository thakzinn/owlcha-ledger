import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  DEFAULT_GP_RATES,
  type GpRates,
  type SalesEntry,
  round2,
  gpForward,
  grossFromNet,
  summarize,
  presetRange,
  summaryToCsv,
  parsePasted,
  channelFromDescription,
} from "@/lib/pnd94";

const entry = (over: Partial<SalesEntry> = {}): SalesEntry => ({
  id: "x",
  date: "2026-03-15",
  channel: "Grab",
  gross: 100,
  ...over,
});

describe("round2 — half up 2 ตำแหน่ง float-safe", () => {
  it("half up มาตรฐาน", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0)).toBe(0);
    expect(round2(32.1)).toBe(32.1);
  });
  it("boundary float: 6.85×0.30 = 2.0549999... ต้องปัดเป็น 2.06 (จับ regression สูตร EPSILON)", () => {
    expect(round2(6.85 * 0.3)).toBe(2.06);
  });
});

describe("gpForward — สูตรไปข้างหน้า gross → net", () => {
  it("ตัวอย่างสเปก: 100 บาท Grab 30% → GP 30 + VAT 2.10 = หัก 32.10 → สุทธิ 67.90", () => {
    expect(gpForward(100, 30)).toEqual({
      gp: 30,
      vat: 2.1,
      deduction: 32.1,
      net: 67.9,
    });
  });
  it("ยอด 0 บาท → ศูนย์ทั้งหมด", () => {
    expect(gpForward(0, 30)).toEqual({ gp: 0, vat: 0, deduction: 0, net: 0 });
  });
  it("หน้าร้าน 0% → ไม่มีการหัก net = gross (ขาย 200 รับ 200)", () => {
    expect(gpForward(200, 0)).toEqual({ gp: 0, vat: 0, deduction: 0, net: 200 });
  });
  it("float ยาก: 149.5 @30% → gp 44.85, vat 3.14, หัก 47.99, สุทธิ 101.51", () => {
    expect(gpForward(149.5, 30)).toEqual({
      gp: 44.85,
      vat: 3.14,
      deduction: 47.99,
      net: 101.51,
    });
  });
  it("อัตรา custom 25%: 80 บาท → gp 20, vat 1.40, หัก 21.40, สุทธิ 58.60", () => {
    expect(gpForward(80, 25)).toEqual({
      gp: 20,
      vat: 1.4,
      deduction: 21.4,
      net: 58.6,
    });
  });
  it("property invariant: ตัวเลข 2 ตำแหน่งที่ผู้ใช้เห็นบวกกันลงตัวทุกค่า (ห้าม strict === บน float)", () => {
    for (let cents = 1; cents <= 200_000; cents += 7) {
      const gross = cents / 100;
      for (const rate of [30, 25, 17.5, 31.5]) {
        const { gp, vat, deduction, net } = gpForward(gross, rate);
        expect((gp + vat).toFixed(2)).toBe(deduction.toFixed(2));
        expect((gross - deduction).toFixed(2)).toBe(net.toFixed(2));
      }
    }
  });
});

describe("grossFromNet — ย้อนกลับสำหรับแถวชีตที่ F ว่าง", () => {
  it("67.90 @30/7 → 100.00", () => {
    expect(grossFromNet(67.9, 30)).toBe(100);
  });
  it("อัตรารวมเกิน 100% (factor ≤ 0) → null", () => {
    expect(grossFromNet(50, 94)).toBeNull();
    expect(grossFromNet(50, 120)).toBeNull();
  });
  it("round-trip: net ที่คำนวณกลับต่างจาก net เดิมไม่เกิน 0.01 (inclusive — deviation จริงชนขอบ 0.0100)", () => {
    for (let cents = 1; cents <= 2_000_000; cents += 997) {
      const net = cents / 100;
      const gross = grossFromNet(net, 30)!;
      const back = gpForward(gross, 30).net;
      // เทียบที่ระดับสตางค์ — การลบ float ตรง ๆ มี noise (เช่น 0.010000000000001563)
      const centsDiff = Math.abs(Math.round(back * 100) - Math.round(net * 100));
      expect(centsDiff).toBeLessThanOrEqual(1);
    }
  });
});

describe("summarize — กรองช่วง + group ตามช่องทาง", () => {
  const rates: GpRates = DEFAULT_GP_RATES;
  const FROM = "2026-01-01";
  const TO = "2026-06-30";

  it("group ตามช่องทางถูกต้อง + grand total", () => {
    const s = summarize(
      [
        entry({ gross: 100 }),
        entry({ gross: 200 }),
        entry({ channel: "หน้าร้าน", gross: 300 }),
      ],
      rates,
      FROM,
      TO,
    );
    expect(s.rows).toHaveLength(2);
    const grab = s.rows.find((r) => r.channel === "Grab")!;
    expect(grab).toMatchObject({ count: 2, gross: 300, gp: 90, vat: 6.3, deduction: 96.3, net: 203.7 });
    const store = s.rows.find((r) => r.channel === "หน้าร้าน")!;
    expect(store).toMatchObject({ count: 1, gross: 300, gp: 0, net: 300 });
    expect(s.total).toMatchObject({ count: 3, gross: 600, gp: 90, vat: 6.3, deduction: 96.3, net: 503.7 });
  });

  it("ปัดระดับรายการก่อนรวม: sum-of-rounded ≠ round-of-sum", () => {
    // 2 รายการ 6.85 @30%: GP ต่อรายการ 2.06 → รวม 4.12 (ถ้าปัดหลังรวม 4.11)
    const s = summarize(
      [entry({ gross: 6.85 }), entry({ gross: 6.85 })],
      rates,
      FROM,
      TO,
    );
    expect(s.rows[0]!.gp).toBe(4.12);
  });

  it("ช่วงที่ไม่มีรายการ → ศูนย์ทั้งหมด ไม่มี NaN", () => {
    const s = summarize([entry()], rates, "2027-01-01", "2027-06-30");
    expect(s.rows).toHaveLength(0);
    expect(s.total).toMatchObject({ count: 0, gross: 0, gp: 0, vat: 0, deduction: 0, net: 0 });
    expect(Number.isNaN(s.total.net)).toBe(false);
  });

  it("ขอบเขต inclusive ทั้งสองด้าน และ from > to → ว่าง", () => {
    const s = summarize(
      [entry({ date: FROM }), entry({ date: TO }), entry({ date: "2026-07-01" })],
      rates,
      FROM,
      TO,
    );
    expect(s.total.count).toBe(2);
    expect(summarize([entry()], rates, TO, FROM).total.count).toBe(0);
  });

  it("แถว estimated รวมยอดเทียบ sheetNet กับ computedNet", () => {
    const s = summarize(
      [
        entry({ gross: 100, estimated: true, sheetNet: 67.9 }),
        entry({ gross: 50 }),
      ],
      rates,
      FROM,
      TO,
    );
    expect(s.estimated).toEqual({ count: 1, sheetNet: 67.9, computedNet: 67.9 });
  });
});

describe("presetRange", () => {
  it("H1/H2/FULL จากปีของ today", () => {
    expect(presetRange("H1", "2026-07-26")).toEqual({ from: "2026-01-01", to: "2026-06-30" });
    expect(presetRange("H2", "2026-07-26")).toEqual({ from: "2026-07-01", to: "2026-12-31" });
    expect(presetRange("FULL", "2026-07-26")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("summaryToCsv", () => {
  const summary = summarize(
    [entry({ gross: 1234.5 }), entry({ channel: "หน้าร้าน", gross: 200 })],
    DEFAULT_GP_RATES,
    "2026-01-01",
    "2026-06-30",
  );
  const csv = summaryToCsv(summary, "2026-01-01", "2026-06-30");

  it("ขึ้นต้นด้วย BOM (U+FEFF)", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it("มีหัวตารางไทย, แถวช่องทาง, แถวรวม, ตัวเลข toFixed(2) ไม่คั่นหลักพัน", () => {
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe(
      "ช่องทาง,จำนวนรายการ,ยอดขายรวม (ก่อนหัก GP),ค่า GP รวม,VAT ของ GP รวม,ยอดหักรวม,ยอดรับสุทธิรวม",
    );
    expect(lines[2]).toBe("Grab,1,1234.50,370.35,25.92,396.27,838.23");
    expect(lines[3]).toBe("หน้าร้าน,1,200.00,0.00,0.00,0.00,200.00");
    expect(lines[4]).toBe("รวมทั้งหมด,2,1434.50,370.35,25.92,396.27,1038.23");
  });
});

describe("parsePasted — วางจาก Excel (TSV) / CSV", () => {
  it("TSV 3 คอลัมน์", () => {
    const r = parsePasted("15/01/2569\tGrab\t1,234.50\n2026-01-16\tหน้าร้าน\t200");
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toEqual([
      { date: "2026-01-15", channel: "Grab", gross: 1234.5 },
      { date: "2026-01-16", channel: "หน้าร้าน", gross: 200 },
    ]);
  });
  it("CSV + ยอดมี comma (คอลัมน์เกินรวมกลับเป็นยอด)", () => {
    const r = parsePasted("15/01/2568,Grab,1,234.50");
    expect(r.errors).toHaveLength(0);
    expect(r.entries[0]).toEqual({ date: "2025-01-15", channel: "Grab", gross: 1234.5 });
  });
  it("ปี พ.ศ. ทั้ง dd/mm/yyyy และ yyyy-mm-dd → ค.ศ.; ค.ศ. ผ่านตรง", () => {
    const r = parsePasted("15/01/2568,grab,10\n2568-01-16,grab,10\n2025-01-17,grab,10");
    expect(r.entries.map((e) => e.date)).toEqual(["2025-01-15", "2025-01-16", "2025-01-17"]);
  });
  it("channel alias ทุกแบบ + ไม่รู้จัก → อื่น ๆ", () => {
    const r = parsePasted(
      [
        "2026-01-01,GRAB,1",
        "2026-01-01,LineMan,1",
        "2026-01-01,ไลน์แมน,1",
        "2026-01-01,shopeefood,1",
        "2026-01-01,ช้อปปี้,1",
        "2026-01-01,หน้าร้าน,1",
        "2026-01-01,เงินสด,1",
        "2026-01-01,KShop,1",
        "2026-01-01,คนละครึ่ง,1",
        "2026-01-01,ตลาดนัด,1",
      ].join("\n"),
    );
    expect(r.errors).toHaveLength(0);
    expect(r.entries.map((e) => e.channel)).toEqual([
      "Grab",
      "LINE MAN",
      "LINE MAN",
      "ShopeeFood",
      "ShopeeFood",
      "หน้าร้าน",
      "หน้าร้าน",
      "kshop",
      "คนละครึ่ง",
      "อื่น ๆ",
    ]);
  });
  it("บรรทัดแรกเป็นหัวตาราง → ข้ามเงียบ ๆ บรรทัดข้อมูลนำเข้าปกติ", () => {
    const r = parsePasted("วันที่,ช่องทาง,ยอดขาย\n2026-01-01,Grab,100");
    expect(r.errors).toHaveLength(0);
    expect(r.entries).toHaveLength(1);
  });
  it("วันที่เป็นไปไม่ได้ (31/02) → error พร้อมเลขบรรทัด ไม่ silently ผ่าน", () => {
    const r = parsePasted("2026-01-01,Grab,100\n31/02/2568,Grab,100");
    expect(r.entries).toHaveLength(1);
    expect(r.errors).toEqual([
      { line: 2, reason: expect.stringContaining("วันที่ไม่ถูกต้อง") },
    ]);
  });
  it("ยอดติดลบ/ไม่ใช่ตัวเลข/ช่องทางว่าง → error รายบรรทัด บรรทัดดีนำเข้าต่อ", () => {
    const r = parsePasted(
      "2026-01-01,Grab,-5\n2026-01-02,Grab,abc\n2026-01-03,,100\n2026-01-04,Grab,0",
    );
    expect(r.entries).toEqual([{ date: "2026-01-04", channel: "Grab", gross: 0 }]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });
  it("input ว่าง / มีแต่บรรทัดว่าง → ว่างทั้งคู่", () => {
    expect(parsePasted("")).toEqual({ entries: [], errors: [] });
    expect(parsePasted("\n\n")).toEqual({ entries: [], errors: [] });
  });
});

describe("channelFromDescription — แยกช่องทางจากรายละเอียดในชีต", () => {
  it("ตรง regex delivery เดิมของ LedgerApp", () => {
    expect(channelFromDescription("Grab เครื่องดื่ม")).toBe("Grab");
    expect(channelFromDescription("lineman")).toBe("LINE MAN");
    expect(channelFromDescription("LINE MAN x2")).toBe("LINE MAN");
    expect(channelFromDescription("ShopeeFood x2")).toBe("ShopeeFood");
  });
  it("egest เป็น online delivery ไม่ใช่หน้าร้าน", () => {
    expect(channelFromDescription("egest")).toBe("egest");
    expect(channelFromDescription("EGest ยอดขาย")).toBe("egest");
  });
  it("รายรับหน้าร้านแยกประเภทหลัก: kshop / คนละครึ่ง / ที่เหลือ = หน้าร้าน", () => {
    expect(channelFromDescription("kshop")).toBe("kshop");
    expect(channelFromDescription("K Shop โอน")).toBe("kshop");
    expect(channelFromDescription("คนละครึ่ง")).toBe("คนละครึ่ง");
    expect(channelFromDescription("ขายหน้าร้าน")).toBe("หน้าร้าน");
    expect(channelFromDescription("รายรับอื่น")).toBe("หน้าร้าน");
  });
});

describe("ค่าคงที่", () => {
  it("อัตราตั้งต้นตามสเปก และ CHANNELS ครบ 8 ช่องทาง", () => {
    expect(CHANNELS).toHaveLength(8);
    expect(DEFAULT_GP_RATES).toEqual({
      Grab: 30,
      "LINE MAN": 30,
      ShopeeFood: 30,
      egest: 30,
      หน้าร้าน: 0,
      kshop: 0,
      คนละครึ่ง: 0,
      "อื่น ๆ": 0,
    });
  });
});
