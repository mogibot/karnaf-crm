const SHEET_NAME = 'Leads';
const SPREADSHEET_ID = '1VmxuWNz0LAdCBmmln8fZz4rn21yZdx8tdMiIVtJ6lU4';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    sheet.appendRow([
      payload.created_at || new Date().toISOString(),
      payload.full_name || '',
      payload.phone || '',
      payload.email || '',
      payload.interest || '',
      payload.source || 'karnaf-landing-v2',
      payload.status || 'new',
      payload.whatsapp_state || 'pending',
      payload.notes || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
