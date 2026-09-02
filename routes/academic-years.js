const express = require('express');
const router = express.Router();
const db = require('../db/database');

// List all academic years, most recent label first, with a quick record count
router.get('/', (req, res) => {
  const years = db.prepare('SELECT * FROM academic_years ORDER BY label DESC').all();
  const withCounts = years.map(y => ({
    ...y,
    student_count: db.prepare('SELECT COUNT(*) as c FROM students WHERE academic_year_id = ?').get(y.id).c,
  }));
  res.json(withCounts);
});

// Add a new academic year (e.g. "2027-28")
router.post('/', (req, res) => {
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'A label like "2027-28" is required' });
  try {
    const result = db.prepare('INSERT INTO academic_years (label, is_current) VALUES (?, 0)').run(label.trim());
    res.status(201).json({ message: 'Academic year added', id: result.lastInsertRowid, label: label.trim() });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'That academic year already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Make an academic year the default everyone starts on
router.put('/:id/activate', (req, res) => {
  const year = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(req.params.id);
  if (!year) return res.status(404).json({ error: 'Academic year not found' });
  db.prepare('UPDATE academic_years SET is_current = 0').run();
  db.prepare('UPDATE academic_years SET is_current = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Academic year set as default' });
});

// Delete an academic year, but only if nothing is filed under it
router.delete('/:id', (req, res) => {
  const year = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(req.params.id);
  if (!year) return res.status(404).json({ error: 'Academic year not found' });
  const counts = {
    students: db.prepare('SELECT COUNT(*) as c FROM students WHERE academic_year_id = ?').get(req.params.id).c,
    classes: db.prepare('SELECT COUNT(*) as c FROM classes WHERE academic_year_id = ?').get(req.params.id).c,
    timetable: db.prepare('SELECT COUNT(*) as c FROM timetable WHERE academic_year_id = ?').get(req.params.id).c,
  };
  if (counts.students + counts.classes + counts.timetable > 0) {
    return res.status(400).json({ error: `Can't delete — this year still has ${counts.students} student(s), ${counts.classes} class(es) and ${counts.timetable} timetable entr(ies) on file.` });
  }
  db.prepare('DELETE FROM academic_years WHERE id = ?').run(req.params.id);
  res.json({ message: 'Academic year deleted' });
});

module.exports = router;
