const express = require('express');
const router = express.Router();
const db = require('../db/database');

db.exec(`CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class TEXT NOT NULL,
  division TEXT NOT NULL,
  medium TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(class, division, medium)
)`);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM classes ORDER BY class DESC, division ASC').all());
});

router.post('/', (req, res) => {
  const { class: cls, division, medium } = req.body;
  if (!cls || !division || !medium) return res.status(400).json({ error: 'Class, division and medium are required' });
  try {
    const result = db.prepare('INSERT INTO classes (class, division, medium) VALUES (?, ?, ?)').run(cls, division, medium);
    res.status(201).json({ message: 'Class added', id: result.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'This class/division/medium already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Class not found' });
  res.json({ message: 'Class deleted' });
});

module.exports = router;
