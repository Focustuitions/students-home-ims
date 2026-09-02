const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

router.get('/', (req, res) => {
  const yearId = resolveYearId(req.query.academic_year_id);
  const sql = 'SELECT * FROM classes WHERE academic_year_id = ? ORDER BY class DESC, division ASC';
  res.json(db.prepare(sql).all(yearId));
});

router.post('/', (req, res) => {
  const { class: cls, division, medium, academic_year_id } = req.body;
  if (!cls || !division || !medium) return res.status(400).json({ error: 'Class, division and medium are required' });
  const yearId = resolveYearId(academic_year_id);
  try {
    const result = db.prepare('INSERT INTO classes (class, division, medium, academic_year_id) VALUES (?, ?, ?, ?)').run(cls, division, medium, yearId);
    res.status(201).json({ message: 'Class added', id: result.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'This class/division/medium already exists for this academic year' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Class not found' });
  res.json({ message: 'Class deleted' });
});

module.exports = router;
