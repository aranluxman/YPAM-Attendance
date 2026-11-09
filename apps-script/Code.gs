/**
 * YPAM Attendance — Google Apps Script backend.
 *
 * The Google Sheet is the database. Each class is one tab laid out like
 * "3pm-Class 2":
 *
 *   row 2: B = level ("Level 3"), C.. = session dates ("9/20", "10/4", …)
 *   row 3: B = teacher,            C.. = weekday ("Sun")
 *   row 4+: B = student name,      C.. = "P" / "A" / blank
 *   …then summary rows labelled "Present", "Absent", "Percentage".
 *
 * Access: the web app runs as the teacher using it, so only people the
 * sheet is shared with (as editors) can read or save attendance.
 */

var SPREADSHEET_ID = '1y71GdKxz8nn4Dw9ck-hpKPBRIFZZi3L4OLdgq3fpWTo';

var LAYOUT = {
  headerRow: 2,
  subHeaderRow: 3,
  firstStudentRow: 4,
  nameCol: 2,
  firstDateCol: 3
};

var PRESENT = 'P';
var ABSENT = 'A';
var SUMMARY_LABELS = ['present', 'absent', 'percentage'];
var SKIP_TABS = ['attendance key'];

// ---------------------------------------------------------------- web app

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('YPAM Attendance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Used by Index.html to pull in Styles.html and App.html. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ------------------------------------------------------- called by the app

/** Lists every tab that looks like a class sheet. */
function getClasses() {
  return getSpreadsheet_().getSheets()
    .filter(isClassSheet_)
    .map(function (sheet) {
      return {
        name: sheet.getName(),
        level: sheet.getRange(LAYOUT.headerRow, LAYOUT.nameCol).getDisplayValue().trim()
      };
    });
}

/** Returns sessions, students and their marks for one class tab. */
function getClassData(sheetName) {
  var sheet = getClassSheet_(sheetName);
  return parseClassGrid(sheet.getDataRange().getDisplayValues(), sheet.getName(), new Date());
}

/**
 * Saves one session's marks.
 *
 * @param {string} sheetName   class tab
 * @param {number} sessionCol  1-based column of the session
 * @param {string} sessionLabel the header text the app saw (e.g. "11/15"),
 *                              checked so we never write into the wrong column
 * @param {{row:number, name:string, mark:string}[]} entries
 * @return the class data after saving
 */
function saveAttendance(sheetName, sessionCol, sessionLabel, entries) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Someone else is saving right now. Try again in a few seconds.');
  }
  try {
    var sheet = getClassSheet_(sheetName);
    var values = sheet.getDataRange().getDisplayValues();
    var plan = planSave(values, sessionCol, sessionLabel, entries);
    plan.writes.forEach(function (w) {
      sheet.getRange(w.row, sessionCol).setValue(w.mark);
    });
    SpreadsheetApp.flush();
    var data = parseClassGrid(sheet.getDataRange().getDisplayValues(), sheet.getName(), new Date());
    data.saved = { written: plan.writes.length, skipped: plan.skipped };
    return data;
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------- pure helpers (tested)

/**
 * Turns a tab's display values (row 1 = index 0) into app data.
 * Pure function: no Apps Script calls, so it can be tested in Node.
 */
function parseClassGrid(values, sheetName, today) {
  var header = values[LAYOUT.headerRow - 1] || [];
  var sub = values[LAYOUT.subHeaderRow - 1] || [];

  var sessions = [];
  for (var c = LAYOUT.firstDateCol; c <= header.length; c++) {
    var label = cell_(header, c);
    var md = parseMonthDay_(label);
    if (!md) break;
    sessions.push({ col: c, label: label, weekday: cell_(sub, c), month: md.month, day: md.day, year: md.year });
  }
  assignYears_(sessions, today);

  var students = [];
  for (var r = LAYOUT.firstStudentRow; r <= values.length; r++) {
    var row = values[r - 1] || [];
    var name = cell_(row, LAYOUT.nameCol);
    if (!name) continue;
    if (SUMMARY_LABELS.indexOf(name.toLowerCase()) !== -1) break;
    students.push({
      row: r,
      name: name,
      marks: sessions.map(function (s) { return normalizeMark_(cell_(row, s.col)); })
    });
  }

  var defaultSession = sessions.length ? sessions.length - 1 : -1;
  for (var i = 0; i < sessions.length; i++) {
    var anyMark = students.some(function (st) { return st.marks[i] !== ''; });
    if (!anyMark) { defaultSession = i; break; }
  }

  return {
    sheetName: sheetName,
    level: cell_(header, LAYOUT.nameCol),
    teacher: cell_(sub, LAYOUT.nameCol),
    sessions: sessions.map(function (s) {
      return { col: s.col, label: s.label, weekday: s.weekday, date: s.date };
    }),
    students: students,
    defaultSession: defaultSession
  };
}

/**
 * Works out which cells to write. Re-checks the column header and each
 * student's name against the live sheet, so a row inserted or a column
 * moved since the app loaded can't cause a mark to land on the wrong person.
 */
function planSave(values, sessionCol, sessionLabel, entries) {
  var col = Number(sessionCol);
  if (!(col >= LAYOUT.firstDateCol) || Math.floor(col) !== col) {
    throw new Error('Invalid session column.');
  }
  var header = values[LAYOUT.headerRow - 1] || [];
  if (cell_(header, col) !== String(sessionLabel).trim()) {
    throw new Error('The sheet changed since you opened it (session ' + sessionLabel +
      ' moved). Reload the app and try again.');
  }
  if (!Array.isArray(entries)) throw new Error('Nothing to save.');

  var writes = [];
  var skipped = [];
  entries.forEach(function (e) {
    var mark = normalizeMark_(e && e.mark);
    var row = Number(e && e.row);
    var name = String((e && e.name) || '').trim();
    if (!(row >= LAYOUT.firstStudentRow) || Math.floor(row) !== row) { skipped.push(name); return; }
    var sheetRow = values[row - 1] || [];
    if (cell_(sheetRow, LAYOUT.nameCol) !== name) { skipped.push(name); return; }
    if (normalizeMark_(cell_(sheetRow, col)) === mark) return; // unchanged
    writes.push({ row: row, mark: mark });
  });
  if (skipped.length) {
    throw new Error('The student list changed since you opened the app (' + skipped.join(', ') +
      '). Reload and try again.');
  }
  return { writes: writes, skipped: skipped };
}

function parseMonthDay_(text) {
  var m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(String(text || '').trim());
  if (!m) return null;
  var month = Number(m[1]);
  var day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  var year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : null;
  return { month: month, day: day, year: year };
}

/**
 * Headers like "9/20" have no year. The season runs Sep → May, so the year
 * goes up by one whenever the month goes backwards (12/13 → 1/10).
 */
function assignYears_(sessions, today) {
  if (!sessions.length) return;
  var first = sessions[0];
  var year = first.year;
  if (!year) {
    year = today.getFullYear();
    var firstDate = new Date(year, first.month - 1, first.day);
    var halfYear = 183 * 24 * 60 * 60 * 1000;
    if (firstDate.getTime() - today.getTime() > halfYear) year -= 1;
  }
  var prevMonth = first.month;
  sessions.forEach(function (s) {
    if (s.year) {
      year = s.year;
    } else if (s.month < prevMonth) {
      year += 1;
    }
    prevMonth = s.month;
    s.date = year + '-' + pad2_(s.month) + '-' + pad2_(s.day);
  });
}

function normalizeMark_(value) {
  var v = String(value == null ? '' : value).trim().toUpperCase();
  return v === PRESENT || v === ABSENT ? v : '';
}

function cell_(row, col) {
  var v = row[col - 1];
  return v == null ? '' : String(v).trim();
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

// --------------------------------------------------- Apps Script plumbing

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getClassSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(String(sheetName || ''));
  if (!sheet || !isClassSheet_(sheet)) {
    throw new Error('Class "' + sheetName + '" was not found in the attendance sheet.');
  }
  return sheet;
}

function isClassSheet_(sheet) {
  if (SKIP_TABS.indexOf(sheet.getName().trim().toLowerCase()) !== -1) return false;
  if (sheet.getLastRow() < LAYOUT.firstStudentRow || sheet.getLastColumn() < LAYOUT.firstDateCol) return false;
  return parseMonthDay_(sheet.getRange(LAYOUT.headerRow, LAYOUT.firstDateCol).getDisplayValue()) !== null;
}
