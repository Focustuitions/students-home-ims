const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { requireAuth, cleanExpiredSessions } = require('./db/auth');

const app = express();
const PORT = process.env.PORT || 3000;

cleanExpiredSessions();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication endpoints and health check are the only ones open to the public
app.use('/api/auth', require('./routes/auth'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Everything else requires a logged-in administrator
app.use('/api', requireAuth);

app.use('/api/students', require('./routes/students'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/timetable', require('./routes/timetable'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/academic-years', require('./routes/academic-years'));
app.use('/api/weekly-tests', require('./routes/weekly-tests'));
app.use('/api/hot-seats', require('./routes/hot-seats'));
app.use('/api/import', require('./routes/import'));

app.listen(PORT, () => {
  console.log(`Institution Management System running at http://localhost:${PORT}`);
});
