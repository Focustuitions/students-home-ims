const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/students', require('./routes/students'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/timetable', require('./routes/timetable'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/import', require('./routes/import'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Institution Management System running at http://localhost:${PORT}`);
});
