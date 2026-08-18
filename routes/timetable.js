const express = require('express');
const router = express.Router();
const db = require('../db/database');

function calcHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight guard
  return Math.round((mins / 60) * 100) / 100;
}

router.get('/', (req, res) => {
  const { date, teacher_id, class: cls } = req.query;
  let sql = `SELECT t.*, te.name as teacher_name, te.subject as teacher_subject
             FROM timetable t JOIN teachers te ON te.id = t.teacher_id WHERE 1=1`;
  const params = [];
  if (date) { sql += ' AND t.date = ?'; params.push(date); }
  if (teacher_id) { sql += ' AND t.teacher_id = ?'; params.push(teacher_id); }
  if (cls) { sql += ' AND t.class = ?'; params.push(cls); }
  sql += ' ORDER BY t.date DESC, t.start_time ASC';
  res.json(db.prepare(sql).all(...params));
});

// Create a timetable entry. If teacher_id is 'new', a teacher record is created first (name/subject/hour_rate/phone in body)
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.date || !b.start_time || !b.end_time) {
    return res.status(400).json({ error: 'Date, start time and end time are required' });
  }

  let teacher_id = b.teacher_id;
  if (teacher_id === 'new') {
    if (!b.new_teacher_name) return res.status(400).json({ error: 'New teacher name is required' });
    const result = db.prepare(`INSERT INTO teachers (name, classes_handled, subject, hour_rate, phone)
      VALUES (?, ?, ?, ?, ?)`).run(
      b.new_teacher_name,
      b.new_teacher_classes || b.class || '',
      b.new_teacher_subject || b.subject || '',
      Number(b.new_teacher_hour_rate) || 0,
      b.new_teacher_phone || ''
    );
    teacher_id = result.lastInsertRowid;
  }

  if (!teacher_id) return res.status(400).json({ error: 'Teacher is required' });

  const hours = calcHours(b.start_time, b.end_time);
  const result = db.prepare(`INSERT INTO timetable (date, start_time, end_time, hours, class, division, subject, teacher_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    b.date, b.start_time, b.end_time, hours, b.class || '', b.division || '', b.subject || '', teacher_id
  );
  res.status(201).json({ message: 'Timetable entry added, hours logged to teacher worklog', id: result.lastInsertRowid, teacher_id, hours });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM timetable WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const b = req.body;
  const start_time = b.start_time ?? existing.start_time;
  const end_time = b.end_time ?? existing.end_time;
  const hours = calcHours(start_time, end_time);
  db.prepare(`UPDATE timetable SET date=?, start_time=?, end_time=?, hours=?, class=?, division=?, subject=?, teacher_id=? WHERE id=?`).run(
    b.date ?? existing.date, start_time, end_time, hours,
    b.class ?? existing.class, b.division ?? existing.division, b.subject ?? existing.subject,
    b.teacher_id ?? existing.teacher_id, req.params.id
  );
  res.json({ message: 'Timetable entry updated' });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM timetable WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Entry not found' });
  res.json({ message: 'Timetable entry deleted' });
});

module.exports = router;
