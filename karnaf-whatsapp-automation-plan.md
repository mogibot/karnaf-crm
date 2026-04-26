# קרנף נדל"ן - אוטומציית לידים ו-WhatsApp

## מה נבנה
1. דף נחיתה עם טופס השארת פרטים.
2. שליחת הליד ל-Google Sheets:
   - Sheet: `Karnaf Leads CRM`
   - URL: https://docs.google.com/spreadsheets/d/1VmxuWNz0LAdCBmmln8fZz4rn21yZdx8tdMiIVtJ6lU4/edit
3. שדה `whatsapp_state` לניהול מצב ההמשך.
4. בהמשך, סוכן WhatsApp יקרא שורות חדשות וימשיך תהליך מכירה.

## מבנה העמודה בשיטס
- created_at
- full_name
- phone
- email
- interest
- source
- status
- whatsapp_state
- notes

## תהליך אוטומציה מומלץ
### שלב 1
Google Apps Script webhook
- מקבל POST מהדף
- מוסיף שורה לשיטס
- מחזיר OK

### שלב 2
סוכן WhatsApp / observer
- סורק שורות עם `status=new` ו-`whatsapp_state=pending`
- שולח הודעת פתיחה
- מעדכן `whatsapp_state=sent`

### שלב 3
המשך qualification
- שאלת מצב: דירה ראשונה / השקעה / מימון
- בדיקת דחיפות
- תיאום שיחה
- סטטוסים כמו:
  - new
  - contacted
  - qualified
  - call_booked
  - closed

## הערה חשובה
כרגע בדף עצמו שמתי placeholder עבור Google Apps Script:
- `https://script.google.com/macros/s/REPLACE_ME/exec`

ברגע שנעלה Apps Script אמיתי, הטופס יהפוך לאוטומטי מקצה לקצה.
