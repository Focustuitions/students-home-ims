const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { requireAuth, cleanExpiredSessions } = require('./db/auth');
const { cleanExpiredParentSessions } = require('./db/parentAuth');
const { cleanExpiredTeacherSessions } = require('./db/teacherAuth');

const app = express();
// Hostinger sits behind a reverse proxy; trust one proxy hop so login throttling uses visitor IPs.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

cleanExpiredSessions();
cleanExpiredParentSessions();
cleanExpiredTeacherSessions();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication endpoints and health check are the only ones open to the public
app.use('/api/auth', require('./routes/auth'));
// Parent endpoints establish their own limited session and must be mounted before admin-only APIs.
app.use('/api/parents', require('./routes/parents'));
// Teacher login and limited portal APIs use a separate teacher session, not admin or parent sessions.
app.use('/api/teacher-auth', require('./routes/teacher-auth'));
app.use('/api/teacher-portal', require('./routes/teacher-portal'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Everything else requires a logged-in administrator
app.use('/api', requireAuth);

app.use('/api/students', require('./routes/students'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/teacher-accounts', require('./routes/teacher-accounts'));
app.use('/api/timetable', require('./routes/timetable'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/academic-years', require('./routes/academic-years'));
app.use('/api/weekly-tests', require('./routes/weekly-tests'));
app.use('/api/mark-entry', require('./routes/mark-entry'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/late-arrivals', require('./routes/late-arrivals'));
app.use('/api/term-exams', require('./routes/term-exams'));
app.use('/api/hot-seats', require('./routes/hot-seats'));
app.use('/api/import', require('./routes/import'));

app.listen(PORT, () => {
  console.log(`Institution Management System running at http://localhost:${PORT}`);
});
