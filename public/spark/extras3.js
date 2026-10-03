(() => {
'use strict';
const S = window.SPARK;
const X = window.SPARK_X;
const { api, act, esc, money, fmtDT, badge, shell, toast, formData, $ } = S;
const me = () => S.me();
const isAdmin = () => me().role === 'admin';
const mapsUrl = (a) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a);
const download = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
};

// ======================================================================= Today (mobile staff view)
async function today() {
  const d = await api('my-jobs');
  const tomorrow = new Date(d.today + 'T00:00:00'); tomorrow.setDate(tomorrow.getDate() + 1);
  const tmr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const label = (j) => {
    const dt = (j.scheduled_start || '').slice(0, 10);
    if (!dt) return 'Unscheduled';
    if (dt === d.today) return 'Today';
    if (dt === tmr) return 'Tomorrow';
    if (dt < d.today) return 'Earlier';
    return new Date(dt + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const groups = [];
  for (const j of d.jobs) { const l = label(j); let g = groups.find((x) => x.l === l); if (!g) groups.push((g = { l, jobs: [] })); g.jobs.push(j); }
  const card = (j) => `<div class="card" style="padding:12px">
    <div class="row" style="margin-bottom:4px"><b class="grow" style="font-size:17px">${esc(j.title)}</b>${badge(j.status)}</div>
    <div class="muted">${j.scheduled_start ? '🕐 ' + esc(j.scheduled_start.slice(11, 16)) + ' · ' : ''}${esc(j.client_name)}</div>
    ${j.site_address ? `<div style="margin:4px 0"><a href="${mapsUrl(j.site_address)}" target="_blank" rel="noopener">📍 ${esc(j.site_address)}</a></div>` : ''}
    <div class="row" style="margin-top:8px">
      ${j.client_phone ? `<a href="tel:${esc(j.client_phone)}"><button class="sec" type="button">📞 Call</button></a>` : ''}
      ${j.site_address ? `<a href="${mapsUrl(j.site_address)}" target="_blank" rel="noopener"><button class="sec" type="button">🧭 Directions</button></a>` : ''}
      ${d.running && d.running.job_id === j.id ? `<button class="bad" data-stop="${j.id}">■ Stop timer</button>` : `<button data-start="${j.id}">▶ Start</button>`}
      <button class="sec" data-omw="${j.id}">💬 On my way</button>
      <button class="sec" onclick="location.hash='#/job/${j.id}'">Open</button></div></div>`;
  shell('today', `<h1>My jobs</h1>
    ${d.running ? `<div class="card" style="border-color:var(--accent)">⏱ Timer running on job <a href="#/job/${d.running.job_id}">#${d.running.job_id}</a> since ${fmtDT(d.running.started_at + 'Z')}</div>` : ''}
    ${groups.length ? groups.map((g) => `<h3 style="margin-top:14px">${esc(g.l)}</h3>${g.jobs.map(card).join('')}`).join('') : '<div class="card"><p class="muted">Nothing is assigned to you right now.</p></div>'}
    <div class="row"><button class="sec" onclick="location.hash='#/jobs'">All jobs</button><button class="sec" onclick="location.hash='#/job/new'">+ New job</button></div>`);
  document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => act(async () => { await api(`jobs/${b.dataset.start}/time/start`, 'POST'); today(); })));
  document.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => act(async () => { await api(`jobs/${b.dataset.stop}/time/stop`, 'POST', {}); today(); })));
  document.querySelectorAll('[data-omw]').forEach((b) => (b.onclick = () => confirm('Text the customer that you are on your way?') && act(async () => { await api(`jobs/${b.dataset.omw}/sms`, 'POST', { kind: 'omw' }); toast('Customer notified'); })));
}

// ======================================================================= Suppliers
async function suppliers() {
  shell('suppliers', `<h1>Suppliers</h1><div class="row"><input id="q" class="grow" placeholder="Search suppliers"><button onclick="location.hash='#/supplier/new'">+ New supplier</button>
    <a href="/api/spark/export/suppliers" style="padding:8px">⬇ CSV</a></div><div class="card tablewrap" id="list"></div>`);
  const load = () => act(async () => {
    const rows = await api('suppliers?q=' + encodeURIComponent($('#q').value));
    $('#list').innerHTML = rows.length ? `<table><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th></tr>${rows.map((s) => `<tr class="click" onclick="location.hash='#/supplier/${s.id}'"><td>${esc(s.name)}</td><td>${esc(s.contact || '')}</td><td>${esc(s.phone || '')}</td><td>${esc(s.email || '')}</td></tr>`).join('')}</table>` : '<p class="muted">No suppliers yet. Add one, or use Import to load a CSV.</p>';
  });
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
}

async function supplier(id) {
  const s = id === 'new' ? {} : await api('suppliers/' + id);
  shell('suppliers', `<h1>${id === 'new' ? 'New supplier' : esc(s.name)}</h1><div class="card"><form class="form" id="f">
    <label>Name</label><input name="name" value="${esc(s.name)}" required><label>Contact person</label><input name="contact" value="${esc(s.contact)}">
    <label>Phone</label><input name="phone" value="${esc(s.phone)}"><label>Email</label><input name="email" type="email" value="${esc(s.email)}">
    <label>Address</label><input name="address" value="${esc(s.address)}"><label>ABN</label><input name="abn" value="${esc(s.abn)}">
    <label>Notes</label><textarea name="notes">${esc(s.notes)}</textarea>
    ${id !== 'new' ? `<p class="muted">Recorded expenses with this supplier: ${s.expense_count} totalling ${money(s.spend)}</p>` : ''}
    <div class="row" style="margin-top:12px"><button>Save</button>${id !== 'new' && isAdmin() ? '<button type="button" class="bad" id="del">Delete</button>' : ''}</div></form></div>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => {
    if (id === 'new') { const r = await api('suppliers', 'POST', formData(e.target)); location.hash = '#/supplier/' + r.id; } else { await api('suppliers/' + id, 'PUT', formData(e.target)); toast('Saved'); }
  }); };
  const del = $('#del'); if (del) del.onclick = () => confirm('Delete this supplier?') && act(async () => { await api('suppliers/' + id, 'DELETE'); location.hash = '#/suppliers'; });
}

// ======================================================================= CSV import
const FIELDS = {
  clients: { label: 'Customers', required: ['name'], cols: {
    name: ['name', 'customer', 'customer_name', 'client', 'client_name', 'company', 'company_name', 'full_name', 'business_name'],
    email: ['email', 'email_address', 'e_mail', 'customer_email'], phone: ['phone', 'mobile', 'telephone', 'phone_number', 'mobile_number', 'contact_number', 'cell'],
    address: ['address', 'street_address', 'site_address', 'location', 'billing_address'], notes: ['notes', 'note', 'comments'] } },
  suppliers: { label: 'Suppliers', required: ['name'], cols: {
    name: ['name', 'supplier', 'supplier_name', 'company', 'company_name', 'business_name'], contact: ['contact', 'contact_name', 'contact_person'],
    email: ['email', 'email_address', 'e_mail'], phone: ['phone', 'mobile', 'telephone', 'phone_number'], address: ['address', 'street_address', 'location'],
    abn: ['abn'], notes: ['notes', 'note', 'comments'] } },
  pricelist: { label: 'Price list', required: ['name', 'unit_price'], cols: {
    name: ['name', 'item', 'item_name', 'description', 'product', 'product_name'], unit_price: ['unit_price', 'price', 'sell', 'sell_price', 'price_ex_gst', 'rrp', 'sale_price'],
    cost: ['cost', 'cost_price', 'buy', 'buy_price', 'purchase_price'], category: ['category', 'group', 'type'], is_labour: ['is_labour', 'labour', 'labor'] } },
};
const TEMPLATES = {
  clients: 'name,email,phone,address,notes\nJane Citizen,jane@example.com,0412 345 678,"12 Example St, Liverpool NSW",Prefers morning visits\n',
  suppliers: 'name,contact,email,phone,address,abn,notes\nExample Electrical Wholesale,Sam,orders@example.com,02 9999 0000,"1 Trade Rd, Wetherill Park NSW",12 345 678 901,Trade account 1234\n',
  pricelist: 'name,unit_price,cost,category,is_labour\nDouble power point supply & install,95.00,28.50,Power,\nElectrician labour per hour,110.00,0,Labour,yes\n',
};

function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const head = text.split(/\r?\n/, 1)[0];
  const count = (ch) => head.split(ch).length - 1;
  const delim = count('\t') > count(',') && count('\t') >= count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  const endRow = () => { row.push(cur); cur = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && cur === '') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += c;
  }
  if (cur !== '' || row.length) endRow();
  return rows;
}
const normHead = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function importPage() {
  if (!isAdmin()) { shell('import', '<h1>Import</h1><div class="card"><p class="muted">Only administrators can import data.</p></div>'); return; }
  shell('import', `<h1>Import from CSV</h1>
    <div class="card"><p class="muted">Export a CSV from Excel, Google Sheets, ServiceM8, Xero or MYOB, then upload it here. Columns are matched by heading, so the order does not matter. Existing records are detected by email (customers) or name (suppliers, price list).</p>
      <div class="row"><select id="type">${Object.entries(FIELDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        <button class="sec" id="tpl" type="button">⬇ Download template</button></div>
      <div class="row"><input type="file" id="file" accept=".csv,text/csv,.txt,.tsv"></div>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text);font-size:14px"><input type="checkbox" id="upd"> Update existing records that match (otherwise they are skipped)</label></div>
    <div id="preview"></div><div id="result"></div>`);
  let parsed = null;
  $('#tpl').onclick = () => download(`spark-${$('#type').value}-template.csv`, TEMPLATES[$('#type').value]);
  const analyse = async () => {
    const f = $('#file').files[0]; if (!f) return;
    const type = $('#type').value, def = FIELDS[type];
    if (f.size > 5 * 1024 * 1024) { toast('File is too large (5 MB max)'); return; }
    const all = parseCSV(await f.text());
    if (all.length < 2) { $('#preview').innerHTML = '<div class="card"><p>The file has no data rows.</p></div>'; parsed = null; return; }
    const heads = all[0].map(normHead); const map = {}, used = new Set();
    for (const [field, aliases] of Object.entries(def.cols)) {
      const idx = heads.findIndex((h, i) => !used.has(i) && aliases.includes(h));
      if (idx >= 0) { map[field] = idx; used.add(idx); }
    }
    const missing = def.required.filter((r) => map[r] === undefined);
    const ignored = all[0].filter((_, i) => !used.has(i));
    const rows = all.slice(1).map((c, i) => { const o = { _row: i + 2 }; for (const [field, idx] of Object.entries(map)) o[field] = (c[idx] ?? '').trim(); return o; });
    parsed = missing.length ? null : { type, rows };
    $('#result').innerHTML = '';
    $('#preview').innerHTML = `<div class="card"><h2>${rows.length} rows found</h2>
      <p>${Object.entries(map).map(([k, i]) => `<span class="badge">${esc(k)} ← ${esc(all[0][i])}</span>`).join(' ')}</p>
      ${ignored.length ? `<p class="muted">Ignored columns: ${ignored.map(esc).join(', ')}</p>` : ''}
      ${missing.length ? `<p style="color:var(--bad)">Cannot import: no column found for <b>${missing.join(', ')}</b>. Check the heading names or download the template.</p>` : ''}
      <div class="tablewrap"><table><tr>${Object.keys(map).map((k) => `<th>${esc(k)}</th>`).join('')}</tr>${rows.slice(0, 5).map((r) => `<tr>${Object.keys(map).map((k) => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</table></div>
      ${missing.length ? '' : `<div class="row" style="margin-top:10px"><button id="go">Import ${rows.length} rows</button></div>`}</div>`;
    const go = $('#go'); if (go) go.onclick = () => runImport();
  };
  const runImport = () => act(async () => {
    if (!parsed) return;
    const go = $('#go'); go.disabled = true;
    const tot = { added: 0, updated: 0, skipped: 0, errors: [] };
    for (let i = 0; i < parsed.rows.length; i += 100) {
      go.textContent = `Importing… ${Math.min(i + 100, parsed.rows.length)} / ${parsed.rows.length}`;
      const r = await api('import/' + parsed.type, 'POST', { rows: parsed.rows.slice(i, i + 100), update: $('#upd').checked });
      tot.added += r.added; tot.updated += r.updated; tot.skipped += r.skipped; tot.errors.push(...r.errors);
    }
    go.textContent = 'Done';
    $('#result').innerHTML = `<div class="card"><h2>Import complete</h2><p>✅ ${tot.added} added · ✏️ ${tot.updated} updated · ⏭ ${tot.skipped} skipped (already exist) · ❌ ${tot.errors.length} rejected</p>
      ${tot.errors.length ? `<div class="tablewrap"><table><tr><th>Row</th><th>Problem</th></tr>${tot.errors.slice(0, 50).map((e) => `<tr><td>${e.row ?? ''}</td><td>${esc(e.error)}</td></tr>`).join('')}</table></div>${tot.errors.length > 50 ? `<p class="muted">…and ${tot.errors.length - 50} more</p>` : ''}` : ''}</div>`;
  });
  $('#file').onchange = analyse; $('#type').onchange = analyse;
}

// ======================================================================= Integrations
async function integrations(arg, params) {
  const i = await api('integrations');
  const admin = isAdmin();
  if (params && params.get('xero') === 'connected') toast('Xero connected');
  if (params && params.get('xero') === 'error') toast('Xero: ' + (params.get('msg') || 'connection failed'));
  const dot = (ok) => (ok ? '<span style="color:var(--ok)">● Ready</span>' : '<span style="color:var(--bad)">● Not set up</span>');
  const code = (t) => `<code style="background:#0b121b;padding:1px 5px;border-radius:4px">${t}</code>`;
  const x = i.xero;
  shell('integrations', `<h1>Integrations</h1>
    <div class="card"><h2>Email (Mailgun) ${dot(i.mailgun)}</h2><p class="muted">Needs the ${code('MAILGUN_API_KEY')} secret on the Pages project.</p></div>

    <div class="card"><h2>SMS reminders ${dot(!!i.sms.provider)}</h2>
      <p class="muted">${i.sms.provider ? `Sending through <b>${esc(i.sms.provider)}</b>.` : `Set <i>either</i> ${code('TWILIO_ACCOUNT_SID')} ${code('TWILIO_AUTH_TOKEN')} ${code('SMS_FROM')} <i>or</i> ${code('CLICKSEND_USERNAME')} ${code('CLICKSEND_API_KEY')} on the Pages project.`}</p>
      <p class="muted">Automatic reminders go out the day before a booked job (8am-7pm Sydney time). The hourly trigger is ${i.cron ? '<b>configured</b>' : `<b>not configured</b>: set the same ${code('CRON_SECRET')} on the Pages project and the ohmworks-contact Worker`}.</p>
      <form class="form" id="smsf"><label style="display:flex;gap:8px;align-items:center;color:var(--text);font-size:14px"><input type="checkbox" name="sms_auto_reminders" value="1" ${i.sms.auto ? 'checked' : ''} ${admin ? '' : 'disabled'}> Send reminders automatically</label>
        <label>Reminder text (use {name} {business} {date} {time} {phone})</label><textarea name="sms_reminder_template" ${admin ? '' : 'disabled'}>${esc(i.sms.template)}</textarea>
        ${admin ? '<div class="row" style="margin-top:8px"><button>Save</button><button type="button" class="sec" id="runrem">Send due reminders now</button></div>' : ''}</form></div>

    <div class="card"><h2>Card payments (Stripe) ${dot(i.stripe.configured && i.stripe.webhook)}</h2>
      <p class="muted">Customers see a <b>Pay by card</b> button on their invoice link. Set ${code('STRIPE_SECRET_KEY')} (${i.stripe.configured ? 'set' : 'missing'}) and ${code('STRIPE_WEBHOOK_SECRET')} (${i.stripe.webhook ? 'set' : 'missing'}) on the Pages project.</p>
      <p class="muted">In Stripe → Developers → Webhooks, add this endpoint and subscribe to <b>checkout.session.completed</b> and <b>checkout.session.async_payment_succeeded</b>:<br><code style="background:#0b121b;padding:2px 6px;border-radius:4px;word-break:break-all">${esc(i.stripe.webhook_url)}</code></p>
      <p class="muted">Payments are recorded automatically once Stripe confirms them. The invoice is marked paid when the balance reaches zero.</p></div>

    <div class="card"><h2>Xero ${dot(x.connected)}</h2>
      ${x.connected ? `<p>Connected to <b>${esc(x.tenant || 'your organisation')}</b>.</p>` : x.configured ? '<p class="muted">Credentials are set. Click Connect to authorise SPARK in Xero.</p>' : `<p class="muted">Create an app at developer.xero.com, then set ${code('XERO_CLIENT_ID')} and ${code('XERO_CLIENT_SECRET')} on the Pages project. Add this redirect URI to the Xero app:<br><code style="background:#0b121b;padding:2px 6px;border-radius:4px;word-break:break-all">${esc(x.redirect_uri)}</code></p>`}
      <form class="form" id="xf"><label>Sales account code</label><input name="xero_account_code" value="${esc(x.account_code)}" ${admin ? '' : 'disabled'}>
        <label>GST tax type</label><input name="xero_tax_type" value="${esc(x.tax_type)}" ${admin ? '' : 'disabled'}>
        <label>Bank account code for payments (leave empty to sync invoices only)</label><input name="xero_bank_code" value="${esc(x.bank_code)}" ${admin ? '' : 'disabled'}>
        ${admin ? '<div class="row" style="margin-top:8px"><button>Save</button></div>' : ''}</form>
      ${admin ? `<div class="row" style="margin-top:10px">${x.configured ? `<button id="xconn" class="${x.connected ? 'sec' : ''}">${x.connected ? 'Reconnect' : 'Connect to Xero'}</button>` : ''}
        ${x.connected ? '<button id="xsync">Sync unsynced invoices</button><button class="bad" id="xdisc">Disconnect</button>' : ''}</div><div id="xout" class="muted"></div>` : ''}
      <p class="muted" style="margin-top:8px">Invoices are pushed to Xero as authorised sales invoices and are not changed again afterwards. MYOB is not connected yet. You can export invoices and customers from Reports (CSV) and import them into MYOB.</p></div>`);
  if (!admin) return;
  const saveForm = (formId) => { $(formId).onsubmit = (e) => { e.preventDefault(); act(async () => {
    const d = formData(e.target);
    if (formId === '#smsf') d.sms_auto_reminders = e.target.sms_auto_reminders.checked ? '1' : '0';
    await api('settings', 'PUT', d); toast('Saved');
  }); }; };
  saveForm('#smsf'); saveForm('#xf');
  const rr = $('#runrem'); if (rr) rr.onclick = () => act(async () => { const r = await api('sms/run-reminders', 'POST', {}); toast(r.skipped ? r.skipped : `Sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ''}`); });
  const xc = $('#xconn'); if (xc) xc.onclick = () => act(async () => { const r = await api('xero/connect'); location.href = r.url; });
  const xd = $('#xdisc'); if (xd) xd.onclick = () => confirm('Disconnect Xero?') && act(async () => { await api('xero/disconnect', 'POST', {}); integrations(); });
  const xs = $('#xsync'); if (xs) xs.onclick = () => act(async () => {
    xs.disabled = true; let total = 0, failed = [], left = 1;
    while (left > 0) {
      const r = await api('xero/sync-all', 'POST', {}); total += r.synced; failed.push(...r.failed); left = r.remaining;
      $('#xout').textContent = `Synced ${total}…`;
      if (!r.synced) break;
    }
    $('#xout').innerHTML = `Synced ${total} invoice(s).${failed.length ? ' Problems:<br>' + failed.map((f) => `Job #${f.job}: ${esc(f.error)}`).join('<br>') : ''}`;
    xs.disabled = false;
  });
}

// ======================================================================= Reports (extended)
const origReports = X.pages.reports;
async function reports(arg, params) {
  await origReports(arg, params);
  let r; try { r = await api('reports-extra'); } catch { return; }
  const max = Math.max(1, ...r.monthly.flatMap((m) => [m.received, m.expenses]));
  const bar = (v, c) => `<div style="background:${c};height:10px;border-radius:3px;width:${(v / max * 100).toFixed(1)}%;min-width:${v > 0 ? 2 : 0}px"></div>`;
  const rate = r.quotes.total ? Math.round(r.quotes.won / r.quotes.total * 100) : 0;
  const box = document.createElement('div');
  box.innerHTML = `
    <div class="card"><h2>Last 12 months</h2>${r.monthly.length ? r.monthly.map((m) => `<div style="margin:8px 0"><div class="row" style="margin:0"><b class="grow">${esc(m.month)}</b><span class="muted">in ${money(m.received)} · out ${money(m.expenses)}</span></div>${bar(m.received, 'var(--ok)')}<div style="height:3px"></div>${bar(m.expenses, 'var(--bad)')}</div>`).join('') : '<p class="muted">No data yet.</p>'}
      <p class="muted"><span style="color:var(--ok)">■</span> received &nbsp; <span style="color:var(--bad)">■</span> expenses</p></div>
    <div class="grid"><div class="stat"><b>${rate}%</b><span>quotes won, last 90 days (${r.quotes.won} of ${r.quotes.total})</span></div>
      ${r.sources.map((s) => `<div class="stat"><b>${s.jobs}</b><span>jobs from ${esc(s.source)}, 90 days</span></div>`).join('')}</div>
    <div class="card" style="margin-top:14px"><h2>Recent job profitability</h2>${r.profit.length ? `<div class="tablewrap"><table><tr><th>Job</th><th>Client</th><th class="right">Revenue</th><th class="right">Costs</th><th class="right">Margin</th></tr>${r.profit.map((p) => `<tr class="click" onclick="location.hash='#/job/${p.id}'"><td>#${p.id} ${esc(p.title)}</td><td>${esc(p.client_name)}</td><td class="right">${money(p.revenue)}</td><td class="right">${money(p.costs)}</td><td class="right" style="color:${p.margin < 0 ? 'var(--bad)' : 'inherit'}">${money(p.margin)}</td></tr>`).join('')}</table></div><p class="muted">Revenue ex GST. Costs are item costs plus job expenses ex GST.</p>` : '<p class="muted">No completed jobs yet.</p>'}</div>
    <div class="card"><h2>Revenue by category (completed jobs, ex GST)</h2>${r.by_category.length ? `<table>${r.by_category.map((c) => `<tr><td>${esc(c.category)}</td><td class="muted">${c.jobs} jobs</td><td class="right">${money(c.revenue_ex_gst)}</td></tr>`).join('')}</table>` : '<p class="muted">None yet.</p>'}</div>
    <div class="card"><h2>Top suppliers (spend, last 12 months)</h2>${r.suppliers.length ? `<table>${r.suppliers.map((c) => `<tr><td>${esc(c.supplier)}</td><td class="right">${money(c.total)}</td></tr>`).join('')}</table>` : '<p class="muted">No expenses recorded.</p>'}</div>`;
  document.querySelector('main').appendChild(box);
}

// ======================================================================= Job page additions: SMS + Xero
const prevHook = X.jobHook;
async function jobHook(id, job) {
  await prevHook(id, job);
  if (!id || id === 'new') return;
  const [ints, log] = await Promise.all([api('integrations'), api(`jobs/${id}/sms`)]);
  const main = document.querySelector('main');
  const box = document.createElement('div');
  const sms = !!ints.sms.provider;
  const inv = job && job.invoice;
  box.innerHTML = `
    <div class="card"><h2>SMS</h2>${sms ? `<div class="row"><button class="sec" data-sms="reminder">Send booking reminder</button><button class="sec" data-sms="omw">On my way</button></div>
      <form class="row" id="smsf"><input name="message" class="grow" maxlength="320" placeholder="Custom message to client" required><button>Send SMS</button></form>`
        : '<p class="muted">SMS is not set up yet. See Integrations.</p>'}
      ${log.length ? `<details><summary class="muted">SMS history (${log.length})</summary>${log.map((m) => `<div class="muted">${fmtDT(m.created_at + 'Z')} · ${m.ok ? '✓' : '✗ ' + esc(m.detail)} · ${esc(m.body)}</div>`).join('')}</details>` : ''}</div>
    ${isAdmin() && ints.xero.connected && inv ? `<div class="card"><h2>Xero</h2><p>${inv.xero_invoice_id ? `✅ Invoice ${esc(inv.number)} is in Xero (synced ${fmtDT(inv.xero_synced_at + 'Z')}).${ints.xero.bank_code ? ' New payments sync when you press the button.' : ''}` : `Invoice ${esc(inv.number)} has not been sent to Xero.`}</p>
      <div class="row"><button id="xs">${inv.xero_invoice_id ? 'Sync new payments' : 'Send invoice to Xero'}</button></div></div>` : ''}`;
  main.appendChild(box);
  box.querySelectorAll('[data-sms]').forEach((b) => (b.onclick = () => confirm('Send this SMS to the client?') && act(async () => { await api(`jobs/${id}/sms`, 'POST', { kind: b.dataset.sms }); toast('SMS sent'); S.route(); })));
  const f = box.querySelector('#smsf'); if (f) f.onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`jobs/${id}/sms`, 'POST', { kind: 'custom', message: formData(e.target).message }); toast('SMS sent'); S.route(); }); };
  const xs = box.querySelector('#xs'); if (xs) xs.onclick = () => act(async () => { xs.disabled = true; const r = await api(`jobs/${id}/xero-sync`, 'POST', {}); toast(`Xero: invoice ${r.invoice}${r.payments ? `, ${r.payments} payment(s)` : ''}`); S.route(); });
}

Object.assign(X.pages, { today, suppliers, supplier, import: importPage, integrations, reports });
X.jobHook = jobHook;
})();
