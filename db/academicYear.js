const db = require('./database');

function getCurrentYearId() {
  const row = db.prepare('SELECT id FROM academic_years WHERE is_current = 1').get();
  if (row) return row.id;
  const any = db.prepare('SELECT id FROM academic_years ORDER BY id LIMIT 1').get();
  return any ? any.id : null;
}

// Prefer an explicitly requested year (e.g. from a query param or form field);
// fall back to whichever year is marked current.
function resolveYearId(requested) {
  if (requested !== undefined && requested !== null && requested !== '') {
    const n = Number(requested);
    if (!Number.isNaN(n)) return n;
  }
  return getCurrentYearId();
}

module.exports = { getCurrentYearId, resolveYearId };
