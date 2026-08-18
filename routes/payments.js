const express = require('express');
const router = express.Router();
const db = require('../db/database');

// List all payments (history), newest first, with optional search
router.get('/', (req, res) => {
  const { q } = req.query;
  let sql = `SELECT p.*, s.name as student_name, s.class, s.division
             FROM payments p JOIN students s ON s.admission_no = p.admission_no`;
  const params = [];
  if (q) {
    sql += ' WHERE p.admission_no LIKE ? OR s.name LIKE ? OR p.receipt_no LIKE ?';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY p.payment_date DESC, p.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// Suggests the next receipt number: one more than the highest purely-numeric
// receipt on file (non-numeric receipts, e.g. opening-balance imports, are ignored).
router.get('/next-receipt-no', (req, res) => {
  const rows = db.prepare('SELECT receipt_no FROM payments').all();
  let maxNum = 0;
  let widestNumeric = '';
  rows.forEach(r => {
    if (/^\d+$/.test(r.receipt_no)) {
      const n = parseInt(r.receipt_no, 10);
      if (n > maxNum) {
        maxNum = n;
        widestNumeric = r.receipt_no;
      }
    }
  });
  let next = String(maxNum + 1);
  if (widestNumeric.length > next.length) {
    next = next.padStart(widestNumeric.length, '0');
  }
  res.json({ next_receipt_no: next });
});

// Record a payment
router.post('/', (req, res) => {
  const { admission_no, receipt_no, amount, payment_date } = req.body;
  if (!admission_no || !receipt_no || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(admission_no);
  if (!student) return res.status(404).json({ error: 'No student with that admission number' });

  const stmt = db.prepare(`INSERT INTO payments (admission_no, receipt_no, amount, payment_date)
    VALUES (?, ?, ?, ?)`);
  const result = stmt.run(
    admission_no,
    receipt_no,
    Number(amount),
    payment_date || new Date().toISOString().slice(0, 10)
  );
  res.status(201).json({ message: 'Payment recorded', id: result.lastInsertRowid });
});

// Update a payment
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Payment not found' });
  const { receipt_no, amount, payment_date } = req.body;
  db.prepare('UPDATE payments SET receipt_no=?, amount=?, payment_date=? WHERE id=?').run(
    receipt_no ?? existing.receipt_no,
    amount !== undefined ? Number(amount) : existing.amount,
    payment_date ?? existing.payment_date,
    req.params.id
  );
  res.json({ message: 'Payment updated' });
});

// Single payment, joined with student details — used to render a printable receipt
router.get('/:id/receipt', (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(payment.admission_no);
  if (!student) return res.status(404).json({ error: 'Student not found for this payment' });
  const paidRow = db.prepare('SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE admission_no = ?').get(payment.admission_no);
  const balance = Math.max(student.net_fees - paidRow.paid, 0);
  res.json({
    receipt_no: payment.receipt_no,
    amount: payment.amount,
    payment_date: payment.payment_date,
    admission_no: student.admission_no,
    name: student.name,
    class: student.class,
    division: student.division,
    net_fees: student.net_fees,
    total_paid: paidRow.paid,
    balance,
  });
});

// Delete a payment
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Payment not found' });
  res.json({ message: 'Payment deleted' });
});

module.exports = router;
