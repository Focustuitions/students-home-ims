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

CREATE INDEX IF NOT EXISTS idx_payments_adm ON payments(admission_no);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable(teacher_id);
`);

if (isNew) {
  console.log('Created new database at', DB_PATH);
}

// Migration: add remark column for imported student notes (safe no-op if it already exists)
try { db.exec("ALTER TABLE students ADD COLUMN remark TEXT"); } catch (e) { /* column already exists */ }

module.exports = db;
