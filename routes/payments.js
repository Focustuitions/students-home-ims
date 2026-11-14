const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveYearId } = require('../db/academicYear');

// Keep the receipt sequence separately from payment history. This allows an
// explicitly chosen receipt number to control the next suggestion, even when
// that number is lower than an older/historical receipt number.
db.exec(`
  CREATE TABLE IF NOT EXISTS receipt_sequence (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_numeric_receipt TEXT NOT NULL DEFAULT '0',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

function highestNumericReceiptOnFile() {
  const rows = db.prepare('SELECT receipt_no FROM payments').all();
  let maxNum = 0n;
  let widestNumeric = '0';
  for (const row of rows) {
    const value = String(row.receipt_no ?? '');
    if (!/^\d+$/.test(value)) continue;
    const num = BigInt(value);
    if (num > maxNum) {
      maxNum = num;
      widestNumeric = value;
    }
  }
  return widestNumeric;
}

// First-run migration for existing databases: start from the highest existing
// numeric receipt. Once initialized, manual receipt-number choices drive it.
if (!db.prepare('SELECT id FROM receipt_sequence WHERE id = 1').get()) {
  db.prepare(`INSERT INTO receipt_sequence (id, last_numeric_receipt)
              VALUES (1, ?)`)
    .run(highestNumericReceiptOnFile());
}

function updateReceiptSequence(receiptNo) {
  const value = String(receiptNo ?? '').trim();
  // Non-numeric labels (for example, OB- entries) do not affect numbering.
  if (!/^\d+$/.test(value)) return;
  db.prepare(`INSERT INTO receipt_sequence (id, last_numeric_receipt, updated_at)
              VALUES (1, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                last_numeric_receipt = excluded.last_numeric_receipt,
                updated_at = excluded.updated_at`)
    .run(value);
}

function nextReceiptNumber(lastReceiptNo) {
  const current = String(lastReceiptNo ?? '0');
  if (!/^\d+$/.test(current)) return '1';
  let next = String(BigInt(current) + 1n);
  if (current.length > next.length) next = next.padStart(current.length, '0');
  return next;
}

// List all payments (history), newest first, with optional search, year and limit
router.get('/', (req, res) => {
  const { q, academic_year_id, limit } = req.query;
  let sql = `SELECT p.*, s.name as student_name, s.class, s.division
             FROM payments p JOIN students s ON s.admission_no = p.admission_no WHERE 1=1`;
  const params = [];
  const yearId = resolveYearId(academic_year_id);
  if (yearId) { sql += ' AND s.academic_year_id = ?'; params.push(yearId); }
  if (q) {
    sql += ' AND (p.admission_no LIKE ? OR s.name LIKE ? OR p.receipt_no LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY p.payment_date DESC, p.id DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
  res.json(db.prepare(sql).all(...params));
});

// Suggest one more than the last saved numeric receipt number. The sequence
// is initially seeded from existing history, then follows a user's manually
// chosen receipt number after the payment is saved or a receipt is renumbered.
router.get('/next-receipt-no', (req, res) => {
  const sequence = db.prepare(
    'SELECT last_numeric_receipt FROM receipt_sequence WHERE id = 1'
  ).get();
  res.json({ next_receipt_no: nextReceiptNumber(sequence?.last_numeric_receipt) });
});

// Record a payment
router.post('/', (req, res) => {
  const { admission_no, receipt_no, amount, payment_date } = req.body;
  if (!admission_no || !receipt_no || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const student = db.prepare('SELECT * FROM students WHERE admission_no = ?').get(admission_no);
  if (!student) return res.status(404).json({ error: 'No student with that admission number' });

  const savePayment = db.transaction(() => {
    const result = db.prepare(`INSERT INTO payments (admission_no, receipt_no, amount, payment_date)
      VALUES (?, ?, ?, ?)`).run(
      admission_no,
      String(receipt_no).trim(),
      Number(amount),
      payment_date || new Date().toISOString().slice(0, 10)
    );
    updateReceiptSequence(receipt_no);
    return result;
  });
  const result = savePayment();
  res.status(201).json({ message: 'Payment recorded', id: result.lastInsertRowid });
});

// Update a payment
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Payment not found' });
  const { receipt_no, amount, payment_date } = req.body;
  const saveUpdatedPayment = db.transaction(() => {
    db.prepare('UPDATE payments SET receipt_no=?, amount=?, payment_date=? WHERE id=?').run(
      receipt_no ?? existing.receipt_no,
      amount !== undefined ? Number(amount) : existing.amount,
      payment_date ?? existing.payment_date,
      req.params.id
    );
    // Only renumbering an existing receipt should change the sequence.
    // Editing its amount/date alone must not reset numbering to an older receipt.
    if (receipt_no !== undefined && receipt_no !== null &&
        String(receipt_no).trim() !== String(existing.receipt_no).trim()) {
      updateReceiptSequence(receipt_no);
    }
  });
  saveUpdatedPayment();
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

// Delete a payment receipt. This endpoint is mounted behind requireAuth in
// server.js, so only an authenticated administrator can remove a ledger entry.
// Keep receipt_sequence unchanged after deletion so a deleted receipt number is
// not suggested again and the receipt sequence never moves backwards.
router.delete('/:id', (req, res) => {
  const paymentId = Number(req.params.id);
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ error: 'Invalid payment ID' });
  }

  const existing = db.prepare(`
    SELECT p.id, p.receipt_no, p.admission_no, p.amount, p.payment_date,
           s.name AS student_name
    FROM payments p
    LEFT JOIN students s ON s.admission_no = p.admission_no
    WHERE p.id = ?
  `).get(paymentId);
  if (!existing) return res.status(404).json({ error: 'Payment not found' });

  const deletePayment = db.transaction(id =>
    db.prepare('DELETE FROM payments WHERE id = ?').run(id)
  );
  const result = deletePayment(paymentId);
  if (result.changes === 0) return res.status(404).json({ error: 'Payment not found' });

  // Paid totals and pending balances are calculated from the payments table,
  // so all student/admin/parent fee summaries reflect the deletion immediately.
  res.json({ message: 'Payment deleted', deleted: existing });
});

module.exports = router;
