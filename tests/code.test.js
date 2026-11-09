// Runs the pure parts of apps-script/Code.gs in Node: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
const grid = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-3pm-class2.json'), 'utf8'));
const NOV_9_2026 = new Date(2026, 10, 9);
// objects from the vm sandbox have a different prototype; compare as plain JSON
const plain = (v) => JSON.parse(JSON.stringify(v));

test('reads level, teacher and all 16 session dates', () => {
  const d = ctx.parseClassGrid(grid(), '3pm-Class 2', NOV_9_2026);
  assert.equal(d.level, 'Level 3');
  assert.equal(d.teacher, 'Teacher');
  assert.equal(d.sessions.length, 16);
  assert.deepEqual(plain(d.sessions[0]), { col: 3, label: '9/20', weekday: 'Sun', date: '2026-09-20' });
  assert.equal(d.sessions[6].date, '2026-12-13');
  assert.equal(d.sessions[7].date, '2027-01-10', 'year rolls over after December');
  assert.equal(d.sessions[15].date, '2027-05-16');
  assert.equal(d.sessions[15].col, 18);
});

test('reads 14 students and skips blank and summary rows', () => {
  const d = ctx.parseClassGrid(grid(), '3pm-Class 2', NOV_9_2026);
  assert.equal(d.students.length, 14);
  assert.equal(d.students[0].row, 4);
  assert.equal(d.students[13].name, 'Student Fourteen');
  assert.ok(!d.students.some((s) => /present|absent|percentage/i.test(s.name)));
  assert.deepEqual(plain(d.students[1].marks.slice(0, 5)), ['P', 'P', 'A', 'A', '']);
});

test('opens on the first session with no marks (11/15)', () => {
  const d = ctx.parseClassGrid(grid(), '3pm-Class 2', NOV_9_2026);
  assert.equal(d.defaultSession, 4);
  assert.equal(d.sessions[4].label, '11/15');
});

test('column totals match the sheet summary rows (8, 11, 8, 7 present)', () => {
  const d = ctx.parseClassGrid(grid(), '3pm-Class 2', NOV_9_2026);
  const present = [0, 1, 2, 3].map((i) => d.students.filter((s) => s.marks[i] === 'P').length);
  const absent = [0, 1, 2, 3].map((i) => d.students.filter((s) => s.marks[i] === 'A').length);
  assert.deepEqual(present, [8, 11, 8, 7]);
  assert.deepEqual(absent, [6, 3, 6, 7]);
});

test('season years are right when opened in spring', () => {
  const d = ctx.parseClassGrid(grid(), '3pm-Class 2', new Date(2027, 2, 20));
  assert.equal(d.sessions[0].date, '2026-09-20');
  assert.equal(d.sessions[15].date, '2027-05-16');
});

test('season years are right when opened just before it starts', () => {
  const d = ctx.parseClassGrid(grid(), '3pm-Class 2', new Date(2027, 7, 25));
  assert.equal(d.sessions[0].date, '2027-09-20');
});

test('planSave writes only changed cells', () => {
  const g = grid();
  const d = ctx.parseClassGrid(g, '3pm-Class 2', NOV_9_2026);
  const entries = d.students.map((s, i) => ({ row: s.row, name: s.name, mark: i < 3 ? 'P' : '' }));
  const plan = ctx.planSave(g, 7, '11/15', entries);
  assert.deepEqual(plain(plan.writes), [
    { row: 4, mark: 'P' }, { row: 5, mark: 'P' }, { row: 6, mark: 'P' }
  ]);

  // re-saving an already-marked session with the same marks writes nothing
  const same = d.students.map((s) => ({ row: s.row, name: s.name, mark: s.marks[3] }));
  assert.equal(ctx.planSave(g, 6, '11/8', same).writes.length, 0);
});

test('planSave can clear a mark and ignores junk marks', () => {
  const g = grid();
  const plan = ctx.planSave(g, 3, '9/20', [{ row: 4, name: 'STUDENT ONE', mark: '' }, { row: 5, name: 'STUDENT TWO', mark: 'x' }]);
  assert.deepEqual(plain(plan.writes), [{ row: 4, mark: '' }, { row: 5, mark: '' }]);
});

test('planSave refuses if the session column moved', () => {
  assert.throws(() => ctx.planSave(grid(), 7, '11/29', []), /sheet changed/);
  assert.throws(() => ctx.planSave(grid(), 1, '', []), /Invalid session column/);
});

test('planSave refuses if a student row no longer matches', () => {
  assert.throws(
    () => ctx.planSave(grid(), 7, '11/15', [{ row: 4, name: 'STUDENT TWO', mark: 'P' }]),
    /student list changed/
  );
  assert.throws(
    () => ctx.planSave(grid(), 7, '11/15', [{ row: 2, name: 'Level 3', mark: 'P' }]),
    /student list changed/
  );
});
