from pathlib import Path
import json

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

BASE = Path(r"C:\Users\mogi\.openclaw\workspace")
TOKEN_FILE = BASE / "google-sheets-token.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SHEET_TITLE = "Karnaf Leads CRM"
HEADERS = [["created_at", "full_name", "phone", "email", "interest", "source", "status", "whatsapp_state", "notes"]]

creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())
    TOKEN_FILE.write_text(creds.to_json(), encoding='utf-8')
service = build('sheets', 'v4', credentials=creds)

spreadsheet = service.spreadsheets().create(body={
    'properties': {'title': SHEET_TITLE},
    'sheets': [{'properties': {'title': 'Leads'}}]
}).execute()
spreadsheet_id = spreadsheet['spreadsheetId']
service.spreadsheets().values().update(
    spreadsheetId=spreadsheet_id,
    range='Leads!A1:I1',
    valueInputOption='RAW',
    body={'values': HEADERS}
).execute()

print(json.dumps({
    'spreadsheetId': spreadsheet_id,
    'spreadsheetUrl': f'https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit'
}, ensure_ascii=False, indent=2))
