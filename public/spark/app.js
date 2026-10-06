(() => {
'use strict';
const $app = document.getElementById('app');
const STATUSES = ['quote', 'work_order', 'completed', 'invoiced', 'paid', 'cancelled'];
let me = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDT = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const badge = (s) => `<span class="badge s-${esc(s)}">${esc(String(s).replace('_', ' '))}</span>`;
const $ = (sel, root = document) => root.querySelector(sel);

// Any address becomes a Google Maps link (opens directions/search in a new tab; the Maps app on phones)
const mapsHref = (a) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(a).trim());
const mapLink = (a) => (a && String(a).trim()
  ? `<a href="${mapsHref(a)}" target="_blank" rel="noopener noreferrer" title="Open in Google Maps" onclick="event.stopPropagation()">📍 ${esc(a)}</a>` : '');
// Under every address input show a live "open in Google Maps" link
function wireAddr(root = document) {
  root.querySelectorAll('input[name=address],input[name=site_address]').forEach((inp) => {
    if (inp.dataset.maps) return; inp.dataset.maps = '1';
    const a = document.createElement('a');
    a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'maplink'; a.textContent = '📍 Open in Google Maps';
    const sync = () => { const v = inp.value.trim(); a.style.display = v ? 'inline-block' : 'none'; if (v) a.href = mapsHref(v); };
    inp.addEventListener('input', sync); inp.addEventListener('change', sync); sync();
    inp.after(a);
    // programmatic changes (e.g. job address auto-filled from the client) don't fire events, so re-check shortly
    setTimeout(sync, 0); const obs = setInterval(() => { if (!document.body.contains(inp)) clearInterval(obs); else sync(); }, 700);
  });
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 2800);
}

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/spark/' + path, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('auth/') && me) { me = null; boot(); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const act = async (fn) => { try { await fn(); } catch (e) { toast(e.message); } };
const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- Shell ----------
function shell(active, html) {
  const links = [['dashboard', 'Dashboard'], ['today', 'My Jobs'], ['jobs', 'Jobs'], ['invoices', 'Invoices'], ['schedule', 'Schedule'], ['clients', 'Clients'], ['suppliers', 'Suppliers'], ['pricelist', 'Price List'], ['templates', 'Quote Templates'], ['expenses', 'Expenses'], ['reports', 'Reports'], ['staff', 'Staff'], ['import', 'Import'], ['integrations', 'Integrations'], ['settings', 'Settings']];
  $app.innerHTML = `
    <div class="topbar"><a class="brand" href="#/dashboard" title="Dashboard">⚡ SPARK</a><button class="sec menubtn" id="menubtn" aria-label="Menu">☰ ${esc((links.find(([k]) => k === active) || [0, 'Menu'])[1])}</button>
      <nav id="nav">${links.filter(([k]) => k !== 'dashboard').map(([k, l]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
      <input id="gs" placeholder="Search…" style="width:150px"><span class="who">${esc(me.name)}</span><button class="sec" id="logout">Sign out</button></div>
    <div id="gsr" class="card" style="display:none;position:absolute;right:16px;top:52px;z-index:20;min-width:260px"></div>
    <main>${html}</main>`;
  wireAddr($app);
  $('#menubtn').onclick = () => $('#nav').classList.toggle('open');
  $('#logout').onclick = () => act(async () => { await api('auth/logout', 'POST'); me = null; boot(); });
  let gt; $('#gs').oninput = (e) => { clearTimeout(gt); gt = setTimeout(() => act(async () => {
    const box = $('#gsr'); const q = e.target.value.trim();
    if (q.length < 3) { box.style.display = 'none'; return; }
    const r = await api('search?q=' + encodeURIComponent(q));
    box.innerHTML = [...r.clients.map((c) => `<div><a href="#/client/${c.id}">👤 ${esc(c.name)}</a></div>`), ...r.jobs.map((j) => `<div><a href="#/job/${j.id}">🔧 #${j.id} ${esc(j.title)} <span class="muted">${esc(j.client_name)}</span></a></div>`)].join('') || '<span class="muted">No matches</span>';
    box.style.display = 'block';
  }), 300); };
  document.addEventListener('click', (e) => { const b = $('#gsr'); if (b && !e.target.closest('#gs,#gsr')) b.style.display = 'none'; }, { once: true });
}

// ---------- Auth ----------
async function authScreen(needsSetup) {
  $app.innerHTML = `<div class="login card"><h1>⚡ SPARK</h1>
    <p class="muted">${needsSetup ? 'First-time setup: create the administrator account.' : 'Sign in to continue.'}</p>
    <form class="form" id="f">
      ${needsSetup ? '<label>Your name</label><input name="name" required>' : ''}
      <label>Email</label><input name="email" type="email" required autocomplete="username">
      <label>Password${needsSetup ? ' (10+ characters)' : ''}</label><input name="password" type="password" required minlength="${needsSetup ? 10 : 1}" autocomplete="${needsSetup ? 'new-password' : 'current-password'}">
      <div class="row" style="margin-top:12px"><button>${needsSetup ? 'Create account' : 'Sign in'}</button></div></form>${needsSetup ? '' : '<p style="margin-top:12px"><a href="#" id="forgot">Forgot my password?</a></p>'}</div>`;
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(needsSetup ? 'auth/setup' : 'auth/login', 'POST', formData(e.target)); boot(); }); };
  const fg = $('#forgot'); if (fg) fg.onclick = (e) => { e.preventDefault(); forgotScreen(); };
}

function forgotScreen() {
  $app.innerHTML = `<div class="login card"><h1>⚡ SPARK</h1><p class="muted">Enter your email and we will send you a link to reset your password.</p>
    <form class="form" id="f"><label>Email</label><input name="email" type="email" required autocomplete="username">
    <div class="row" style="margin-top:12px"><button>Send reset link</button></div></form>
    <p style="margin-top:12px"><a href="#" id="back">Back to sign in</a></p></div>`;
  $('#back').onclick = (e) => { e.preventDefault(); boot(); };
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => {
    await api('auth/forgot', 'POST', formData(e.target));
    $app.querySelector('.login').innerHTML = '<h1>⚡ SPARK</h1><p>If that email belongs to an active staff account, a reset link has been sent. It is valid for 1 hour.</p><p><a href="#" id="back2">Back to sign in</a></p>';
    $('#back2').onclick = (ev) => { ev.preventDefault(); boot(); };
  }); };
}

function resetScreen(token) {
  $app.innerHTML = `<div class="login card"><h1>⚡ SPARK</h1><p class="muted">Choose a new password.</p>
    <form class="form" id="f"><label>New password (10+ characters)</label><input name="password" type="password" minlength="10" required autocomplete="new-password">
    <label>Confirm password</label><input name="confirm" type="password" minlength="10" required autocomplete="new-password">
    <div class="row" style="margin-top:12px"><button>Set password</button></div></form></div>`;
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => {
    const d = formData(e.target);
    if (d.password !== d.confirm) { toast('Passwords do not match'); return; }
    await api('auth/reset', 'POST', { token, password: d.password });
    toast('Password updated. Please sign in.');
    location.hash = '#/'; boot();
  }); };
} 
// ---------- Dashboard ----------
async function dashboard() {
  const d = await api('dashboard');
  const c = Object.fromEntries(d.counts.map((x) => [x.status, x.n]));
  shell('dashboard', `<h1>Dashboard</h1>
    <div class="grid">${STATUSES.map((s) => `<div class="stat" onclick="location.hash='#/jobs?status=${s}'"><b>${c[s] || 0}</b><span>${s.replace('_', ' ')}</span></div>`).join('')}
      <div class="stat"><b>${money(d.outstanding)}</b><span>outstanding (inc GST)</span></div></div>
    <div class="card" style="margin-top:14px"><h2>Today's jobs</h2>
      ${d.today.length ? `<div class="tablewrap"><table>${d.today.map((j) => `<tr class="click" onclick="location.hash='#/job/${j.id}'"><td>${fmtDT(j.scheduled_start)}</td><td>${esc(j.title)}</td><td>${esc(j.client_name)}</td><td>${badge(j.status)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing scheduled today.</p>'}</div>
    <div class="row"><button onclick="location.hash='#/job/new'">+ New job</button><button class="sec" onclick="location.hash='#/client/new'">+ New client</button></div>`);
}

// ---------- Clients ----------
async function clients() {
  shell('clients', `<h1>Clients</h1><div class="row"><input id="q" class="grow" placeholder="Search name, email, phone, address"><button onclick="location.hash='#/client/new'">+ New client</button></div><div class="card tablewrap" id="list"></div>`);
  const load = () => act(async () => {
    const rows = await api('clients?q=' + encodeURIComponent($('#q').value));
    $('#list').innerHTML = rows.length ? `<table><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th></tr>${rows.map((c) => `<tr class="click" onclick="location.hash='#/client/${c.id}'"><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td>${mapLink(c.address)}</td></tr>`).join('')}</table>` : '<p class="muted">No clients found.</p>';
  });
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
}

async function clientForm(id) {
  const c = id === 'new' ? {} : await api('clients/' + id);
  shell('clients', `<h1>${id === 'new' ? 'New client' : esc(c.name)}</h1>
    <div class="card"><form class="form" id="f">
      <label>Name</label><input name="name" value="${esc(c.name)}" required>
      <label>Phone</label><input name="phone" value="${esc(c.phone)}">
      <label>Email</label><input name="email" type="email" value="${esc(c.email)}">
      <label>Address</label><input name="address" value="${esc(c.address)}">
      <label>Notes</label><textarea name="notes">${esc(c.notes)}</textarea>
      <div class="row" style="margin-top:12px"><button>Save</button>
        ${id !== 'new' ? `<button type="button" class="sec" onclick="location.hash='#/job/new?client=${id}'">+ New job</button>` : ''}
        ${id !== 'new' && me.role === 'admin' ? '<button type="button" class="bad" id="del">Delete</button>' : ''}</div></form></div>
    ${id !== 'new' ? `<div class="card tablewrap"><h2>Jobs</h2>${c.jobs.length ? `<table>${c.jobs.map((j) => `<tr class="click" onclick="location.hash='#/job/${j.id}'"><td>${esc(j.title)}</td><td>${badge(j.status)}</td><td>${fmtDT(j.scheduled_start)}</td></tr>`).join('')}</table>` : '<p class="muted">No jobs yet.</p>'}</div>` : ''}`);
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => {
    if (id === 'new') { const r = await api('clients', 'POST', formData(e.target)); location.hash = '#/client/' + r.id; }
    else { await api('clients/' + id, 'PUT', formData(e.target)); toast('Saved'); }
  }); };
  const del = $('#del'); if (del) del.onclick = () => confirm('Delete this client and all their jobs?') && act(async () => { await api('clients/' + id, 'DELETE'); location.hash = '#/clients'; });
}

// ---------- Jobs ----------
async function jobs(params) {
  const status = params.get('status') || '';
  shell('jobs', `<h1>Jobs</h1><div class="row"><select id="st"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>
    <button onclick="location.hash='#/job/new'">+ New job</button></div><div class="card tablewrap" id="list"></div>`);
  $('#st').onchange = (e) => (location.hash = '#/jobs' + (e.target.value ? '?status=' + e.target.value : ''));
  const rows = await api('jobs' + (status ? '?status=' + status : ''));
  $('#list').innerHTML = rows.length ? `<table><tr><th>#</th><th>Job</th><th>Client</th><th>Status</th><th>Scheduled</th><th>Staff</th></tr>${rows.map((j) => `<tr class="click" onclick="location.hash='#/job/${j.id}'"><td>${j.id}</td><td>${esc(j.title)}${j.site_address ? `<div style="font-size:12px">${mapLink(j.site_address)}</div>` : ''}</td><td>${esc(j.client_name)}</td><td>${badge(j.status)}</td><td>${fmtDT(j.scheduled_start)}</td><td>${esc(j.assigned_name || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">No jobs.</p>';
}

const toLocalInput = (s) => (s ? s.replace(' ', 'T').slice(0, 16) : '');

async function jobPage(id, params) {
  const [cl, us] = await Promise.all([api('clients'), api('users')]);
  const j = id === 'new' ? { status: 'quote', client_id: params.get('client') || '', items: [], notes: [], totals: { subtotal: 0, gst: 0, total: 0 } } : await api('jobs/' + id);
  const pl = id === 'new' ? [] : await api('pricelist');
  // New jobs default the site address to the selected client's address
  if (id === 'new' && !j.site_address && j.client_id) {
    const pc = cl.find((c) => String(c.id) === String(j.client_id));
    if (pc && pc.address) j.site_address = pc.address;
  }
  shell('jobs', `<h1>${id === 'new' ? 'New job' : `Job #${j.id} ${badge(j.status)}`}</h1>
    <div class="card"><form class="form" id="f">
      <label>Client</label><select name="client_id" required><option value="">Select…</option>${cl.map((c) => `<option value="${c.id}" ${String(c.id) === String(j.client_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label>Title</label><input name="title" value="${esc(j.title)}" required>
      <label>Description</label><textarea name="description">${esc(j.description)}</textarea>
      <label>Site address</label><input name="site_address" value="${esc(j.site_address)}">
      <div class="row"><div class="grow"><label>Start</label><input type="datetime-local" name="scheduled_start" value="${toLocalInput(j.scheduled_start)}"></div>
        <div class="grow"><label>End</label><input type="datetime-local" name="scheduled_end" value="${toLocalInput(j.scheduled_end)}"></div></div>
      <div class="row"><div class="grow"><label>Status</label><select name="status">${STATUSES.map((s) => `<option value="${s}" ${s === j.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></div>
        <div class="grow"><label>Assigned to</label><select name="assigned_to"><option value="">Unassigned</option>${us.filter((u) => u.active).map((u) => `<option value="${u.id}" ${u.id === j.assigned_to ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div></div>
      <div class="row" style="margin-top:12px"><button>Save job</button>
        ${id !== 'new' && me.role === 'admin' ? '<button type="button" class="bad" id="del">Delete</button>' : ''}</div></form></div>
    ${id === 'new' ? '' : `
    <div class="card"><h2>Line items</h2><div class="tablewrap"><table>
      <tr><th>Description</th><th class="right">Qty</th><th class="right">Unit (ex GST)</th><th class="right">Total</th><th></th></tr>
      ${j.items.map((i) => `<tr><td>${esc(i.description)}${j.invoice && !i.on_invoice ? ' <span class="muted">(not on invoice)</span>' : ''}</td><td class="right">${i.qty}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.qty * i.unit_price)}</td><td><button class="sec" data-rm="${i.id}">✕</button></td></tr>`).join('')}
      <tr><td colspan="3" class="right muted">Subtotal</td><td class="right">${money(j.totals.subtotal)}</td><td></td></tr>
      <tr><td colspan="3" class="right muted">GST (10%)</td><td class="right">${money(j.totals.gst)}</td><td></td></tr>
      <tr><td colspan="3" class="right"><b>Total</b></td><td class="right"><b>${money(j.totals.total)}</b></td><td></td></tr></table></div>
      <form class="row" id="addi" style="margin-top:10px">
        <input type="hidden" name="item_id"><select id="pick" class="grow"><option value="">Price list…</option>${pl.map((p) => `<option value="${p.id}" data-n="${esc(p.name)}" data-p="${p.unit_price}">${esc(p.name)} — ${money(p.unit_price)}</option>`).join('')}</select>
        <input name="description" placeholder="Description" class="grow" required>
        <input name="qty" type="number" step="0.01" value="1" style="width:80px"><input name="unit_price" type="number" step="0.01" placeholder="Unit $" style="width:100px" required>
        <button>Add</button></form></div>
    <div class="card"><h2>Invoice</h2>${j.invoice ? `<p><b>${esc(j.invoice.number)}</b> issued ${esc(j.invoice.issued_at)}, due ${esc(j.invoice.due_at)} ${j.invoice.paid_at ? badge('paid') : ''}</p>` : '<p class="muted">Not invoiced yet. Tick the parts and labour to include on the invoice.</p>' + (j.items.length ? '<div class="tablewrap"><table>' + j.items.map((i) => `<tr><td style="width:30px"><input type="checkbox" class="invsel" value="${i.id}" checked></td><td>${esc(i.description)}</td><td class="right">${i.qty}</td><td class="right">${money(i.qty * i.unit_price)}</td></tr>`).join('') + '</table></div><p class="muted" id="invsum"></p>' : '')}
      <div class="row">${!j.invoice ? '<button id="mkinv">Create invoice</button>' : ''}${j.invoice && me.role === 'admin' ? '<button class="bad" id="delinv">Delete invoice</button>' : ''}${j.invoice && !j.invoice.paid_at ? '<button class="ok" id="paid">Mark paid</button>' : ''}${j.invoice ? '<button class="sec" onclick="window.print()">Print / Save PDF</button>' : ''}</div></div>
    <div class="card"><h2>Notes</h2><form class="row" id="addn"><input name="body" class="grow" placeholder="Add a note" required><button>Add</button></form>
      ${j.notes.map((n) => `<p><span class="muted">${fmtDT(n.created_at + 'Z')} · ${esc(n.user_name || '')}</span><br>${esc(n.body)}</p>`).join('') || '<p class="muted">No notes.</p>'}</div>`}`);

  if (id === 'new') {
    const addr = $('#f [name=site_address]');
    let autoFilled = addr.value; // only overwrite while the user hasn't typed their own address
    $('#f [name=client_id]').onchange = (e) => {
      const c = cl.find((x) => String(x.id) === e.target.value);
      if (addr.value === '' || addr.value === autoFilled) { autoFilled = (c && c.address) || ''; addr.value = autoFilled; }
    };
  }
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => {
    const d = formData(e.target);
    d.scheduled_start = d.scheduled_start ? d.scheduled_start.replace('T', ' ') : null;
    d.scheduled_end = d.scheduled_end ? d.scheduled_end.replace('T', ' ') : null;
    if (id === 'new') { const r = await api('jobs', 'POST', d); location.hash = '#/job/' + r.id; }
    else { await api('jobs/' + id, 'PUT', d); toast('Saved'); route(); }
  }); };
  if (id === 'new') return;
  const del = $('#del'); if (del) del.onclick = () => confirm('Delete this job?') && act(async () => { await api('jobs/' + id, 'DELETE'); location.hash = '#/jobs'; });
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => act(async () => { await api(`jobs/${id}/items/${b.dataset.rm}`, 'DELETE'); route(); })));
  $('#pick').onchange = (e) => { const o = e.target.selectedOptions[0]; $('#addi [name=item_id]').value = o.value; if (o.value) { $('#addi [name=description]').value = o.dataset.n; $('#addi [name=unit_price]').value = o.dataset.p; } };
  $('#addi').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`jobs/${id}/items`, 'POST', formData(e.target)); route(); }); };
  $('#addn').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`jobs/${id}/notes`, 'POST', formData(e.target)); route(); }); };
  const sums = () => { const el = $('#invsum'); if (!el) return; const ids = [...document.querySelectorAll('.invsel:checked')].map((c) => c.value); const sub = j.items.filter((i) => ids.includes(String(i.id))).reduce((s, i) => s + i.qty * i.unit_price, 0); el.textContent = `Invoicing ${ids.length} of ${j.items.length} lines: ${money(sub)} ex GST, ${money(sub * 1.1)} inc GST`; };
  document.querySelectorAll('.invsel').forEach((c) => (c.onchange = sums)); sums();
  const mk = $('#mkinv'); if (mk) mk.onclick = () => act(async () => { const item_ids = [...document.querySelectorAll('.invsel:checked')].map((c) => Number(c.value)); if (j.items.length && !item_ids.length) return toast('Tick at least one item to invoice'); await api(`jobs/${id}/invoice`, 'POST', { item_ids }); route(); });
  const di = $('#delinv'); if (di) di.onclick = () => confirm('Delete invoice ' + j.invoice.number + '? The job returns to Completed and every line goes back to being available to invoice.') && act(async () => { await api(`jobs/${id}/invoice`, 'DELETE'); toast('Invoice deleted'); route(); });
  const pd = $('#paid'); if (pd) pd.onclick = () => act(async () => { await api(`jobs/${id}/paid`, 'POST'); route(); });
  if (window.SPARK_X) window.SPARK_X.jobHook(id, j).catch((e) => toast(e.message));
}

// ---------- Schedule (week view) ----------
let weekOffset = 0;
async function schedule() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + weekOffset * 7);
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rows = await api(`jobs?from=${iso(days[0])}&to=${iso(days[6])}`);
  shell('schedule', `<h1>Schedule</h1><div class="row noprint"><button class="sec" id="prev">◀</button><button class="sec" id="today">This week</button><button class="sec" id="next">▶</button></div>
    <div class="cal">${days.map((d) => `<div class="day"><h4>${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</h4>
      ${rows.filter((j) => (j.scheduled_start || '').slice(0, 10) === iso(d) && j.status !== 'cancelled').sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))
        .map((j) => `<a class="ev" href="#/job/${j.id}">${esc(j.scheduled_start.slice(11, 16))} ${esc(j.title)} · ${esc(j.client_name)}</a>`).join('')}</div>`).join('')}</div>`);
  $('#prev').onclick = () => { weekOffset--; schedule(); };
  $('#next').onclick = () => { weekOffset++; schedule(); };
  $('#today').onclick = () => { weekOffset = 0; schedule(); };
}

// ---------- Price list ----------
async function pricelist() {
  const rows = await api('pricelist');
  shell('pricelist', `<h1>Price list</h1><div class="card"><form class="row" id="f"><input name="name" class="grow" placeholder="Item / service" required><input name="unit_price" type="number" step="0.01" placeholder="Price ex GST" required style="width:140px"><button>Add</button></form>
    <div class="tablewrap">${rows.length ? `<table>${rows.map((p) => `<tr><td>${esc(p.name)}</td><td class="right">${money(p.unit_price)}</td><td class="right"><button class="sec" data-rm="${p.id}">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">Empty.</p>'}</div></div>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => { await api('pricelist', 'POST', formData(e.target)); pricelist(); }); };
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => act(async () => { await api('pricelist/' + b.dataset.rm, 'DELETE'); pricelist(); })));
}

// ---------- Staff ----------
async function staff() {
  const rows = await api('users');
  const admin = me.role === 'admin';
  shell('staff', `<h1>Staff</h1><div class="card tablewrap"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th>${admin ? '<th></th>' : ''}</tr>
    ${rows.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role}</td><td>${u.active ? 'Yes' : 'No'}</td>${admin ? `<td><button class="sec" data-tg="${u.id}" data-a="${u.active}" data-r="${u.role}" data-n="${esc(u.name)}">${u.active ? 'Deactivate' : 'Activate'}</button> <button class="sec" data-pw="${u.id}" data-n="${esc(u.name)}">Set password</button>${u.id !== me.id ? ` <button class="bad" data-del="${u.id}" data-n="${esc(u.name)}">Delete</button>` : ''}</td>` : ''}</tr>`).join('')}</table></div>
    ${admin ? `<div class="card"><h2>Add staff member</h2><form class="form" id="f"><label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required>
      <label>Temporary password (10+ chars)</label><input name="password" type="password" minlength="10" required><label>Role</label><select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select>
      <div class="row" style="margin-top:12px"><button>Add</button></div></form></div>` : ''}`);
  if (!admin) return;
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => { await api('users', 'POST', formData(e.target)); staff(); }); };
  document.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = () => act(async () => {
    await api('users/' + b.dataset.tg, 'PUT', { name: b.dataset.n, role: b.dataset.r, active: b.dataset.a !== '1' }); staff();
  })));
  document.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = () => {
    const pw = prompt(`New password for ${b.dataset.n} (10+ characters):`);
    if (!pw) return;
    act(async () => { await api(`users/${b.dataset.pw}/password`, 'POST', { password: pw }); toast('Password updated'); });
  }));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    if (!confirm(`Permanently delete ${b.dataset.n}? This cannot be undone. (Deactivate instead to keep their history.)`)) return;
    act(async () => { await api('users/' + b.dataset.del, 'DELETE'); toast('Staff member deleted'); staff(); });
  }));
}

// ---------- Router ----------
async function route() {
  if (!me) return;
  const [path, qs] = (location.hash.slice(2) || 'dashboard').split('?');
  const params = new URLSearchParams(qs || '');
  const [page, arg] = path.split('/');
  try {
    const X = window.SPARK_X;
    if (X && X.pages[page]) await X.pages[page](arg, params);
    else if (page === 'jobs') await jobs(params);
    else if (page === 'job') await jobPage(arg, params);
    else if (page === 'clients') await clients();
    else if (page === 'client') await clientForm(arg);
    else if (page === 'schedule') await schedule();
    else if (page === 'pricelist') await pricelist();
    else if (page === 'staff') await staff();
    else await dashboard();
  } catch (e) { if (me) toast(e.message); }
}

async function boot() {
  try {
    me = await api('auth/me');
    route();
  } catch {
    me = null;
    const s = await fetch('/api/spark/auth/status').then((r) => r.json()).catch(() => ({}));
    const rm = location.hash.match(/^#\/reset\/([A-Za-z0-9]+)$/);
    if (rm) return resetScreen(rm[1]);
    authScreen(!!s.needsSetup);
  }
}
window.addEventListener('hashchange', route);
window.SPARK = { api, act, esc, money, fmtDT, badge, shell, toast, route, formData, $, mapLink, mapsHref, me: () => me, STATUSES };
const xs = document.createElement('script');
xs.src = '/spark/extras.js';
xs.onload = () => {
  // extras3.js builds on extras.js (reports + job page), so it must load second
  const x3 = document.createElement('script');
  x3.src = '/spark/extras3.js';
  x3.onload = () => { const x4 = document.createElement('script'); x4.src = '/spark/extras4.js'; x4.onload = boot; x4.onerror = boot; document.head.appendChild(x4); }; x3.onerror = boot;
  document.head.appendChild(x3);
};
xs.onerror = boot;
document.head.appendChild(xs);
})();
