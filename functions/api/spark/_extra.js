// SPARK phase 2 API: settings, photos, checklists, time tracking, payments, signatures,
// email (Mailgun), client portal, recurring jobs, expenses, reports, search, CSV export.
const GST = 0.1;
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const KINDS = ['quote', 'invoice', 'reminder', 'booking'];

export async function getSettings(env) {
  const rows = (await env.DB.prepare('SELECT key,value FROM settings').all()).results;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function totals(env, jobId) {
  const t = await env.DB.prepare('SELECT COALESCE(SUM(qty*unit_price),0) AS s, COALESCE(SUM(qty*cost),0) AS c FROM job_items WHERE job_id=?').bind(jobId).first();
  const p = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM payments WHERE job_id=?').bind(jobId).first();
  const subtotal = r2(t.s), gst = r2(subtotal * GST), total = r2(subtotal + gst);
  return { subtotal, gst, total, cost: r2(t.c), paid: r2(p.p), balance: r2(total - p.p) };
}

async function ensureToken(env, jobId) {
  const j = await env.DB.prepare('SELECT portal_token FROM jobs WHERE id=?').bind(jobId).first();
  if (j && j.portal_token) return j.portal_token;
  const tok = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36).padStart(2, '0')).join('');
  await env.DB.prepare('UPDATE jobs SET portal_token=? WHERE id=?').bind(tok, jobId).run();
  return tok;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function sendMail(env, { to, subject, html, text, replyTo }) {
  const key = env.MAILGUN_API_KEY && String(env.MAILGUN_API_KEY).trim();
  const domain = String(env.MAILGUN_DOMAIN || 'ohmworks.com.au').trim();
  if (!key) return { ok: false, detail: 'MAILGUN_API_KEY is not set on the Pages project' };
  const base = env.MAILGUN_API_BASE || 'https://api.mailgun.net';
  const form = new FormData();
  form.append('from', env.FROM_ADDRESS || 'OHMWORKS <jobs@ohmworks.com.au>');
  form.append('to', to);
  form.append('subject', subject);
  form.append('text', text);
  form.append('html', html);
  if (replyTo) form.append('h:Reply-To', replyTo);
  const resp = await fetch(`${base}/v3/${domain}/messages`, { method: 'POST', headers: { Authorization: 'Basic ' + btoa('api:' + key) }, body: form });
  const detail = await resp.text().catch(() => '');
  return { ok: resp.ok, detail: detail.slice(0, 300) };
}

async function buildEmail(env, origin, job, kind, message) {
  const s = await getSettings(env);
  const items = (await env.DB.prepare('SELECT * FROM job_items WHERE job_id=? ORDER BY id').bind(job.id).all()).results;
  const t = await totals(env, job.id);
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE job_id=?').bind(job.id).first();
  const link = `${origin}/spark/portal.html?t=${await ensureToken(env, job.id)}`;
  const heading = { quote: 'Quote', invoice: 'Tax Invoice ' + (inv ? inv.number : ''), reminder: 'Payment reminder ' + (inv ? inv.number : ''), booking: 'Booking confirmation' }[kind];
  const intro = message || {
    quote: 'Thanks for the opportunity to quote. Please review the details below and accept online.',
    invoice: 'Please find your invoice below. Payment details are at the bottom.',
    reminder: 'This is a friendly reminder that the invoice below is now due.',
    booking: `Your job is booked${job.scheduled_start ? ' for ' + job.scheduled_start : ''}.`,
  }[kind];
  const rows = items.map((i) => `<tr><td style="padding:6px;border-bottom:1px solid #ddd">${esc(i.description)}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${i.qty}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${money(i.unit_price * i.qty)}</td></tr>`).join('');
  const showTable = kind !== 'booking';
  const bank = (kind === 'invoice' || kind === 'reminder') && s.bank_details ? `<p><b>Payment details</b><br>${esc(s.bank_details).replace(/\n/g, '<br>')}</p>` : '';
  const terms = kind === 'quote' ? s.quote_terms : kind === 'booking' ? '' : s.invoice_terms;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111">
    <h2 style="margin-bottom:0">${esc(s.business_name)}</h2><div style="color:#555">ABN ${esc(s.abn)} · Lic ${esc(s.licence)} · ${esc(s.phone)}</div>
    <h3>${esc(heading)}</h3><p>Hi ${esc(job.client_name)},</p><p>${esc(intro).replace(/\n/g, '<br>')}</p>
    <p><b>${esc(job.title)}</b>${job.site_address ? '<br>' + esc(job.site_address) : ''}</p>
    ${showTable ? `<table style="width:100%;border-collapse:collapse"><tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Amount</th></tr>${rows}
      <tr><td colspan="2" align="right">Subtotal</td><td align="right">${money(t.subtotal)}</td></tr><tr><td colspan="2" align="right">GST</td><td align="right">${money(t.gst)}</td></tr>
      <tr><td colspan="2" align="right"><b>Total</b></td><td align="right"><b>${money(t.total)}</b></td></tr>
      ${t.paid ? `<tr><td colspan="2" align="right">Paid</td><td align="right">${money(t.paid)}</td></tr><tr><td colspan="2" align="right"><b>Balance</b></td><td align="right"><b>${money(t.balance)}</b></td></tr>` : ''}</table>` : ''}
    <p><a href="${link}" style="background:#0b79d0;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${kind === 'quote' ? 'View &amp; accept quote' : 'View online'}</a></p>
    ${bank}<p style="color:#666;font-size:12px">${esc(terms || '')}</p></div>`;
  const text = `${heading}\n\nHi ${job.client_name},\n\n${intro}\n\n${job.title}\nTotal: ${money(t.total)}${t.paid ? `\nBalance: ${money(t.balance)}` : ''}\n\nView online: ${link}\n\n${s.business_name} ${s.phone}`;
  return { subject: `${heading.trim()} – ${job.title} – ${s.business_name}`, html, text };
}

const addInterval = (dateStr, rule) => {
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  if (rule === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (rule === 'fortnightly') d.setUTCDate(d.getUTCDate() + 14);
  else if (rule === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (rule === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (rule === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

async function cloneJob(env, id, { status = 'quote', start = null, end = null, parent = null } = {}) {
  const j = await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();
  if (!j) return null;
  const r = await env.DB.prepare(
    `INSERT INTO jobs (client_id,title,description,site_address,status,assigned_to,scheduled_start,scheduled_end,category,repeat_rule,repeat_parent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(j.client_id, j.title, j.description, j.site_address, status, j.assigned_to, start, end, j.category, null, parent).run();
  const nid = r.meta.last_row_id;
  await env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price,cost) SELECT ?,description,qty,unit_price,cost FROM job_items WHERE job_id=?').bind(nid, id).run();
  await env.DB.prepare('INSERT INTO job_checklist (job_id,label) SELECT ?,label FROM job_checklist WHERE job_id=?').bind(nid, id).run();
  return nid;
}

export async function runRecurring(env) {
  const due = (await env.DB.prepare(
    `SELECT id,scheduled_start,scheduled_end,repeat_rule FROM jobs WHERE repeat_rule IS NOT NULL AND repeat_rule!='none' AND repeat_spawned=0
     AND status IN ('completed','invoiced','paid') AND scheduled_start IS NOT NULL LIMIT 20`).all()).results;
  for (const j of due) {
    const start = addInterval(j.scheduled_start, j.repeat_rule);
    const end = j.scheduled_end ? addInterval(j.scheduled_end, j.repeat_rule) : null;
    const nid = await cloneJob(env, j.id, { status: 'work_order', start, end, parent: j.id });
    if (nid) {
      await env.DB.prepare('UPDATE jobs SET repeat_spawned=1 WHERE id=?').bind(j.id).run();
      await env.DB.prepare('UPDATE jobs SET repeat_rule=? WHERE id=?').bind(j.repeat_rule, nid).run();
    }
  }
}

export async function syncPaid(env, jobId) {
  const t = await totals(env, jobId);
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE job_id=?').bind(jobId).first();
  if (!inv) return;
  if (t.total > 0 && t.balance <= 0.004) {
    await env.DB.prepare(`UPDATE invoices SET paid_at=COALESCE(paid_at,date('now')) WHERE job_id=?`).bind(jobId).run();
    await env.DB.prepare(`UPDATE jobs SET status='paid', updated_at=datetime('now') WHERE id=?`).bind(jobId).run();
  } else {
    await env.DB.prepare(`UPDATE invoices SET paid_at=NULL WHERE job_id=?`).bind(jobId).run();
    await env.DB.prepare(`UPDATE jobs SET status='invoiced', updated_at=datetime('now') WHERE id=? AND status='paid'`).bind(jobId).run();
  }
}

// ---------- Public client portal (no login) ----------
export async function handlePortal({ env, request, parts, body, json, err }) {
  const token = parts[1];
  const action = parts[2];
  if (!token || token.length < 20) return err('Not found', 404);
  const j = await env.DB.prepare(
    `SELECT j.id,j.title,j.description,j.site_address,j.status,j.scheduled_start,j.signed_at,j.signed_name,j.quote_accepted_at,j.quote_accepted_name,c.name AS client_name
     FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.portal_token=?`).bind(token).first();
  if (!j) return err('Not found', 404);
  if (request.method === 'POST' && action === 'accept') {
    // Signing the quote is acceptance: a drawn signature and a printed name are both required.
    if (!body.name || !String(body.name).trim()) return err('Please print your name');
    if (!body.signature || !String(body.signature).startsWith('data:image/png') || body.signature.length > 300000) return err('Please sign the quote');
    if (j.quote_accepted_at) return json({ ok: true });
    await env.DB.prepare(`UPDATE jobs SET quote_accepted_at=datetime('now'), quote_accepted_name=?, quote_signature=?, status=CASE WHEN status='quote' THEN 'work_order' ELSE status END, updated_at=datetime('now') WHERE id=?`)
      .bind(String(body.name).trim().slice(0, 100), body.signature, j.id).run();
    await env.DB.prepare('INSERT INTO job_notes (job_id,body) VALUES (?,?)').bind(j.id, `Quote signed and accepted online by ${String(body.name).trim()}`).run();
    return json({ ok: true });
  }
  if (request.method === 'POST' && action === 'sign') {
    if (!body.name || !body.signature || !String(body.signature).startsWith('data:image/png') || body.signature.length > 300000) return err('Name and signature required');
    await env.DB.prepare(`UPDATE jobs SET signature=?, signed_name=?, signed_at=datetime('now') WHERE id=?`).bind(body.signature, String(body.name).slice(0, 100), j.id).run();
    return json({ ok: true });
  }
  const s = await getSettings(env);
  const items = (await env.DB.prepare('SELECT description,qty,unit_price FROM job_items WHERE job_id=? ORDER BY id').bind(j.id).all()).results;
  const invoice = await env.DB.prepare('SELECT number,issued_at,due_at,paid_at FROM invoices WHERE job_id=?').bind(j.id).first();
  if (invoice) await env.DB.prepare(`UPDATE invoices SET portal_viewed_at=COALESCE(portal_viewed_at,datetime('now')) WHERE job_id=?`).bind(j.id).run();
  const payments = (await env.DB.prepare('SELECT amount,method,paid_on FROM payments WHERE job_id=? ORDER BY id').bind(j.id).all()).results;
  const { id, ...pub } = j;
  const tot = await totals(env, j.id);
  return json({
    ...pub, items, invoice, payments, totals: tot,
    card: !!(env.STRIPE_SECRET_KEY && invoice && !invoice.paid_at && tot.balance >= 0.5),
    business: { name: s.business_name, abn: s.abn, licence: s.licence, phone: s.phone, email: s.email, address: s.address },
    bank_details: invoice ? s.bank_details : '', terms: invoice ? s.invoice_terms : s.quote_terms,
  });
}

// ---------- Authenticated extras. Return a Response, or null if the route isn't handled here ----------
export async function handleExtra({ env, request, url, parts, body, user, json, err }) {
  const method = request.method;
  const [res, id, sub, subId] = parts;
  const admin = user.role === 'admin';

  // Settings
  if (res === 'settings') {
    if (method === 'GET') return json(await getSettings(env));
    if (!admin) return err('Admin only', 403);
    if (method === 'PUT') {
      for (const [k, v] of Object.entries(body)) {
        if (!/^[a-z_]{1,40}$/.test(k)) continue;
        await env.DB.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, String(v ?? '')).run();
      }
      return json({ ok: true });
    }
  }

  // Change own password
  if (res === 'me' && id === 'password' && method === 'POST') {
    if (!body.new_password || body.new_password.length < 10) return err('New password must be 10+ characters');
    const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
    const enc = async (p, salt) => {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
      return btoa(String.fromCharCode(...new Uint8Array(bits)));
    };
    if ((await enc(body.current_password || '', u.pass_salt)) !== u.pass_hash) return err('Current password is wrong', 403);
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?').bind(await enc(body.new_password, salt), salt, user.id).run();
    return json({ ok: true });
  }

  // Global search
  if (res === 'search' && method === 'GET') {
    const q = `%${(url.searchParams.get('q') || '').trim()}%`;
    if (q.length < 3) return json({ clients: [], jobs: [] });
    const clients = (await env.DB.prepare('SELECT id,name,phone,email FROM clients WHERE name LIKE ?1 OR phone LIKE ?1 OR email LIKE ?1 OR address LIKE ?1 LIMIT 8').bind(q).all()).results;
    const jobs = (await env.DB.prepare(`SELECT j.id,j.title,j.status,c.name AS client_name FROM jobs j JOIN clients c ON c.id=j.client_id
      WHERE j.title LIKE ?1 OR j.site_address LIKE ?1 OR c.name LIKE ?1 OR CAST(j.id AS TEXT)=trim(?2,'%') LIMIT 8`).bind(q, q).all()).results;
    return json({ clients, jobs });
  }

  // Checklist templates
  if (res === 'checklist-templates') {
    if (method === 'GET') return json((await env.DB.prepare('SELECT * FROM checklist_templates ORDER BY name').all()).results);
    if (method === 'POST') {
      if (!body.name || !body.items) return err('Name and items required');
      await env.DB.prepare('INSERT INTO checklist_templates (name,items) VALUES (?,?)').bind(body.name, body.items).run();
      return json({ ok: true }, 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM checklist_templates WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  // Expenses
  if (res === 'expenses') {
    if (method === 'GET') {
      const from = url.searchParams.get('from') || '0000-01-01', to = url.searchParams.get('to') || '9999-12-31';
      return json((await env.DB.prepare('SELECT e.*, j.title AS job_title FROM expenses e LEFT JOIN jobs j ON j.id=e.job_id WHERE e.spent_on BETWEEN ? AND ? ORDER BY e.spent_on DESC LIMIT 500').bind(from, to).all()).results);
    }
    if (method === 'POST') {
      if (!body.description || !(Number(body.amount) > 0)) return err('Description and amount required');
      await env.DB.prepare('INSERT INTO expenses (job_id,description,amount,supplier,spent_on) VALUES (?,?,?,?,COALESCE(?,date(\'now\')))')
        .bind(body.job_id || null, body.description, Number(body.amount), body.supplier || null, body.spent_on || null).run();
      return json({ ok: true }, 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM expenses WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  // Reports
  if (res === 'reports' && method === 'GET') {
    const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    const rev = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS v, COUNT(*) AS n FROM payments WHERE paid_on BETWEEN ? AND ?').bind(from, to).first();
    const exp = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE spent_on BETWEEN ? AND ?').bind(from, to).first();
    const invoiced = await env.DB.prepare(`SELECT COALESCE(SUM(i.qty*i.unit_price),0)*1.1 AS v FROM job_items i JOIN invoices v ON v.job_id=i.job_id WHERE v.issued_at BETWEEN ? AND ?`).bind(from, to).first();
    const aging = (await env.DB.prepare(
      `SELECT j.id, j.title, c.name AS client_name, v.number, v.due_at,
        CAST(julianday('now')-julianday(v.due_at) AS INTEGER) AS days_over,
        (SELECT COALESCE(SUM(qty*unit_price),0)*1.1 FROM job_items WHERE job_id=j.id) - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE job_id=j.id) AS balance
       FROM invoices v JOIN jobs j ON j.id=v.job_id JOIN clients c ON c.id=j.client_id WHERE v.paid_at IS NULL ORDER BY v.due_at`).all()).results
      .map((a) => ({ ...a, balance: r2(a.balance) })).filter((a) => a.balance > 0.004);
    const hours = (await env.DB.prepare(
      `SELECT u.name, ROUND(SUM((julianday(COALESCE(t.ended_at,datetime('now')))-julianday(t.started_at))*24),2) AS hours
       FROM time_entries t JOIN users u ON u.id=t.user_id WHERE date(t.started_at) BETWEEN ? AND ? GROUP BY u.id ORDER BY hours DESC`).bind(from, to).all()).results;
    const byClient = (await env.DB.prepare(
      `SELECT c.name, ROUND(SUM(p.amount),2) AS total FROM payments p JOIN jobs j ON j.id=p.job_id JOIN clients c ON c.id=j.client_id
       WHERE p.paid_on BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC LIMIT 10`).bind(from, to).all()).results;
    const gstCollected = r2(rev.v / 11), gstPaid = r2(exp.v / 11);
    return json({ from, to, received: r2(rev.v), payments: rev.n, invoiced: r2(invoiced.v), expenses: r2(exp.v), profit: r2(rev.v - exp.v),
      gst_collected: gstCollected, gst_paid: gstPaid, gst_payable: r2(gstCollected - gstPaid), aging, hours, top_clients: byClient });
  }

  // CSV export
  if (res === 'export' && method === 'GET') {
    const csv = (rows) => {
      if (!rows.length) return '';
      const cols = Object.keys(rows[0]);
      const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
    };
    let rows = [];
    if (id === 'clients') rows = (await env.DB.prepare('SELECT id,name,email,phone,address,notes,created_at FROM clients ORDER BY name').all()).results;
    else if (id === 'invoices') rows = (await env.DB.prepare(`SELECT v.number,v.issued_at,v.due_at,v.paid_at,c.name AS client,j.title,
      ROUND((SELECT COALESCE(SUM(qty*unit_price),0) FROM job_items WHERE job_id=j.id),2) AS subtotal,
      ROUND((SELECT COALESCE(SUM(qty*unit_price),0) FROM job_items WHERE job_id=j.id)*1.1,2) AS total
      FROM invoices v JOIN jobs j ON j.id=v.job_id JOIN clients c ON c.id=j.client_id ORDER BY v.id`).all()).results;
    else if (id === 'jobs') rows = (await env.DB.prepare('SELECT j.id,j.title,j.status,c.name AS client,j.site_address,j.scheduled_start,j.created_at FROM jobs j JOIN clients c ON c.id=j.client_id ORDER BY j.id').all()).results;
    else if (id === 'suppliers') rows = (await env.DB.prepare('SELECT id,name,contact,email,phone,address,abn,notes FROM suppliers ORDER BY name').all()).results;
    else if (id === 'pricelist') rows = (await env.DB.prepare(
      `SELECT p.name, p.unit_price, COALESCE(si.cost, p.cost) AS cost, p.category, CASE WHEN p.is_labour=1 THEN 'yes' ELSE '' END AS is_labour,
        p.manufacturer, p.mfr_part_no, s.name AS supplier, si.supplier_part_no, si.cost AS supplier_cost,
        CASE WHEN si.preferred=1 THEN 'yes' ELSE '' END AS preferred,
        CASE WHEN p.track_stock=1 THEN p.stock_qty ELSE '' END AS stock_qty
       FROM price_list p LEFT JOIN supplier_items si ON si.item_id=p.id LEFT JOIN suppliers s ON s.id=si.supplier_id
       ORDER BY p.name COLLATE NOCASE, si.preferred DESC, s.name`).all()).results;
    else return err('Unknown export', 404);
    return new Response(csv(rows), { headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="spark-${id}.csv"` } });
  }

  // Dashboard extras
  if (res === 'dashboard-extra' && method === 'GET') {
    await runRecurring(env);
    const overdue = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE paid_at IS NULL AND due_at < date('now')`).first()).n;
    const month = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE paid_on >= date('now','start of month')`).first();
    const open = (await env.DB.prepare(`SELECT j.id,j.title,j.scheduled_start,c.name AS client_name FROM jobs j JOIN clients c ON c.id=j.client_id
      WHERE j.status='quote' ORDER BY j.id DESC LIMIT 5`).all()).results;
    const running = await env.DB.prepare('SELECT t.id,t.job_id,t.started_at,j.title FROM time_entries t JOIN jobs j ON j.id=t.job_id WHERE t.user_id=? AND t.ended_at IS NULL').bind(user.id).first();
    const mine = (await env.DB.prepare(`SELECT j.id,j.title,j.scheduled_start,j.status,j.site_address,c.name AS client_name FROM jobs j JOIN clients c ON c.id=j.client_id
      WHERE j.assigned_to=? AND j.status IN ('work_order','completed') ORDER BY COALESCE(j.scheduled_start,'9999') LIMIT 10`).bind(user.id).all()).results;
    return json({ overdue, month: r2(month.v), open_quotes: open, running, mine });
  }

  // Job sub-resources
  if (res === 'jobs' && id && id !== 'new') {
    if (sub === 'photos') {
      if (method === 'GET') return json((await env.DB.prepare('SELECT id,caption,data,created_at FROM job_photos WHERE job_id=? ORDER BY id DESC').bind(id).all()).results);
      if (method === 'POST') {
        if (!body.data || !String(body.data).startsWith('data:image/') || body.data.length > 700000) return err('Image missing or too large');
        await env.DB.prepare('INSERT INTO job_photos (job_id,user_id,caption,data) VALUES (?,?,?,?)').bind(id, user.id, body.caption || null, body.data).run();
        return json({ ok: true }, 201);
      }
      if (method === 'DELETE' && subId) { await env.DB.prepare('DELETE FROM job_photos WHERE id=? AND job_id=?').bind(subId, id).run(); return json({ ok: true }); }
    }
    if (sub === 'checklist') {
      if (method === 'GET') return json((await env.DB.prepare('SELECT * FROM job_checklist WHERE job_id=? ORDER BY id').bind(id).all()).results);
      if (method === 'POST') {
        let labels = [];
        if (body.template_id) {
          const t = await env.DB.prepare('SELECT items FROM checklist_templates WHERE id=?').bind(body.template_id).first();
          labels = t ? t.items.split('\n').map((x) => x.trim()).filter(Boolean) : [];
        } else if (body.label) labels = [body.label];
        for (const l of labels) await env.DB.prepare('INSERT INTO job_checklist (job_id,label) VALUES (?,?)').bind(id, l).run();
        return json({ ok: true, added: labels.length }, 201);
      }
      if (method === 'PUT' && subId) {
        await env.DB.prepare(`UPDATE job_checklist SET done=?, done_by=?, done_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END WHERE id=? AND job_id=?`)
          .bind(body.done ? 1 : 0, body.done ? user.id : null, body.done ? 1 : 0, subId, id).run();
        return json({ ok: true });
      }
      if (method === 'DELETE' && subId) { await env.DB.prepare('DELETE FROM job_checklist WHERE id=? AND job_id=?').bind(subId, id).run(); return json({ ok: true }); }
    }
    if (sub === 'time') {
      if (method === 'GET') return json((await env.DB.prepare('SELECT t.*, u.name AS user_name FROM time_entries t JOIN users u ON u.id=t.user_id WHERE job_id=? ORDER BY t.id DESC').bind(id).all()).results);
      if (method === 'POST' && subId === 'start') {
        await env.DB.prepare(`UPDATE time_entries SET ended_at=datetime('now') WHERE user_id=? AND ended_at IS NULL`).bind(user.id).run();
        await env.DB.prepare(`INSERT INTO time_entries (job_id,user_id,started_at) VALUES (?,?,datetime('now'))`).bind(id, user.id).run();
        return json({ ok: true });
      }
      if (method === 'POST' && subId === 'stop') {
        await env.DB.prepare(`UPDATE time_entries SET ended_at=datetime('now'), notes=COALESCE(?,notes) WHERE user_id=? AND job_id=? AND ended_at IS NULL`).bind(body.notes || null, user.id, id).run();
        return json({ ok: true });
      }
      if (method === 'POST' && subId === 'manual') {
        if (!body.started_at || !body.ended_at) return err('Start and end required');
        await env.DB.prepare('INSERT INTO time_entries (job_id,user_id,started_at,ended_at,notes) VALUES (?,?,?,?,?)').bind(id, body.user_id || user.id, body.started_at, body.ended_at, body.notes || null).run();
        return json({ ok: true }, 201);
      }
      if (method === 'DELETE' && subId) { await env.DB.prepare('DELETE FROM time_entries WHERE id=? AND job_id=?').bind(subId, id).run(); return json({ ok: true }); }
      if (method === 'POST' && subId === 'bill') {
        const s = await getSettings(env);
        const rate = Number(body.rate) || Number(s.hourly_rate) || 110;
        const t = await env.DB.prepare(`SELECT COALESCE(SUM((julianday(ended_at)-julianday(started_at))*24),0) AS h FROM time_entries WHERE job_id=? AND ended_at IS NOT NULL`).bind(id).first();
        const hours = Math.round(t.h * 4) / 4;
        if (hours <= 0) return err('No completed time to bill');
        await env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price) VALUES (?,?,?,?)').bind(id, 'Labour (hours)', hours, rate).run();
        return json({ ok: true, hours, rate });
      }
    }
    if (sub === 'payments') {
      if (method === 'GET') return json((await env.DB.prepare('SELECT * FROM payments WHERE job_id=? ORDER BY id').bind(id).all()).results);
      if (method === 'POST') {
        const amt = Number(body.amount);
        if (!(amt > 0)) return err('Amount required');
        await env.DB.prepare(`INSERT INTO payments (job_id,amount,method,reference,paid_on) VALUES (?,?,?,?,COALESCE(?,date('now')))`)
          .bind(id, amt, body.method || 'bank', body.reference || null, body.paid_on || null).run();
        await syncPaid(env, id);
        return json({ ok: true }, 201);
      }
      if (method === 'DELETE' && subId) { await env.DB.prepare('DELETE FROM payments WHERE id=? AND job_id=?').bind(subId, id).run(); await syncPaid(env, id); return json({ ok: true }); }
    }
    if (sub === 'signature' && method === 'POST') {
      if (!body.signature || !String(body.signature).startsWith('data:image/png') || body.signature.length > 300000 || !body.name) return err('Name and signature required');
      await env.DB.prepare(`UPDATE jobs SET signature=?, signed_name=?, signed_at=datetime('now') WHERE id=?`).bind(body.signature, String(body.name).slice(0, 100), id).run();
      return json({ ok: true });
    }
    if (sub === 'checkin' && method === 'POST') {
      await env.DB.prepare(`UPDATE jobs SET checkin_at=datetime('now'), checkin_lat=?, checkin_lng=? WHERE id=?`).bind(body.lat ?? null, body.lng ?? null, id).run();
      return json({ ok: true });
    }
    if (sub === 'repeat' && method === 'POST') {
      const rule = ['none', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].includes(body.rule) ? body.rule : 'none';
      await env.DB.prepare('UPDATE jobs SET repeat_rule=?, repeat_spawned=0 WHERE id=?').bind(rule, id).run();
      return json({ ok: true });
    }
    if (sub === 'clone' && method === 'POST') {
      const nid = await cloneJob(env, id, { status: 'quote' });
      return nid ? json({ id: nid }, 201) : err('Not found', 404);
    }
    if (sub === 'email' && method === 'POST') {
      if (!KINDS.includes(body.kind)) return err('Bad email type');
      const job = await env.DB.prepare('SELECT j.*, c.name AS client_name, c.email AS client_email FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.id=?').bind(id).first();
      if (!job) return err('Not found', 404);
      const to = (body.to || job.client_email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return err('Client has no valid email address');
      if ((body.kind === 'invoice' || body.kind === 'reminder')) {
        const inv = await env.DB.prepare('SELECT 1 FROM invoices WHERE job_id=?').bind(id).first();
        if (!inv) return err('Create the invoice first');
      }
      const m = await buildEmail(env, new URL(request.url).origin, job, body.kind, body.message);
      const s = await getSettings(env);
      const result = await sendMail(env, { to, subject: m.subject, html: m.html, text: m.text, replyTo: s.email });
      await env.DB.prepare('INSERT INTO email_log (job_id,to_addr,subject,kind,ok,detail) VALUES (?,?,?,?,?,?)').bind(id, to, m.subject, body.kind, result.ok ? 1 : 0, result.detail).run();
      if (!result.ok) return err('Email failed: ' + result.detail, 502);
      await env.DB.prepare('INSERT INTO job_notes (job_id,user_id,body) VALUES (?,?,?)').bind(id, user.id, `Emailed ${body.kind} to ${to}`).run();
      return json({ ok: true });
    }
    if (sub === 'emails' && method === 'GET') return json((await env.DB.prepare('SELECT * FROM email_log WHERE job_id=? ORDER BY id DESC LIMIT 20').bind(id).all()).results);
    if (sub === 'portal' && method === 'GET') return json({ url: `${new URL(request.url).origin}/spark/portal.html?t=${await ensureToken(env, id)}` });
    if (sub === 'extra' && method === 'GET') {
      const j = await env.DB.prepare('SELECT signature,signed_name,signed_at,quote_accepted_at,quote_accepted_name,repeat_rule,checkin_at,portal_token FROM jobs WHERE id=?').bind(id).first();
      const photos = (await env.DB.prepare('SELECT id,caption,created_at FROM job_photos WHERE job_id=? ORDER BY id DESC').bind(id).all()).results;
      const checklist = (await env.DB.prepare('SELECT * FROM job_checklist WHERE job_id=? ORDER BY id').bind(id).all()).results;
      const time = (await env.DB.prepare('SELECT t.*, u.name AS user_name FROM time_entries t JOIN users u ON u.id=t.user_id WHERE job_id=? ORDER BY t.id DESC').bind(id).all()).results;
      const payments = (await env.DB.prepare('SELECT * FROM payments WHERE job_id=? ORDER BY id').bind(id).all()).results;
      const emails = (await env.DB.prepare('SELECT * FROM email_log WHERE job_id=? ORDER BY id DESC LIMIT 10').bind(id).all()).results;
      return json({ ...j, photos, checklist, time, payments, emails, totals: await totals(env, id) });
    }
  }
  return null;
}
