# YPAM Attendance

A phone-friendly attendance app for the Sunday Aaniin classes. Teachers tap **P** or **A** for each student, and the marks are saved straight into the attendance Google Sheet. The Sheet stays the database, so it always shows the same data as the app.

**Screens**

- **Take**: pick a session date, tap P/A for each student (or "Mark rest present"), then Save.
- **Members**: each student's attendance %, sorted lowest first or A–Z, with search.
- **Dashboard**: average turnout, last session, sessions done, perfect records, a turnout chart, and anything worth noticing (best session, drops in a row, students who haven't come yet).

## How it works

```
Phone browser  ──tap Save──▶  Apps Script (Code.gs)  ──writes──▶  Google Sheet
   (Index.html)  ◀──data────                           ◀──reads───   (one tab per class)
```

- It runs on **Google Apps Script**, which is free with no servers to manage.
- **Access:** the app runs as the teacher using it, so a teacher can only open it if the Sheet is **shared with them as an editor**. To add a teacher, share the Sheet. To remove one, un-share it.
- **Classes:** every tab laid out like `3pm-Class 2` shows up in the class picker. To add a class, duplicate a class tab (the "Attendance key" tab is ignored).
- **Sheet layout the app expects** (the same as now):
  - Row 2: column B = level (`Level 3`), then session dates from column C (`9/20`, `10/4`, …)
  - Row 3: column B = teacher, then the weekday (`Sun`)
  - Row 4 and down: column B = student name, then `P` / `A` / blank
  - The `Present` / `Absent` / `Percentage` rows at the bottom are left alone.
- **Safety:** before saving, the app re-checks that the date column and every student's row still match what it loaded. If someone inserted a row or moved a column in the meantime, it refuses to save and asks you to reload, so a mark never lands on the wrong student.

## Set it up (about 10 minutes, one time)

1. Go to <https://script.google.com> and click **New project**. Name it `YPAM Attendance`.
2. Click the gear icon (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
3. Back in the **Editor**, create these files and paste in the contents from the `apps-script/` folder in this repo:
   | In Apps Script | Paste from |
   | --- | --- |
   | `Code.gs` (already exists; replace everything) | `apps-script/Code.gs` |
   | `appsscript.json` | `apps-script/appsscript.json` |
   | **+ › HTML** named `Index` | `apps-script/Index.html` |
   | **+ › HTML** named `Styles` | `apps-script/Styles.html` |
   | **+ › HTML** named `App` | `apps-script/App.html` |
4. Click **Deploy › New deployment**, choose type **Web app**, and set:
   - **Execute as:** User accessing the web app
   - **Who has access:** Anyone with a Google account

   (Only people the Sheet is shared with can actually load data.)
5. Click **Deploy**, approve the permissions, and copy the **Web app URL**.
6. Open the URL on your phone and use **Add to Home Screen** so it opens like an app.
7. Share the Sheet (as **Editor**) with each teacher, then send them the URL. The first time they open it, Google asks them to approve access once.

**Updating later:** paste in the new code, then go to **Deploy › Manage deployments › Edit (pencil) › Version: New version › Deploy**. The URL stays the same.

**Using a different Sheet:** change `SPREADSHEET_ID` at the top of `Code.gs`. It's the long ID in the Sheet's URL.

## Tests

```bash
npm test
```

These run the Sheet-reading and save-checking logic from `Code.gs` in Node against `tests/fixture-3pm-class2.json`, a copy of the real tab's layout with placeholder student names.
