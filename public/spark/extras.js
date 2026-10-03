(() => {
'use strict';
const S = window.SPARK;
const { api, act, esc, money, fmtDT, badge, shell, toast, formData, $ } = S;
const me = () => S.me();

// ---------- helpers ----------
function resizeImage(file, max = 1100, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
  let drawing = false, dirty = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return [(t.clientX - r.left) * (canvas.width / r.width), (t.clientY - r.top) * (canvas.height / r.height)]; };
  const start = (e) => { drawing = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty = true; e.preventDefault(); };
  const end = () => (drawing = false);
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', end);
  return { clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }, isEmpty: () => !dirty,
    png() { const o = document.createElement('canvas'); o.width = canvas.width; o.height = canvas.height; const c = o.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); c.drawImage(canvas, 0, 0); return o.toDataURL('image/png'); } };
}

const hoursOf = (t) => (t.ended_at ? (new Date(t.ended_at.replace(' ', 'T') + 'Z') - new Date(t.started_at.replace(' ', 'T') + 'Z')) / 36e5 : (Date.now() - new Date(t.started_at.replace(' ', 'T') + 'Z')) / 36e5);
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const sqlFromLocal = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : '');

// ---------- Job detail extras ----------
async function jobHook(id) {
  if (!id || id === 'new') return;
  const x = await api(`jobs/${id}/extra`);
  const tpl = await api('checklist-templates');
  const main = document.querySelector('main');
  const box = document.createElement('div');
  const done = x.checklist.filter((c) => c.done).length;
  const running = x.time.find((t) => !t.ended_at && t.user_name === me().name);
  const totalHrs = x.time.filter((t) => t.ended_at).reduce((a, t) => a + hoursOf(t), 0);
  box.innerHTML = `
  <div class="card"><h2>Send to client</h2>
    <div class="row"><button data-mail="quote">✉ Email quote</button><button data-mail="booking" class="sec">✉ Booking confirmation</button>
      <button data-mail="invoice" class="sec">✉ Email invoice</button><button data-mail="reminder" class="sec">✉ Payment reminder</button>
      <button class="sec" id="portal">🔗 Copy client link</button><button class="sec" id="clone">⎘ Duplicate job</button></div>
    ${x.quote_accepted_at ? `<p>✅ Quote accepted by <b>${esc(x.quote_accepted_name)}</b> on ${fmtDT(x.quote_accepted_at)}</p>` : ''}
    ${x.emails.length ? `<details><summary class="muted">Email history (${x.emails.length})</summary>${x.emails.map((m) => `<div class="muted">${fmtDT(m.created_at)} · ${esc(m.kind)} → ${esc(m.to_addr)} ${m.ok ? '✓' : '✗ ' + esc(m.detail)}</div>`).join('')}</details>` : ''}</div>

  <div class="card"><h2>Payments</h2>
    <div class="muted">Total ${money(x.totals.total)} · Paid ${money(x.totals.paid)} · <b>Balance ${money(x.totals.balance)}</b>${x.totals.cost ? ` · Est. margin ${money(x.totals.subtotal - x.totals.cost)}` : ''}</div>
    <div class="tablewrap"><table>${x.payments.map((p) => `<tr><td>${esc(p.paid_on)}</td><td>${esc(p.method)}</td><td>${esc(p.reference || '')}</td><td class="right">${money(p.amount)}</td><td><button class="sec" data-delpay="${p.id}">✕</button></td></tr>`).join('')}</table></div>
    <form class="row" id="addpay"><input name="amount" type="number" step="0.01" placeholder="Amount inc GST" value="${x.totals.balance > 0 ? x.totals.balance : ''}" required style="width:150px">
      <select name="method"><option>bank</option><option>card</option><option>cash</option><option>cheque</option><option>other</option></select>
      <input name="reference" placeholder="Reference" class="grow"><button>Record payment</button></form></div>

  <div class="card"><h2>Time &amp; check-in</h2>
    <div class="row">${running ? '<button class="bad" id="tstop">■ Stop timer</button>' : '<button id="tstart">▶ Start timer</button>'}
      <button class="sec" id="checkin">📍 Check in${x.checkin_at ? ' (' + fmtDT(x.checkin_at) + ')' : ''}</button>
      <button class="sec" id="tbill">Bill hours to job</button><span class="muted">Logged: ${totalHrs.toFixed(2)} h</span></div>
    <div class="tablewrap"><table>${x.time.map((t) => `<tr><td>${esc(t.user_name)}</td><td>${fmtDT(t.started_at + 'Z')}</td><td>${t.ended_at ? hoursOf(t).toFixed(2) + ' h' : '<b>running…</b>'}</td><td><button class="sec" data-deltime="${t.id}">✕</button></td></tr>`).join('')}</table></div>
    <details><summary class="muted">Add time manually</summary><form class="row" id="mtime" style="margin-top:8px"><input type="datetime-local" name="s" required><input type="datetime-local" name="e" required><button>Add</button></form></details></div>

  <div class="card"><h2>Checklist ${x.checklist.length ? `<span class="muted">(${done}/${x.checklist.length})</span>` : ''}</h2>
    ${x.checklist.map((c) => `<div class="row" style="margin:4px 0"><label style="margin:0;color:var(--text);font-size:15px"><input type="checkbox" data-chk="${c.id}" ${c.done ? 'checked' : ''}> ${c.done ? '<s class="muted">' + esc(c.label) + '</s>' : esc(c.label)}</label><button class="sec" data-delchk="${c.id}">✕</button></div>`).join('')}
    <form class="row" id="addchk"><input name="label" placeholder="Add step" class="grow"><button>Add</button>
      <select id="tplsel"><option value="">Add from template…</option>${tpl.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></form></div>

  <div class="card"><h2>Photos</h2><div class="row"><input type="file" id="photo" accept="image/*" capture="environment" multiple><input id="cap" placeholder="Caption (optional)" class="grow"></div>
    <div id="photos" class="grid" style="margin-top:8px">${x.photos.map((p) => `<div><img data-ph="${p.id}" style="width:100%;border-radius:6px;cursor:pointer" alt=""><div class="muted">${esc(p.caption || '')} <a data-delph="${p.id}">delete</a></div></div>`).join('')}</div></div>

  <div class="card"><h2>Customer sign-off</h2>
    ${x.signed_at ? `<p>Signed by <b>${esc(x.signed_name)}</b> on ${fmtDT(x.signed_at)}</p><img id="sigimg" style="background:#fff;max-width:320px;border-radius:6px" alt="">` : '<p class="muted">No signature captured.</p>'}
    <details ${x.signed_at ? '' : 'open'}><summary class="muted">${x.signed_at ? 'Capture again' : 'Capture signature'}</summary>
      <canvas id="sig" width="600" height="200" style="background:#fff;border-radius:6px;width:100%;max-width:420px;touch-action:none;display:block;margin:8px 0"></canvas>
      <div class="row"><input id="sname" placeholder="Customer name" class="grow"><button class="sec" id="sclear">Clear</button><button id="ssave">Save signature</button></div></details></div>

  <div class="card"><h2>Repeat</h2><div class="row"><select id="rep">${['none', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].map((r) => `<option ${r === (x.repeat_rule || 'none') ? 'selected' : ''}>${r}</option>`).join('')}</select>
    <span class="muted">When this job is completed, the next one is created automatically.</span></div></div>`;
  main.appendChild(box);

  document.querySelectorAll('[data-mail]').forEach((b) => (b.onclick = () => act(async () => {
    const kind = b.dataset.mail;
    if (!confirm(`Send ${kind} email to the client?`)) return;
    b.disabled = true; await api(`jobs/${id}/email`, 'POST', { kind }); toast('Email sent'); S.route();
  })));
  $('#portal').onclick = () => act(async () => { const r = await api(`jobs/${id}/portal`); try { await navigator.clipboard.writeText(r.url); toast('Client link copied'); } catch { prompt('Client link', r.url); } });
  $('#clone').onclick = () => act(async () => { const r = await api(`jobs/${id}/clone`, 'POST'); location.hash = '#/job/' + r.id; });
  $('#addpay').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`jobs/${id}/payments`, 'POST', formData(e.target)); S.route(); }); };
  document.querySelectorAll('[data-delpay]').forEach((b) => (b.onclick = () => confirm('Remove payment?') && act(async () => { await api(`jobs/${id}/payments/${b.dataset.delpay}`, 'DELETE'); S.route(); })));
  const ts = $('#tstart'); if (ts) ts.onclick = () => act(async () => { await api(`jobs/${id}/time/start`, 'POST'); S.route(); });
  const te = $('#tstop'); if (te) te.onclick = () => act(async () => { await api(`jobs/${id}/time/stop`, 'POST', {}); S.route(); });
  $('#tbill').onclick = () => act(async () => { const r = await api(`jobs/${id}/time/bill`, 'POST', {}); toast(`Added ${r.hours} h @ ${money(r.rate)}`); S.route(); });
  document.querySelectorAll('[data-deltime]').forEach((b) => (b.onclick = () => act(async () => { await api(`jobs/${id}/time/${b.dataset.deltime}`, 'DELETE'); S.route(); })));
  $('#mtime').onsubmit = (e) => { e.preventDefault(); act(async () => { const f = formData(e.target); await api(`jobs/${id}/time/manual`, 'POST', { started_at: sqlFromLocal(f.s), ended_at: sqlFromLocal(f.e) }); S.route(); }); };
  $('#checkin').onclick = () => act(async () => {
    const pos = await new Promise((res) => (navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { timeout: 6000 }) : res(null)));
    await api(`jobs/${id}/checkin`, 'POST', { lat: pos && pos.latitude, lng: pos && pos.longitude }); toast('Checked in'); S.route();
  });
  document.querySelectorAll('[data-chk]').forEach((c) => (c.onchange = () => act(async () => { await api(`jobs/${id}/checklist/${c.dataset.chk}`, 'PUT', { done: c.checked }); S.route(); })));
  document.querySelectorAll('[data-delchk]').forEach((b) => (b.onclick = () => act(async () => { await api(`jobs/${id}/checklist/${b.dataset.delchk}`, 'DELETE'); S.route(); })));
  $('#addchk').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`jobs/${id}/checklist`, 'POST', formData(e.target)); S.route(); }); };
  $('#tplsel').onchange = (e) => e.target.value && act(async () => { await api(`jobs/${id}/checklist`, 'POST', { template_id: e.target.value }); S.route(); });

  $('#photo').onchange = (e) => act(async () => {
    for (const f of e.target.files) { const data = await resizeImage(f); await api(`jobs/${id}/photos`, 'POST', { data, caption: $('#cap').value }); }
    S.route();
  });
  if (x.photos.length) {
    const all = await api(`jobs/${id}/photos`);
    const map = Object.fromEntries(all.map((p) => [p.id, p.data]));
    document.querySelectorAll('[data-ph]').forEach((im) => { im.src = map[im.dataset.ph]; im.onclick = () => { const w = window.open(); w.document.write(`<img src="${map[im.dataset.ph]}" style="max-width:100%">`); }; });
    document.querySelectorAll('[data-delph]').forEach((a) => (a.onclick = () => confirm('Delete photo?') && act(async () => { await api(`jobs/${id}/photos/${a.dataset.delph}`, 'DELETE'); S.route(); })));
  }

  const pad = signaturePad($('#sig'));
  $('#sclear').onclick = () => pad.clear();
  $('#ssave').onclick = () => act(async () => {
    if (pad.isEmpty() || !$('#sname').value.trim()) throw new Error('Name and signature required');
    await api(`jobs/${id}/signature`, 'POST', { name: $('#sname').value.trim(), signature: pad.png() }); S.route();
  });
  if (x.signed_at && x.signature && $('#sigimg')) $('#sigimg').src = x.signature;
  $('#rep').onchange = (e) => act(async () => { await api(`jobs/${id}/repeat`, 'POST', { rule: e.target.value }); toast('Saved'); });
}

// ---------- Dashboard (enhanced) ----------
async function dashboard() {
  const [d, e] = await Promise.all([api('dashboard'), api('dashboard-extra')]);
  const c = Object.fromEntries(d.counts.map((x) => [x.status, x.n]));
  shell('dashboard', `<h1>Dashboard</h1>
    <div class="grid">${S.STATUSES.map((s) => `<div class="stat" onclick="location.hash='#/jobs?status=${s}'"><b>${c[s] || 0}</b><span>${s.replace('_', ' ')}</span></div>`).join('')}
      <div class="stat" onclick="location.hash='#/reports'"><b>${money(d.outstanding)}</b><span>outstanding (inc GST)</span></div>
      <div class="stat" onclick="location.hash='#/reports'"><b style="color:${e.overdue ? 'var(--bad)' : 'inherit'}">${e.overdue}</b><span>overdue invoices</span></div>
      <div class="stat"><b>${money(e.month)}</b><span>received this month</span></div></div>
    ${e.running ? `<div class="card" style="margin-top:14px;border-color:var(--accent)">⏱ Timer running on <a href="#/job/${e.running.job_id}">${esc(e.running.title)}</a> since ${fmtDT(e.running.started_at + 'Z')}</div>` : ''}
    <div class="card" style="margin-top:14px"><h2>Today's jobs</h2>${d.today.length ? `<div class="tablewrap"><table>${d.today.map((j) => `<tr class="click" onclick="location.hash='#/job/${j.id}'"><td>${fmtDT(j.scheduled_start)}</td><td>${esc(j.title)}</td><td>${esc(j.client_name)}</td><td>${badge(j.status)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing scheduled today.</p>'}</div>
    <div class="card"><h2>My upcoming work</h2>${e.mine.length ? `<div class="tablewrap"><table>${e.mine.map((j) => `<tr class="click" onclick="location.hash='#/job/${j.id}'"><td>${fmtDT(j.scheduled_start)}</td><td>${esc(j.title)}</td><td>${esc(j.client_name)}</td><td>${esc(j.site_address || '')}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing assigned to you.</p>'}</div>
    <div class="card"><h2>Open quotes</h2>${e.open_quotes.length ? `<div class="tablewrap"><table>${e.open_quotes.map((j) => `<tr class="click" onclick="location.hash='#/job/${j.id}'"><td>#${j.id}</td><td>${esc(j.title)}</td><td>${esc(j.client_name)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No open quotes.</p>'}</div>
    <div class="row"><button onclick="location.hash='#/job/new'">+ New job</button><button class="sec" onclick="location.hash='#/client/new'">+ New client</button></div>`);
}

// ---------- Reports ----------
async function reports(arg, params) {
  const today = new Date().toISOString().slice(0, 10);
  const from = params.get('from') || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = params.get('to') || today;
  const r = await api(`reports?from=${from}&to=${to}`);
  shell('reports', `<h1>Reports</h1>
    <form class="row noprint" id="rf"><input type="date" name="from" value="${from}"><input type="date" name="to" value="${to}"><button>Run</button>
      <a href="/api/spark/export/invoices" class="sec" style="padding:8px">⬇ Invoices CSV</a><a href="/api/spark/export/jobs" style="padding:8px">⬇ Jobs CSV</a><a href="/api/spark/export/clients" style="padding:8px">⬇ Clients CSV</a></form>
    <div class="grid"><div class="stat"><b>${money(r.received)}</b><span>received (${r.payments} payments)</span></div><div class="stat"><b>${money(r.invoiced)}</b><span>invoiced</span></div>
      <div class="stat"><b>${money(r.expenses)}</b><span>expenses</span></div><div class="stat"><b>${money(r.profit)}</b><span>cash profit</span></div>
      <div class="stat"><b>${money(r.gst_payable)}</b><span>GST payable (collected ${money(r.gst_collected)} − paid ${money(r.gst_paid)})</span></div></div>
    <div class="card" style="margin-top:14px"><h2>Unpaid invoices</h2>${r.aging.length ? `<div class="tablewrap"><table><tr><th>Invoice</th><th>Client</th><th>Due</th><th class="right">Balance</th><th></th></tr>${r.aging.map((a) => `<tr class="click" onclick="location.hash='#/job/${a.id}'"><td>${esc(a.number)}</td><td>${esc(a.client_name)}</td><td>${esc(a.due_at)} ${a.days_over > 0 ? `<span class="badge s-cancelled">${a.days_over}d overdue</span>` : ''}</td><td class="right">${money(a.balance)}</td><td></td></tr>`).join('')}</table></div>` : '<p class="muted">All invoices paid 🎉</p>'}</div>
    <div class="card"><h2>Hours by staff</h2>${r.hours.length ? `<table>${r.hours.map((h) => `<tr><td>${esc(h.name)}</td><td class="right">${h.hours} h</td></tr>`).join('')}</table>` : '<p class="muted">No time logged.</p>'}</div>
    <div class="card"><h2>Top clients (by payments)</h2>${r.top_clients.length ? `<table>${r.top_clients.map((h) => `<tr><td>${esc(h.name)}</td><td class="right">${money(h.total)}</td></tr>`).join('')}</table>` : '<p class="muted">No payments.</p>'}</div>`);
  $('#rf').onsubmit = (e) => { e.preventDefault(); const f = formData(e.target); location.hash = `#/reports?from=${f.from}&to=${f.to}`; };
}

// ---------- Expenses ----------
async function expenses() {
  const [rows, jobs] = await Promise.all([api('expenses'), api('jobs')]);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  shell('expenses', `<h1>Expenses</h1><div class="card"><form class="row" id="f"><input name="description" placeholder="Description" class="grow" required><input name="supplier" placeholder="Supplier">
    <input name="amount" type="number" step="0.01" placeholder="Amount inc GST" required style="width:140px"><input name="spent_on" type="date" value="${new Date().toISOString().slice(0, 10)}">
    <select name="job_id"><option value="">No job</option>${jobs.slice(0, 100).map((j) => `<option value="${j.id}">#${j.id} ${esc(j.title)}</option>`).join('')}</select><button>Add</button></form>
    <div class="tablewrap">${rows.length ? `<table><tr><th>Date</th><th>Description</th><th>Supplier</th><th>Job</th><th class="right">Amount</th><th></th></tr>${rows.map((r) => `<tr><td>${esc(r.spent_on)}</td><td>${esc(r.description)}</td><td>${esc(r.supplier || '')}</td><td>${esc(r.job_title || '')}</td><td class="right">${money(r.amount)}</td><td><button class="sec" data-rm="${r.id}">✕</button></td></tr>`).join('')}
      <tr><td colspan="4" class="right"><b>Total</b></td><td class="right"><b>${money(total)}</b></td><td></td></tr></table>` : '<p class="muted">No expenses.</p>'}</div></div>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => { await api('expenses', 'POST', formData(e.target)); expenses(); }); };
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => act(async () => { await api('expenses/' + b.dataset.rm, 'DELETE'); expenses(); })));
}

// ---------- Settings ----------
async function settings() {
  const s = await api('settings');
  const admin = me().role === 'admin';
  const tpl = await api('checklist-templates');
  const field = (k, label, ta) => `<label>${label}</label>${ta ? `<textarea name="${k}" ${admin ? '' : 'disabled'}>${esc(s[k])}</textarea>` : `<input name="${k}" value="${esc(s[k])}" ${admin ? '' : 'disabled'}>`}`;
  shell('settings', `<h1>Settings</h1><div class="card"><form class="form" id="f">
    ${field('business_name', 'Business name')}${field('abn', 'ABN')}${field('licence', 'Licence number')}${field('phone', 'Phone')}${field('email', 'Reply-to email')}${field('address', 'Address')}
    ${field('hourly_rate', 'Hourly labour rate (ex GST)')}${field('payment_days', 'Default payment terms (days)')}
    ${field('bank_details', 'Bank / payment details shown on invoices', true)}${field('quote_terms', 'Quote terms', true)}${field('invoice_terms', 'Invoice terms', true)}
    ${admin ? '<div class="row" style="margin-top:12px"><button>Save settings</button></div>' : ''}</form></div>
    <div class="card"><h2>Checklist templates</h2>${tpl.map((t) => `<p><b>${esc(t.name)}</b> <a data-deltpl="${t.id}">delete</a><br><span class="muted">${esc(t.items).replace(/\n/g, ' · ')}</span></p>`).join('')}
      <form class="form" id="tf"><label>Name</label><input name="name" required><label>Steps (one per line)</label><textarea name="items" required></textarea><div class="row" style="margin-top:8px"><button>Add template</button></div></form></div>
    <div class="card"><h2>Change my password</h2><form class="form" id="pf"><label>Current password</label><input type="password" name="current_password" required><label>New password (10+ chars)</label><input type="password" name="new_password" minlength="10" required><div class="row" style="margin-top:8px"><button>Change password</button></div></form></div>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => { await api('settings', 'PUT', formData(e.target)); toast('Saved'); }); };
  $('#tf').onsubmit = (e) => { e.preventDefault(); act(async () => { await api('checklist-templates', 'POST', formData(e.target)); settings(); }); };
  document.querySelectorAll('[data-deltpl]').forEach((a) => (a.onclick = () => act(async () => { await api('checklist-templates/' + a.dataset.deltpl, 'DELETE'); settings(); })));
  $('#pf').onsubmit = (e) => { e.preventDefault(); act(async () => { await api('me/password', 'POST', formData(e.target)); e.target.reset(); toast('Password changed'); }); };
}

window.SPARK_X = { jobHook, pages: { dashboard, reports, expenses, settings } };
})();
