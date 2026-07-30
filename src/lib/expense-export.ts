import { dateStrToSerial } from "@/lib/date";
import {
  UNCATEGORIZED_LABEL,
  buildExpenseReport,
  type CategoryMappingInput,
  type ExpenseEntry,
  type MonthCells,
} from "@/lib/expense-report";

/**
 * Export รายงานค่าใช้จ่ายเป็นไฟล์ .xlsx (2 ชีต) — ห้าม import React/server
 *
 * ชีต 1 "สรุปค่าใช้จ่าย": ตารางเดือน × หมวด โดย "ทุกเซลล์เป็นสูตร SUMIFS"
 * ผูกกับชีต 2 ผ่านหัวคอลัมน์ (B$1) + เดือนจาก ROW() — ผู้ใช้แก้ตัวเลข/ย้ายหมวด
 * ในชีตรายละเอียดแล้วสรุปคำนวณใหม่เอง และ copy สูตรต่อในไฟล์ได้
 * ชีต 2 "รายละเอียดค่าใช้จ่าย": หมวดหมู่ | วันที่ทำรายการ | รายการ | จำนวนเงิน (บาท) | หมายเหตุ
 *
 * โปรเจกต์ห้ามเพิ่ม dependency → สร้าง .xlsx เอง: xlsx คือ zip ของ XML
 * ใช้ zip แบบ STORED (ไม่บีบอัด — Excel รองรับ) + CRC32 จึงไม่ต้องมี zlib
 */

export const SUMMARY_SHEET = "สรุปค่าใช้จ่าย";
export const DETAIL_SHEET = "รายละเอียดค่าใช้จ่าย";
/** ป้ายหมวดในชีตรายละเอียดของแถว "ไม่นับเป็นค่าใช้จ่าย" — ต่อท้ายชื่อหมวดจริง
 * เพื่อไม่ให้ SUMIFS ของคอลัมน์หมวดปกติเผลอรวมยอดพวกนี้เข้าไป */
export const NOT_COUNTED_SUFFIX = " (ไม่นับเป็นค่าใช้จ่าย)";

export interface DetailRow {
  category: string;
  /** YYYY-MM-DD (ไปเป็น date serial ตอนเขียนไฟล์) */
  date: string;
  description: string;
  /** ค่าบวกเสมอ (|amount|) */
  amount: number;
  note: string;
}

/** แถวชีตรายละเอียด: รายจ่ายทุกแถวในช่วง [from, to] เรียงตามวันที่ (first-wins เหมือนรายงาน) */
export function detailRows(
  entries: readonly ExpenseEntry[],
  mappings: readonly CategoryMappingInput[],
  from: string,
  to: string,
): DetailRow[] {
  const byItem = new Map<string, CategoryMappingInput>();
  for (const m of mappings) {
    const item = m.item.trim();
    if (item && !byItem.has(item)) byItem.set(item, m);
  }
  return entries
    .filter((e) => e.amount < 0 && e.date >= from && e.date <= to)
    .map((e) => {
      const m = byItem.get(e.description.trim());
      return {
        category: !m
          ? UNCATEGORIZED_LABEL
          : m.counted
            ? m.category
            : `${m.category}${NOT_COUNTED_SUFFIX}`,
        date: e.date,
        description: e.description.trim(),
        amount: Math.abs(e.amount),
        note: m?.note ?? "",
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

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
 */
export function monthCellFormula(col: string, year: number, month: number): string {
  const m = `DATE(${year},${month},1)`;
  const d = `'${DETAIL_SHEET}'`;
  return (
    `SUMIFS(${d}!$D:$D,${d}!$A:$A,${col}$1,` +
    `${d}!$B:$B,">="&${m},${d}!$B:$B,"<"&EDATE(${m},1))`
  );
}

// ---------- XML ----------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Cell {
  ref: string;
  /** s = style index ใน cellXfs */
  s?: number;
  text?: string;
  num?: number;
  formula?: string;
}

const cellXml = (c: Cell): string => {
  const s = c.s ? ` s="${c.s}"` : "";
  if (c.formula !== undefined) {
    // ไม่ใส่ค่า cache → บังคับ Excel คำนวณตอนเปิด (คู่กับ fullCalcOnLoad)
    return `<c r="${c.ref}"${s}><f>${esc(c.formula)}</f></c>`;
  }
  if (c.num !== undefined) return `<c r="${c.ref}"${s}><v>${c.num}</v></c>`;
  return `<c r="${c.ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.text ?? "")}</t></is></c>`;
};

const rowXml = (rowNo: number, cells: Cell[]): string =>
  `<row r="${rowNo}">${cells.map(cellXml).join("")}</row>`;

/** widths = ความกว้างคอลัมน์ (หน่วยตัวอักษรของ Excel) เรียงจากคอลัมน์ A */
const sheetXml = (rows: string[], widths: number[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("")}</cols>` +
  `<sheetData>${rows.join("")}</sheetData></worksheet>`;

// cellXfs: 0=ปกติ 1=หัวตาราง(หนา) 2=วันที่ dd/mm/yyyy 3=เงิน #,##0.00 4=เงิน+หนา
const STYLES_XML =
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

function buildSummarySheet(
  categories: readonly string[],
  notCountedLabels: readonly string[],
  months: readonly MonthCells[],
): string {
  // คอลัมน์: A=เดือน, ต่อด้วยหมวดทุกหมวด + ยังไม่จัดหมวด, สุดท้าย=รวมทั้งหมด
  const headers = [...categories, UNCATEGORIZED_LABEL];
  const totalColNo = 2 + headers.length;
  const rows: string[] = [];

  rows.push(
    rowXml(1, [
      { ref: "A1", s: 1, text: "เดือน" },
      ...headers.map((h, i) => ({ ref: `${colLetter(2 + i)}1`, s: 1, text: h })),
      { ref: `${colLetter(totalColNo)}1`, s: 1, text: "รวมทั้งหมด" },
    ]),
  );

  months.forEach((m, mi) => {
    const r = mi + 2;
    rows.push(
      rowXml(r, [
        { ref: `A${r}`, text: m.label },
        ...headers.map((_, i) => ({
          ref: `${colLetter(2 + i)}${r}`,
          s: 3,
          formula: monthCellFormula(colLetter(2 + i), m.year, m.month),
        })),
        {
          ref: `${colLetter(totalColNo)}${r}`,
          s: 3,
          formula: `SUM(B${r}:${colLetter(totalColNo - 1)}${r})`,
        },
      ]),
    );
  });

  const lastMonthRow = 1 + months.length;
  const totalRow = lastMonthRow + 1;
  rows.push(
    rowXml(totalRow, [
      { ref: `A${totalRow}`, s: 1, text: "รวมทั้งช่วง" },
      ...Array.from({ length: headers.length + 1 }, (_, i) => {
        const col = colLetter(2 + i);
        return {
          ref: `${col}${totalRow}`,
          s: 4,
          formula: `SUM(${col}2:${col}${lastMonthRow})`,
        };
      }),
    ]),
  );

  if (notCountedLabels.length > 0) {
    const r = totalRow + 1;
    const formula = notCountedLabels
      .map(
        (l) =>
          `SUMIFS('${DETAIL_SHEET}'!$D:$D,'${DETAIL_SHEET}'!$A:$A,"${l}")`,
      )
      .join("+");
    rows.push(
      rowXml(r, [
        { ref: `A${r}`, text: "ไม่นับเป็นค่าใช้จ่าย (หักจากรายได้)" },
        { ref: `${colLetter(totalColNo)}${r}`, s: 3, formula },
      ]),
    );
  }

  // เดือนแคบ คอลัมน์เงินกว้างพอเลขหลักแสนพร้อม comma
  return sheetXml(rows, [10, ...Array.from({ length: headers.length + 1 }, () => 16)]);
}

function buildDetailSheet(rows: readonly DetailRow[]): string {
  const xml: string[] = [
    rowXml(1, [
      { ref: "A1", s: 1, text: "หมวดหมู่" },
      { ref: "B1", s: 1, text: "วันที่ทำรายการ" },
      { ref: "C1", s: 1, text: "รายการ" },
      { ref: "D1", s: 1, text: "จำนวนเงิน (บาท)" },
      { ref: "E1", s: 1, text: "หมายเหตุ" },
    ]),
  ];
  rows.forEach((d, i) => {
    const r = i + 2;
    xml.push(
      rowXml(r, [
        { ref: `A${r}`, text: d.category },
        { ref: `B${r}`, s: 2, num: dateStrToSerial(d.date) },
        { ref: `C${r}`, text: d.description },
        { ref: `D${r}`, s: 3, num: d.amount },
        { ref: `E${r}`, text: d.note },
      ]),
    );
  });
  // หมวด/รายการ/หมายเหตุ เป็นข้อความไทยยาว, วันที่ต้องกว้างพอ dd/mm/yyyy
  return sheetXml(xml, [26, 14, 34, 16, 34]);
}

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
const workbookXml = (): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets>` +
  `<sheet name="${esc(SUMMARY_SHEET)}" sheetId="1" r:id="rId1"/>` +
  `<sheet name="${esc(DETAIL_SHEET)}" sheetId="2" r:id="rId2"/>` +
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

/** สร้างไฟล์ .xlsx ทั้งก้อน (bytes) สำหรับช่วง [from, to] ที่เลือก */
export function buildExpenseWorkbook(
  entries: readonly ExpenseEntry[],
  mappings: readonly CategoryMappingInput[],
  from: string,
  to: string,
): Uint8Array<ArrayBuffer> {
  // ใช้ลำดับคอลัมน์เดียวกับตารางบนเว็บ (first appearance ของหมวดในแท็บ)
  const report = buildExpenseReport(entries, mappings, from, to);
  const details = detailRows(entries, mappings, from, to);
  const notCountedLabels = [
    ...new Set(
      details
        .filter((d) => d.category.endsWith(NOT_COUNTED_SUFFIX))
        .map((d) => d.category),
    ),
  ];

  const enc = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml()) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    {
      name: "xl/worksheets/sheet1.xml",
      data: enc.encode(
        buildSummarySheet(report.categories, notCountedLabels, report.months),
      ),
    },
    { name: "xl/worksheets/sheet2.xml", data: enc.encode(buildDetailSheet(details)) },
  ]);
}
