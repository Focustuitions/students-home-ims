const API = '/api';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const todayStr = () => new Date().toISOString().slice(0, 10);
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ---------- toast ----------
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- fetch helper ----------
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Not logged in'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

async function apiUpload(path, file, extraFields = {}) {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
  const res = await fetch(API + path, { method: 'POST', body: formData });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Not logged in'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
  return data;
}


// ---------- receipt deletion ----------
async function deletePaymentReceipt(payment, onDeleted) {
  const studentName = payment.student_name || payment.name || 'this student';
  const admissionNo = payment.admission_no || '';
  const confirmed = confirm(
    `Permanently delete receipt ${payment.receipt_no} for ${studentName}${admissionNo ? ` (${admissionNo})` : ''}?\n\n` +
    `Amount: ${money(payment.amount)}\nDate: ${payment.payment_date}\n\n` +
    `This will remove the payment from the fee ledger and recalculate the student's total paid and pending balance. ` +
    `The deletion cannot be undone. The receipt number sequence will not be moved backwards.`
  );
  if (!confirmed) return false;

  try {
    await api('/payments/' + encodeURIComponent(payment.id), { method: 'DELETE' });
    toast(`Receipt ${payment.receipt_no} deleted. Student fee balance has been recalculated.`);
    if (typeof onDeleted === 'function') {
      try { await onDeleted(); }
      catch (refreshError) { toast('Receipt deleted, but this page could not refresh. Reload the page.', true); }
    }
    return true;
  } catch (err) {
    toast(err.message || 'Could not delete receipt.', true);
    return false;
  }
}

function wirePaymentDeleteButtons(container, getPayment, onDeleted) {
  $$('[data-delete-payment-id]', container).forEach(button => {
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const payment = getPayment(button.dataset.deletePaymentId);
      if (!payment) { toast('Payment record not found. Refresh the page and try again.', true); return; }
      button.disabled = true;
      const deleted = await deletePaymentReceipt(payment, onDeleted);
      if (!deleted) button.disabled = false;
    });
  });
}

// ---------- academic year state ----------
let academicYears = [];
let currentYearId = null;

function yearQS(extra = '') {
  const parts = [];
  if (currentYearId) parts.push(`academic_year_id=${currentYearId}`);
  if (extra) parts.push(extra);
  return parts.length ? '?' + parts.join('&') : '';
}

async function loadAcademicYears() {
  academicYears = await api('/academic-years');
  const current = academicYears.find(y => y.is_current) || academicYears[0];
  currentYearId = current ? current.id : null;
  renderYearSwitcher();
}

function renderYearSwitcher() {
  const sel = $('#year-switcher');
  if (!sel) return;
  sel.innerHTML = academicYears.map(y =>
    `<option value="${y.id}" ${y.id === currentYearId ? 'selected' : ''}>${y.label}</option>`
  ).join('');
}

async function switchAcademicYear(id) {
  await api(`/academic-years/${id}/activate`, { method: 'PUT' });
  currentYearId = Number(id);
  renderYearSwitcher();
  navigate();
}

async function addAcademicYear() {
  const label = prompt('New academic year (e.g. 2027-28):');
  if (!label || !label.trim()) return;
  try {
    const result = await api('/academic-years', { method: 'POST', body: JSON.stringify({ label: label.trim() }) });
    await loadAcademicYears();
    await switchAcademicYear(result.id);
    toast(`Academic year ${label.trim()} added and set as active.`);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- clock ----------
function tickClock() {
  const el = $('#clock');
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}
tickClock();
setInterval(tickClock, 60000);

// ---------- router ----------
const routes = {
  dashboard: renderDashboard,
  'finance-details': renderFinanceDetails,
  students: renderStudents,
  'withdrawn-students': renderWithdrawnStudents,
  'add-student': () => renderStudentForm(null),
  payment: renderPayment,
  'fee-pending-slips': renderFeePendingSlips,
  'payment-history': renderPaymentHistory,
  classes: renderClasses,
  teachers: renderTeachers,
  'teacher-accounts': renderTeacherPortalAccounts,
  timetable: renderTimetable,
  'mark-entry': renderMarkEntry,
  assignments: renderAssignments,
  'late-arrival-work': renderLateArrivalWork,
  'weekly-tests': renderWeeklyTests,
  'term-exams': renderTermExams,
  'hot-seat': renderHotSeat,
  import: renderImport,
};

function setActiveTab(route) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === route));
}

async function navigate() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  const [base, param] = hash.split('/');

  if (base === 'student') return renderStudentDetail(decodeURIComponent(param));
  if (base === 'edit-student') return renderStudentForm(decodeURIComponent(param));
  if (base === 'edit-payment') { setActiveTab('payment'); return renderPayment(decodeURIComponent(param)); }
  if (base === 'mark-entry' && param) { setActiveTab(base); return renderMarkEntry(decodeURIComponent(param)); }

  setActiveTab(base);
  const fn = routes[base] || renderDashboard;
  try {
    await fn();
  } catch (err) {
    view.innerHTML = `<div class="card"><p>Could not load this page: ${err.message}</p></div>`;
  }
}

window.addEventListener('hashchange', navigate);
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const status = await fetch('/api/auth/status').then(r => r.json());
    if (status.setupNeeded || !status.loggedIn) { location.href = '/login.html'; return; }
    const usernameEl = $('#logged-in-as');
    if (usernameEl) usernameEl.textContent = status.username;
  } catch (err) {
    location.href = '/login.html';
    return;
  }

  document.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-route]');
    if (btn) {
      location.hash = btn.dataset.route;
    }
  });
  $('#year-switcher').addEventListener('change', e => switchAcademicYear(e.target.value));
  $('#add-year-btn').addEventListener('click', addAcademicYear);
  $('#logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
  $('#change-password-btn').addEventListener('click', async () => {
    const currentPassword = prompt('Current password:');
    if (currentPassword === null) return;
    const newPassword = prompt('New password (at least 6 characters):');
    if (newPassword === null) return;
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      toast('Password updated.');
    } catch (err) {
      toast(err.message, true);
    }
  });
  await loadAcademicYears();
  navigate();
});

function useTemplate(id) {
  const tpl = $(id);
  view.innerHTML = '';
  view.appendChild(tpl.content.cloneNode(true));
}

// =====================================================================
// DASHBOARD
// =====================================================================
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning!';
  if (h < 17) return 'Good afternoon!';
  return 'Good evening!';
}

async function renderDashboard() {
  useTemplate('#tpl-dashboard');
  $('#wb-greeting').textContent = timeGreeting();

  const [students, weeklyTests, termExams, topPerformers, pendingAssignments, pendingLateWork] = await Promise.all([
    api('/students' + yearQS()),
    api('/weekly-tests' + yearQS()),
    api('/term-exams' + yearQS()),
    api('/weekly-tests/top-performers' + yearQS('limit=3')),
    api('/assignments/pending' + yearQS()),
    api('/late-arrivals/pending' + yearQS()),
  ]);

  const completedTests = weeklyTests.filter(t =>
    t.entry_status !== 'in_progress' && Number(t.presentCount) > 0 && Number(t.max_marks) > 0 && t.average !== null
  );
  const testedCount = completedTests.reduce((sum, t) => sum + Number(t.presentCount || 0), 0);
  const weightedAverage = testedCount
    ? completedTests.reduce((sum, t) => sum + (Number(t.average) / Number(t.max_marks)) * 100 * Number(t.presentCount || 0), 0) / testedCount
    : null;
  const averageLabel = weightedAverage === null ? '—' : `${Math.round(weightedAverage * 10) / 10}%`;

  $('#academic-stat-row').innerHTML = `
    <div class="stat"><div class="label">Active Students</div><div class="value">${students.length}</div></div>
    <div class="stat"><div class="label">Weekly Tests</div><div class="value">${weeklyTests.length}</div></div>
    <div class="stat"><div class="label">Average Test Score</div><div class="value">${averageLabel}</div></div>
    <div class="stat"><div class="label">Term Exams</div><div class="value">${termExams.length}</div></div>
  `;

  const latestTests = [...weeklyTests]
    .sort((a, b) => String(b.test_date || '').localeCompare(String(a.test_date || '')) || Number(b.id || 0) - Number(a.id || 0))
    .slice(0, 6);
  $('#dashboard-weekly-tests').innerHTML = latestTests.length ? `
    <table>
      <thead><tr><th>Date</th><th>Test</th><th>Class</th><th>Average</th><th>Pass Rate</th></tr></thead>
      <tbody>${latestTests.map(t => {
        const pct = Number(t.max_marks) > 0 && t.average !== null
          ? `${Math.round((Number(t.average) / Number(t.max_marks)) * 1000) / 10}%`
          : '—';
        const testName = t.subject ? `${t.subject}${t.topic ? ` — ${t.topic}` : ''}` : (t.exam_name || 'Weekly Test');
        return `<tr>
          <td>${t.test_date || '—'}</td>
          <td>${testName}${t.entry_status === 'in_progress' ? ' <span class="tag due">In Progress</span>' : ''}</td>
          <td>${t.class ? `Class ${t.class}` : '—'}</td>
          <td><strong>${pct}</strong></td>
          <td>${t.passRate != null ? `${t.passRate}%` : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<p class="empty-row">No weekly test records found for this academic year.</p>`;

  const latestExams = [...termExams]
    .sort((a, b) => String(b.exam_date || '').localeCompare(String(a.exam_date || '')) || Number(b.id || 0) - Number(a.id || 0))
    .slice(0, 6);
  $('#dashboard-term-exams').innerHTML = latestExams.length ? `
    <table>
      <thead><tr><th>Exam</th><th>Class</th><th>Students</th><th>Average</th></tr></thead>
      <tbody>${latestExams.map(e => `<tr>
        <td><span class="dashboard-exam-date">${e.exam_date || '—'}</span><br><strong>${e.exam_name || 'Term Exam'}</strong></td>
        <td>${e.class ? `Class ${e.class}` : '—'}</td>
        <td>${e.studentCount || 0}</td>
        <td><strong>${e.average !== null && e.average !== undefined ? `${e.average}%` : '—'}</strong></td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="empty-row">No term examination records found for this academic year.</p>`;

  const performerClasses = topPerformers.classes || [];
  $('#dashboard-top-performers').innerHTML = performerClasses.length ? `
    <div class="dashboard-performers-grid">
      ${performerClasses.map(cls => `
        <div class="dashboard-performer-class">
          <div class="dashboard-performer-class-title">Class ${cls}</div>
          ${(topPerformers.byClass[cls] || []).map(student => `
            <div class="dashboard-performer-row clickable" onclick="location.hash='student/${encodeURIComponent(student.admission_no)}'">
              <span class="dashboard-performer-rank">${student.rank}</span>
              <span class="dashboard-performer-name">${student.name}<small>${student.class}-${student.division || ''}</small></span>
              <strong>${student.average}%</strong>
            </div>`).join('')}
        </div>`).join('')}
    </div>` : `<p class="empty-row">Top performers will appear after weekly test marks are entered.</p>`;

  const today = todayStr();
  const overdueAssignments = pendingAssignments.filter(row => row.due_date && row.due_date < today).length;
  const overdueLateWork = pendingLateWork.filter(row => row.due_date && row.due_date < today).length;
  $('#dashboard-academic-follow-up').innerHTML = `
    <div class="dashboard-work-item">
      <div class="dashboard-work-copy"><span>Pending Assignments</span><strong>${pendingAssignments.length}</strong><small>${overdueAssignments} overdue</small></div>
      <a class="btn btn-small btn-ghost" href="#assignments">Review</a>
    </div>
    <div class="dashboard-work-item">
      <div class="dashboard-work-copy"><span>Late Arrival Work</span><strong>${pendingLateWork.length}</strong><small>${overdueLateWork} overdue</small></div>
      <a class="btn btn-small btn-ghost" href="#late-arrival-work">Review</a>
    </div>
  `;
}

// =====================================================================
// FINANCE DETAILS — separated from the academic dashboard
// =====================================================================
async function renderFinanceDetails() {
  useTemplate('#tpl-finance-details');
  const [students, payments, teachers, recentPayments] = await Promise.all([
    api('/students' + yearQS()),
    api('/payments' + yearQS()),
    api('/teachers' + yearQS()),
    api('/payments' + yearQS('limit=8')),
  ]);

  const totalCollected = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const totalDue = students.reduce((sum, student) => sum + Number(student.balance || 0), 0);

  $('#finance-stat-row').innerHTML = `
    <div class="stat"><div class="label">Total Students</div><div class="value">${students.length}</div></div>
    <div class="stat"><div class="label">Fees Collected</div><div class="value">${money(totalCollected)}</div></div>
    <div class="stat alert"><div class="label">Fees Pending</div><div class="value">${money(totalDue)}</div></div>
    <div class="stat"><div class="label">Faculty on Roll</div><div class="value">${teachers.length}</div></div>
  `;

  const byClass = {};
  students.forEach(student => {
    const key = `Class ${student.class}`;
    byClass[key] = byClass[key] || { paid: 0, balance: 0, count: 0 };
    byClass[key].paid += Number(student.paid || 0);
    byClass[key].balance += Number(student.balance || 0);
    byClass[key].count += 1;
  });
  const classRows = Object.entries(byClass).sort((a, b) => b[0].localeCompare(a[0]))
    .map(([cls, values]) => `<tr><td>${cls}</td><td>${values.count}</td><td>${money(values.paid)}</td><td>${money(values.balance)}</td></tr>`).join('');
  $('#fee-by-class').innerHTML = students.length
    ? `<table><thead><tr><th>Class</th><th>Students</th><th>Collected</th><th>Pending</th></tr></thead><tbody>${classRows}</tbody></table>`
    : `<p class="empty-row">No students admitted yet.</p>`;

  const topPendingStudents = students
    .map(student => ({ ...student, balance: Math.max(Number(student.balance) || 0, 0) }))
    .filter(student => student.balance > 0)
    .sort((a, b) => b.balance - a.balance || String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 20);
  $('#top-pending-fees').innerHTML = topPendingStudents.length ? `
    <table>
      <thead><tr><th>#</th><th>Adm. No.</th><th>Student</th><th>Class</th><th>Net Fee</th><th>Paid</th><th>Pending</th></tr></thead>
      <tbody>${topPendingStudents.map((student, index) => `
        <tr class="clickable" onclick="location.hash='student/${encodeURIComponent(student.admission_no)}'">
          <td>${index + 1}</td><td class="mono">${student.admission_no}</td><td>${student.name}</td>
          <td>${student.class}-${student.division || ''}</td><td>${money(student.net_fees)}</td>
          <td>${money(student.paid)}</td><td><strong>${money(student.balance)}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table>` : `<p class="empty-row">No students have pending fees for this academic year.</p>`;

  $('#recent-payments').innerHTML = recentPayments.length ? `
    <table>
      <thead><tr><th>Date</th><th>Student</th><th>Class</th><th>Amount</th><th></th></tr></thead>
      <tbody>${recentPayments.map(payment => `
        <tr class="clickable" onclick="location.hash='student/${encodeURIComponent(payment.admission_no)}'">
          <td>${payment.payment_date}</td><td>${payment.student_name}</td><td>${payment.class}-${payment.division}</td><td>${money(payment.amount)}</td>
          <td>
            <a href="/receipt.html?id=${payment.id}" target="_blank" rel="noopener" class="btn-icon" onclick="event.stopPropagation()">Receipt</a>
            <a href="#edit-payment/${payment.id}" class="btn-icon" onclick="event.stopPropagation()">Edit</a>
            <button type="button" class="btn-icon btn-delete-receipt" data-delete-payment-id="${payment.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>` : `<p class="empty-row">No payments recorded yet.</p>`;
  wirePaymentDeleteButtons($('#recent-payments'), id => recentPayments.find(payment => String(payment.id) === String(id)), renderFinanceDetails);
}

// =====================================================================
// STUDENTS — LIST
// =====================================================================
async function renderStudents() {
  useTemplate('#tpl-students');
  const PAGE_SIZE = 50;
  let currentPage = 1;
  let allStudents = [];

  function renderPage() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allStudents.slice(start, start + PAGE_SIZE);

    $('#students-table').innerHTML = pageItems.length ? `
      <table>
        <thead><tr><th>Adm. No.</th><th>Name</th><th>Class</th><th>Medium</th><th>School</th><th>Net Fee</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>
          ${pageItems.map(s => `
            <tr class="clickable" onclick="location.hash='student/${encodeURIComponent(s.admission_no)}'">
              <td class="mono">${s.admission_no}</td>
              <td>${s.name}</td>
              <td>${s.class}-${s.division}</td>
              <td>${s.medium}</td>
              <td>${s.school === 'Others' ? (s.school_other || 'Others') : s.school}</td>
              <td>${money(s.net_fees)}</td>
              <td>${money(s.balance)}</td>
              <td>${s.balance > 0 ? '<span class="tag due">Balance Due</span>' : '<span class="tag">Paid Up</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No students match this search yet.</p></div>`;

    renderPaginationBar('#students-pagination', currentPage, allStudents.length, PAGE_SIZE, p => {
      currentPage = p;
      renderPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function load() {
    const params = new URLSearchParams();
    if (currentYearId) params.set('academic_year_id', currentYearId);
    const q = $('#stu-search').value.trim();
    if (q) params.set('q', q);
    if ($('#f-class').value) params.set('cls', $('#f-class').value);
    if ($('#f-division').value) params.set('division', $('#f-division').value);
    if ($('#f-medium').value) params.set('medium', $('#f-medium').value);
    allStudents = await api('/students?' + params.toString());
    if ($('#f-status').value === 'Pending') allStudents = allStudents.filter(s => s.balance > 0);
    currentPage = 1;
    renderPage();
  }

  $('#stu-search').addEventListener('input', debounce(load, 250));
  ['#f-class', '#f-division', '#f-medium', '#f-status'].forEach(sel => $(sel).addEventListener('change', load));
  $('#export-pending').addEventListener('click', exportFeePendingCSV);
  $('#export-details').addEventListener('click', () => {
    window.location.href = API + '/students/reports/details/export' + yearQS();
    toast('Exporting full student details as Excel…');
  });

  await load();
}

async function renderWithdrawnStudents() {
  useTemplate('#tpl-withdrawn-students');
  const PAGE_SIZE = 50;
  let currentPage = 1;
  let allStudents = [];

  function renderPage() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allStudents.slice(start, start + PAGE_SIZE);
    $('#withdrawn-students-table').innerHTML = pageItems.length ? `
      <table>
        <thead><tr><th>Adm. No.</th><th>Name</th><th>Class</th><th>Left Date</th><th>Reason</th><th>Paid</th><th>Balance at Exit</th><th></th></tr></thead>
        <tbody>${pageItems.map(s => `
          <tr>
            <td class="mono clickable" onclick="location.hash='student/${encodeURIComponent(s.admission_no)}'">${s.admission_no}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(s.admission_no)}'">${s.name}</td>
            <td>${s.class}-${s.division || ''}</td>
            <td>${s.withdrawn_at || '—'}</td>
            <td>${s.withdrawal_reason || '—'}</td>
            <td>${money(s.paid)}</td>
            <td>${money(s.balance)}</td>
            <td><button class="btn-icon" data-restore="${encodeURIComponent(s.admission_no)}">Restore</button></td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="empty-state"><p>No withdrawn students found for this academic year.</p></div>`;

    renderPaginationBar('#withdrawn-students-pagination', currentPage, allStudents.length, PAGE_SIZE, p => {
      currentPage = p;
      renderPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $$('[data-restore]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const adm = decodeURIComponent(btn.dataset.restore);
      const student = allStudents.find(s => s.admission_no === adm);
      if (!confirm(`Restore ${student?.name || adm} to the active student register? Their previous fee and academic history will remain unchanged.`)) return;
      try {
        const reason = prompt('Optional note (e.g. Rejoined):', 'Rejoined');
        if (reason === null) return;
        await api('/students/' + encodeURIComponent(adm) + '/reactivate', {
          method: 'POST', body: JSON.stringify({ reason })
        });
        toast('Student restored to active register.');
        await load();
      } catch (err) { toast(err.message, true); }
    }));
  }

  async function load() {
    const q = $('#withdrawn-search').value.trim();
    const extra = q ? 'q=' + encodeURIComponent(q) : '';
    allStudents = await api('/students/withdrawn' + yearQS(extra));
    currentPage = 1;
    renderPage();
  }
  $('#withdrawn-search').addEventListener('input', debounce(load, 250));
  await load();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Reusable client-side pagination bar. Renders "Showing X–Y of Z" plus
// Prev/page-number/Next controls into containerId, and calls onChange(page)
// when the user picks a different page.
function renderPaginationBar(containerId, currentPage, totalItems, pageSize, onChange) {
  const container = $(containerId);
  if (!container) return;
  const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }
  const pageButtons = pages.map(p => p === '…'
    ? `<span class="page-number">…</span>`
    : `<button class="page-number ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`
  ).join('');

  container.innerHTML = `
    <div class="page-info">Showing ${start}&ndash;${end} of ${totalItems}</div>
    <div class="page-controls">
      <button data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&larr; Prev</button>
      ${pageButtons}
      <button data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Next &rarr;</button>
    </div>
  `;
  $$('[data-page]', container).forEach(btn => btn.addEventListener('click', () => {
    const p = Number(btn.dataset.page);
    if (p >= 1 && p <= totalPages) onChange(p);
  }));
}

async function exportFeePendingCSV() {
  const pending = await api('/students/reports/fee-pending' + yearQS());
  if (!pending.length) { toast('No pending fee balances — nothing to export.'); return; }
  window.location.href = API + '/students/reports/fee-pending/export' + yearQS();
  toast(`Exporting ${pending.length} pending record(s) as Excel…`);
}

// =====================================================================
// STUDENT DETAIL
// =====================================================================
async function renderStudentDetail(admNo) {
  useTemplate('#tpl-student-detail');
  const s = await api('/students/' + encodeURIComponent(admNo));

  $('#sd-name').textContent = `${s.name} — ${s.admission_no}`;
  const isWithdrawn = s.status === 'Withdrawn';
  $('#sd-back').addEventListener('click', () => location.hash = isWithdrawn ? 'withdrawn-students' : 'students');
  const statusAction = $('#sd-status-action');
  statusAction.textContent = isWithdrawn ? 'Restore to Active Students' : 'Move to Left / Withdrawn';
  statusAction.addEventListener('click', async () => {
    try {
      if (isWithdrawn) {
        if (!confirm(`Restore ${s.name} (${s.admission_no}) to the active student register?`)) return;
        const reason = prompt('Optional note (e.g. Rejoined):', 'Rejoined');
        if (reason === null) return;
        await api('/students/' + encodeURIComponent(s.admission_no) + '/reactivate', {
          method: 'POST', body: JSON.stringify({ reason })
        });
        toast('Student restored to active register.');
        location.hash = 'students';
      } else {
        const reason = prompt('Reason for leaving (optional):', '');
        if (reason === null) return;
        const confirmed = confirm(`Move ${s.name} (${s.admission_no}) to Left / Withdrawn Students? Their student details, payments and academic records will be preserved. Their unpaid balance will no longer appear in active fee-pending reports, but it will remain visible in the archived record.`);
        if (!confirmed) return;
        await api('/students/' + encodeURIComponent(s.admission_no) + '/withdraw', {
          method: 'POST', body: JSON.stringify({ reason })
        });
        toast('Student moved to Left / Withdrawn Students.');
        location.hash = 'withdrawn-students';
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#sd-edit').addEventListener('click', () => location.hash = 'edit-student/' + encodeURIComponent(s.admission_no));
  $('#sd-reset-parent').addEventListener('click', async () => {
    const confirmed = confirm(`Reset the Parent Portal login for ${s.name} (${s.admission_no})? Their current parent password will stop working, and the registered mother's mobile number will become the initial password again.`);
    if (!confirmed) return;
    try {
      const result = await api('/parents/' + encodeURIComponent(s.admission_no) + '/reset-login', { method: 'POST' });
      toast(result.message || 'Parent login reset.');
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#sd-pay').addEventListener('click', () => {
    location.hash = 'payment';
    setTimeout(() => { $('#pf-adm').value = s.admission_no; $('#pf-adm').dispatchEvent(new Event('input')); }, 60);
  });
  $('#sd-delete').addEventListener('click', async () => {
    const confirmed = confirm(`Delete ${s.name} (${s.admission_no})? This also removes their payment history. This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api('/students/' + encodeURIComponent(s.admission_no), { method: 'DELETE' });
      toast('Student deleted.');
      location.hash = 'students';
    } catch (err) {
      toast(err.message, true);
    }
  });

  const schoolDisplay = s.school === 'Others' ? (s.school_other || 'Others') : s.school;
  $('#sd-details').innerHTML = `
    <h2>Admission Details</h2>
    <div class="detail-grid">
      <div><span class="d-label">Admission No.</span><span class="d-value mono">${s.admission_no}</span></div>
      <div><span class="d-label">Joining Date</span><span class="d-value">${s.joining_date}</span></div>
      <div><span class="d-label">Student Status</span><span class="d-value">${isWithdrawn ? 'Left / Withdrawn' : 'Active'}</span></div>
      ${isWithdrawn ? `<div><span class="d-label">Left Date</span><span class="d-value">${s.withdrawn_at || '—'}</span></div><div><span class="d-label">Reason</span><span class="d-value">${s.withdrawal_reason || '—'}</span></div>` : ''}
      <div><span class="d-label">Class / Division</span><span class="d-value">${s.class} - ${s.division}</span></div>
      <div><span class="d-label">Medium</span><span class="d-value">${s.medium}</span></div>
      <div><span class="d-label">School</span><span class="d-value">${schoolDisplay}</span></div>
      <div><span class="d-label">Place</span><span class="d-value">${s.place || '—'}</span></div>
      <div><span class="d-label">Father</span><span class="d-value">${s.father_name || '—'}</span></div>
      <div><span class="d-label">Father's Phone</span><span class="d-value">${s.father_phone || '—'}</span></div>
      <div><span class="d-label">Mother</span><span class="d-value">${s.mother_name || '—'}</span></div>
      <div><span class="d-label">Mother's Phone</span><span class="d-value">${s.mother_phone || '—'}</span></div>
      <div><span class="d-label">Total Fees</span><span class="d-value">${money(s.total_fees)}</span></div>
      <div><span class="d-label">Discount</span><span class="d-value">${money(s.discount)}</span></div>
    </div>`;

  $('#sd-fee-summary').innerHTML = `
    <div class="fee-chip"><div class="label">Net Payable</div><div class="value">${money(s.net_fees)}</div></div>
    <div class="fee-chip paid"><div class="label">Paid</div><div class="value">${money(s.paid)}</div></div>
    <div class="fee-chip due"><div class="label">Balance</div><div class="value">${money(s.balance)}</div></div>
  `;

  $('#sd-payments').innerHTML = s.payments.length ? `
    <table>
      <thead><tr><th>Receipt No.</th><th>Amount</th><th>Date</th><th></th></tr></thead>
      <tbody>${s.payments.map(p => `<tr><td class="mono">${p.receipt_no}</td><td>${money(p.amount)}</td><td>${p.payment_date}</td>
        <td>
          <a href="/receipt.html?id=${p.id}" target="_blank" rel="noopener" class="btn-icon">Receipt</a>
          <a href="#edit-payment/${p.id}" class="btn-icon">Edit</a>
          <button type="button" class="btn-icon btn-delete-receipt" data-delete-payment-id="${p.id}">Delete</button>
        </td></tr>`).join('')}</tbody>
    </table>` : `<p class="empty-row">No payments recorded yet.</p>`;
  wirePaymentDeleteButtons($('#sd-payments'), id => s.payments.find(p => String(p.id) === String(id)) && ({
    ...s.payments.find(p => String(p.id) === String(id)), student_name: s.name, admission_no: s.admission_no
  }), () => renderStudentDetail(admNo));

  const weeklyTests = await api('/students/' + encodeURIComponent(admNo) + '/weekly-tests');
  $('#sd-performance-report').href = '/student-performance-report.html?adm=' + encodeURIComponent(admNo);
  $('#sd-weekly-tests').innerHTML = weeklyTests.length ? `
    <table>
      <thead><tr><th>Date</th><th>Exam</th><th>Marks</th><th>%</th><th></th></tr></thead>
      <tbody>${weeklyTests.map(w => {
        const pct = w.is_absent ? null : Math.round((w.marks / w.max_marks) * 1000) / 10;
        return `<tr>
          <td>${w.test_date}</td>
          <td>${w.subject || w.exam_name}</td>
          <td>${w.is_absent ? 'Absent' : `${w.marks} / ${w.max_marks}`}</td>
          <td>${pct !== null ? `<span class="tag ${pct < 35 ? 'due' : ''}">${pct}%</span>` : '—'}</td>
          <td><a href="/weekly-test-report.html?id=${w.test_id}" target="_blank" rel="noopener" class="btn-icon">Report</a></td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<p class="empty-row">No weekly test marks recorded yet.</p>`;

  const hotSeats = await api('/students/' + encodeURIComponent(admNo) + '/hot-seats' + yearQS());
  $('#sd-hot-seats').innerHTML = hotSeats.length ? `
    <table>
      <thead><tr><th>Date</th><th>Subject</th><th>Teacher</th><th>Performance</th><th>Notes</th></tr></thead>
      <tbody>${hotSeats.map(h => `
        <tr>
          <td>${h.date}</td>
          <td>${h.subject || '—'}</td>
          <td>${h.teacher || '—'}</td>
          <td>${h.performance ? `<span class="perf-badge ${perfBadgeClass(h.performance)}">${h.performance}</span>` : '—'}</td>
          <td>${h.remarks || (h.no_notebook || h.no_textbook ? '<span style="color:var(--pink);">Missing materials</span>' : '—')}</td>
        </tr>`).join('')}</tbody>
    </table>` : `<p class="empty-row">No Hot Seat records yet.</p>`;
}

// =====================================================================
// STUDENT FORM (add / edit)
// =====================================================================
async function renderStudentForm(admNo) {
  useTemplate('#tpl-student-form');
  const form = $('#student-form');
  const isEdit = !!admNo;

  if (isEdit) {
    $('#sf-eyebrow').textContent = 'Register — Editing Record';
    $('#sf-title').textContent = 'Edit Student';
    const s = await api('/students/' + encodeURIComponent(admNo));
    for (const [key, val] of Object.entries(s)) {
      const field = form.elements[key];
      if (field) field.value = val ?? '';
    }
    form.elements['admission_no'].setAttribute('readonly', 'true');
    toggleSchoolOther();
  } else {
    form.elements['joining_date'].value = todayStr();
    const yearLabel = academicYears.find(y => y.id === currentYearId);
    if (yearLabel) $('#sf-eyebrow').textContent = `Register — Admitting into ${yearLabel.label}`;
  }

  function toggleSchoolOther() {
    const isOther = $('#sf-school').value === 'Others';
    $('#sf-school-other-wrap').classList.toggle('hidden', !isOther);
  }
  function updateNet() {
    const total = Number(form.elements['total_fees'].value) || 0;
    const discount = Number(form.elements['discount'].value) || 0;
    $('#sf-net-fee').textContent = money(Math.max(total - discount, 0));
  }
  $('#sf-school').addEventListener('change', toggleSchoolOther);
  form.elements['total_fees'].addEventListener('change', updateNet);
  form.elements['discount'].addEventListener('input', updateNet);
  updateNet();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (isEdit) {
        await api('/students/' + encodeURIComponent(admNo), { method: 'PUT', body: JSON.stringify(data) });
        toast('Student record updated.');
        location.hash = 'student/' + encodeURIComponent(admNo);
      } else {
        data.academic_year_id = currentYearId;
        await api('/students', { method: 'POST', body: JSON.stringify(data) });
        toast('Student admitted successfully.');
        location.hash = 'students';
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// =====================================================================
// FEE PAYMENT
// =====================================================================
async function renderPayment(editPaymentId) {
  useTemplate('#tpl-payment');
  const form = $('#payment-form');
  const isEdit = !!editPaymentId;
  let currentStudent = null;

  async function suggestReceiptNo() {
    const receiptField = form.elements['receipt_no'];
    try {
      const { next_receipt_no } = await api('/payments/next-receipt-no');
      // Do not overwrite a number the user has already started typing while
      // this asynchronous suggestion request was in flight.
      if (!receiptField.value.trim()) receiptField.value = next_receipt_no;
    } catch (err) { /* leave blank if this fails — still editable */ }
  }

  async function loadStudentFields(adm) {
    try {
      const s = await api('/students/' + encodeURIComponent(adm));
      currentStudent = s;
      $('#pf-name').value = s.name;
      $('#pf-class').value = `${s.class}-${s.division} (${s.medium})`;
      $('#pf-total').value = money(s.net_fees);
      $('#pf-paid').value = money(s.paid);
      $('#pf-balance').value = money(s.balance);
    } catch (err) {
      currentStudent = null;
      clearStudentFields();
    }
  }

  if (isEdit) {
    $('#pf-eyebrow').textContent = 'Register — Editing Payment';
    $('#pf-title').textContent = 'Edit Fee Receipt';
    $('#pf-submit').textContent = 'Save Changes';
    $('#pf-cancel-edit').classList.remove('hidden');
    $('#pf-delete').classList.remove('hidden');
    $('#pf-delete').addEventListener('click', async () => {
      const p = await api('/payments/' + editPaymentId + '/receipt').catch(() => null);
      if (!p) { toast('Could not load receipt details. Refresh and try again.', true); return; }
      const deleted = await deletePaymentReceipt({ ...p, id: editPaymentId }, () => { location.hash = 'payment-history'; });
      if (deleted) $('#pf-delete').disabled = true;
    });
    $('#pf-receipt-hint').textContent = 'Editing this receipt updates the fee ledger and sets the basis for the next receipt suggestion.';
    try {
      const p = await api('/payments/' + editPaymentId + '/receipt');
      $('#pf-adm').value = p.admission_no;
      $('#pf-adm').setAttribute('readonly', 'true');
      form.elements['receipt_no'].value = p.receipt_no;
      form.elements['amount'].value = p.amount;
      form.elements['payment_date'].value = p.payment_date;
      await loadStudentFields(p.admission_no);
    } catch (err) {
      view.innerHTML = `<div class="card"><p>Could not load this payment: ${err.message}</p></div>`;
      return;
    }
  } else {
    form.elements['payment_date'].value = todayStr();
    suggestReceiptNo();
  }

  $('#pf-adm').addEventListener('input', debounce(async () => {
    if (isEdit) return; // admission no. is locked while editing
    const adm = $('#pf-adm').value.trim();
    if (!adm) { clearStudentFields(); return; }
    loadStudentFields(adm);
  }, 300));

  function clearStudentFields() {
    $('#pf-name').value = '';
    $('#pf-class').value = '';
    $('#pf-total').value = '';
    $('#pf-paid').value = '';
    $('#pf-balance').value = '';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const banner = $('#pf-status');
    if (!currentStudent) {
      banner.textContent = 'Enter a valid Admission Number before recording a payment.';
      banner.className = 'status-banner error';
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (isEdit) {
        await api('/payments/' + editPaymentId, { method: 'PUT', body: JSON.stringify(data) });
        banner.innerHTML = `Receipt ${data.receipt_no} updated for ${currentStudent.name} (${currentStudent.admission_no}).
          <a href="/receipt.html?id=${editPaymentId}" target="_blank" rel="noopener" class="btn btn-small btn-primary" style="margin-left:10px;text-decoration:none;">Print Receipt</a>`;
        banner.className = 'status-banner';
        toast('Receipt updated.');
      } else {
        const result = await api('/payments', { method: 'POST', body: JSON.stringify(data) });
        banner.innerHTML = `Payment of ${money(data.amount)} recorded for ${currentStudent.name} (${currentStudent.admission_no}).
          <a href="/receipt.html?id=${result.id}" target="_blank" rel="noopener" class="btn btn-small btn-primary" style="margin-left:10px;text-decoration:none;">Print Receipt</a>`;
        banner.className = 'status-banner';
        toast('Payment recorded.');
        form.reset();
        form.elements['payment_date'].value = todayStr();
        clearStudentFields();
        currentStudent = null;
        suggestReceiptNo();
      }
    } catch (err) {
      banner.textContent = err.message;
      banner.className = 'status-banner error';
    }
  });
}

// =====================================================================
// FEE PENDING SLIP GENERATION
// =====================================================================
async function renderFeePendingSlips() {
  useTemplate('#tpl-fee-pending-slips');
  const classSelect = $('#fps-class');
  const divisionSelect = $('#fps-division');
  const targetInput = $('#fps-target');
  const dueDateInput = $('#fps-due-date');
  const resultsCard = $('#fps-results-card');
  const statusBox = $('#fps-status');
  const printRoot = $('#fee-slip-print');
  let activeStudents = [];
  let generatedSlips = [];

  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const formatDueDate = value => {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    const parts = new Intl.DateTimeFormat('ml-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    }).formatToParts(d);
    const part = type => parts.find(item => item.type === type)?.value || '';
    // Keep a natural Malayalam date order in the printed due-date heading.
    return `${part('year')} ${part('month')} ${part('day')}`.trim();
  };

  statusBox.innerHTML = '<p class="hint">Loading active students for the selected academic year…</p>';
  activeStudents = await api('/students' + yearQS());
  const classValues = [...new Set(activeStudents.map(s => String(s.class || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  classSelect.innerHTML = '<option value="">Select Class</option>' + classValues
    .map(cls => `<option value="${escapeText(cls)}">Class ${escapeText(cls)}</option>`).join('');
  divisionSelect.innerHTML = '<option value="">Select Division</option>';
  divisionSelect.disabled = true;
  statusBox.textContent = '';

  function refreshDivisionOptions() {
    const selectedClass = String(classSelect.value || '').trim();
    const divisions = [...new Set(activeStudents
      .filter(s => String(s.class || '').trim() === selectedClass)
      .map(s => String(s.division || '').trim().toUpperCase())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    divisionSelect.innerHTML = '<option value="">Select Division</option>' + divisions
      .map(div => `<option value="${escapeText(div)}">Division ${escapeText(div)}</option>`).join('');
    divisionSelect.disabled = !selectedClass || divisions.length === 0;
    clearGenerated();
    statusBox.className = '';
    statusBox.textContent = selectedClass && divisions.length === 0
      ? `No divisions are recorded for Class ${selectedClass}. Update the student records first.`
      : '';
  }
  classSelect.addEventListener('change', refreshDivisionOptions);
  divisionSelect.addEventListener('change', clearGenerated);

  function clearGenerated() {
    generatedSlips = [];
    resultsCard.classList.add('hidden');
    $('#fps-summary').innerHTML = '';
    $('#fps-results-table').innerHTML = '';
    printRoot.innerHTML = '';
    printRoot.setAttribute('aria-hidden', 'true');
  }

  $('#fps-preview').addEventListener('click', async () => {
    const selectedClass = classSelect.value;
    const selectedDivision = divisionSelect.value;
    const targetAmount = Number(targetInput.value);
    const dueDate = dueDateInput.value;
    statusBox.className = '';
    statusBox.textContent = '';

    if (!selectedClass) {
      statusBox.className = 'status-banner error';
      statusBox.textContent = 'Please select a class.';
      return;
    }
    if (!selectedDivision) {
      statusBox.className = 'status-banner error';
      statusBox.textContent = 'Please select a division.';
      return;
    }
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      statusBox.className = 'status-banner error';
      statusBox.textContent = 'Enter a target amount greater than zero.';
      return;
    }
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      statusBox.className = 'status-banner error';
      statusBox.textContent = 'Please select a valid due date.';
      return;
    }

    try {
      // Refresh balances so slips use the latest payment ledger, not stale page data.
      activeStudents = await api('/students' + yearQS());
      const classStudents = activeStudents.filter(s =>
        String(s.class || '').trim() === String(selectedClass).trim() &&
        String(s.division || '').trim().toUpperCase() === String(selectedDivision).trim().toUpperCase()
      );
      generatedSlips = classStudents.map(s => {
        const balance = Math.max(Number(s.balance) || 0, 0);
        const paid = Math.max(Number(s.paid) || 0, 0);
        // The entered amount is a cumulative paid-fee target, not the amount
        // to request directly. Ask only for the gap to target, and never more
        // than the student's actual outstanding fee balance.
        const gapToTarget = Math.max(targetAmount - paid, 0);
        const requested = Math.min(gapToTarget, balance);
        return {
          admission_no: s.admission_no,
          name: s.name,
          class: s.class,
          division: s.division,
          net_fees: Number(s.net_fees) || 0,
          paid,
          balance,
          requested,
          father_name: s.father_name || '',
          mother_name: s.mother_name || '',
        };
      }).filter(s => s.requested > 0)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      if (!generatedSlips.length) {
        clearGenerated();
        statusBox.className = 'status-banner';
        statusBox.textContent = `No active students in Class ${selectedClass} - Division ${selectedDivision} need an additional payment to reach the cumulative target of ${money(targetAmount)} for this academic year.`;
        return;
      }

      generatedSlips = generatedSlips.map(s => ({ ...s, due_date: dueDate, target_amount: targetAmount }));
      const totalRequested = generatedSlips.reduce((sum, s) => sum + s.requested, 0);
      const totalOutstanding = generatedSlips.reduce((sum, s) => sum + s.balance, 0);
      $('#fps-summary').innerHTML = `
        <div class="fee-chip"><div class="label">Class / Division</div><div class="value">${escapeText(selectedClass)} - ${escapeText(selectedDivision)}</div></div>
        <div class="fee-chip"><div class="label">Slips to Generate</div><div class="value">${generatedSlips.length}</div></div>
        <div class="fee-chip due"><div class="label">Total Outstanding</div><div class="value">${money(totalOutstanding)}</div></div>
        <div class="fee-chip paid"><div class="label">Total Requested</div><div class="value">${money(totalRequested)}</div></div>`;
      $('#fps-results-table').innerHTML = `
        <table><thead><tr><th>#</th><th>Admission No.</th><th>Student</th><th>Class / Division</th><th>Paid So Far</th><th>Target Paid</th><th>Outstanding</th><th>Requested by Due Date</th></tr></thead>
        <tbody>${generatedSlips.map((s, i) => `<tr>
          <td>${i + 1}</td><td class="mono">${escapeText(s.admission_no)}</td>
          <td>${escapeText(s.name)}</td><td>${escapeText(s.class)}-${escapeText(s.division)}</td>
          <td>${money(s.paid)}</td><td>${money(s.target_amount)}</td><td>${money(s.balance)}</td><td><strong>${money(s.requested)}</strong></td>
        </tr>`).join('')}</tbody></table>`;
      resultsCard.classList.remove('hidden');
      statusBox.className = 'status-banner';
      statusBox.textContent = `${generatedSlips.length} fee pending slip(s) are ready for Class ${selectedClass} - Division ${selectedDivision}.`;
      window.scrollTo({ top: resultsCard.offsetTop - 20, behavior: 'smooth' });
    } catch (err) {
      statusBox.className = 'status-banner error';
      statusBox.textContent = err.message || 'Could not generate fee pending slips.';
    }
  });

  $('#fps-print').addEventListener('click', async () => {
    if (!generatedSlips.length) return;
    const yearLabel = academicYears.find(y => y.id === currentYearId)?.label || '';
    const slipCards = generatedSlips.map((s, index) => `
      <article class="fee-pending-slip" lang="ml">
        <div class="fps-topline">
          <img src="/images/logo-mark.png" alt="Students' Home" />
          <div><h1>STUDENTS' HOME</h1><p>കോട്ടക്കൽ · ഫീസ് വിഭാഗം</p></div>
          <span class="fps-slip-label">ഫീസ് അടവ് അറിയിപ്പ്</span>
        </div>
        <div class="fps-academic-year">അധ്യയന വർഷം: ${escapeText(yearLabel)}</div>
        <p class="fps-greeting">പ്രിയ രക്ഷിതാവേ,</p>
        <p class="fps-message">സ്ഥാപനത്തിൽ ഇതുവരെ അടച്ച ഫീസ് വിവരങ്ങൾ താഴെ കൊടുക്കുന്നു.<br><br>അടയ്ക്കാൻ ബാക്കിയുള്ള തുക താഴെ നൽകിയിരിക്കുന്ന തീയതിക്കുള്ളിൽ അടയ്ക്കണമെന്ന് അറിയിക്കുന്നു.</p>
        <div class="fps-student-grid">
          <div><span>വിദ്യാർത്ഥിയുടെ പേര്</span><strong>${escapeText(s.name)}</strong></div>
          <div><span>അഡ്മിഷൻ നമ്പർ</span><strong>${escapeText(s.admission_no)}</strong></div>
          <div><span>ക്ലാസ് / ഡിവിഷൻ</span><strong>${escapeText(s.class)} - ${escapeText(s.division)}</strong></div>
          <div><span>രക്ഷിതാവിന്റെ പേര്</span><strong>${escapeText(s.father_name || s.mother_name || 'രക്ഷിതാവ്')}</strong></div>
        </div>
        <div class="fps-amount-grid">
          <div><span>ആകെ ഫീസ്</span><strong>${money(s.net_fees)}</strong></div>
          <div><span>ആകെ അടച്ചത്</span><strong>${money(s.paid)}</strong></div>
          <div><span>അടക്കേണ്ട തുക</span><strong>${money(s.target_amount)}</strong></div>
        </div>
        <div class="fps-payable">
          <div><span>${escapeText(formatDueDate(s.due_date))}-ന് മുമ്പ് അടയ്ക്കേണ്ട തുക</span><strong>${money(s.requested)}</strong></div>
        </div>
        <div class="fps-footer">
          <p>കൂടുതൽ വിവരങ്ങൾക്കും സംശയങ്ങൾക്കും സ്ഥാപന ഓഫീസുമായി ബന്ധപ്പെടുക.</p>
          <div><span>ഓഫീസ് ഉപയോഗത്തിന്</span><span>ലഭിച്ച തുക: ₹ __________</span></div>
          <div class="fps-signature"><span>രക്ഷിതാവിന്റെ ഒപ്പ്</span><span>അധികൃത ഒപ്പ്</span></div>
        </div>
        <div class="fps-serial">${index + 1} / ${generatedSlips.length}</div>
      </article>`);
    const slipPages = [];
    for (let i = 0; i < slipCards.length; i += 4) {
      slipPages.push(`<section class="fee-slip-page">${slipCards.slice(i, i + 4).join('')}</section>`);
    }
    printRoot.innerHTML = slipPages.join('');
    printRoot.setAttribute('aria-hidden', 'false');
    document.body.classList.add('printing-fee-slips');
    const cleanup = () => document.body.classList.remove('printing-fee-slips');
    window.addEventListener('afterprint', cleanup, { once: true });
    // Wait for the requested Malayalam font to finish loading before opening print.
    try {
      if (document.fonts?.load) await document.fonts.load('600 10pt "Noto Sans Malayalam"');
      if (document.fonts?.ready) await document.fonts.ready;
    } catch (_) { /* Use the configured Malayalam system-font fallback if offline. */ }
    window.print();
    setTimeout(cleanup, 1500);
  });

  $('#fps-reset').addEventListener('click', () => {
    classSelect.value = '';
    divisionSelect.innerHTML = '<option value="">Select Division</option>';
    divisionSelect.disabled = true;
    targetInput.value = '';
    dueDateInput.value = '';
    statusBox.className = '';
    statusBox.textContent = '';
    clearGenerated();
  });
}

// =====================================================================
// PAYMENT HISTORY
// =====================================================================
async function renderPaymentHistory() {
  useTemplate('#tpl-payment-history');
  const PAGE_SIZE = 50;
  let currentPage = 1;
  let allPayments = [];

  function renderPage() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allPayments.slice(start, start + PAGE_SIZE);

    $('#ph-table').innerHTML = pageItems.length ? `
      <table>
        <thead><tr><th>Date</th><th>Receipt No.</th><th>Adm. No.</th><th>Student</th><th>Class</th><th>Amount</th><th></th></tr></thead>
        <tbody>${pageItems.map(p => `
          <tr>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.payment_date}</td>
            <td class="mono clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.receipt_no}</td>
            <td class="mono clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.admission_no}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.student_name}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.class}-${p.division}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${money(p.amount)}</td>
            <td>
              <a href="/receipt.html?id=${p.id}" target="_blank" rel="noopener" class="btn-icon">Receipt</a>
              <a href="#edit-payment/${p.id}" class="btn-icon">Edit</a>
              <button type="button" class="btn-icon btn-delete-receipt" data-delete-payment-id="${p.id}">Delete</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>` : `<p class="empty-row">No payments recorded yet.</p>`;
    wirePaymentDeleteButtons($('#ph-table'), id => allPayments.find(p => String(p.id) === String(id)), load);

    renderPaginationBar('#ph-pagination', currentPage, allPayments.length, PAGE_SIZE, p => {
      currentPage = p;
      renderPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function load() {
    const q = $('#ph-search').value.trim();
    allPayments = await api('/payments' + yearQS(q ? 'q=' + encodeURIComponent(q) : ''));
    currentPage = 1;
    renderPage();
  }
  $('#ph-search').addEventListener('input', debounce(load, 250));
  await load();
}

// =====================================================================
// CLASSES
// =====================================================================
async function renderClasses() {
  useTemplate('#tpl-classes');
  const form = $('#class-form');

  async function load() {
    const classes = await api('/classes' + yearQS());
    $('#classes-table').innerHTML = classes.length ? `
      <table>
        <thead><tr><th>Class</th><th>Division</th><th>Medium</th><th></th></tr></thead>
        <tbody>${classes.map(c => `
          <tr><td>${c.class}</td><td>${c.division}</td><td>${c.medium}</td>
          <td><button class="btn-icon" data-del="${c.id}">Remove</button></td></tr>`).join('')}</tbody>
      </table>` : `<p class="empty-row">No classes added yet for this academic year.</p>`;

    $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      await api('/classes/' + btn.dataset.del, { method: 'DELETE' });
      toast('Class removed.');
      load();
    }));
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.academic_year_id = currentYearId;
    try {
      await api('/classes', { method: 'POST', body: JSON.stringify(data) });
      toast('Class added.');
      form.reset();
      load();
    } catch (err) { toast(err.message, true); }
  });

  await load();
}

// =====================================================================
// TEACHERS
// =====================================================================
async function renderTeachers() {
  useTemplate('#tpl-teachers');
  const form = $('#teacher-form');

  async function load() {
    const teachers = await api('/teachers' + yearQS());
    const yearLabel = academicYears.find(y => y.id === currentYearId);
    $('#teachers-table').innerHTML = teachers.length ? `
      <table>
        <thead><tr><th>Name</th><th>Subject</th><th>Classes</th><th>Rate/hr</th><th>Hours Logged${yearLabel ? ` (${yearLabel.label})` : ''}</th><th>Earned</th><th></th></tr></thead>
        <tbody>${teachers.map(t => `
          <tr>
            <td>${t.name}</td><td>${t.subject || '—'}</td><td>${t.classes_handled || '—'}</td>
            <td>${money(t.hour_rate)}</td><td>${t.total_hours}</td><td>${money(t.total_earned)}</td>
            <td>
              <button class="btn-icon" data-edit="${t.id}">Edit</button>
              <button class="btn-icon" data-del="${t.id}">Remove</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>` : `<p class="empty-row">No teachers added yet.</p>`;

    $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      await api('/teachers/' + btn.dataset.del, { method: 'DELETE' });
      toast('Teacher removed.');
      load();
    }));
    $$('[data-edit]').forEach(btn => btn.addEventListener('click', async () => {
      const t = teachers.find(x => x.id == btn.dataset.edit);
      form.elements['id'].value = t.id;
      form.elements['name'].value = t.name;
      form.elements['classes_handled'].value = t.classes_handled || '';
      form.elements['subject'].value = t.subject || '';
      form.elements['hour_rate'].value = t.hour_rate;
      form.elements['phone'].value = t.phone || '';
      $('#tf-title').textContent = 'Edit Teacher';
      $('#tf-submit').textContent = 'Save Changes';
      $('#tf-cancel').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  $('#tf-cancel').addEventListener('click', () => {
    form.reset();
    form.elements['id'].value = '';
    $('#tf-title').textContent = 'Add Teacher';
    $('#tf-submit').textContent = 'Add Teacher';
    $('#tf-cancel').classList.add('hidden');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const id = data.id;
    delete data.id;
    try {
      if (id) {
        await api('/teachers/' + id, { method: 'PUT', body: JSON.stringify(data) });
        toast('Teacher updated.');
      } else {
        await api('/teachers', { method: 'POST', body: JSON.stringify(data) });
        toast('Teacher added.');
      }
      form.reset();
      $('#tf-title').textContent = 'Add Teacher';
      $('#tf-submit').textContent = 'Add Teacher';
      $('#tf-cancel').classList.add('hidden');
      load();
    } catch (err) { toast(err.message, true); }
  });

  await load();
}

// =====================================================================
// TEACHER PORTAL ACCOUNT MANAGEMENT
// =====================================================================
async function renderTeacherPortalAccounts() {
  useTemplate('#tpl-teacher-accounts');
  const form = $('#tpa-form');
  const credentialBox = $('#tpa-credential-box');
  const options = await api('/teacher-accounts/options' + yearQS());
  const subjects = options.subjects || [];
  const classes = options.classes || [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  $('#tpa-subject-options').innerHTML = subjects.map((subject, i) => `
    <label class="tpa-check"><input type="checkbox" name="tpa-subject" value="${escape(subject)}"><span>${escape(subject)}</span></label>`).join('');
  $('#tpa-class-options').innerHTML = classes.length ? classes.map(cls => `
    <label class="tpa-check"><input type="checkbox" name="tpa-class" value="${escape(cls)}"><span>Class ${escape(cls)}</span></label>`).join('')
    : '<p class="hint">No active student classes found for this academic year.</p>';

  function selected(name) { return $$(`input[name="${name}"]:checked`, form).map(el => el.value); }
  function setSelected(name, values) {
    const set = new Set((values || []).map(String));
    $$(`input[name="${name}"]`, form).forEach(el => { el.checked = set.has(el.value); });
  }
  function resetForm() {
    form.reset(); form.elements.id.value = '';
    $('#tpa-form-title').textContent = 'Add Teacher Portal Account';
    $('#tpa-submit').textContent = 'Create Teacher Login';
    $('#tpa-cancel').classList.add('hidden');
    credentialBox.classList.add('hidden'); credentialBox.innerHTML = '';
    setSelected('tpa-subject', []); setSelected('tpa-class', []);
  }
  function showTemporaryPassword(code, password, message) {
    credentialBox.classList.remove('hidden');
    credentialBox.innerHTML = `<strong>${escape(message)}</strong>
      <div class="tpa-credential-line"><span>Teacher Code</span><code>${escape(code)}</code></div>
      <div class="tpa-credential-line"><span>Temporary Password</span><code id="tpa-temp-password">${escape(password)}</code></div>
      <p>Share these credentials privately. The teacher must change the temporary password at first login.</p>
      <button type="button" class="btn btn-ghost btn-small" id="tpa-copy-credentials">Copy Credentials</button>`;
    $('#tpa-copy-credentials').addEventListener('click', async () => {
      const text = `Teacher Code: ${code}\nTemporary Password: ${password}`;
      try { await navigator.clipboard.writeText(text); toast('Credentials copied.'); }
      catch { toast('Select and copy the credentials manually.', true); }
    });
  }

  async function load() {
    const accounts = await api('/teacher-accounts');
    $('#tpa-count').textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;
    $('#tpa-table').innerHTML = accounts.length ? `<table><thead><tr><th>Teacher</th><th>Code</th><th>Subjects</th><th>Classes</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${accounts.map(a => `<tr>
        <td><strong>${escape(a.name)}</strong></td><td class="mono">${escape(a.teacher_code)}</td>
        <td>${escape(a.subjects.join(', '))}</td><td>${escape(a.classes.map(c => 'Class ' + c).join(', '))}</td>
        <td>${a.is_active ? '<span class="tag paid">Active</span>' : '<span class="tag due">Inactive</span>'}${a.must_change_password ? '<br><small class="hint">Password change pending</small>' : ''}</td>
        <td class="tpa-actions"><button type="button" class="btn-icon" data-tpa-edit="${a.id}">Edit</button>
        <button type="button" class="btn-icon" data-tpa-reset="${a.id}">Reset Password</button>
        <button type="button" class="btn-icon" data-tpa-status="${a.id}" data-active="${a.is_active ? 1 : 0}">${a.is_active ? 'Deactivate' : 'Activate'}</button></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty-state"><p>No teacher portal accounts yet. Create the first account using the form.</p></div>';

    $$('[data-tpa-edit]').forEach(btn => btn.addEventListener('click', () => {
      const a = accounts.find(x => String(x.id) === btn.dataset.tpaEdit);
      if (!a) return;
      form.elements.id.value = a.id;
      form.elements.name.value = a.name;
      form.elements.teacher_code.value = a.teacher_code;
      setSelected('tpa-subject', a.subjects); setSelected('tpa-class', a.classes);
      $('#tpa-form-title').textContent = 'Edit Teacher Portal Account';
      $('#tpa-submit').textContent = 'Save Changes';
      $('#tpa-cancel').classList.remove('hidden');
      credentialBox.classList.add('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    $$('[data-tpa-reset]').forEach(btn => btn.addEventListener('click', async () => {
      const a = accounts.find(x => String(x.id) === btn.dataset.tpaReset);
      if (!a || !confirm(`Generate a new temporary password for ${a.name} (${a.teacher_code})? Their current sessions will be signed out.`)) return;
      try {
        const result = await api(`/teacher-accounts/${a.id}/reset-password`, { method: 'POST', body: '{}' });
        showTemporaryPassword(a.teacher_code, result.temporary_password, `New temporary password for ${a.name}`);
        toast('Temporary password generated.'); await load();
      } catch (err) { toast(err.message, true); }
    }));
    $$('[data-tpa-status]').forEach(btn => btn.addEventListener('click', async () => {
      const a = accounts.find(x => String(x.id) === btn.dataset.tpaStatus);
      const active = btn.dataset.active !== '1';
      if (!a || !confirm(`${active ? 'Activate' : 'Deactivate'} teacher portal access for ${a.name}?`)) return;
      try { await api(`/teacher-accounts/${a.id}/status`, { method: 'POST', body: JSON.stringify({ is_active: active }) }); toast(`Teacher account ${active ? 'activated' : 'deactivated'}.`); await load(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  $('#tpa-cancel').addEventListener('click', resetForm);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = {
      name: form.elements.name.value.trim(),
      teacher_code: form.elements.teacher_code.value.trim(),
      subjects: selected('tpa-subject'), classes: selected('tpa-class'),
      academic_year_id: currentYearId,
    };
    if (!data.subjects.length || !data.classes.length) { toast('Select at least one subject and one class.', true); return; }
    const id = form.elements.id.value;
    const submit = $('#tpa-submit'); submit.disabled = true;
    try {
      if (id) {
        await api(`/teacher-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Teacher portal account updated. Existing sessions have been signed out.');
        resetForm();
      } else {
        const result = await api('/teacher-accounts', { method: 'POST', body: JSON.stringify(data) });
        showTemporaryPassword(data.teacher_code.toUpperCase(), result.temporary_password, `Login created for ${data.name}`);
        toast('Teacher portal account created.');
        form.reset(); setSelected('tpa-subject', []); setSelected('tpa-class', []);
      }
      await load();
    } catch (err) { toast(err.message, true); }
    finally { submit.disabled = false; }
  });
  await load();
}

// =====================================================================
// TIMETABLE
// =====================================================================
function teacherInitials(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function subjectColorClass(subject) {
  const str = (subject || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return 'tt-c' + (hash % 5);
}

const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

async function renderTimetable() {
  useTemplate('#tpl-timetable');
  const form = $('#timetable-form');
  form.elements['date'].value = todayStr();
  const teacherSelect = $('#tt-teacher');
  const newTeacherWrap = $('#tt-new-teacher');
  const classDivisionSelect = $('#tt-class-division');
  const gridDateInput = $('#tt-grid-date');
  gridDateInput.value = todayStr();

  const [teachers, classes] = await Promise.all([api('/teachers' + yearQS()), api('/classes' + yearQS())]);

  // populate teacher dropdown
  const newTeacherOpt = teacherSelect.querySelector('option[value="new"]');
  teachers.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} — ${t.subject || 'General'}`;
    teacherSelect.insertBefore(opt, newTeacherOpt);
  });
  teacherSelect.addEventListener('change', () => {
    newTeacherWrap.classList.toggle('hidden', teacherSelect.value !== 'new');
    $$('input', newTeacherWrap).forEach(i => i.required = teacherSelect.value === 'new');
  });

  // populate class & division dropdown from Classes page (sorted class desc, division asc)
  function populateClassDivision(list) {
    classDivisionSelect.innerHTML = '<option value="">Select</option>';
    const sorted = [...list].sort((a, b) => b.class.localeCompare(a.class) || a.division.localeCompare(b.division));
    sorted.forEach(c => {
      const opt = document.createElement('option');
      opt.value = `${c.class}|${c.division}`;
      opt.textContent = `${c.class} ${c.division}`;
      classDivisionSelect.appendChild(opt);
    });
    if (!sorted.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'No classes added yet — add one on the Classes page';
      classDivisionSelect.appendChild(opt);
    }
  }
  populateClassDivision(classes);

  // ---------- grid view ----------
  async function loadGrid() {
    const date = gridDateInput.value || todayStr();
    const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' });
    $('#tt-daylabel').textContent = dayName;

    const [entries, currentClasses] = await Promise.all([api('/timetable' + yearQS('date=' + date)), api('/classes' + yearQS())]);

    // columns: prefer configured classes; fall back to whatever is in the entries for this date
    let columns = [...currentClasses].sort((a, b) => b.class.localeCompare(a.class) || a.division.localeCompare(b.division))
      .map(c => ({ class: c.class, division: c.division }));
    if (!columns.length) {
      const seen = new Set();
      entries.forEach(e => {
        const key = `${e.class}|${e.division}`;
        if (!seen.has(key)) { seen.add(key); columns.push({ class: e.class, division: e.division }); }
      });
    }

    if (!columns.length) {
      $('#tt-grid').innerHTML = `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>Add some classes on the Classes page, then schedule a timetable entry to see the grid.</p></div>`;
      return;
    }

    // rows: unique time slots for this date, sorted chronologically
    const slotMap = new Map();
    entries.forEach(e => {
      const key = `${e.start_time}-${e.end_time}`;
      if (!slotMap.has(key)) slotMap.set(key, { start: e.start_time, end: e.end_time });
    });
    const slots = [...slotMap.values()].sort((a, b) => a.start.localeCompare(b.start));

    if (!slots.length) {
      $('#tt-grid').innerHTML = `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No classes scheduled for ${dayName}, ${date}.</p></div>`;
      return;
    }

    const thead = `<thead><tr><th>${dayName}</th>${columns.map(c => `<th>${c.class} ${c.division}</th>`).join('')}<th>Class Time</th></tr></thead>`;
    const rows = slots.map((slot, i) => {
      const cells = columns.map(col => {
        const entry = entries.find(e => e.start_time === slot.start && e.end_time === slot.end && e.class === col.class && e.division === col.division);
        if (!entry) return `<td class="tt-cell"><span class="tt-empty-cell">—</span></td>`;
        const colorClass = subjectColorClass(entry.subject);
        return `<td class="tt-cell filled" data-del="${entry.id}" title="Click to remove this class">
          <span class="tt-chip ${colorClass}">
            <span class="subj">${entry.subject || 'Class'}</span>
            <span class="teach">${teacherInitials(entry.teacher_name)}</span>
          </span>
        </td>`;
      }).join('');
      return `<tr><td class="tt-period-cell">${ordinals[i] || (i + 1) + 'th'}</td>${cells}<td class="tt-time-cell">${slot.start}–${slot.end}</td></tr>`;
    }).join('');

    $('#tt-grid').innerHTML = `<table class="tt-grid">${thead}<tbody>${rows}</tbody></table>`;

    $$('[data-del]', $('#tt-grid')).forEach(cell => cell.addEventListener('click', async () => {
      if (!confirm('Remove this scheduled class?')) return;
      await api('/timetable/' + cell.dataset.del, { method: 'DELETE' });
      toast('Entry removed.');
      loadGrid();
      loadList();
    }));
  }

  gridDateInput.addEventListener('change', loadGrid);
  $('#tt-prev-day').addEventListener('click', () => {
    const d = new Date(gridDateInput.value + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    gridDateInput.value = d.toISOString().slice(0, 10);
    loadGrid();
  });
  $('#tt-next-day').addEventListener('click', () => {
    const d = new Date(gridDateInput.value + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    gridDateInput.value = d.toISOString().slice(0, 10);
    loadGrid();
  });

  // ---------- list view ----------
  async function loadList() {
    const date = $('#tt-filter-date').value;
    const entries = await api('/timetable' + yearQS(date ? 'date=' + date : ''));
    $('#timetable-table').innerHTML = entries.length ? `
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Hours</th><th></th></tr></thead>
        <tbody>${entries.map(e => `
          <tr>
            <td>${e.date}</td><td class="mono">${e.start_time}–${e.end_time}</td>
            <td>${[e.class, e.division].filter(Boolean).join('-') || '—'}</td>
            <td>${e.subject || '—'}</td><td>${e.teacher_name}</td><td>${e.hours}</td>
            <td><button class="btn-icon" data-listdel="${e.id}">Remove</button></td>
          </tr>`).join('')}</tbody>
      </table>` : `<p class="empty-row">No classes scheduled${date ? ' for this date' : ''}.</p>`;

    $$('[data-listdel]').forEach(btn => btn.addEventListener('click', async () => {
      await api('/timetable/' + btn.dataset.listdel, { method: 'DELETE' });
      toast('Entry removed.');
      loadList();
      loadGrid();
    }));
  }

  $('#tt-filter-date').addEventListener('change', loadList);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!classDivisionSelect.value) { toast('Select a class & division.', true); return; }
    const [cls, division] = classDivisionSelect.value.split('|');
    const data = Object.fromEntries(new FormData(form).entries());
    data.class = cls;
    data.division = division;
    data.academic_year_id = currentYearId;
    try {
      const result = await api('/timetable', { method: 'POST', body: JSON.stringify(data) });
      toast(`Scheduled — ${result.hours} hour(s) logged to teacher's worklog.`);
      form.reset();
      form.elements['date'].value = todayStr();
      newTeacherWrap.classList.add('hidden');
      loadList();
      loadGrid();
      refreshTeacherOptions();
    } catch (err) { toast(err.message, true); }
  });

  async function refreshTeacherOptions() {
    const fresh = await api('/teachers');
    const existingIds = new Set([...teacherSelect.options].map(o => o.value));
    fresh.forEach(t => {
      if (!existingIds.has(String(t.id))) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.name} — ${t.subject || 'General'}`;
        teacherSelect.insertBefore(opt, teacherSelect.querySelector('option[value="new"]'));
      }
    });
  }

  await Promise.all([loadGrid(), loadList()]);
}

// =====================================================================
// QUICK MARK ENTRY
// =====================================================================
function markEntryEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function renderMarkEntry(resumeTestId = null) {
  useTemplate('#tpl-mark-entry');
  const dateEl = $('#me-date');
  const classEl = $('#me-class');
  const subjectEl = $('#me-subject');
  const topicEl = $('#me-topic');
  const maxMarksEl = $('#me-max-marks');
  const admissionEl = $('#me-admission');
  const markEl = $('#me-mark');
  const matchesEl = $('#me-student-matches');
  const selectedEl = $('#me-selected-student');
  const saveBtn = $('#me-save-mark');
  const clearBtn = $('#me-clear-student');
  const finishBtn = $('#me-finish-entry');
  const exportBtn = $('#me-export');
  const sessionStatus = $('#me-session-status');
  const saveStatus = $('#me-save-status');
  const workflowSteps = $$('.me-workflow-step');
  const markMaxLabel = $('#me-mark-max-label');
  let activeSession = false;
  let selectedStudent = null;
  let enteredMarks = [];
  let currentTestId = null;
  let searchSequence = 0;
  let saving = false;

  dateEl.value = todayStr();
  const updateWorkflowStage = stage => workflowSteps.forEach((step, index) => {
    step.classList.toggle('is-current', index + 1 === stage);
    step.classList.toggle('is-done', index + 1 < stage);
  });
  const updateMarkMaxLabel = () => { if (markMaxLabel) markMaxLabel.textContent = `/ ${maxMarksEl.value || 20}`; };
  updateWorkflowStage(1);
  updateMarkMaxLabel();
  const students = await api('/students' + yearQS());
  const classNames = [...new Set(students.map(s => String(s.class || '').trim()).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a) || b.localeCompare(a));
  classEl.innerHTML = '<option value="">Select class</option>' + classNames
    .map(cls => `<option value="${markEntryEscape(cls)}">Class ${markEntryEscape(cls)}</option>`).join('');

  const getMeta = () => ({
    test_date: dateEl.value,
    class: classEl.value,
    subject: subjectEl.value.trim(),
    topic: topicEl.value.trim(),
    max_marks: maxMarksEl.value || 20,
    academic_year_id: currentYearId,
  });
  const metaQuery = () => new URLSearchParams(getMeta()).toString();

  function clearStudentSelection() {
    selectedStudent = null;
    selectedEl.classList.add('hidden');
    selectedEl.innerHTML = '';
    markEl.value = '';
    markEl.disabled = true;
    saveBtn.disabled = true;
    clearBtn.disabled = true;
  }

  function renderEnteredMarks() {
    $('#me-mark-count').textContent = `${enteredMarks.length} student(s) saved to Weekly Tests`;
    exportBtn.disabled = !enteredMarks.length;
    $('#me-marklist').innerHTML = enteredMarks.length ? `
      <table>
        <thead><tr><th>#</th><th>Admission No.</th><th>Student</th><th>Class &amp; Div.</th><th>Mark</th><th>Out of</th></tr></thead>
        <tbody>${enteredMarks.map((m, i) => `
          <tr><td>${i + 1}</td><td class="mono">${markEntryEscape(m.admission_no)}</td>
          <td>${markEntryEscape(m.name)}</td><td>${markEntryEscape(m.class)} - ${markEntryEscape(m.division)}</td>
          <td><strong>${m.is_absent ? 'AB' : m.marks}</strong></td><td>${m.max_marks}</td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state"><p>No marks have been entered for this Weekly Test yet.</p></div>';
  }

  function renderStudentMatches(list, prefix) {
    if (!list.length) {
      matchesEl.innerHTML = `<p class="hint">No active student found in Class ${markEntryEscape(classEl.value)} for “${markEntryEscape(prefix)}”. Check the Admission Number and press Enter again.</p>`;
      return;
    }
    matchesEl.innerHTML = `<div class="hint" style="margin-bottom:7px;">${list.length > 1 ? 'More than one student matches. Select the correct student:' : 'Select the matching student:'}</div>
      <div class="me-match-list">${list.map((s, i) => `
        <button type="button" class="me-match-option" data-match-index="${i}">
          <strong>${markEntryEscape(s.admission_no)}</strong>
          <span>${markEntryEscape(s.name)}</span>
          <small>Class ${markEntryEscape(s.class)} - ${markEntryEscape(s.division)}</small>
        </button>`).join('')}</div>`;
    $$('.me-match-option', matchesEl).forEach(btn => btn.addEventListener('click', () => {
      const student = list[Number(btn.dataset.matchIndex)];
      selectedStudent = student;
      admissionEl.value = student.admission_no;
      admissionEl.disabled = true;
      matchesEl.innerHTML = '';
      selectedEl.classList.remove('hidden');
      selectedEl.innerHTML = `<strong>${markEntryEscape(student.name)}</strong><span>${markEntryEscape(student.admission_no)} · Class ${markEntryEscape(student.class)} - ${markEntryEscape(student.division)}</span>`;
      markEl.disabled = false;
      saveBtn.disabled = true;
      clearBtn.disabled = false;
      markEl.focus();
    }));
  }

  async function lookupAdmission() {
    if (!activeSession || saving) return;
    const prefix = admissionEl.value.trim();
    matchesEl.innerHTML = '';
    const seq = ++searchSequence;
    if (prefix.length < 3) {
      matchesEl.innerHTML = '<p class="hint error-text">Enter at least three characters. For Class 10, the first three digits are enough.</p>';
      admissionEl.focus();
      return;
    }
    admissionEl.disabled = true;
    saveStatus.textContent = 'Finding student…';
    try {
      const params = new URLSearchParams({ class: classEl.value, prefix, academic_year_id: currentYearId || '' });
      const list = await api('/mark-entry/students?' + params.toString());
      if (seq !== searchSequence || !activeSession) return;
      const exact = list.find(s => String(s.admission_no).toLowerCase() === prefix.toLowerCase());
      if (exact) {
        renderStudentMatches([exact], prefix);
        $('.me-match-option', matchesEl)?.click();
      } else if (list.length === 1) {
        renderStudentMatches(list, prefix);
        $('.me-match-option', matchesEl)?.click();
      } else {
        renderStudentMatches(list, prefix);
        saveStatus.textContent = list.length ? 'Select the correct student from the matching list.' : 'Student not found. Try again.';
        admissionEl.disabled = false;
        admissionEl.focus();
        return;
      }
      saveStatus.textContent = 'Student selected. Enter the mark and press Enter to save.';
    } catch (err) {
      if (seq === searchSequence) {
        matchesEl.innerHTML = `<p class="hint error-text">${markEntryEscape(err.message)}</p>`;
        admissionEl.disabled = false;
        admissionEl.focus();
        saveStatus.textContent = err.message;
      }
    }
  }

  async function loadSession() {
    if (activeSession && (selectedStudent || admissionEl.value.trim())) {
      toast('Save or clear the current student entry before restarting this session.', true);
      if (selectedStudent) markEl.focus(); else admissionEl.focus();
      return;
    }
    if (!dateEl.value || !classEl.value || !subjectEl.value.trim() || !topicEl.value.trim()) {
      toast('Enter the date, class, subject and topic first.', true);
      return;
    }
    const max = Number(maxMarksEl.value || 20);
    if (!Number.isFinite(max) || max <= 0 || max > 1000) {
      toast('Maximum marks must be greater than 0 and no more than 1000.', true);
      maxMarksEl.focus();
      return;
    }
    try {
      const startedTest = await api('/mark-entry/tests/start', {
        method: 'POST',
        body: JSON.stringify(getMeta()),
      });
      currentTestId = startedTest.id;
      if (startedTest.max_marks) maxMarksEl.value = startedTest.max_marks;
      const data = await api('/mark-entry/marks?' + metaQuery());
      currentTestId = data.test_id || currentTestId;
      if (data.max_marks) maxMarksEl.value = data.max_marks;
      enteredMarks = data.marks || [];
      activeSession = true;
      updateWorkflowStage(2);
      updateMarkMaxLabel();
      admissionEl.disabled = false;
      markEl.disabled = true;
      finishBtn.disabled = false;
      admissionEl.placeholder = classEl.value === '10' ? 'First 3 digits or full Admission Number' : 'Enter Admission Number';
      $('#me-admission-hint').textContent = classEl.value === '10'
        ? 'Type the first three digits (e.g. 101) or the full Admission Number, then press Enter.'
        : 'Type the Admission Number and press Enter. Then enter the mark and press Enter.';
      $('#me-entry-card').style.opacity = '1';
      sessionStatus.textContent = data.test_id
        ? `Weekly Test loaded · ${enteredMarks.length} mark(s) already saved. You can continue entering marks.`
        : 'Ready. This will be added directly to the Weekly Tests register when the first mark is saved.';
      matchesEl.innerHTML = '';
      admissionEl.value = '';
      clearStudentSelection();
      renderEnteredMarks();
      saveStatus.textContent = 'Enter Admission Number and press Enter.';
      admissionEl.focus();
    } catch (err) { toast(err.message, true); }
  }

  async function finishEntry() {
    if (!activeSession) return;
    if (saving) return;
    if (selectedStudent || admissionEl.value.trim()) {
      toast('Save or clear the current student entry before finishing.', true);
      if (selectedStudent) markEl.focus(); else admissionEl.focus();
      return;
    }
    const confirmed = confirm(`Finish mark entry for Class ${classEl.value} — ${subjectEl.value.trim()} — ${topicEl.value.trim()}?\n\n${enteredMarks.length} student mark(s) are saved in Weekly Tests.`);
    if (!confirmed) return;
    if (currentTestId) {
      try {
        await api(`/mark-entry/tests/${currentTestId}/finish`, {
          method: 'POST',
          body: JSON.stringify({ academic_year_id: currentYearId }),
        });
      } catch (err) {
        toast(`Could not finish this mark-entry session: ${err.message}`, true);
        return;
      }
    }
    activeSession = false;
    updateWorkflowStage(3);
    searchSequence++;
    admissionEl.disabled = true;
    markEl.disabled = true;
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    finishBtn.disabled = true;
    $('#me-entry-card').style.opacity = '.65';
    sessionStatus.textContent = `Mark entry finished · ${enteredMarks.length} student mark(s) saved to Weekly Tests.`;
    saveStatus.textContent = 'Entry session finished. Export the marklist or start/resume to continue.';
    toast('Mark entry finished. All saved marks are in Weekly Tests.');
  }

  async function saveMark() {
    if (!activeSession || !selectedStudent || saving) return;
    const markValue = markEl.value.trim();
    const mark = Number(markValue);
    const max = Number(maxMarksEl.value || 20);
    if (markValue === '' || !Number.isFinite(mark) || mark < 0 || mark > max) {
      toast(`Enter a mark between 0 and ${max}.`, true);
      markEl.focus();
      return;
    }
    const payload = { ...getMeta(), admission_no: selectedStudent.admission_no, marks: mark };
    saving = true;
    saveBtn.disabled = true;
    admissionEl.disabled = true;
    markEl.disabled = true;
    saveStatus.textContent = 'Saving mark to Weekly Tests…';
    try {
      let result;
      try {
        result = await api('/mark-entry/marks', { method: 'POST', body: JSON.stringify(payload) });
      } catch (err) {
        if (!err.message.includes('already been entered')) throw err;
        if (!confirm(`${err.message}\n\nDo you want to replace the existing mark?`)) {
          saveStatus.textContent = 'Existing mark was kept unchanged.';
          return;
        }
        result = await api('/mark-entry/marks', { method: 'POST', body: JSON.stringify({ ...payload, replace: true }) });
      }
      currentTestId = result.test_id || currentTestId;
      enteredMarks = result.marks || [];
      renderEnteredMarks();
      toast(`${result.student.name}: ${result.message}`);
      admissionEl.value = '';
      matchesEl.innerHTML = '';
      clearStudentSelection();
      saveStatus.textContent = 'Mark saved. Enter the next Admission Number and press Enter.';
    } catch (err) {
      toast(err.message, true);
      saveStatus.textContent = err.message;
      markEl.disabled = false;
      saveBtn.disabled = false;
    } finally {
      saving = false;
      if (activeSession) {
        if (selectedStudent) {
          // Keep the selected Admission Number fixed until this mark is saved or cleared.
          admissionEl.disabled = true;
          markEl.disabled = false;
          const n = Number(markEl.value);
          saveBtn.disabled = markEl.value.trim() === '' || !Number.isFinite(n) || n < 0 || n > Number(maxMarksEl.value || 20);
          if (!saveBtn.disabled) markEl.focus();
        } else {
          admissionEl.disabled = false;
          admissionEl.focus();
        }
      }
    }
  }

  $('#me-load-session').addEventListener('click', loadSession);
  maxMarksEl.addEventListener('input', updateMarkMaxLabel);
  [dateEl, classEl, subjectEl, topicEl, maxMarksEl].forEach(el => el.addEventListener('change', () => {
    if (activeSession || enteredMarks.length) {
      activeSession = false;
      searchSequence++;
      currentTestId = null;
      enteredMarks = [];
      clearStudentSelection();
      admissionEl.value = '';
      matchesEl.innerHTML = '';
      admissionEl.disabled = true;
      finishBtn.disabled = true;
      updateWorkflowStage(1);
      $('#me-entry-card').style.opacity = '.65';
      sessionStatus.textContent = 'Test details changed. Start / Resume Mark Entry again.';
      saveStatus.textContent = '';
      renderEnteredMarks();
    }
  }));

  admissionEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookupAdmission();
    }
    if (event.key === 'ArrowDown' && $('.me-match-option', matchesEl)) {
      event.preventDefault();
      $('.me-match-option', matchesEl).focus();
    }
  });
  markEl.addEventListener('input', () => {
    const n = Number(markEl.value);
    saveBtn.disabled = !selectedStudent || markEl.value.trim() === '' || !Number.isFinite(n) || n < 0 || n > Number(maxMarksEl.value || 20);
  });
  markEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveMark();
    }
  });
  clearBtn.addEventListener('click', () => {
    admissionEl.disabled = false;
    admissionEl.value = '';
    matchesEl.innerHTML = '';
    clearStudentSelection();
    saveStatus.textContent = 'Enter Admission Number and press Enter.';
    admissionEl.focus();
  });
  saveBtn.addEventListener('click', saveMark);
  finishBtn.addEventListener('click', finishEntry);

  exportBtn.addEventListener('click', () => {
    if (!enteredMarks.length) return;
    window.location.href = '/api/mark-entry/export?' + metaQuery();
  });
  renderEnteredMarks();

  // A Resume Entry action in the Weekly Tests register opens this screen with
  // its original metadata, switches the test back to in-progress, and loads the
  // already saved marks so the next student can be entered immediately.
  if (resumeTestId) {
    try {
      const test = await api(`/mark-entry/tests/${encodeURIComponent(resumeTestId)}` + yearQS());
      dateEl.value = test.test_date || '';
      classEl.value = String(test.class || '');
      subjectEl.value = test.subject || '';
      topicEl.value = test.topic || '';
      maxMarksEl.value = test.max_marks || 20;
      await loadSession();
      toast(`Resumed ${test.subject || test.exam_name}. Previously entered marks have been loaded.`);
    } catch (err) {
      toast(`Could not resume this Weekly Test: ${err.message}`, true);
      sessionStatus.textContent = err.message;
    }
  }
}


// =====================================================================
// IMPOSITIONS & OTHER ASSIGNMENTS — quick student-by-student entry
// =====================================================================
async function renderAssignments() {
  useTemplate('#tpl-assignments');
  const dateEl = $('#as-date');
  const dueDateEl = $('#as-due-date');
  const teacherEl = $('#as-teacher');
  const subjectEl = $('#as-subject');
  const classEl = $('#as-class');
  const divisionEl = $('#as-division');
  const admissionListEl = $('#as-admission-list');
  const typeEl = $('#as-type');
  const detailsEl = $('#as-details');
  const previewPanel = $('#as-preview-panel');
  const previewTable = $('#as-preview-table');
  const confirmBtn = $('#as-confirm');
  const previewBtn = $('#as-preview');
  const statusEl = $('#as-status');
  const addTeacherPanel = $('#as-add-teacher-panel');
  const newTeacherSubjectEl = $('#as-new-teacher-subject');
  const newTeacherNameEl = $('#as-new-teacher-name');
  const subjects = ['English', 'Hindi', 'History', 'Geography', 'Physics', 'Chemistry', 'Biology', 'Mathematics'];
  let teacherRoster = {};
  let previewData = null;
  let dueDateTouched = false;
  let allYearRecords = [];
  let records = [];
  let pendingRecords = [];
  let busy = false;

  const escape = markEntryEscape;
  const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addOneDay = value => {
    if (!value) return '';
    const d = new Date(`${value}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const queryYear = () => currentYearId ? `?academic_year_id=${encodeURIComponent(currentYearId)}` : '';
  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
  }
  function invalidatePreview() {
    previewData = null;
    previewPanel.classList.add('hidden');
    confirmBtn.disabled = true;
    previewBtn.disabled = busy;
  }
  function selectedMeta() {
    return {
      given_date: dateEl.value,
      due_date: dueDateEl.value,
      teacher_name: teacherEl.value,
      subject: subjectEl.value,
      class: classEl.value,
      division: divisionEl.value,
      assignment_type: typeEl.value,
      details: detailsEl.value.trim(),
      admission_numbers: admissionListEl.value,
      academic_year_id: currentYearId,
    };
  }
  function populateSubjectsForTeacher() {
    const teacherName = teacherEl.value;
    const available = subjects.filter(subject => (teacherRoster[subject] || []).some(t => t.teacher_name.toLowerCase() === teacherName.toLowerCase()));
    subjectEl.innerHTML = '<option value="">Select subject</option>' + available.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
    subjectEl.disabled = !teacherName || !available.length;
  }
  async function loadDivisions() {
    divisionEl.disabled = true;
    divisionEl.innerHTML = '<option value="">Loading divisions…</option>';
    if (!classEl.value) { divisionEl.innerHTML = '<option value="">Select class first</option>'; return; }
    try {
      const params = new URLSearchParams({ class: classEl.value, academic_year_id: currentYearId || '' });
      const divisions = await api('/assignments/divisions?' + params.toString());
      divisionEl.innerHTML = '<option value="">Select division</option>' + divisions.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
      divisionEl.disabled = false;
    } catch (err) { divisionEl.innerHTML = '<option value="">Could not load</option>'; toast(err.message, true); }
  }
  function statusBadge(status, dueDate) {
    if (status === 'Submitted') return '<span class="tag tt-c0">Submitted</span>';
    const today = localDate();
    return dueDate && dueDate < today ? '<span class="tag due">Overdue</span>' : '<span class="tag">Pending</span>';
  }
  function actionButton(row) {
    return row.submission_status === 'Submitted'
      ? `<button class="btn btn-ghost btn-small" data-as-pending="${row.id}">Mark Pending</button>`
      : `<button class="btn btn-primary btn-small" data-as-submitted="${row.id}">Mark Submitted</button>`;
  }
  function renderStats() {
    const pendingCount = pendingRecords.length;
    const submittedCount = allYearRecords.filter(r => (r.submission_status || 'Pending') === 'Submitted').length;
    const overdueCount = pendingRecords.filter(r => r.due_date && r.due_date < localDate()).length;
    $('#as-total-count').textContent = allYearRecords.length;
    $('#as-pending-count').textContent = pendingCount;
    $('#as-submitted-count').textContent = submittedCount;
    $('#as-overdue-count').textContent = overdueCount;
  }
  function renderPending() {
    $('#as-pending-list-count').textContent = `${pendingRecords.length} assignment(s) are awaiting submission.`;
    $('#as-pending-register').innerHTML = pendingRecords.length ? `<table><thead><tr><th>Due Date</th><th>Admission No.</th><th>Student</th><th>Class &amp; Div.</th><th>Subject</th><th>Teacher</th><th>Work Details</th><th>Status</th><th>Action</th></tr></thead><tbody>${pendingRecords.map(r => `
      <tr><td>${escape(r.due_date || '—')}</td><td class="mono">${escape(r.admission_no)}</td><td>${escape(r.student_name)}</td>
      <td>${escape(r.student_class)} - ${escape(r.student_division)}</td><td>${escape(r.subject)}</td><td>${escape(r.teacher_name)}</td>
      <td>${escape(r.details || '—')}</td><td>${statusBadge('Pending', r.due_date)}</td><td>${actionButton(r)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><p>No pending assignments. All recorded work has been submitted.</p></div>';
    bindSubmissionButtons($('#as-pending-register'));
  }
  function renderRegister() {
    $('#as-list-count').textContent = `${records.length} record(s) shown`;
    $('#as-register').innerHTML = records.length ? `<table><thead><tr><th>Given Date</th><th>Due Date</th><th>Status</th><th>Type</th><th>Admission No.</th><th>Student</th><th>Class &amp; Div.</th><th>Subject</th><th>Teacher</th><th>Work Details</th><th>Submission Date</th><th>Action</th></tr></thead><tbody>${records.map(r => `
      <tr><td>${escape(r.given_date)}</td><td>${escape(r.due_date || '—')}</td><td>${statusBadge(r.submission_status || 'Pending', r.due_date)}</td>
      <td>${escape(r.assignment_type)}</td><td class="mono">${escape(r.admission_no)}</td><td>${escape(r.student_name)}</td>
      <td>${escape(r.student_class)} - ${escape(r.student_division)}</td><td>${escape(r.subject)}</td><td>${escape(r.teacher_name)}</td>
      <td>${escape(r.details || '—')}</td><td>${escape(r.submitted_date || '—')}</td><td class="as-row-actions">${actionButton(r)} <button class="btn-icon" data-as-delete="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><p>No assignment records match these filters.</p></div>';
    bindSubmissionButtons($('#as-register'));
    $$('[data-as-delete]', $('#as-register')).forEach(btn => btn.addEventListener('click', async () => {
      const row = records.find(r => String(r.id) === btn.dataset.asDelete);
      if (!row || !confirm(`Delete this ${String(row.assignment_type).toLowerCase()} for ${row.student_name} (${row.admission_no})?`)) return;
      try { await api('/assignments/' + row.id, { method: 'DELETE' }); toast('Assignment record deleted.'); await refreshAssignments(); }
      catch (err) { toast(err.message, true); }
    }));
  }
  function bindSubmissionButtons(root) {
    $$('[data-as-submitted], [data-as-pending]', root).forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.asSubmitted || btn.dataset.asPending;
      const nextStatus = btn.dataset.asSubmitted ? 'Submitted' : 'Pending';
      if (nextStatus === 'Submitted' && !confirm('Mark this assignment as submitted?')) return;
      if (nextStatus === 'Pending' && !confirm('Return this assignment to Pending?')) return;
      btn.disabled = true;
      try {
        await api(`/assignments/${id}/submission`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, submitted_date: nextStatus === 'Submitted' ? localDate() : null }) });
        toast(nextStatus === 'Submitted' ? 'Submission recorded.' : 'Assignment marked pending.');
        await refreshAssignments();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    }));
  }
  async function loadRegister() {
    const params = new URLSearchParams();
    if (currentYearId) params.set('academic_year_id', currentYearId);
    for (const [id, key] of [['as-filter-date','date'], ['as-filter-status','submission_status'], ['as-filter-type','assignment_type'], ['as-filter-subject','subject'], ['as-filter-search','admission_no']]) {
      const value = $( `#${id}` ).value.trim(); if (value) params.set(key, value);
    }
    records = await api('/assignments?' + params.toString());
    renderRegister();
  }
  async function refreshAssignments() {
    const qs = queryYear();
    [allYearRecords, pendingRecords] = await Promise.all([api('/assignments' + qs), api('/assignments/pending' + qs)]);
    renderStats(); renderPending(); await loadRegister();
  }
  function renderPreview(data) {
    previewData = data;
    previewPanel.classList.remove('hidden');
    const summary = data.summary || {};
    $('#as-preview-summary').textContent = `${data.ready_count} ready to create · ${(summary.already_recorded || 0)} already recorded · ${(summary.not_found || 0) + (summary.wrong_division || 0) + (summary.invalid || 0) + (summary.ambiguous || 0) + (summary.duplicate_input || 0)} skipped / needs correction.`;
    const label = { matched:'Ready', already_recorded:'Already recorded', not_found:'Not found', wrong_division:'Wrong division', invalid:'Invalid number', ambiguous:'Ambiguous', duplicate_input:'Duplicate input' };
    previewTable.innerHTML = `<table><thead><tr><th>Entered Number</th><th>Admission No.</th><th>Student</th><th>Class &amp; Division</th><th>Result</th><th>Message</th></tr></thead><tbody>${data.rows.map(r => `
      <tr><td class="mono">${escape(r.input)}</td><td class="mono">${escape(r.admission_no || '—')}</td><td>${escape(r.name || '—')}</td>
      <td>${r.class ? `Class ${escape(r.class)} - ${escape(r.division)}` : '—'}</td><td><span class="tag ${r.status === 'matched' ? 'tt-c0' : (r.status === 'already_recorded' ? '' : 'due')}">${label[r.status] || escape(r.status)}</span></td><td>${escape(r.message || '')}</td></tr>`).join('')}</tbody></table>`;
    confirmBtn.disabled = !data.ready_count || busy;
  }
  async function previewBatch() {
    if (busy) return;
    const payload = selectedMeta();
    if (!payload.given_date || !payload.due_date || !payload.teacher_name || !payload.subject || !payload.class || !payload.division || !payload.admission_numbers.trim()) {
      setStatus('Complete the date, teacher, subject, class, division, Admission Numbers and due date.', true); return;
    }
    busy = true; previewBtn.disabled = true; confirmBtn.disabled = true; setStatus('Checking Admission Numbers…');
    try {
      const data = await api('/assignments/batch/preview', { method: 'POST', body: JSON.stringify(payload) });
      renderPreview(data); setStatus(`${data.ready_count} student(s) are ready for confirmation.`);
    } catch (err) { setStatus(err.message, true); toast(err.message, true); previewPanel.classList.add('hidden'); }
    finally { busy = false; previewBtn.disabled = false; if (previewData) confirmBtn.disabled = !previewData.ready_count; }
  }
  async function confirmBatch() {
    if (busy || !previewData || !previewData.ready_count) return;
    const admissionNos = previewData.rows.filter(r => r.status === 'matched').map(r => r.admission_no);
    if (!confirm(`Create assignments for ${admissionNos.length} student(s)?\nTeacher: ${teacherEl.value}\nSubject: ${subjectEl.value}\nClass: ${classEl.value} - ${divisionEl.value}\nDue date: ${dueDateEl.value}`)) return;
    busy = true; confirmBtn.disabled = true; previewBtn.disabled = true;
    try {
      const result = await api('/assignments/batch', { method: 'POST', body: JSON.stringify({ ...selectedMeta(), admission_nos: admissionNos }) });
      toast(`${result.saved_count} assignment(s) created.`);
      if (result.skipped_count) toast(`${result.skipped_count} duplicate(s) skipped.`, true);
      admissionListEl.value = ''; detailsEl.value = ''; previewData = null; previewPanel.classList.add('hidden');
      setStatus('Assignments created. Ready for the next batch.');
      await refreshAssignments(); admissionListEl.focus();
    } catch (err) { setStatus(err.message, true); toast(err.message, true); }
    finally { busy = false; previewBtn.disabled = false; confirmBtn.disabled = !previewData || !previewData.ready_count; }
  }
  function clearForm() {
    dateEl.value = localDate(); dueDateTouched = false; dueDateEl.value = addOneDay(dateEl.value);
    teacherEl.value = ''; populateSubjectsForTeacher(); classEl.value = ''; divisionEl.innerHTML = '<option value="">Select class first</option>'; divisionEl.disabled = true;
    typeEl.value = 'Imposition'; detailsEl.value = ''; admissionListEl.value = ''; invalidatePreview();
    setStatus('Form cleared. Ready to create a new assignment batch.');
  }

  // Initial data.
  async function refreshTeacherRoster(preferredTeacher = '') {
    const roster = await api('/assignments/teachers');
    teacherRoster = roster.teachers || {};
    const teacherNames = [...new Set(Object.values(teacherRoster).flat().map(t => t.teacher_name))].sort((a,b) => a.localeCompare(b));
    teacherEl.innerHTML = '<option value="">Select teacher</option>' + teacherNames.map(n => `<option value="${escape(n)}">${escape(n)}</option>`).join('');
    if (preferredTeacher && teacherNames.includes(preferredTeacher)) teacherEl.value = preferredTeacher;
    populateSubjectsForTeacher();
  }
  await refreshTeacherRoster();
  newTeacherSubjectEl.innerHTML = '<option value="">Select subject</option>' + subjects.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
  subjectEl.innerHTML = '<option value="">Select teacher first</option>';
  $('#as-filter-subject').innerHTML = '<option value="">All subjects</option>' + subjects.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
  const classes = await api('/assignments/classes' + queryYear());
  classEl.innerHTML = '<option value="">Select class</option>' + classes.map(v => `<option value="${escape(v)}">Class ${escape(v)}</option>`).join('');
  dateEl.value = localDate(); dueDateEl.value = addOneDay(dateEl.value);

  teacherEl.addEventListener('change', () => { populateSubjectsForTeacher(); invalidatePreview(); });
  $('#as-add-teacher').addEventListener('click', () => { addTeacherPanel.classList.remove('hidden'); newTeacherNameEl.focus(); });
  $('#as-cancel-add-teacher').addEventListener('click', () => { addTeacherPanel.classList.add('hidden'); newTeacherNameEl.value = ''; newTeacherSubjectEl.value = ''; });
  $('#as-save-teacher').addEventListener('click', async () => {
    const subject = newTeacherSubjectEl.value;
    const teacherName = newTeacherNameEl.value.trim();
    if (!subject || !teacherName) { toast('Select a subject and enter the teacher name.', true); return; }
    try {
      await api('/assignments/teachers', { method: 'POST', body: JSON.stringify({ subject, teacher_name: teacherName }) });
      await refreshTeacherRoster(teacherName);
      subjectEl.value = subject;
      addTeacherPanel.classList.add('hidden'); newTeacherNameEl.value = ''; newTeacherSubjectEl.value = '';
      invalidatePreview();
      toast(`${teacherName} added for ${subject}.`);
    } catch (err) { toast(err.message, true); }
  });
  subjectEl.addEventListener('change', invalidatePreview);
  classEl.addEventListener('change', async () => { await loadDivisions(); invalidatePreview(); });
  divisionEl.addEventListener('change', invalidatePreview);
  dateEl.addEventListener('change', () => { if (!dueDateTouched) dueDateEl.value = addOneDay(dateEl.value); invalidatePreview(); });
  dueDateEl.addEventListener('input', () => { dueDateTouched = true; invalidatePreview(); });
  [typeEl, detailsEl, admissionListEl].forEach(el => el.addEventListener('input', invalidatePreview));
  $('#as-preview').addEventListener('click', previewBatch);
  $('#as-confirm').addEventListener('click', confirmBatch);
  $('#as-clear').addEventListener('click', clearForm);
  $('#as-refresh-pending').addEventListener('click', () => refreshAssignments().catch(err => toast(err.message, true)));
  $('#as-export-pending').addEventListener('click', () => {
    if (!pendingRecords.length) { toast('There are no pending assignments to export.', true); return; }
    const params = new URLSearchParams(); if (currentYearId) params.set('academic_year_id', currentYearId);
    window.location.href = '/api/assignments/pending/export?' + params.toString();
  });
  $('#as-export').addEventListener('click', () => {
    if (!records.length) { toast('There are no assignment records to export.', true); return; }
    const params = new URLSearchParams(); if (currentYearId) params.set('academic_year_id', currentYearId);
    for (const [id,key] of [['as-filter-date','date'],['as-filter-status','submission_status'],['as-filter-type','assignment_type'],['as-filter-subject','subject'],['as-filter-search','admission_no']]) { const v = $(`#${id}`).value.trim(); if (v) params.set(key,v); }
    window.location.href = '/api/assignments/export?' + params.toString();
  });
  $('#as-filter-date').addEventListener('change', loadRegister);
  $('#as-filter-status').addEventListener('change', loadRegister);
  $('#as-filter-type').addEventListener('change', loadRegister);
  $('#as-filter-subject').addEventListener('change', loadRegister);
  $('#as-filter-search').addEventListener('input', () => { clearTimeout($('#as-filter-search')._timer); $('#as-filter-search')._timer = setTimeout(loadRegister, 250); });
  $('#as-filter-clear').addEventListener('click', () => { ['as-filter-date','as-filter-status','as-filter-type','as-filter-subject','as-filter-search'].forEach(id => $(`#${id}`).value = ''); loadRegister(); });
  await refreshAssignments();
}

// =====================================================================
// LATE ARRIVAL ADDITIONAL WORK — batch entry and submission tracking
// =====================================================================
async function renderLateArrivalWork() {
  useTemplate('#tpl-late-arrival-work');
  const dateEl = $('#la-date');
  const admissionListEl = $('#la-admission-list');
  const previewPanel = $('#la-preview-panel');
  const previewTable = $('#la-preview-table');
  const previewBtn = $('#la-preview');
  const finishBtn = $('#la-finish');
  const statusEl = $('#la-status');
  const escape = markEntryEscape;
  let previewData = null;
  let allRecords = [];
  let pendingRecords = [];
  let records = [];
  let busy = false;

  const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addOneDay = value => {
    if (!value) return '';
    const d = new Date(`${value}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const yearQuery = () => currentYearId ? `?academic_year_id=${encodeURIComponent(currentYearId)}` : '';
  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
  }
  function invalidatePreview() {
    previewData = null;
    previewPanel.classList.add('hidden');
    finishBtn.disabled = true;
    previewBtn.disabled = busy;
  }
  function selectedMeta() {
    return { late_date: dateEl.value, admission_numbers: admissionListEl.value, academic_year_id: currentYearId };
  }
  function statusBadge(row) {
    if (row.submission_status === 'Submitted') return '<span class="tag tt-c0">Submitted</span>';
    return row.due_date && row.due_date < localDate() ? '<span class="tag due">Overdue</span>' : '<span class="tag">Pending</span>';
  }
  function statusAction(row) {
    return row.submission_status === 'Submitted'
      ? `<button class="btn btn-ghost btn-small" data-la-pending="${row.id}">Mark Pending</button>`
      : `<button class="btn btn-primary btn-small" data-la-submitted="${row.id}">Mark Submitted</button>`;
  }
  function renderStats() {
    const pending = pendingRecords.length;
    const submitted = allRecords.filter(r => r.submission_status === 'Submitted').length;
    const overdue = pendingRecords.filter(r => r.due_date && r.due_date < localDate()).length;
    $('#la-total-count').textContent = allRecords.length;
    $('#la-pending-count').textContent = pending;
    $('#la-submitted-count').textContent = submitted;
    $('#la-overdue-count').textContent = overdue;
  }
  function bindStatusActions(root) {
    $$('[data-la-submitted], [data-la-pending]', root).forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.laSubmitted || btn.dataset.laPending;
      const next = btn.dataset.laSubmitted ? 'Submitted' : 'Pending';
      if (!confirm(next === 'Submitted' ? 'Mark this late-arrival work as submitted?' : 'Return this late-arrival work to Pending?')) return;
      btn.disabled = true;
      try {
        await api(`/late-arrivals/${id}/submission`, { method: 'PATCH', body: JSON.stringify({ status: next, submitted_date: next === 'Submitted' ? localDate() : null }) });
        toast(next === 'Submitted' ? 'Submission recorded.' : 'Work returned to pending.');
        await refresh();
      } catch (err) { btn.disabled = false; toast(err.message, true); }
    }));
  }
  function renderPending() {
    $('#la-pending-list-count').textContent = `${pendingRecords.length} late-arrival work record(s) are awaiting submission.`;
    $('#la-pending-register').innerHTML = pendingRecords.length ? `<table><thead><tr><th>Late Date</th><th>Due Date</th><th>Admission No.</th><th>Student</th><th>Class &amp; Div.</th><th>Status</th><th>Action</th></tr></thead><tbody>${pendingRecords.map(r => `
      <tr><td>${escape(r.late_date)}</td><td>${escape(r.due_date)}</td><td class="mono">${escape(r.admission_no)}</td><td>${escape(r.student_name)}</td>
      <td>${escape(r.student_class)} - ${escape(r.student_division)}</td><td>${statusBadge(r)}</td><td>${statusAction(r)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-state"><p>No pending late-arrival work. All recorded work has been submitted.</p></div>';
    bindStatusActions($('#la-pending-register'));
  }
  function renderRegister() {
    $('#la-list-count').textContent = `${records.length} record(s) shown`;
    $('#la-register').innerHTML = records.length ? `<table><thead><tr><th>Late Date</th><th>Due Date</th><th>Status</th><th>Admission No.</th><th>Student</th><th>Class &amp; Div.</th><th>Work</th><th>Submitted Date</th><th>Action</th></tr></thead><tbody>${records.map(r => `
      <tr><td>${escape(r.late_date)}</td><td>${escape(r.due_date)}</td><td>${statusBadge(r)}</td><td class="mono">${escape(r.admission_no)}</td>
      <td>${escape(r.student_name)}</td><td>${escape(r.student_class)} - ${escape(r.student_division)}</td><td>${escape(r.details || 'Additional work for late arrival')}</td>
      <td>${escape(r.submitted_date || '—')}</td><td class="la-row-actions">${statusAction(r)} <button class="btn-icon" data-la-delete="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-state"><p>No late-arrival work matches these filters.</p></div>';
    bindStatusActions($('#la-register'));
    $$('[data-la-delete]', $('#la-register')).forEach(btn => btn.addEventListener('click', async () => {
      const row = records.find(r => String(r.id) === btn.dataset.laDelete);
      if (!row || !confirm(`Delete late-arrival work for ${row.student_name} (${row.admission_no}) dated ${row.late_date}? This will also remove it from the student's performance report.`)) return;
      btn.disabled = true;
      try { await api('/late-arrivals/' + row.id, { method: 'DELETE' }); toast('Late-arrival work deleted.'); await refresh(); }
      catch (err) { btn.disabled = false; toast(err.message, true); }
    }));
  }
  async function loadRegister() {
    const params = new URLSearchParams();
    if (currentYearId) params.set('academic_year_id', currentYearId);
    for (const [id, key] of [['la-filter-date','date'], ['la-filter-status','submission_status'], ['la-filter-class','class'], ['la-filter-division','division'], ['la-filter-search','admission_no']]) {
      const value = $(`#${id}`).value.trim(); if (value) params.set(key, value);
    }
    records = await api('/late-arrivals?' + params.toString());
    renderRegister();
  }
  async function refresh() {
    const qs = yearQuery();
    [allRecords, pendingRecords] = await Promise.all([api('/late-arrivals' + qs), api('/late-arrivals/pending' + qs)]);
    renderStats(); renderPending(); await loadRegister();
  }
  function renderPreview(data) {
    previewData = data;
    previewPanel.classList.remove('hidden');
    const summary = data.summary || {};
    const skipped = Object.entries(summary).filter(([k]) => k !== 'matched').reduce((n, [,v]) => n + v, 0);
    $('#la-preview-summary').textContent = `${data.ready_count} student(s) ready · ${summary.already_recorded || 0} already recorded · ${skipped} skipped / need correction.`;
    $('#la-preview-due').textContent = data.due_date || addOneDay(dateEl.value);
    const labels = { matched:'Ready', already_recorded:'Already recorded', not_found:'Not found', invalid:'Invalid number', ambiguous:'Ambiguous', duplicate_input:'Duplicate input' };
    previewTable.innerHTML = `<table><thead><tr><th>Entered Number</th><th>Admission No.</th><th>Student</th><th>Class &amp; Division</th><th>Result</th><th>Message</th></tr></thead><tbody>${data.rows.map(r => `
      <tr><td class="mono">${escape(r.input)}</td><td class="mono">${escape(r.admission_no || '—')}</td><td>${escape(r.name || '—')}</td>
      <td>${r.class ? `Class ${escape(r.class)} - ${escape(r.division)}` : '—'}</td><td><span class="tag ${r.status === 'matched' ? 'tt-c0' : (r.status === 'already_recorded' ? '' : 'due')}">${labels[r.status] || escape(r.status)}</span></td><td>${escape(r.message || '')}</td></tr>`).join('')}</tbody></table>`;
    finishBtn.disabled = !data.ready_count || busy;
  }
  async function previewBatch() {
    if (busy) return;
    const payload = selectedMeta();
    if (!payload.late_date || !payload.admission_numbers.trim()) { setStatus('Enter the late-arrival date and Admission Numbers.', true); return; }
    busy = true; previewBtn.disabled = true; finishBtn.disabled = true; setStatus('Checking Admission Numbers…');
    try {
      const data = await api('/late-arrivals/batch/preview', { method: 'POST', body: JSON.stringify(payload) });
      renderPreview(data); setStatus(`${data.ready_count} student(s) are ready. Review the preview, then Finish.`);
    } catch (err) { toast(err.message, true); setStatus(err.message, true); previewPanel.classList.add('hidden'); }
    finally { busy = false; previewBtn.disabled = false; if (previewData) finishBtn.disabled = !previewData.ready_count; }
  }
  function selectedMeta() { return { late_date: dateEl.value, admission_numbers: admissionListEl.value, academic_year_id: currentYearId }; }
  async function finishBatch() {
    if (busy || !previewData || !previewData.ready_count) return;
    const admissionNos = previewData.rows.filter(r => r.status === 'matched').map(r => r.admission_no);
    const dueDate = previewData.due_date;
    if (!confirm(`Finish and save late-arrival work for ${admissionNos.length} student(s) across all classes and divisions?\nDate: ${dateEl.value}\nDue date: ${dueDate}`)) return;
    busy = true; finishBtn.disabled = true; previewBtn.disabled = true;
    try {
      const result = await api('/late-arrivals/batch', { method: 'POST', body: JSON.stringify({ late_date: dateEl.value, admission_nos: admissionNos, academic_year_id: currentYearId }) });
      toast(`${result.saved_count} late-arrival work record(s) saved.`);
      admissionListEl.value = ''; invalidatePreview(); setStatus('Late-arrival work saved. Ready to record more students from any class.');
      await refresh(); admissionListEl.focus();
    } catch (err) { toast(err.message, true); setStatus(err.message, true); }
    finally { busy = false; previewBtn.disabled = false; finishBtn.disabled = !previewData || !previewData.ready_count; }
  }
  function clearForm() {
    dateEl.value = localDate(); admissionListEl.value = '';
    invalidatePreview(); setStatus('Form cleared. Ready to record late-arrival work from any class.');
  }

  dateEl.value = localDate();
  const classes = await api('/late-arrivals/classes' + yearQuery());
  $('#la-filter-class').innerHTML = '<option value="">All classes</option>' + classes.map(v => `<option value="${escape(v)}">Class ${escape(v)}</option>`).join('');
  $('#la-filter-division').innerHTML = '<option value="">All divisions</option>';

  [dateEl, admissionListEl].forEach(el => el.addEventListener(el === admissionListEl ? 'input' : 'change', invalidatePreview));
  previewBtn.addEventListener('click', previewBatch);
  finishBtn.addEventListener('click', finishBatch);
  $('#la-clear').addEventListener('click', clearForm);
  $('#la-refresh-pending').addEventListener('click', () => refresh().catch(err => toast(err.message, true)));
  $('#la-filter-date').addEventListener('change', loadRegister);
  $('#la-filter-status').addEventListener('change', loadRegister);
  $('#la-filter-class').addEventListener('change', async () => {
    const filterClass = $('#la-filter-class').value;
    const divEl = $('#la-filter-division');
    if (!filterClass) { divEl.innerHTML = '<option value="">All divisions</option>'; }
    else {
      const params = new URLSearchParams({ class: filterClass, academic_year_id: currentYearId || '' });
      const divs = await api('/late-arrivals/divisions?' + params.toString());
      divEl.innerHTML = '<option value="">All divisions</option>' + divs.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join('');
    }
    await loadRegister();
  });
  $('#la-filter-division').addEventListener('change', loadRegister);
  $('#la-filter-search').addEventListener('input', () => { clearTimeout($('#la-filter-search')._timer); $('#la-filter-search')._timer = setTimeout(loadRegister, 250); });
  $('#la-filter-clear').addEventListener('click', () => {
    ['la-filter-date','la-filter-status','la-filter-class','la-filter-division','la-filter-search'].forEach(id => $(`#${id}`).value = '');
    $('#la-filter-division').innerHTML = '<option value="">All divisions</option>'; loadRegister();
  });
  $('#la-export-pending').addEventListener('click', () => {
    if (!pendingRecords.length) { toast('There are no pending late-arrival records to export.', true); return; }
    const params = new URLSearchParams(); if (currentYearId) params.set('academic_year_id', currentYearId);
    window.location.href = '/api/late-arrivals/pending/export?' + params.toString();
  });
  $('#la-export').addEventListener('click', () => {
    if (!records.length) { toast('There are no late-arrival records to export.', true); return; }
    const params = new URLSearchParams(); if (currentYearId) params.set('academic_year_id', currentYearId);
    for (const [id,key] of [['la-filter-date','date'],['la-filter-status','submission_status'],['la-filter-class','class'],['la-filter-division','division'],['la-filter-search','admission_no']]) { const v = $(`#${id}`).value.trim(); if (v) params.set(key,v); }
    window.location.href = '/api/late-arrivals/export?' + params.toString();
  });
  await refresh();
}

// =====================================================================
// WEEKLY TESTS
// =====================================================================
function gradeColor(pct) {
  if (pct >= 90) return 'tt-c0';
  if (pct >= 75) return 'tt-c3';
  if (pct >= 50) return 'tt-c4';
  if (pct >= 35) return 'tt-c1';
  return 'tt-c2';
}

async function renderWeeklyTests() {
  useTemplate('#tpl-weekly-tests');
  const tests = await api('/weekly-tests' + yearQS());

  $('#wt-list').innerHTML = tests.length ? `
    <table>
      <thead><tr><th>Date</th><th>Exam</th><th>Class</th><th>Present</th><th>Absent</th><th>Average</th><th>Pass Rate</th><th>Entry Status</th><th></th></tr></thead>
      <tbody>${tests.map(t => {
        const avgPct = t.average != null ? Math.round((t.average / t.max_marks) * 1000) / 10 : null;
        return `<tr>
          <td>${t.test_date}</td>
          <td>${t.subject ? `${t.subject}${t.topic ? ' — ' + t.topic : ''}` : t.exam_name}</td>
          <td>${t.class ? `Class ${t.class}` : '—'}</td>
          <td>${t.presentCount}</td>
          <td>${t.absentCount > 0 ? `<span class="tag due">${t.absentCount}</span>` : '0'}</td>
          <td>${t.average} / ${t.max_marks}${avgPct !== null ? ` <span class="mono" style="color:var(--text-mute);">(${avgPct}%)</span>` : ''}</td>
          <td>${t.passRate}%</td>
          <td><span class="tag ${t.entry_status === 'in_progress' ? 'due' : ''}">${t.entry_status === 'in_progress' ? 'In Progress' : 'Finished'}</span></td>
          <td>
            <button class="btn-icon" data-resume-entry="${t.id}">${t.entry_status === 'in_progress' ? 'Resume Entry' : 'Open / Edit Marks'}</button>
            <a href="/weekly-test-report.html?id=${t.id}" target="_blank" rel="noopener" class="btn-icon">Report</a>
            <button class="btn-icon" data-del="${t.id}">Remove</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No weekly tests imported yet for this academic year. Head to Import Data to add marks.</p></div>`;

  $$('[data-resume-entry]').forEach(btn => btn.addEventListener('click', () => {
    location.hash = `mark-entry/${encodeURIComponent(btn.dataset.resumeEntry)}`;
  }));

  $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this weekly test and all its marks? This cannot be undone.')) return;
    await api('/weekly-tests/' + btn.dataset.del, { method: 'DELETE' });
    toast('Weekly test deleted.');
    renderWeeklyTests();
  }));

  async function loadTopPerformers() {
    const limit = $('#wt-top-limit').value;
    $('#wt-top-report-link').href = `/top-performers-report.html?limit=${limit}${currentYearId ? '&academic_year_id=' + currentYearId : ''}`;
    const data = await api('/weekly-tests/top-performers' + yearQS('limit=' + limit));
    const rankClass = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';

    $('#wt-top-performers').innerHTML = data.classes.length ? `
      <div class="top-performers-grid">
        ${data.classes.map(cls => `
          <div class="tp-class-col">
            <div class="tp-class-head">Class ${cls}</div>
            ${data.byClass[cls].map((s, i) => `
              <div class="tp-row clickable" onclick="location.hash='student/${encodeURIComponent(s.admission_no)}'">
                <span class="tp-rank ${rankClass(i)}">${s.rank}</span>
                <span class="tp-name">${s.name} <span class="division">(${s.class}-${s.division})</span></span>
                <span class="tp-avg">${s.average}%</span>
              </div>`).join('')}
          </div>`).join('')}
      </div>` : `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No weekly test marks yet — import some to see the leaderboard.</p></div>`;
  }

  $('#wt-top-limit').addEventListener('change', loadTopPerformers);
  await loadTopPerformers();

  async function loadMostImproved() {
    const limit = $('#wt-improved-limit').value;
    $('#wt-improved-report-link').href = `/most-improved-report.html?limit=${limit}${currentYearId ? '&academic_year_id=' + currentYearId : ''}`;
    const data = await api('/weekly-tests/most-improved' + yearQS('limit=' + limit));
    const rankClass = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';

    $('#wt-improved-list').innerHTML = data.classes.length ? `
      <div class="top-performers-grid">
        ${data.classes.map(cls => `
          <div class="tp-class-col">
            <div class="tp-class-head">Class ${cls}</div>
            ${data.byClass[cls].map((s, i) => `
              <div class="tp-row clickable" onclick="location.hash='student/${encodeURIComponent(s.admission_no)}'">
                <span class="tp-rank ${rankClass(i)}">${s.rank}</span>
                <span class="tp-name">${s.name} <span class="division">(${s.class}-${s.division})</span></span>
                <span class="tp-scoreline">${s.earlier_avg}% → ${s.recent_avg}%</span>
                <span class="tp-improve-badge">+${s.improvement}%</span>
              </div>`).join('')}
          </div>`).join('')}
      </div>` : `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No students with a clear upward trend yet — this needs at least 3 weekly tests per student to spot a trend.</p></div>`;
  }

  $('#wt-improved-limit').addEventListener('change', loadMostImproved);
  await loadMostImproved();
}

// =====================================================================
// TERM EXAMS
// =====================================================================
async function renderTermExams() {
  useTemplate('#tpl-term-exams');
  const exams = await api('/term-exams' + yearQS());

  $('#te-list').innerHTML = exams.length ? `
    <table>
      <thead><tr><th>Date</th><th>Exam</th><th>Class</th><th>Subjects</th><th>Students</th><th>Average</th><th>Highest</th><th>Lowest</th><th></th></tr></thead>
      <tbody>${exams.map(e => `
        <tr>
          <td>${e.exam_date}</td>
          <td>${e.exam_name}</td>
          <td>${e.class ? `Class ${e.class}` : '—'}</td>
          <td>${e.subjectCount}</td>
          <td>${e.studentCount}</td>
          <td>${e.average !== null ? e.average + '%' : '—'}</td>
          <td>${e.highest !== null ? e.highest + '%' : '—'}</td>
          <td>${e.lowest !== null ? e.lowest + '%' : '—'}</td>
          <td>
            <a href="/term-exam-report.html?id=${e.id}" target="_blank" rel="noopener" class="btn-icon">Report</a>
            <button class="btn-icon" data-del="${e.id}">Remove</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>` : `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No term exams imported yet for this academic year. Head to Import Data to add a marklist.</p></div>`;

  $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this term exam and all its marks? This cannot be undone.')) return;
    await api('/term-exams/' + btn.dataset.del, { method: 'DELETE' });
    toast('Term exam deleted.');
    renderTermExams();
  }));
}

// =====================================================================
// HOT SEAT
// =====================================================================
function perfBadgeClass(perf) {
  const key = (perf || '').toLowerCase().replace(/\s+/g, '');
  return { excellent: 'perf-excellent', verygood: 'perf-verygood', good: 'perf-good', average: 'perf-average', poor: 'perf-poor' }[key] || '';
}

async function renderHotSeat() {
  useTemplate('#tpl-hot-seat');
  const form = $('#hot-seat-form');
  form.elements['date'].value = todayStr();
  let currentStudent = null;
  let editingId = null;

  $('#hs-adm').addEventListener('input', debounce(async () => {
    const adm = $('#hs-adm').value.trim();
    if (!adm) { clearHsFields(); return; }
    try {
      const s = await api('/students/' + encodeURIComponent(adm));
      currentStudent = s;
      $('#hs-name').value = s.name;
      $('#hs-class').value = `${s.class}-${s.division}`;
      $('#hs-school').value = s.school === 'Others' ? (s.school_other || 'Others') : s.school;
    } catch (err) {
      currentStudent = null;
      clearHsFields();
    }
  }, 300));

  function clearHsFields() {
    $('#hs-name').value = '';
    $('#hs-class').value = '';
    $('#hs-school').value = '';
  }

  function resetForm() {
    form.reset();
    form.elements['date'].value = todayStr();
    form.elements['id'].value = '';
    $('#hs-adm').removeAttribute('readonly');
    clearHsFields();
    currentStudent = null;
    editingId = null;
    $('#hs-form-title').textContent = 'Add Hot Seat Record';
    $('#hs-submit').textContent = 'Add Record';
    $('#hs-cancel-edit').classList.add('hidden');
  }

  $('#hs-cancel-edit').addEventListener('click', resetForm);

  async function loadList() {
    const q = $('#hs-search').value.trim();
    const params = new URLSearchParams();
    if (currentYearId) params.set('academic_year_id', currentYearId);
    if (q) params.set('q', q);
    const records = await api('/hot-seats?' + params.toString());

    $('#hs-table').innerHTML = records.length ? `
      <table>
        <thead><tr><th>Date</th><th>Adm. No.</th><th>Name</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Performance</th><th>Checklist</th><th></th></tr></thead>
        <tbody>${records.map(r => {
          const icons = [];
          if (r.notes_completed) icons.push('<span class="ci-yes" title="Notes Completed">✓Notes</span>');
          if (r.notebook_neat) icons.push('<span class="ci-yes" title="Notebook Neat">✓Book</span>');
          if (r.questions_answered) icons.push('<span class="ci-yes" title="Questions Answered">✓Qs</span>');
          if (r.good_attention_span) icons.push('<span class="ci-yes" title="Good Attention Span">✓Focus</span>');
          if (r.no_notebook) icons.push('<span class="ci-alert" title="No Notebook">!Notebook</span>');
          if (r.no_textbook) icons.push('<span class="ci-alert" title="No Text Book">!Textbook</span>');
          return `<tr>
            <td>${r.date}</td>
            <td class="mono clickable" onclick="location.hash='student/${encodeURIComponent(r.admission_no)}'">${r.admission_no}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(r.admission_no)}'">${r.student_name}</td>
            <td>${r.student_class}-${r.student_division}</td>
            <td>${r.subject || '—'}</td>
            <td>${r.teacher || '—'}</td>
            <td>${r.performance ? `<span class="perf-badge ${perfBadgeClass(r.performance)}">${r.performance}</span>` : '—'}</td>
            <td><div class="checklist-icons">${icons.join(' ') || '<span style="color:var(--text-mute);">—</span>'}</div></td>
            <td>
              <button class="btn-icon" data-edit="${r.id}">Edit</button>
              <button class="btn-icon" data-del="${r.id}">Remove</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : `<div class="empty-state"><img src="/images/mascot-main.png" alt="Nubo" /><p>No Hot Seat records yet.</p></div>`;

    $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this Hot Seat record?')) return;
      await api('/hot-seats/' + btn.dataset.del, { method: 'DELETE' });
      toast('Hot Seat record deleted.');
      loadList();
    }));
    $$('[data-edit]').forEach(btn => btn.addEventListener('click', async () => {
      const r = await api('/hot-seats/' + btn.dataset.edit);
      editingId = r.id;
      form.elements['id'].value = r.id;
      $('#hs-adm').value = r.admission_no;
      $('#hs-adm').setAttribute('readonly', 'true');
      $('#hs-name').value = r.student_name;
      $('#hs-class').value = `${r.student_class}-${r.student_division}`;
      $('#hs-school').value = r.student_school === 'Others' ? (r.school_other || 'Others') : r.student_school;
      currentStudent = { admission_no: r.admission_no };
      form.elements['date'].value = r.date;
      form.elements['subject'].value = r.subject || '';
      form.elements['teacher'].value = r.teacher || '';
      form.elements['performance'].value = r.performance || '';
      form.elements['remarks'].value = r.remarks || '';
      form.elements['parent_feedback'].value = r.parent_feedback || '';
      ['notes_completed', 'notebook_neat', 'questions_answered', 'good_attention_span', 'no_notebook', 'no_textbook'].forEach(k => {
        form.elements[k].checked = !!r[k];
      });
      $('#hs-form-title').textContent = 'Edit Hot Seat Record';
      $('#hs-submit').textContent = 'Save Changes';
      $('#hs-cancel-edit').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  $('#hs-search').addEventListener('input', debounce(loadList, 250));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentStudent) { toast('Enter a valid Admission Number first.', true); return; }
    const formData = new FormData(form);
    const data = {};
    formData.forEach((v, k) => { if (k !== 'id') data[k] = v; });
    ['notes_completed', 'notebook_neat', 'questions_answered', 'good_attention_span', 'no_notebook', 'no_textbook'].forEach(k => {
      data[k] = form.elements[k].checked;
    });
    try {
      if (editingId) {
        await api('/hot-seats/' + editingId, { method: 'PUT', body: JSON.stringify(data) });
        toast('Hot Seat record updated.');
      } else {
        data.academic_year_id = currentYearId;
        await api('/hot-seats', { method: 'POST', body: JSON.stringify(data) });
        toast('Hot Seat record added.');
      }
      resetForm();
      loadList();
    } catch (err) {
      toast(err.message, true);
    }
  });

  await loadList();
}

// =====================================================================
// IMPORT DATA
// =====================================================================
function escapeImportHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function renderImportSummary(container, result) {
  const skippedCount = result.skipped ? result.skipped.length : 0;
  const isFeeImport = 'feesUpdated' in result;
  const summary = isFeeImport ? `
    <div class="import-summary">
      <div class="isum"><div class="n">${result.feesUpdated ?? 0}</div><div class="l">Fees Updated</div></div>
      <div class="isum"><div class="n">${result.paymentsAdjusted ?? 0}</div><div class="l">Payments Adjusted</div></div>
      <div class="isum ${skippedCount ? 'warn' : ''}"><div class="n">${skippedCount}</div><div class="l">Needs Attention</div></div>
    </div>` : `
    <div class="import-summary">
      <div class="isum"><div class="n">${result.inserted ?? 0}</div><div class="l">Added</div></div>
      <div class="isum"><div class="n">${result.updated ?? 0}</div><div class="l">Updated</div></div>
      ${'unchanged' in result ? `<div class="isum"><div class="n">${result.unchanged ?? 0}</div><div class="l">Unchanged</div></div>` : ''}
      <div class="isum ${skippedCount ? 'warn' : ''}"><div class="n">${skippedCount}</div><div class="l">Needs Attention</div></div>
    </div>`;
  let skipTable = '';
  if (skippedCount) {
    const rows = result.skipped.map(s => `<tr>
      <td>${s.sheet ? escapeImportHtml(s.sheet) + ' · ' : ''}Row ${escapeImportHtml(s.row)}</td>
      <td>${escapeImportHtml(s.admission_no || s.name || s.class || '—')}</td>
      <td>${s.value ? `<span class="mono">${escapeImportHtml(s.value)}</span>` : ''}</td>
      <td>${escapeImportHtml(s.reason)}</td>
    </tr>`).join('');
    skipTable = `<div class="import-skip-table table-wrap"><table>
      <thead><tr><th>Location</th><th>Reference</th><th>Value</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  container.innerHTML = `<div class="import-result">${summary}${skipTable}</div>`;
}

function wireImportCard({ fileInputId, filenameId, submitId, resultId, endpoint, toastText, afterSuccess, taggedByYear, getExtraFields, validate }) {
  const fileInput = $(fileInputId);
  const filenameEl = $(filenameId);
  const submitBtn = $(submitId);
  const resultEl = $(resultId);
  let selectedFile = null;

  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files[0] || null;
    filenameEl.textContent = selectedFile ? selectedFile.name : '';
    submitBtn.disabled = !selectedFile;
    resultEl.innerHTML = '';
  });

  submitBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    if (validate) {
      const problem = validate();
      if (problem) { toast(problem, true); return; }
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing…';
    try {
      const extra = { ...(taggedByYear && currentYearId ? { academic_year_id: currentYearId } : {}), ...(getExtraFields ? getExtraFields() : {}) };
      const result = await apiUpload(endpoint, selectedFile, extra);
      renderImportSummary(resultEl, result);
      toast(toastText(result));
      if (afterSuccess) afterSuccess();
    } catch (err) {
      resultEl.innerHTML = `<div class="status-banner error">${err.message}</div>`;
      toast(err.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload & Import';
    }
  });
}

async function renderImport() {
  useTemplate('#tpl-import');
  const yearLabel = academicYears.find(y => y.id === currentYearId);
  if (yearLabel) {
    const notice = document.createElement('p');
    notice.className = 'hint';
    notice.style.marginTop = '-8px';
    notice.textContent = `Students and timetable entries you import will be filed under ${yearLabel.label} — switch the Academic Year in the sidebar first if you meant a different year.`;
    view.insertBefore(notice, view.children[1]);
  }

  wireImportCard({
    fileInputId: '#import-students-file',
    filenameId: '#import-students-filename',
    submitId: '#import-students-submit',
    resultId: '#import-students-result',
    endpoint: '/import/students',
    toastText: r => `Students imported — ${r.inserted ?? 0} added, ${r.updated ?? 0} updated.`,
    taggedByYear: true,
  });

  wireImportCard({
    fileInputId: '#import-divisions-file',
    filenameId: '#import-divisions-filename',
    submitId: '#import-divisions-submit',
    resultId: '#import-divisions-result',
    endpoint: '/import/student-divisions',
    toastText: r => `Division update complete — ${r.updated ?? 0} students moved, ${r.unchanged ?? 0} already in the correct division, ${r.skipped?.length ?? 0} skipped.`,
  });

  wireImportCard({
    fileInputId: '#import-teachers-file',
    filenameId: '#import-teachers-filename',
    submitId: '#import-teachers-submit',
    resultId: '#import-teachers-result',
    endpoint: '/import/teachers',
    toastText: r => `Teachers imported — ${r.inserted ?? 0} added, ${r.updated ?? 0} updated.`,
  });

  wireImportCard({
    fileInputId: '#import-timetable-file',
    filenameId: '#import-timetable-filename',
    submitId: '#import-timetable-submit',
    resultId: '#import-timetable-result',
    endpoint: '/import/timetable',
    toastText: r => `Timetable imported — ${r.inserted ?? 0} added, ${r.updated ?? 0} updated.`,
    taggedByYear: true,
  });

  wireImportCard({
    fileInputId: '#import-fees-file',
    filenameId: '#import-fees-filename',
    submitId: '#import-fees-submit',
    resultId: '#import-fees-result',
    endpoint: '/import/fees',
    toastText: r => `Fees imported — ${r.feesUpdated ?? 0} students updated, ${r.paymentsAdjusted ?? 0} payment entries adjusted.`,
  });

  $('#wt-import-date').value = todayStr();
  wireImportCard({
    fileInputId: '#import-weeklytest-file',
    filenameId: '#import-weeklytest-filename',
    submitId: '#import-weeklytest-submit',
    resultId: '#import-weeklytest-result',
    endpoint: '/import/weekly-test',
    toastText: r => `Weekly test imported — ${r.inserted ?? 0} marks added, ${r.updated ?? 0} updated across ${r.testsCreated ?? 0} exam(s).`,
    taggedByYear: true,
    validate: () => $('#wt-import-date').value ? null : 'Set a test date before uploading.',
    getExtraFields: () => ({
      test_date: $('#wt-import-date').value,
      max_marks: $('#wt-import-maxmarks').value || 20,
    }),
  });

  $('#te-import-date').value = todayStr();
  wireImportCard({
    fileInputId: '#import-termexam-file',
    filenameId: '#import-termexam-filename',
    submitId: '#import-termexam-submit',
    resultId: '#import-termexam-result',
    endpoint: '/import/term-exam',
    toastText: r => {
      const detected = (r.subjectsDetected || []).map(s => `${s.subject} (/${s.max_marks})`).join(', ');
      return `Term exam imported — ${r.inserted ?? 0} marks added, ${r.updated ?? 0} updated across ${r.examsCreated ?? 0} class(es). Detected: ${detected}`;
    },
    taggedByYear: true,
    validate: () => $('#te-import-date').value ? null : 'Set an exam date before uploading.',
    getExtraFields: () => ({
      exam_name: $('#te-import-name').value || 'Term Examination',
      exam_date: $('#te-import-date').value,
    }),
  });
}
