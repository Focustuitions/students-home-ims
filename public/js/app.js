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
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

async function apiUpload(path, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(API + path, { method: 'POST', body: formData });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
  return data;
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
  students: renderStudents,
  'add-student': () => renderStudentForm(null),
  payment: renderPayment,
  'payment-history': renderPaymentHistory,
  classes: renderClasses,
  teachers: renderTeachers,
  timetable: renderTimetable,
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

  setActiveTab(base);
  const fn = routes[base] || renderDashboard;
  try {
    await fn();
  } catch (err) {
    view.innerHTML = `<div class="card"><p>Could not load this page: ${err.message}</p></div>`;
  }
}

window.addEventListener('hashchange', navigate);
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-route]');
    if (btn) {
      location.hash = btn.dataset.route;
    }
  });
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
  const [students, payments, teachers] = await Promise.all([
    api('/students'),
    api('/payments'),
    api('/teachers'),
  ]);

  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const totalDue = students.reduce((s, st) => s + st.balance, 0);
  const activeCount = students.length;

  $('#stat-row').innerHTML = `
    <div class="stat"><div class="label">Total Students</div><div class="value">${activeCount}</div></div>
    <div class="stat"><div class="label">Fees Collected</div><div class="value">${money(totalCollected)}</div></div>
    <div class="stat alert"><div class="label">Fees Pending</div><div class="value">${money(totalDue)}</div></div>
    <div class="stat"><div class="label">Faculty on Roll</div><div class="value">${teachers.length}</div></div>
  `;

  // fee by class
  const byClass = {};
  students.forEach(s => {
    const key = `Class ${s.class}`;
    byClass[key] = byClass[key] || { total: 0, paid: 0, balance: 0, count: 0 };
    byClass[key].total += s.net_fees;
    byClass[key].paid += s.paid;
    byClass[key].balance += s.balance;
    byClass[key].count += 1;
  });
  const classRows = Object.entries(byClass).sort((a, b) => b[0].localeCompare(a[0]))
    .map(([cls, v]) => `<tr><td>${cls}</td><td>${v.count}</td><td>${money(v.paid)}</td><td>${money(v.balance)}</td></tr>`).join('');
  $('#fee-by-class').innerHTML = students.length
    ? `<table><thead><tr><th>Class</th><th>Students</th><th>Collected</th><th>Pending</th></tr></thead><tbody>${classRows}</tbody></table>`
    : `<p class="empty-row">No students admitted yet.</p>`;

  // recent admissions
  const recent = [...students].slice(0, 6);
  $('#recent-admissions').innerHTML = recent.length
    ? `<table><thead><tr><th>Adm. No.</th><th>Name</th><th>Class</th><th>Joined</th></tr></thead><tbody>
        ${recent.map(s => `<tr class="clickable" onclick="location.hash='student/${encodeURIComponent(s.admission_no)}'">
          <td class="mono">${s.admission_no}</td><td>${s.name}</td><td>${s.class}-${s.division}</td><td>${s.joining_date}</td>
        </tr>`).join('')}
      </tbody></table>`
    : `<p class="empty-row">Nothing to show yet.</p>`;
}

// =====================================================================
// STUDENTS — LIST
// =====================================================================
async function renderStudents() {
  useTemplate('#tpl-students');

  async function load() {
    const params = new URLSearchParams();
    const q = $('#stu-search').value.trim();
    if (q) params.set('q', q);
    if ($('#f-class').value) params.set('cls', $('#f-class').value);
    if ($('#f-division').value) params.set('division', $('#f-division').value);
    if ($('#f-medium').value) params.set('medium', $('#f-medium').value);
    let students = await api('/students?' + params.toString());
    if ($('#f-status').value === 'Pending') students = students.filter(s => s.balance > 0);

    $('#students-table').innerHTML = students.length ? `
      <table>
        <thead><tr><th>Adm. No.</th><th>Name</th><th>Class</th><th>Medium</th><th>School</th><th>Net Fee</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>
          ${students.map(s => `
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
  }

  $('#stu-search').addEventListener('input', debounce(load, 250));
  ['#f-class', '#f-division', '#f-medium', '#f-status'].forEach(sel => $(sel).addEventListener('change', load));
  $('#export-pending').addEventListener('click', exportFeePendingCSV);

  await load();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function exportFeePendingCSV() {
  const pending = await api('/students/reports/fee-pending');
  if (!pending.length) { toast('No pending fee balances — nothing to export.'); return; }
  window.location.href = API + '/students/reports/fee-pending/export';
  toast(`Exporting ${pending.length} pending record(s) as Excel…`);
}

// =====================================================================
// STUDENT DETAIL
// =====================================================================
async function renderStudentDetail(admNo) {
  useTemplate('#tpl-student-detail');
  const s = await api('/students/' + encodeURIComponent(admNo));

  $('#sd-name').textContent = `${s.name} — ${s.admission_no}`;
  $('#sd-back').addEventListener('click', () => location.hash = 'students');
  $('#sd-edit').addEventListener('click', () => location.hash = 'edit-student/' + encodeURIComponent(s.admission_no));
  $('#sd-pay').addEventListener('click', () => {
    location.hash = 'payment';
    setTimeout(() => { $('#pf-adm').value = s.admission_no; $('#pf-adm').dispatchEvent(new Event('input')); }, 60);
  });

  const schoolDisplay = s.school === 'Others' ? (s.school_other || 'Others') : s.school;
  $('#sd-details').innerHTML = `
    <h2>Admission Details</h2>
    <div class="detail-grid">
      <div><span class="d-label">Admission No.</span><span class="d-value mono">${s.admission_no}</span></div>
      <div><span class="d-label">Joining Date</span><span class="d-value">${s.joining_date}</span></div>
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
        <td><a href="/receipt.html?id=${p.id}" target="_blank" rel="noopener" class="btn-icon">Receipt</a></td></tr>`).join('')}</tbody>
    </table>` : `<p class="empty-row">No payments recorded yet.</p>`;
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
async function renderPayment() {
  useTemplate('#tpl-payment');
  const form = $('#payment-form');
  form.elements['payment_date'].value = todayStr();
  let currentStudent = null;

  async function suggestReceiptNo() {
    try {
      const { next_receipt_no } = await api('/payments/next-receipt-no');
      form.elements['receipt_no'].value = next_receipt_no;
    } catch (err) { /* leave blank if this fails — still editable */ }
  }
  suggestReceiptNo();

  $('#pf-adm').addEventListener('input', debounce(async () => {
    const adm = $('#pf-adm').value.trim();
    if (!adm) { clearStudentFields(); return; }
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
    } catch (err) {
      banner.textContent = err.message;
      banner.className = 'status-banner error';
    }
  });
}

// =====================================================================
// PAYMENT HISTORY
// =====================================================================
async function renderPaymentHistory() {
  useTemplate('#tpl-payment-history');

  async function load() {
    const q = $('#ph-search').value.trim();
    const payments = await api('/payments' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#ph-table').innerHTML = payments.length ? `
      <table>
        <thead><tr><th>Date</th><th>Receipt No.</th><th>Adm. No.</th><th>Student</th><th>Class</th><th>Amount</th><th></th></tr></thead>
        <tbody>${payments.map(p => `
          <tr>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.payment_date}</td>
            <td class="mono clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.receipt_no}</td>
            <td class="mono clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.admission_no}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.student_name}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${p.class}-${p.division}</td>
            <td class="clickable" onclick="location.hash='student/${encodeURIComponent(p.admission_no)}'">${money(p.amount)}</td>
            <td><a href="/receipt.html?id=${p.id}" target="_blank" rel="noopener" class="btn-icon">Receipt</a></td>
          </tr>`).join('')}</tbody>
      </table>` : `<p class="empty-row">No payments recorded yet.</p>`;
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
    const classes = await api('/classes');
    $('#classes-table').innerHTML = classes.length ? `
      <table>
        <thead><tr><th>Class</th><th>Division</th><th>Medium</th><th></th></tr></thead>
        <tbody>${classes.map(c => `
          <tr><td>${c.class}</td><td>${c.division}</td><td>${c.medium}</td>
          <td><button class="btn-icon" data-del="${c.id}">Remove</button></td></tr>`).join('')}</tbody>
      </table>` : `<p class="empty-row">No classes added yet.</p>`;

    $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      await api('/classes/' + btn.dataset.del, { method: 'DELETE' });
      toast('Class removed.');
      load();
    }));
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
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
    const teachers = await api('/teachers');
    $('#teachers-table').innerHTML = teachers.length ? `
      <table>
        <thead><tr><th>Name</th><th>Subject</th><th>Classes</th><th>Rate/hr</th><th>Hours Logged</th><th>Earned</th><th></th></tr></thead>
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

  const [teachers, classes] = await Promise.all([api('/teachers'), api('/classes')]);

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

    const [entries, currentClasses] = await Promise.all([api('/timetable?date=' + date), api('/classes')]);

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
    const entries = await api('/timetable' + (date ? '?date=' + date : ''));
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
// IMPORT DATA
// =====================================================================
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
      <div class="isum ${skippedCount ? 'warn' : ''}"><div class="n">${skippedCount}</div><div class="l">Needs Attention</div></div>
    </div>`;
  let skipTable = '';
  if (skippedCount) {
    const rows = result.skipped.map(s => `<tr>
      <td>${s.sheet ? s.sheet + ' · ' : ''}Row ${s.row}</td>
      <td>${s.admission_no || s.name || s.class || '—'}</td>
      <td>${s.value ? `<span class="mono">${s.value}</span>` : ''}</td>
      <td>${s.reason}</td>
    </tr>`).join('');
    skipTable = `<div class="import-skip-table table-wrap"><table>
      <thead><tr><th>Location</th><th>Reference</th><th>Value</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  container.innerHTML = `<div class="import-result">${summary}${skipTable}</div>`;
}

function wireImportCard({ fileInputId, filenameId, submitId, resultId, endpoint, toastText, afterSuccess }) {
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
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing…';
    try {
      const result = await apiUpload(endpoint, selectedFile);
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

  wireImportCard({
    fileInputId: '#import-students-file',
    filenameId: '#import-students-filename',
    submitId: '#import-students-submit',
    resultId: '#import-students-result',
    endpoint: '/import/students',
    toastText: r => `Students imported — ${r.inserted ?? 0} added, ${r.updated ?? 0} updated.`,
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
  });

  wireImportCard({
    fileInputId: '#import-fees-file',
    filenameId: '#import-fees-filename',
    submitId: '#import-fees-submit',
    resultId: '#import-fees-result',
    endpoint: '/import/fees',
    toastText: r => `Fees imported — ${r.feesUpdated ?? 0} students updated, ${r.paymentsAdjusted ?? 0} payment entries adjusted.`,
  });
}
