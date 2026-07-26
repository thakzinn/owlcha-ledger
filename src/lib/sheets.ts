import { google, type sheets_v4 } from "googleapis";
import { env } from "@/lib/env";
import { dateStrToSerial } from "@/lib/date";
import {
  DATA_START_ROW,
  type SheetRow,
  normalizeRows,
  computeVersion,
  shouldDrawBorder,
} from "@/lib/rows";
import type { EntryInput } from "@/lib/schema";

/**
 * อ่าน/เขียน Google Sheet ด้วย token ของผู้ใช้ที่ล็อกอิน (ADR D3 — ไม่มี Service Account)
 *
 * กลไก 409 (optimistic concurrency) ในไฟล์นี้ไม่ได้มีไว้กัน "การเขียนพร้อมกัน"
 * แต่มีไว้กัน "stale tab บนอุปกรณ์ร่วม" — พนักงาน A เปิดแอปบนแท็บเล็ตหน้าร้าน
 * ค้างข้อมูลวันอังคารไว้ วันพุธพนักงาน B มาใช้เครื่องเดิมแล้วกดบันทึกโดยไม่สังเกต
 * → ทับข้อมูลด้วยสถานะเก่าโดยไม่มี error ใด ๆ; การใช้งานแบบหมุนเวรบนอุปกรณ์ร่วม
 * ทำให้ความเสี่ยงนี้ "สูงขึ้น" ไม่ใช่ต่ำลง — ห้ามถอดกลไกนี้ออก (ADR-001 §11.2)
 */

/** ผู้ใช้ยังไม่ได้ให้สิทธิ์ไฟล์ผ่าน Picker (Google ตอบ 403/404) → client ต้องพาไป /setup */
export class NeedsPickerError extends Error {}
/** ข้อมูลวันนั้นเปลี่ยนไปแล้วนับจากตอนผู้ใช้โหลด → 409 ห้ามเขียนทับเงียบ ๆ */
export class ConflictError extends Error {}
/** หาแท็บชื่อตาม SHEET_NAME ไม่เจอ — ชื่อแท็บในชีตจริงไม่ตรงกับ env */
export class SheetNotFoundError extends Error {
  constructor() {
    super(
      `ไม่พบแท็บชื่อ "${env.SHEET_NAME}" ในชีต — ชื่อแท็บใน SHEET_NAME ไม่ตรงกับชีตจริง (ห้ามเปลี่ยนชื่อแท็บในชีต)`,
    );
  }
}

function sheetsClient(accessToken: string): sheets_v4.Sheets {
  const oauth = new google.auth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth });
}

function isPickerNeeded(err: unknown): boolean {
  const status =
    typeof err === "object" && err !== null
      ? Number((err as { status?: number; code?: number }).status ?? (err as { code?: number }).code)
      : NaN;
  return status === 403 || status === 404;
}

// ---------- sheetId (gid) resolution — N6 ----------

interface TabProps {
  sheetId: number;
  rowCount: number;
}
let cachedTab: TabProps | null = null;

async function resolveTab(api: sheets_v4.Sheets, force = false): Promise<TabProps> {
  if (cachedTab && !force) return cachedTab;
  const res = await api.spreadsheets.get({
    spreadsheetId: env.SHEET_ID,
    fields: "sheets.properties",
  });
  const props = res.data.sheets
    ?.map((s) => s.properties)
    .find((p) => p?.title === env.SHEET_NAME);
  if (!props || props.sheetId == null) throw new SheetNotFoundError();
  cachedTab = {
    sheetId: props.sheetId,
    rowCount: props.gridProperties?.rowCount ?? 1000,
  };
  return cachedTab;
}

// ---------- อ่าน ----------

async function readRows(api: sheets_v4.Sheets): Promise<SheetRow[]> {
  try {
    const res = await api.spreadsheets.values.get({
      spreadsheetId: env.SHEET_ID,
      range: `'${env.SHEET_NAME}'!B${DATA_START_ROW}:E`,
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    return normalizeRows((res.data.values ?? []) as unknown[][]);
  } catch (err) {
    if (err instanceof SheetNotFoundError) throw err;
    if (isPickerNeeded(err)) throw new NeedsPickerError();
    throw err;
  }
}

export interface DayData {
  entries: { description: string; amount: number; channel: string }[];
  version: string;
  /** วันที่ล่าสุดที่มีข้อมูลในชีต — ใช้แสดงคำเตือนแก้วันย้อนหลัง (D11) */
  latestDate: string | null;
}

export async function getDay(accessToken: string, date: string): Promise<DayData> {
  const api = sheetsClient(accessToken);
  const rows = await readRows(api);
  return {
    entries: rows
      .filter((r) => r.date === date)
      .map(({ description, amount, channel }) => ({ description, amount, channel })),
    version: computeVersion(rows, date),
    latestDate: rows.reduce<string | null>(
      (max, r) => (r.date && (!max || r.date > max) ? r.date : max),
      null,
    ),
  };
}

// ---------- รายการที่เคยใช้ (autocomplete) ----------

let descCache: { data: string[]; at: number } | null = null;
const DESC_TTL_MS = 10 * 60_000;

export function invalidateDescriptions(): void {
  descCache = null;
}

export async function distinctDescriptions(accessToken: string): Promise<string[]> {
  // cache in-memory เป็น best-effort เท่านั้น (R-8) — ชีตว่างได้ array ว่าง ไม่พัง (หนี้เดิมข้อ 6)
  if (descCache && Date.now() - descCache.at < DESC_TTL_MS) return descCache.data;
  const api = sheetsClient(accessToken);
  const rows = await readRows(api);
  const set = new Set<string>();
  for (const r of rows) {
    const d = r.description.trim();
    if (d) set.add(d);
  }
  const data = [...set];
  descCache = { data, at: Date.now() };
  return data;
}

// ---------- เขียน (แทนที่ทั้งวัน + เส้นคั่น) — atomic batchUpdate เดียว ----------

export async function saveDay(
  accessToken: string,
  date: string,
  entries: EntryInput[],
  baseVersion: string,
): Promise<{ written: number }> {
  const api = sheetsClient(accessToken);
  const rows = await readRows(api);

  // stale tab check — ไม่ตรง → 409 ให้ UI ถามผู้ใช้ ไม่มีการเขียนทับเงียบ ๆ
  if (computeVersion(rows, date) !== baseVersion) throw new ConflictError();

  // แถวของวันเป้าหมาย (0-based index ในอาร์เรย์) + defensive check ตาม N7:
  // ทุก index ที่จะลบต้องมีวันที่ตรง target จริง (filter การันตีโดยโครงสร้าง
  // แต่คงเงื่อนไขไว้กัน regression ในอนาคต — ลบผิดแถวคือความเสียหายที่กู้ไม่ได้)
  const delIndexes = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.date === date);
  if (delIndexes.some((x) => rows[x.i]?.date !== date)) {
    throw new Error("การตรวจสอบแถวก่อนลบไม่ผ่าน — ยกเลิกการบันทึกทั้งหมด");
  }

  const remaining = rows.filter((r) => r.date !== date);
  const drawBorder = shouldDrawBorder(remaining, date);

  // ตำแหน่งเขียนแบบ deterministic: แถวแรกของกลุ่มใหม่ (0-based) หลังลบเสร็จ
  // = หัวตาราง 2 แถว + จำนวนแถวที่เหลือ — ตั้งอยู่บนสมมติฐาน N10 ว่าชีตนี้
  // ไม่มีข้อมูลนอกคอลัมน์ B–E (บันทึกเป็น operational note ใน ADR §11.4)
  const startRowIndex = DATA_START_ROW - 1 + remaining.length;

  const doBatch = async (tab: TabProps) => {
    const requests: sheets_v4.Schema$Request[] = [];

    // ลบจากล่างขึ้นบน — index ก่อนหน้าไม่เลื่อน
    for (const { i } of [...delIndexes].sort((a, b) => b.i - a.i)) {
      const rowIndex = DATA_START_ROW - 1 + i;
      requests.push({
        deleteDimension: {
          range: {
            sheetId: tab.sheetId,
            dimension: "ROWS",
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      });
    }

    // grid หดตามจำนวนแถวที่ลบ — ขยายก่อนถ้าพื้นที่ไม่พอ (updateCells ไม่ขยายเอง)
    const rowCountAfter = tab.rowCount - delIndexes.length;
    const needed = startRowIndex + entries.length;
    if (needed > rowCountAfter) {
      requests.push({
        appendDimension: {
          sheetId: tab.sheetId,
          dimension: "ROWS",
          length: needed - rowCountAfter,
        },
      });
    }

    // เขียน B–E ที่ตำแหน่งแน่นอน: วันที่เป็น serial + numberFormat yyyy-mm-dd
    // (สมมาตรกับการอ่านแบบ SERIAL_NUMBER — ไม่พึ่ง locale parsing, W5/N2)
    requests.push({
      updateCells: {
        start: { sheetId: tab.sheetId, rowIndex: startRowIndex, columnIndex: 1 },
        rows: entries.map((e) => ({
          values: [
            {
              userEnteredValue: { numberValue: dateStrToSerial(date) },
              userEnteredFormat: {
                numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
              },
            },
            { userEnteredValue: { stringValue: e.description } },
            { userEnteredValue: { numberValue: e.amount } },
            { userEnteredValue: { stringValue: e.channel } },
          ],
        })),
        fields: "userEnteredValue,userEnteredFormat.numberFormat",
      },
    });

    // เส้นคั่นดำเต็มความกว้างบนแถวแรกของกลุ่มใหม่ (พฤติกรรมเดิม)
    if (drawBorder) {
      requests.push({
        updateBorders: {
          range: {
            sheetId: tab.sheetId,
            startRowIndex,
            endRowIndex: startRowIndex + 1,
          },
          top: {
            style: "SOLID",
            colorStyle: { rgbColor: { red: 0, green: 0, blue: 0 } },
          },
        },
      });
    }

    await api.spreadsheets.batchUpdate({
      spreadsheetId: env.SHEET_ID,
      requestBody: { requests },
    });
  };

  try {
    await doBatch(await resolveTab(api));
  } catch (err) {
    if (err instanceof SheetNotFoundError) throw err;
    if (isPickerNeeded(err)) throw new NeedsPickerError();
    // re-resolve gid แล้วลองซ้ำ 1 ครั้งเท่านั้น (N6) — กันวนไม่จบเมื่อล้มด้วยเหตุอื่น
    await doBatch(await resolveTab(api, true));
  }

  invalidateDescriptions();
  return { written: entries.length };
}
