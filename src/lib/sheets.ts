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
import { EXPENSE_CATEGORY_TAB } from "@/lib/constants";
import {
  CATEGORY_DATA_START_ROW,
  CATEGORY_HEADER,
  EXPENSE_CATEGORY_SEED,
} from "@/lib/expense-seed";

/**
 * อ่าน/เขียน Google Sheet ด้วย token ของผู้ใช้ที่ล็อกอิน (ADR D3 — ไม่มี Service Account)
 *
 * กลไก 409 (optimistic concurrency) ในไฟล์นี้ไม่ได้มีไว้กัน "การเขียนพร้อมกัน"
 * แต่มีไว้กัน "stale tab บนอุปกรณ์ร่วม" — พนักงาน A เปิดแอปบนแท็บเล็ตหน้าร้าน
 * ค้างข้อมูลวันอังคารไว้ วันพุธพนักงาน B มาใช้เครื่องเดิมแล้วกดบันทึกโดยไม่สังเกต
 * → ทับข้อมูลด้วยสถานะเก่าโดยไม่มี error ใด ๆ; การใช้งานแบบหมุนเวรบนอุปกรณ์ร่วม
 * ทำให้ความเสี่ยงนี้ "สูงขึ้น" ไม่ใช่ต่ำลง — ห้ามถอดกลไกนี้ออก (ADR-001 §11.2)
 */

/** Google ตอบ 403/404 = บัญชีผู้ใช้ไม่มีสิทธิ์ในไฟล์ชีต (ต้องถูกแชร์ไฟล์แบบ Editor) */
export class SheetAccessError extends Error {
  constructor() {
    super(
      "บัญชีของคุณยังไม่มีสิทธิ์แก้ไขไฟล์ชีตของร้าน กรุณาให้เจ้าของร้านแชร์ไฟล์ให้ก่อน",
    );
  }
}
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

function isAccessDenied(err: unknown): boolean {
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
      range: `'${env.SHEET_NAME}'!B${DATA_START_ROW}:F`,
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    return normalizeRows((res.data.values ?? []) as unknown[][]);
  } catch (err) {
    if (err instanceof SheetNotFoundError) throw err;
    if (isAccessDenied(err)) throw new SheetAccessError();
    throw err;
  }
}

export interface DayData {
  entries: {
    description: string;
    amount: number;
    channel: string;
    gross: number | null;
  }[];
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
      .map(({ description, amount, channel, gross }) => ({
        description,
        amount,
        channel,
        gross,
      })),
    version: computeVersion(rows, date),
    latestDate: rows.reduce<string | null>(
      (max, r) => (r.date && (!max || r.date > max) ? r.date : max),
      null,
    ),
  };
}

// ---------- อ่านช่วงวันที่ (หน้ารายงาน ภ.ง.ด.94 — read-only, ADR §11.8) ----------

export interface RangeEntry {
  date: string;
  description: string;
  amount: number;
  channel: string;
  gross: number | null;
}

/**
 * รายรับทุกแถว (amount ≥ 0) ในช่วง [from, to] — ไม่มี version/conflict เพราะไม่มีการเขียน
 * opts.includeAll = true → รวมรายจ่าย (amount < 0) ด้วย สำหรับหน้ารายงานเงินสดรับ-จ่าย
 */
export async function getRange(
  accessToken: string,
  from: string,
  to: string,
  opts?: { includeAll?: boolean },
): Promise<{ entries: RangeEntry[] }> {
  const rows = await readRows(sheetsClient(accessToken));
  return {
    entries: rows
      .filter(
        (r): r is SheetRow & { date: string } =>
          r.date !== null &&
          r.date >= from &&
          r.date <= to &&
          (opts?.includeAll === true || r.amount >= 0),
      )
      .map(({ date, description, amount, channel, gross }) => ({
        date,
        description,
        amount,
        channel,
        gross,
      })),
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

    // เขียน B–F ที่ตำแหน่งแน่นอน: วันที่เป็น serial + numberFormat, F = ยอดขายบนแอป
    // (สมมาตรกับการอ่านแบบ SERIAL_NUMBER — ไม่พึ่ง locale parsing, W5/N2; F ตาม ADR §11.7)
    requests.push({
      updateCells: {
        start: { sheetId: tab.sheetId, rowIndex: startRowIndex, columnIndex: 1 },
        rows: entries.map((e) => ({
          values: [
            {
              userEnteredValue: { numberValue: dateStrToSerial(date) },
              userEnteredFormat: {
                // dd/mm/yyyy ให้เข้าชุดกับแถวเดิมในชีต (ค่าในเซลล์เป็น Date serial เหมือนกัน)
                numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" },
              },
            },
            { userEnteredValue: { stringValue: e.description } },
            { userEnteredValue: { numberValue: e.amount } },
            { userEnteredValue: { stringValue: e.channel } },
            e.gross != null
              ? { userEnteredValue: { numberValue: e.gross } }
              : { userEnteredValue: { stringValue: "" } },
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
    if (isAccessDenied(err)) throw new SheetAccessError();
    // re-resolve gid แล้วลองซ้ำ 1 ครั้งเท่านั้น (N6) — กันวนไม่จบเมื่อล้มด้วยเหตุอื่น
    await doBatch(await resolveTab(api, true));
  }

  invalidateDescriptions();
  return { written: entries.length };
}

// ==================================================================
// แท็บ "หมวดหมู่ค่าใช้จ่าย" (EXPENSE_CATEGORY_TAB) — mapping รายการ → หมวด
//
// Concurrency ของแท็บนี้ = last-write-wins โดยเจตนา ไม่ใช้กลไก 409 ของ §11.2:
// ข้อมูล mapping แก้ไขน้อยครั้ง แก้โดยเจ้าของร้านคนเดียว และ client re-read
// ทั้งชุดทุกครั้งที่โหลด/หลังแก้ — การเขียนทับกันเสียหายแค่ 1 แถว mapping
// ที่เห็นและแก้กลับได้ทันที คนละความเสี่ยงกับสมุดบัญชีรายวัน (stale tab
// บนอุปกรณ์ร่วมทับข้อมูลทั้งวัน) จึงไม่ผูก baseVersion; ห้ามเอาเหตุผลนี้ไป
// ลดกลไก 409 ของแท็บสมุดบัญชีด้านบน
// ==================================================================

/** แท็บหมวดหมู่ยังไม่ถูกสร้าง — ให้ผู้ใช้กดสร้างจากหน้ารายงานก่อน */
export class CategoryTabMissingError extends Error {
  constructor() {
    super(`ยังไม่มีแท็บ "${EXPENSE_CATEGORY_TAB}" ในชีต กรุณาสร้างแท็บก่อน`);
  }
}
/** สั่งสร้างแท็บซ้ำ — กัน seed ซ้อน */
export class CategoryTabExistsError extends Error {
  constructor() {
    super(`มีแท็บ "${EXPENSE_CATEGORY_TAB}" อยู่แล้ว`);
  }
}
/** เพิ่มรายการที่มี mapping อยู่แล้ว (ชื่อซ้ำหลังจาก trim) */
export class CategoryItemExistsError extends Error {
  constructor(item: string) {
    super(`รายการ "${item}" มีอยู่ในแท็บหมวดหมู่แล้ว`);
  }
}
/** แก้/ลบรายการที่ไม่มีในแท็บ */
export class CategoryItemNotFoundError extends Error {
  constructor(item: string) {
    super(`ไม่พบรายการ "${item}" ในแท็บหมวดหมู่`);
  }
}

/**
 * cache gid ต่อชื่อแท็บ — แยกจาก cachedTab ของแท็บสมุดบัญชีโดยสิ้นเชิง
 * (best-effort เหมือนกัน R-8: หายตอน cold start ได้ ไม่ใช่ correctness)
 */
const namedTabCache = new Map<string, TabProps>();

/**
 * หา gid ของแท็บตามชื่อ — คืน null เมื่อไม่พบ (ไม่ throw SheetNotFoundError
 * เพราะ error นั้นผูกความหมายกับ env.SHEET_NAME ที่ "ต้องมีอยู่ก่อน" ส่วนแท็บนี้
 * การไม่มีคือสถานะปกติก่อนผู้ใช้กดสร้าง)
 */
async function resolveTabByName(
  api: sheets_v4.Sheets,
  title: string,
  force = false,
): Promise<TabProps | null> {
  const cached = namedTabCache.get(title);
  if (cached && !force) return cached;
  const res = await api.spreadsheets.get({
    spreadsheetId: env.SHEET_ID,
    fields: "sheets.properties",
  });
  const props = res.data.sheets
    ?.map((s) => s.properties)
    .find((p) => p?.title === title);
  if (!props || props.sheetId == null) {
    namedTabCache.delete(title);
    return null;
  }
  const tab: TabProps = {
    sheetId: props.sheetId,
    rowCount: props.gridProperties?.rowCount ?? 1000,
  };
  namedTabCache.set(title, tab);
  return tab;
}

export interface CategoryRow {
  category: string;
  /** ชื่อรายการ (trim แล้ว) — key สำหรับ exact match กับ description ในสมุดบัญชี */
  item: string;
  /** คอลัมน์ C: ว่าง/TRUE = true, FALSE = false */
  counted: boolean;
  note: string;
}

/** คอลัมน์ C: รับได้ทั้ง boolean จากเซลล์ checkbox และข้อความที่คนพิมพ์เอง */
function parseCounted(raw: unknown): boolean {
  if (raw === false) return false;
  if (typeof raw === "string" && raw.trim().toUpperCase() === "FALSE") return false;
  return true;
}

const asTrimmedString = (raw: unknown): string =>
  raw == null ? "" : String(raw).trim();

function normalizeCategoryRows(raw: readonly unknown[][]): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const r of raw) {
    const item = asTrimmedString(r[1]);
    if (!item) continue; // แถวว่าง/ไม่มีชื่อรายการ = ไม่ใช่ mapping
    rows.push({
      category: asTrimmedString(r[0]),
      item,
      counted: parseCounted(r[2]),
      note: asTrimmedString(r[3]),
    });
  }
  return rows;
}

async function readCategoryRows(
  api: sheets_v4.Sheets,
  tab: string,
): Promise<CategoryRow[]> {
  const res = await api.spreadsheets.values.get({
    spreadsheetId: env.SHEET_ID,
    range: `'${tab}'!A${CATEGORY_DATA_START_ROW}:D`,
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  // คงลำดับชีต (รวมชื่อซ้ำ) — expense-report.ts เป็นคนตัดสิน first-wins + เตือน
  return normalizeCategoryRows((res.data.values ?? []) as unknown[][]);
}

/** อ่าน mapping ทั้งแท็บ — แท็บยังไม่ถูกสร้างเป็นสถานะปกติ ไม่ใช่ error */
export async function readCategoryMappings(
  accessToken: string,
): Promise<{ exists: false } | { exists: true; rows: CategoryRow[] }> {
  const api = sheetsClient(accessToken);
  try {
    const tab = await resolveTabByName(api, EXPENSE_CATEGORY_TAB);
    if (!tab) return { exists: false };
    return { exists: true, rows: await readCategoryRows(api, EXPENSE_CATEGORY_TAB) };
  } catch (err) {
    if (isAccessDenied(err)) throw new SheetAccessError();
    // cache ค้างแต่แท็บถูกลบมือ → values.get ล้ม; ตรวจของจริงอีกครั้งเดียว
    const tab = await resolveTabByName(api, EXPENSE_CATEGORY_TAB, true);
    if (!tab) return { exists: false };
    try {
      return { exists: true, rows: await readCategoryRows(api, EXPENSE_CATEGORY_TAB) };
    } catch (err2) {
      if (isAccessDenied(err2)) throw new SheetAccessError();
      throw err2;
    }
  }
}

/** เพิ่ม mapping 1 แถวต่อท้ายแท็บ — ชื่อรายการซ้ำ (หลัง trim) ถือเป็น error */
export async function addCategoryMapping(
  accessToken: string,
  row: CategoryRow,
): Promise<void> {
  const api = sheetsClient(accessToken);
  const current = await readCategoryMappings(accessToken);
  if (!current.exists) throw new CategoryTabMissingError();
  if (current.rows.some((r) => r.item === row.item)) {
    throw new CategoryItemExistsError(row.item);
  }
  try {
    await api.spreadsheets.values.append({
      spreadsheetId: env.SHEET_ID,
      range: `'${EXPENSE_CATEGORY_TAB}'!A1:D`,
      valueInputOption: "RAW",
      requestBody: {
        // คอลัมน์ C: ว่าง = TRUE ตาม data contract, สตริง "FALSE" = ไม่นับ
        // (RAW เก็บเป็นข้อความตรงตัว ไม่ให้ Sheets ตีความ — เข้าชุดกับที่คนพิมพ์มือ)
        values: [[row.category, row.item, row.counted ? "" : "FALSE", row.note]],
      },
    });
  } catch (err) {
    if (isAccessDenied(err)) throw new SheetAccessError();
    throw err;
  }
}

/** หา index (0-based ในข้อมูล) ของแถวบนสุดที่ชื่อรายการตรง — สอดคล้อง first-wins ของรายงาน */
function findItemIndex(rows: readonly CategoryRow[], item: string): number {
  return rows.findIndex((r) => r.item === item);
}

/** แก้ mapping ของรายการเดิม (ย้ายหมวด / สลับนับเป็นค่าใช้จ่าย / แก้หมายเหตุ) */
export async function updateCategoryMapping(
  accessToken: string,
  item: string,
  patch: { category?: string; counted?: boolean; note?: string },
): Promise<void> {
  const api = sheetsClient(accessToken);
  // re-read สดก่อนคำนวณตำแหน่งแถวเสมอ — กัน index เก่าหลังแถวถูกย้าย/ลบจากชีตตรง ๆ
  const current = await readCategoryMappings(accessToken);
  if (!current.exists) throw new CategoryTabMissingError();
  const i = findItemIndex(current.rows, item);
  if (i < 0) throw new CategoryItemNotFoundError(item);
  const merged = { ...current.rows[i]!, ...patch };
  const rowNo = CATEGORY_DATA_START_ROW + i;
  try {
    await api.spreadsheets.values.update({
      spreadsheetId: env.SHEET_ID,
      range: `'${EXPENSE_CATEGORY_TAB}'!A${rowNo}:D${rowNo}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[merged.category, merged.item, merged.counted ? "" : "FALSE", merged.note]],
      },
    });
  } catch (err) {
    if (isAccessDenied(err)) throw new SheetAccessError();
    throw err;
  }
}

/** ลบ mapping — รายการนั้นจะกลับไป "ยังไม่จัดหมวด" ในรายงาน */
export async function deleteCategoryMapping(
  accessToken: string,
  item: string,
): Promise<void> {
  const api = sheetsClient(accessToken);

  // re-read + หา index ใหม่ในทุกความพยายาม — retry จึงไม่มีทางใช้ตำแหน่งแถวค้าง
  const doDelete = async (tab: TabProps) => {
    const rows = await readCategoryRows(api, EXPENSE_CATEGORY_TAB);
    const i = findItemIndex(rows, item);
    if (i < 0) throw new CategoryItemNotFoundError(item);
    const rowIndex = CATEGORY_DATA_START_ROW - 1 + i;
    await api.spreadsheets.batchUpdate({
      spreadsheetId: env.SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: tab.sheetId,
                dimension: "ROWS",
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });
  };

  const tab = await resolveTabByName(api, EXPENSE_CATEGORY_TAB);
  if (!tab) throw new CategoryTabMissingError();
  try {
    await doDelete(tab);
  } catch (err) {
    if (err instanceof CategoryItemNotFoundError) throw err;
    if (isAccessDenied(err)) throw new SheetAccessError();
    // gid ค้าง (แท็บถูกลบแล้วสร้างใหม่) → re-resolve แล้วลองซ้ำ 1 ครั้งเท่านั้น (N6)
    const fresh = await resolveTabByName(api, EXPENSE_CATEGORY_TAB, true);
    if (!fresh) throw new CategoryTabMissingError();
    await doDelete(fresh);
  }
}

/**
 * สร้างแท็บหมวดหมู่ + เขียนหัวตาราง/ข้อมูลตั้งต้น — เรียกจากปุ่มในหน้ารายงาน
 * เท่านั้น (R1: ผู้ใช้ต้องกดยืนยันเอง ห้ามระบบสร้างอัตโนมัติเงียบ ๆ)
 */
export async function createCategoryTab(
  accessToken: string,
): Promise<{ seeded: number }> {
  const api = sheetsClient(accessToken);
  try {
    // force เสมอ — การตัดสินใจ "สร้างหรือไม่" ห้ามอิง cache
    if (await resolveTabByName(api, EXPENSE_CATEGORY_TAB, true)) {
      throw new CategoryTabExistsError();
    }
    const res = await api.spreadsheets.batchUpdate({
      spreadsheetId: env.SHEET_ID,
      requestBody: {
        // ไม่กำหนด sheetId เอง — ให้ Google จ่าย gid กันชนกับแท็บเดิม
        requests: [{ addSheet: { properties: { title: EXPENSE_CATEGORY_TAB } } }],
      },
    });
    const props = res.data.replies?.[0]?.addSheet?.properties;
    if (props?.sheetId != null) {
      namedTabCache.set(EXPENSE_CATEGORY_TAB, {
        sheetId: props.sheetId,
        rowCount: props.gridProperties?.rowCount ?? 1000,
      });
    }
    // เขียน seed แยกจาก addSheet (values.update อ้างด้วยชื่อแท็บ ไม่ต้องรู้ gid;
    // batch เดียวกันอ้าง gid ที่ Google เพิ่งจ่ายไม่ได้)
    await api.spreadsheets.values.update({
      spreadsheetId: env.SHEET_ID,
      range: `'${EXPENSE_CATEGORY_TAB}'!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [...CATEGORY_HEADER],
          ...EXPENSE_CATEGORY_SEED.map((r) => [
            r.category,
            r.item,
            r.counted ? "" : "FALSE",
            r.note,
          ]),
        ],
      },
    });
    return { seeded: EXPENSE_CATEGORY_SEED.length };
  } catch (err) {
    if (err instanceof CategoryTabExistsError) throw err;
    if (isAccessDenied(err)) throw new SheetAccessError();
    throw err;
  }
}
