const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const configuredDbPath = process.env.DB_PATH;
const DB_PATH = configuredDbPath
  ? path.resolve(configuredDbPath)
  : path.join(__dirname, 'institution.db');

// In production, refuse to silently create a fresh, empty database when the
// persistent database path is missing or misconfigured.
if (process.env.NODE_ENV === 'production' && !configuredDbPath) {
  throw new Error('DB_PATH must point to the existing persistent SQLite database in production.');
}
if (process.env.NODE_ENV === 'production' &&
    (DB_PATH.includes(`${path.sep}hbuilds${path.sep}`) || DB_PATH.includes(`${path.sep}public_html${path.sep}`))) {
  throw new Error('DB_PATH must be outside Hostinger deployment folders and the public web root.');
}
if (configuredDbPath) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const isNew = !fs.existsSync(DB_PATH);
if (process.env.NODE_ENV === 'production' && isNew) {
  throw new Error('The configured DB_PATH file does not exist. Refusing to create an empty production database. Upload the verified SQLite backup first.');
}
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

// Student withdrawal/archive metadata. Existing student and fee records remain intact.
try { db.exec("ALTER TABLE students ADD COLUMN withdrawn_at TEXT"); } catch (e) { /* already exists */ }
try { db.exec("ALTER TABLE students ADD COLUMN withdrawal_reason TEXT"); } catch (e) { /* already exists */ }
db.exec(`
CREATE TABLE IF NOT EXISTS student_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_student_status_history_adm ON student_status_history(admission_no, effective_date);
`);

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

// Mark-entry session status: tests created/continued through Quick Mark Entry
// stay resumable until the administrator explicitly presses Finish. Existing
// weekly tests default to completed and can still be reopened from the register.
try { db.exec("ALTER TABLE weekly_tests ADD COLUMN entry_status TEXT NOT NULL DEFAULT 'completed'"); } catch (e) { /* already exists */ }

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

// Impositions and other student assignments. Teacher choices are stored per
// subject so administrators can add a new teacher without changing the staff
// payroll/timetable profile records.
db.exec(`
CREATE TABLE IF NOT EXISTS assignment_teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject, teacher_name)
);

CREATE TABLE IF NOT EXISTS student_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_class TEXT NOT NULL,
  student_division TEXT NOT NULL,
  assignment_type TEXT NOT NULL DEFAULT 'Imposition',
  subject TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  teacher_account_id INTEGER,
  given_date TEXT NOT NULL,
  due_date TEXT,
  submission_status TEXT NOT NULL DEFAULT 'Pending',
  submitted_date TEXT,
  submitted_by TEXT,
  details TEXT NOT NULL DEFAULT '',
  academic_year_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_student_assignments_year_date ON student_assignments(academic_year_id, given_date);
CREATE INDEX IF NOT EXISTS idx_student_assignments_adm ON student_assignments(admission_no);
`);
try { db.exec('ALTER TABLE student_assignments ADD COLUMN teacher_account_id INTEGER'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE student_assignments ADD COLUMN due_date TEXT'); } catch (e) { /* already exists */ }
try { db.exec("ALTER TABLE student_assignments ADD COLUMN submission_status TEXT NOT NULL DEFAULT 'Pending'"); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE student_assignments ADD COLUMN submitted_date TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE student_assignments ADD COLUMN submitted_by TEXT'); } catch (e) { /* already exists */ }
// Existing assignments remain pending until an administrator records submission.
db.exec("UPDATE student_assignments SET due_date = date(given_date, '+1 day') WHERE due_date IS NULL OR due_date = ''");
db.exec("UPDATE student_assignments SET submission_status = 'Pending' WHERE submission_status IS NULL OR submission_status = ''");
db.exec('CREATE INDEX IF NOT EXISTS idx_student_assignments_due_status ON student_assignments(academic_year_id, submission_status, due_date)');

// Additional work assigned to students who arrive late. Kept separately from
// subject/teacher assignments, but included in the same student performance report.
db.exec(`
CREATE TABLE IF NOT EXISTS late_arrival_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_class TEXT NOT NULL,
  student_division TEXT NOT NULL,
  late_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT 'Additional work assigned for late arrival',
  submission_status TEXT NOT NULL DEFAULT 'Pending',
  submitted_date TEXT,
  submitted_by TEXT,
  academic_year_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_late_arrival_year_date ON late_arrival_works(academic_year_id, late_date);
CREATE INDEX IF NOT EXISTS idx_late_arrival_admission ON late_arrival_works(admission_no);
CREATE INDEX IF NOT EXISTS idx_late_arrival_due_status ON late_arrival_works(academic_year_id, submission_status, due_date);
`);


const defaultAssignmentTeachers = {
  English: ['SN', 'NF', 'MA'],
  Hindi: ['KR', 'AR'],
  History: ['UN', 'MN', 'SH'],
  Geography: ['SQ'],
  Physics: ['RM', 'UK'],
  Chemistry: ['FZ', 'HK', 'MN'],
  Biology: ['SR', 'SH PKD', 'SH KTR'],
  Mathematics: ['SF', 'SR'],
};
const insertAssignmentTeacher = db.prepare(`
  INSERT OR IGNORE INTO assignment_teachers (subject, teacher_name) VALUES (?, ?)
`);
for (const [subject, names] of Object.entries(defaultAssignmentTeachers)) {
  for (const name of names) insertAssignmentTeacher.run(subject, name);
}

// Teacher Portal accounts are separate from payroll/timetable teacher profiles.
// Passwords are stored as bcrypt hashes; initial credentials are issued once by Admin.
db.exec(`
CREATE TABLE IF NOT EXISTS teacher_portal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  teacher_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  subjects_json TEXT NOT NULL DEFAULT '[]',
  classes_json TEXT NOT NULL DEFAULT '[]',
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teacher_portal_sessions (
  token TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teacher_portal_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_teacher_portal_sessions_expires ON teacher_portal_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_teacher_portal_sessions_teacher ON teacher_portal_sessions(teacher_id);
CREATE TABLE IF NOT EXISTS teacher_login_attempts (
  key_hash TEXT PRIMARY KEY,
  window_started_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0
);
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

-- Parent portal accounts use the registered mother's phone as the initial password.
-- The first successful login must set a private password before seeing student records.
CREATE TABLE IF NOT EXISTS parent_accounts (
  admission_no TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parent_sessions (
  token TEXT PRIMARY KEY,
  admission_no TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_parent_sessions_expires ON parent_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_parent_sessions_adm ON parent_sessions(admission_no);

-- Failed-login counters store hashed IP/account keys, not raw IP addresses or phone numbers.
CREATE TABLE IF NOT EXISTS parent_login_attempts (
  key_hash TEXT PRIMARY KEY,
  window_started_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0
);
`);

// Term examinations (multi-subject, per-class marklists)
db.exec(`
CREATE TABLE IF NOT EXISTS term_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_name TEXT NOT NULL,
  class TEXT,
  exam_date TEXT NOT NULL,
  academic_year_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(exam_name, class, exam_date, academic_year_id)
);

CREATE TABLE IF NOT EXISTS term_exam_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_exam_id INTEGER NOT NULL,
  admission_no TEXT NOT NULL,
  subject TEXT NOT NULL,
  marks REAL,
  max_marks REAL NOT NULL DEFAULT 100,
  is_absent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (term_exam_id) REFERENCES term_exams(id) ON DELETE CASCADE,
  UNIQUE(term_exam_id, admission_no, subject)
);

CREATE INDEX IF NOT EXISTS idx_term_marks_exam ON term_exam_marks(term_exam_id);
CREATE INDEX IF NOT EXISTS idx_term_marks_adm ON term_exam_marks(admission_no);
`);

module.exports = db;
