const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

const CHECKLIST_FIELDS = ['notes_completed', 'notebook_neat', 'questions_answered', 'good_attention_span', 'no_notebook', 'no_textbook'];

function toBit(v) { return v ? 1 : 0; }

// List / search hot seat records for the active academic year
router.get('/', (req, res) => {
  const { q, academic_year_id } = req.query;
  const yearId = resolveYearId(academic_year_id);
  let sql = `SELECT h.*, s.name as student_name, s.class as student_class, s.division as student_division
             FROM hot_seats h JOIN students s ON s.admission_no = h.admission_no WHERE 1=1`;
  const params = [];
  if (yearId) { sql += ' AND h.academic_year_id = ?'; params.push(yearId); }
  if (q) {
    sql += ' AND (h.admission_no LIKE ? OR s.name LIKE ? OR h.subject LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY h.date DESC, h.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// Single record
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT h.*, s.name as student_name, s.class as student_class, s.division as student_division, s.school as student_school
    FROM hot_seats h JOIN students s ON s.admission_no = h.admission_no WHERE h.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Hot Seat record not found' });
  res.json(row);
});

// Create a record
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.admission_no || !b.date) return res.status(400).json({ error: 'Admission No. and Date are required' });
  const student = db.prepare('SELECT admission_no FROM students WHERE admission_no = ?').get(b.admission_no);
  if (!student) return res.status(404).json({ error: 'No student with that admission number' });

  const academic_year_id = resolveYearId(b.academic_year_id);
  const stmt = db.prepare(`INSERT INTO hot_seats
    (admission_no, date, subject, teacher, performance, notes_completed, notebook_neat, questions_answered,
     good_attention_span, no_notebook, no_textbook, remarks, parent_feedback, academic_year_id)
    VALUES (@admission_no, @date, @subject, @teacher, @performance, @notes_completed, @notebook_neat, @questions_answered,
     @good_attention_span, @no_notebook, @no_textbook, @remarks, @parent_feedback, @academic_year_id)`);
  const result = stmt.run({
    admission_no: b.admission_no,
    date: b.date,
    subject: b.subject || '',
    teacher: b.teacher || '',
    performance: b.performance || '',
    notes_completed: toBit(b.notes_completed),
    notebook_neat: toBit(b.notebook_neat),
    questions_answered: toBit(b.questions_answered),
    good_attention_span: toBit(b.good_attention_span),
    no_notebook: toBit(b.no_notebook),
    no_textbook: toBit(b.no_textbook),
    remarks: b.remarks || '',
    parent_feedback: b.parent_feedback || '',
    academic_year_id,
  });
  res.status(201).json({ message: 'Hot Seat record added', id: result.lastInsertRowid });
});

// Update a record
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM hot_seats WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Hot Seat record not found' });
  const b = req.body;
  const merged = { ...existing, ...b };
  CHECKLIST_FIELDS.forEach(f => { merged[f] = toBit(b[f] !== undefined ? b[f] : existing[f]); });
  db.prepare(`UPDATE hot_seats SET
    date=@date, subject=@subject, teacher=@teacher, performance=@performance,
    notes_completed=@notes_completed, notebook_neat=@notebook_neat, questions_answered=@questions_answered,
    good_attention_span=@good_attention_span, no_notebook=@no_notebook, no_textbook=@no_textbook,
    remarks=@remarks, parent_feedback=@parent_feedback
    WHERE id=@id`).run({ ...merged, id: req.params.id });
  res.json({ message: 'Hot Seat record updated' });
});

// Delete a record
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM hot_seats WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Hot Seat record not found' });
  res.json({ message: 'Hot Seat record deleted' });
});

module.exports = router;
