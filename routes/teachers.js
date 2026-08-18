const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/', (req, res) => {
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY name').all();
  const withWorklog = teachers.map(t => {
    const agg = db.prepare('SELECT COALESCE(SUM(hours),0) as total_hours FROM timetable WHERE teacher_id = ?').get(t.id);
    return { ...t, total_hours: agg.total_hours, total_earned: agg.total_hours * t.hour_rate };
  });
  res.json(withWorklog);
});

router.get('/:id', (req, res) => {
  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
  const worklog = db.prepare('SELECT * FROM timetable WHERE teacher_id = ? ORDER BY date DESC, start_time DESC').all(req.params.id);
  const agg = db.prepare('SELECT COALESCE(SUM(hours),0) as total_hours FROM timetable WHERE teacher_id = ?').get(req.params.id);
  res.json({ ...teacher, worklog, total_hours: agg.total_hours, total_earned: agg.total_hours * teacher.hour_rate });
});

router.post('/', (req, res) => {
  const { name, classes_handled, subject, hour_rate, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(`INSERT INTO teachers (name, classes_handled, subject, hour_rate, phone)
    VALUES (?, ?, ?, ?, ?)`).run(name, classes_handled || '', subject || '', Number(hour_rate) || 0, phone || '');
  res.status(201).json({ message: 'Teacher added', id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Teacher not found' });
  const b = req.body;
  db.prepare(`UPDATE teachers SET name=?, classes_handled=?, subject=?, hour_rate=?, phone=? WHERE id=?`).run(
    b.name ?? existing.name,
    b.classes_handled ?? existing.classes_handled,
    b.subject ?? existing.subject,
    b.hour_rate !== undefined ? Number(b.hour_rate) : existing.hour_rate,
    b.phone ?? existing.phone,
    req.params.id
  );
  res.json({ message: 'Teacher updated' });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Teacher not found' });
  res.json({ message: 'Teacher deleted' });
});

module.exports = router;
