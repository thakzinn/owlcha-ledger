/**
 * Plumbing สร้างไฟล์ .xlsx ด้วยมือ — แชร์ระหว่าง expense-export กับ income-export
 * (ย้ายมาจาก expense-export.ts แบบไม่แก้ logic) — ห้าม import React/server
 *
 * โปรเจกต์ห้ามเพิ่ม dependency → สร้าง .xlsx เอง: xlsx คือ zip ของ XML
 * ใช้ zip แบบ STORED (ไม่บีบอัด — Excel รองรับ) + CRC32 จึงไม่ต้องมี zlib
 * โครงไฟล์ตายตัว: 2 ชีต + styles ชุดเดียว (แบบฟอร์มรายงานของร้านใช้แค่นี้)
 */

/** เลขคอลัมน์ (1-based) → ตัวอักษรคอลัมน์ Excel: 1=A, 27=AA */
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * สูตรเซลล์สรุปรายเดือน: อ้างหัวคอลัมน์แบบ col$1 (copy ไปคอลัมน์อื่นแล้ว Excel
 * ปรับ ref เอง) ส่วนเดือนระบุ DATE(ปี,เดือน,1) ตรง ๆ ต่อแถว — จำนวน/ตำแหน่ง
 * แถวเดือนไม่ตายตัวเมื่อผู้ใช้เลือกช่วงเอง (คร่อมปีได้) จึงไม่ผูกกับ ROW()
 * ต้องการชีตรายละเอียด layout A=ป้ายจัดกลุ่ม B=วันที่ C=รายการ D=จำนวนเงิน
 */
export function monthSumifsFormula(
  detailSheet: string,
  col: string,
  year: number,
  month: number,
): string {
  const m = `DATE(${year},${month},1)`;
  const d = `'${detailSheet}'`;
  return (
    `SUMIFS(${d}!$D:$D,${d}!$A:$A,${col}$1,` +
    `${d}!$B:$B,">="&${m},${d}!$B:$B,"<"&EDATE(${m},1))`
  );
}

// ---------- XML ----------

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface Cell {
  ref: string;
  /** s = style index ใน cellXfs */
  s?: number;
  text?: string;
  num?: number;
  formula?: string;
}

export const cellXml = (c: Cell): string => {
  const s = c.s ? ` s="${c.s}"` : "";
  if (c.formula !== undefined) {
    // ไม่ใส่ค่า cache → บังคับ Excel คำนวณตอนเปิด (คู่กับ fullCalcOnLoad)
    return `<c r="${c.ref}"${s}><f>${esc(c.formula)}</f></c>`;
  }
  if (c.num !== undefined) return `<c r="${c.ref}"${s}><v>${c.num}</v></c>`;
  return `<c r="${c.ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.text ?? "")}</t></is></c>`;
};

export const rowXml = (rowNo: number, cells: Cell[]): string =>
  `<row r="${rowNo}">${cells.map(cellXml).join("")}</row>`;

/** widths = ความกว้างคอลัมน์ (หน่วยตัวอักษรของ Excel) เรียงจากคอลัมน์ A */
export const sheetXml = (rows: string[], widths: number[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("")}</cols>` +
  `<sheetData>${rows.join("")}</sheetData></worksheet>`;

// cellXfs: 0=ปกติ 1=หัวตาราง(หนา) 2=วันที่ dd/mm/yyyy 3=เงิน #,##0.00 4=เงิน+หนา
export const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
  `<cellXfs count="5">` +
  `<xf/>` +
  `<xf fontId="1" applyFont="1"/>` +
  `<xf numFmtId="164" applyNumberFormat="1"/>` +
  `<xf numFmtId="4" applyNumberFormat="1"/>` +
  `<xf numFmtId="4" fontId="1" applyNumberFormat="1" applyFont="1"/>` +
  `</cellXfs></styleSheet>`;

// ---------- แพ็กเกจ xlsx (zip STORED) ----------

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

// fullCalcOnLoad = คำนวณสูตรทั้งไฟล์ตอนเปิด (เราไม่ได้ฝังค่า cache ไว้ในเซลล์สูตร)
// ชื่อชีตผ่าน esc() เสมอแม้ชื่อไทยปัจจุบันไม่มีอักขระพิเศษ — กันอนาคต
const workbookXml = (sheet1Name: string, sheet2Name: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets>` +
  `<sheet name="${esc(sheet1Name)}" sheetId="1" r:id="rId1"/>` +
  `<sheet name="${esc(sheet2Name)}" sheetId="2" r:id="rId2"/>` +
  `</sheets><calcPr fullCalcOnLoad="1"/></workbook>`;

/** CRC32 (พหุนามมาตรฐาน zip) — จำเป็นต่อ zip แม้ entry จะไม่บีบอัด */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * zip แบบ STORED ทุก entry (ชื่อไฟล์ใน archive เป็น ASCII ทั้งหมด)
 * ประกอบผลลัพธ์เป็นชิ้น Uint8Array แล้วค่อยต่อ — ห้าม push(...bytes) เพราะ
 * ไฟล์ XML ของชีตรายละเอียดใหญ่ได้หลายแสนไบต์ spread จะเกิน argument limit
 */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const le16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const le32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const ascii = (s: string) => new Uint8Array([...s].map((ch) => ch.charCodeAt(0)));
  const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = ascii(f.name);
    const crc = crc32(f.data);
    const common = concat([
      le16(20), // version needed
      le16(0), // flags
      le16(0), // method = STORED
      le16(0), // mod time
      le16(0), // mod date
      le32(crc),
      le32(f.data.length), // compressed = uncompressed
      le32(f.data.length),
      le16(name.length),
      le16(0), // extra len
    ]);
    const entry = concat([le32(0x04034b50), common, name, f.data]);
    local.push(entry);
    central.push(
      concat([
        le32(0x02014b50),
        le16(20), // version made by
        common,
        le16(0), // comment len
        le16(0), // disk start
        le16(0), // internal attrs
        le32(0), // external attrs
        le32(offset),
        name,
      ]),
    );
    offset += entry.length;
  }

  const centralBytes = concat(central);
  const eocd = concat([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(files.length),
    le16(files.length),
    le32(centralBytes.length),
    le32(offset),
    le16(0),
  ]);
  return concat([...local, centralBytes, eocd]);
}

/** ประกอบไฟล์ .xlsx ทั้งก้อนจาก XML ของชีตทั้งสอง (ลำดับ entry ตายตัว) */
export function packWorkbook(
  sheet1Name: string,
  sheet2Name: string,
  sheet1Xml: string,
  sheet2Xml: string,
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheet1Name, sheet2Name)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet1Xml) },
    { name: "xl/worksheets/sheet2.xml", data: enc.encode(sheet2Xml) },
  ]);
}
