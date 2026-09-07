const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'institution.db');
const isNew = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT UNIQUE NOT NULL,
  joining_date TEXT NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  division TEXT NOT NULL,
  medium TEXT NOT NULL,
  school TEXT NOT NULL,
  school_other TEXT,
  father_name TEXT,
  father_phone TEXT,
  mother_name TEXT,
  mother_phone TEXT,
  place TEXT,
  total_fees REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  net_fees REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT NOT NULL,
  receipt_no TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  classes_handled TEXT,
  subject TEXT,
  hour_rate REAL NOT NULL DEFAULT 0,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  hours REAL NOT NULL,
  class TEXT,
  division TEXT,
  subject TEXT,
  teacher_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT UNIQUE NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class TEXT NOT NULL,
  division TEXT NOT NULL,
  medium TEXT NOT NULL,
  academic_year_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(class, division, medium, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_adm ON payments(admission_no);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable(teacher_id);
`);

if (isNew) {
  console.log('Created new database at', DB_PATH);
}

// Migration: add remark column for imported student notes (safe no-op if it already exists)
try { db.exec("ALTER TABLE students ADD COLUMN remark TEXT"); } catch (e) { /* column already exists */ }

// Migration: scope students and timetable to an academic year
try { db.exec("ALTER TABLE students ADD COLUMN academic_year_id INTEGER"); } catch (e) { /* already exists */ }
try { db.exec("ALTER TABLE timetable ADD COLUMN academic_year_id INTEGER"); } catch (e) { /* already exists */ }

// Migration: an older "classes" table (from before academic years existed) has
// a UNIQUE(class, division, medium) constraint with no year column, which
// would wrongly block the same class from being re-added in a new year.
// Detect that and rebuild the table with the year-aware constraint, keeping data.
{
  const hasYearCol = db.prepare("PRAGMA table_info(classes)").all().some(c => c.name === 'academic_year_id');
  if (!hasYearCol) {
    db.exec("ALTER TABLE classes ADD COLUMN academic_year_id INTEGER");
  }
  const legacyUniqueIndex = db.prepare("PRAGMA index_list(classes)").all().some(idx => {
    if (!idx.unique) return false;
    const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all().map(c => c.name);
    return !cols.includes('academic_year_id');
  });
  if (legacyUniqueIndex) {
    db.exec(`
      CREATE TABLE classes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class TEXT NOT NULL,
        division TEXT NOT NULL,
        medium TEXT NOT NULL,
        academic_year_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(class, division, medium, academic_year_id)
      );
      INSERT INTO classes_new (id, class, division, medium, academic_year_id, created_at)
        SELECT id, class, division, medium, academic_year_id, created_at FROM classes;
      DROP TABLE classes;
      ALTER TABLE classes_new RENAME TO classes;
    `);
  }
}

// Work out today's academic year label the same way the app names new ones,
// e.g. Aug 2026 -> "2026-27" (year rolls over in June).
function defaultAcademicYearLabel(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const startYear = m >= 6 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// Ensure at least one academic year exists, and backfill any pre-existing
// rows (from before this feature) into it so nothing old goes missing.
let currentYear = db.prepare('SELECT * FROM academic_years WHERE is_current = 1').get();
if (!currentYear) {
  currentYear = db.prepare('SELECT * FROM academic_years ORDER BY id LIMIT 1').get();
  if (currentYear) {
    db.prepare('UPDATE academic_years SET is_current = 1 WHERE id = ?').run(currentYear.id);
  } else {
    const label = defaultAcademicYearLabel();
    const result = db.prepare('INSERT INTO academic_years (label, is_current) VALUES (?, 1)').run(label);
    currentYear = { id: result.lastInsertRowid, label };
  }
}
db.prepare('UPDATE students SET academic_year_id = ? WHERE academic_year_id IS NULL').run(currentYear.id);
db.prepare('UPDATE classes SET academic_year_id = ? WHERE academic_year_id IS NULL').run(currentYear.id);
db.prepare('UPDATE timetable SET academic_year_id = ? WHERE academic_year_id IS NULL').run(currentYear.id);

// Weekly test marks
db.exec(`
CREATE TABLE IF NOT EXISTS weekly_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_name TEXT NOT NULL,
  class TEXT,
  subject TEXT,
  topic TEXT,
  test_date TEXT NOT NULL,
  max_marks REAL NOT NULL DEFAULT 20,
  academic_year_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_test_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_test_id INTEGER NOT NULL,
  admission_no TEXT NOT NULL,
  marks REAL,
  is_absent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (weekly_test_id) REFERENCES weekly_tests(id) ON DELETE CASCADE,
  UNIQUE(weekly_test_id, admission_no)
);

CREATE INDEX IF NOT EXISTS idx_wtm_test ON weekly_test_marks(weekly_test_id);
CREATE INDEX IF NOT EXISTS idx_wtm_adm ON weekly_test_marks(admission_no);
`);

// Hot Seat — per-session classroom observation records
db.exec(`
CREATE TABLE IF NOT EXISTS hot_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT NOT NULL,
  date TEXT NOT NULL,
  subject TEXT,
  teacher TEXT,
  performance TEXT,
  notes_completed INTEGER NOT NULL DEFAULT 0,
  notebook_neat INTEGER NOT NULL DEFAULT 0,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  good_attention_span INTEGER NOT NULL DEFAULT 0,
  no_notebook INTEGER NOT NULL DEFAULT 0,
  no_textbook INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  parent_feedback TEXT,
  academic_year_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hotseat_adm ON hot_seats(admission_no);
CREATE INDEX IF NOT EXISTS idx_hotseat_date ON hot_seats(date);
`);

// Administrator login
db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

module.exports = db;
