const { resolveYearId } = require('../db/academicYear');

const MAX_STUDENTS = 500;
const MAX_RECORDS = 5000;

function validDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateWindow(body) {
  const fromDate = String(body.window_from || '').trim();
  const toDate = String(body.window_to || '').trim();
  if (!validDate(fromDate) || !validDate(toDate)) return { error: 'Enter a valid start and end date for the submission window.' };
  if (fromDate > toDate) return { error: 'The submission window end date cannot be earlier than the start date.' };
  return { fromDate, toDate, yearId: resolveYearId(body.academic_year_id) };
}

function cleanToken(value) { return String(value || '').trim().toUpperCase(); }
function minPrefix(cls) { return String(cls) === '10' ? 3 : (['8', '9'].includes(String(cls)) ? 4 : 3); }

function parseAndResolveAdmissionNumbers(db, raw, yearId) {
  const tokens = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/)).map(cleanToken).filter(Boolean);
  if (!tokens.length) return { error: 'Enter at least one Admission Number.' };
  if (tokens.length > MAX_STUDENTS) return { error: `A batch can contain at most ${MAX_STUDENTS} Admission Numbers.` };

  const seenTokens = new Set();
  const seenStudents = new Set();
  const rows = tokens.map(token => {
    if (seenTokens.has(token)) return { input: token, status: 'duplicate_input', message: 'This Admission Number is repeated in the list.' };
    seenTokens.add(token);

    const numeric = /^\d+$/.test(token);
    const matches = numeric
      ? db.prepare(`SELECT admission_no, name, class, division FROM students
          WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
            AND UPPER(SUBSTR(admission_no, 1, ?)) = ?
          ORDER BY admission_no COLLATE NOCASE LIMIT 101`).all(yearId, token.length, token)
      : db.prepare(`SELECT admission_no, name, class, division FROM students
          WHERE academic_year_id = ? AND COALESCE(status, 'Active') <> 'Withdrawn'
            AND UPPER(admission_no) = ?
          ORDER BY admission_no COLLATE NOCASE LIMIT 101`).all(yearId, token);

    if (!matches.length) return { input: token, status: 'not_found', message: 'No active student matches this Admission Number.' };
    const eligible = numeric ? matches.filter(st => token.length >= minPrefix(st.class)) : matches;
    if (!eligible.length) {
      const required = Math.min(...matches.map(st => minPrefix(st.class)));
      return { input: token, status: 'invalid', message: `Enter at least ${required} leading digits for this class, or use the full Admission Number.` };
    }
    if (eligible.length > 1 || matches.length > 100) {
      const classes = [...new Set(eligible.map(st => `Class ${st.class} - ${st.division}`))].join(', ');
      return { input: token, status: 'ambiguous', message: `This number matches more than one student (${classes}). Enter the full Admission Number.` };
    }
    const student = eligible[0];
    if (seenStudents.has(student.admission_no)) {
      return { input: token, admission_no: student.admission_no, name: student.name, class: student.class, division: student.division,
        status: 'duplicate_input', message: 'This student is already included in the list.' };
    }
    seenStudents.add(student.admission_no);
    return { input: token, admission_no: student.admission_no, name: student.name, class: student.class, division: student.division,
      status: 'resolved', message: 'Student matched.' };
  });

  return { rows, admissionNos: rows.filter(r => r.status === 'resolved').map(r => r.admission_no) };
}

function countStatuses(rows) {
  return rows.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {});
}

function getTodayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

module.exports = {
  MAX_STUDENTS,
  MAX_RECORDS,
  validDate,
  validateWindow,
  parseAndResolveAdmissionNumbers,
  countStatuses,
  getTodayLocal,
};
