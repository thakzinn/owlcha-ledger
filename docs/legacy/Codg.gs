/**
 * Google Apps Script Web App to serve form (doGet) and save entries into a Google Sheet
 * Supports client-side google.script.run and fetch() POST
 * Form fields map to columns B–E:
 *   B: วันที่ดำเนินการ (date)
 *   C: รายการ (description)
 *   D: จำนวน (amount)
 *   E: ช่องทาง (channel)
 */

// Serve the HTML form
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Handle fetch() POST submissions
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    saveEntries(data);
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'success', written: data.entries.length })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle client-side google.script.run calls
function saveData(payload,imgData) {
  try {
    saveEntries(payload,imgData);
  } catch (err) {
    throw err;
  }
}

// Get entries by date
function getEntriesByDate(date) {
  if (!date) {
    throw new Error('Date is required');
  }
  
  const SPREADSHEET_ID = '101FdiQARJMffn23hMrEcdJtJ__a7XgT31vhrGxr9Efo';
  const SHEET_NAME = 'ค่าใช้จ่าย';
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet '${SHEET_NAME}' not found`);
  
  const data = sheet.getDataRange().getValues();
  const entries = [];
  for (let i = 2; i < data.length; i++) {
    const rowDate = data[i][1];
    let dateStr = '';
    if (rowDate instanceof Date) {
      dateStr = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    if (dateStr === date) {
      entries.push({
        description: data[i][2] || '',
        amount: data[i][3] || 0,
        channel: data[i][4] || '',
        type: data[i][3] < 0 ? 'expense' : 'income'
      });
    }
  }
  return entries;
}

// Delete all entries for a specific date
function deleteEntriesByDate(date, sheet) {
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = data.length - 1; i >= 2; i--) {
    const rowDate = data[i][1];
    if (rowDate instanceof Date) {
      const dateStr = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (dateStr === date) {
        rowsToDelete.push(i + 1);
      }
    }
  }
  rowsToDelete.forEach(row => sheet.deleteRow(row));
  return rowsToDelete.length;
}

// Shared logic to append entries to sheet
function saveEntries(data, imgData) {
  const date = data.date;
  const entries = data.entries;
  if (!date || !Array.isArray(entries) || entries.length === 0) {
    throw new Error('Invalid date or empty entries');
  }
  
  const SPREADSHEET_ID = '101FdiQARJMffn23hMrEcdJtJ__a7XgT31vhrGxr9Efo';
  const SHEET_NAME = 'ค่าใช้จ่าย';

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet '${SHEET_NAME}' not found`);

  // Delete any existing entries for this date
  deleteEntriesByDate(date, sheet);

  // Prepare values: [date, description, amount, channel]
  const values = entries.map(entry => [
    date,
    entry.description || '',
    entry.amount || 0,
    entry.channel || ''
  ]);

  // Check if we need a border for date separation
  const lastRow = sheet.getLastRow();
  let addBorder = false;
  if (lastRow >= 3) {
    const lastRowDate = sheet.getRange(lastRow, 2).getValue();
    let lastDateStr = '';
    if (lastRowDate instanceof Date) {
      lastDateStr = Utilities.formatDate(lastRowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    if (lastDateStr !== date) {
      addBorder = true;
    }
  }

  // Append new rows
  const newRange = sheet.getRange(lastRow + 1, 2, values.length, values[0].length);
  newRange.setValues(values);

  // Add border above new rows if needed
  if (addBorder) {
    sheet.getRange(lastRow + 1, 1, 1, sheet.getLastColumn())
         .setBorder(true, null, null, null, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
  }

  // ส่งภาพ imgData ไป Telegram ถ้ามีการแนบรูป
  if (imgData) {
    sendToTelegramImageOnly(imgData);
  }
}

function sendToTelegramImageOnly(imgData) {

  const token = '7692095981:AAHG_8VYTZELk8_fglQsSwdAT9gVmqKyhSQ';
  const chatId = '-1002640817906';
  const telegramUrl = `https://api.telegram.org/bot${token}/sendDocument`;

  // แปลง Base64 image เป็น blob
  const regex = /^data:image\/(\w+);base64,/;
  const matches = imgData.match(regex);
  if (!matches) throw new Error('imgData ไม่ถูกต้อง');
  const contentType = 'image/' + matches[1];
  const bytes = Utilities.base64Decode(imgData.replace(regex, ''));
  const blob = Utilities.newBlob(bytes, contentType, 'Expense-Owl-Cha.png');

  const formData = {
    chat_id: chatId,
    document: blob
  };
  const options = {
    method: 'post',
    payload: formData,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(telegramUrl, options);
  Logger.log(response.getContentText()); // ดู error หรือ success message
}
// Return distinct descriptions from column C
function getDistinctDescriptions() {
  const SPREADSHEET_ID = '101FdiQARJMffn23hMrEcdJtJ__a7XgT31vhrGxr9Efo';
  const SHEET_NAME = 'ค่าใช้จ่าย';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet '${SHEET_NAME}' not found`);
  const values = sheet.getRange(3, 3, sheet.getLastRow() - 2, 1).getValues();
  const descSet = new Set();
  values.forEach(row => {
    if (row[0] && String(row[0]).trim() !== '') {
      descSet.add(String(row[0]).trim());
    }
  });
  return Array.from(descSet);
}

// Get the web app URL
function getScriptURL() {
  return ScriptApp.getService().getUrl();
}
