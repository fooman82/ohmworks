// SPARK phase 3 API: suppliers, CSV import, SMS, integrations status, Xero sync, reminders, extended reports, mobile "my jobs".
import { getSettings, totals, r2 } from './_extra.js';
import {
  smsProvider, sendSms, fillTemplate, whenParts, sydneyNow, normalisePhone,
  xeroStatus, xeroConnectUrl, xeroDisconnect, xeroSyncJob, xeroConfigured, createCheckout,
} from './_integrations.js';

const s1 = (v, n) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, n) : null; };
const money = (v) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const truthy = (v) => /^(1|y|yes|true|t|x)$/i.test(String(v ?? '').trim());
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

// ---------------------------------------------------------------- Reminders
export async function runReminders(env, { force = false } = {}) {
  const s = await getSettings(env);
  if (!force && s.sms_auto_reminders !== '1') return { sent: 0, skipped: 'Automatic reminders are switched off' };
  if (!smsProvider(env)) return { sent: 0, skipped: 'No SMS provider configured' };
  const now = sydneyNow();
  if (!force && (now.hour < 8 || now.hour >= 19)) return { sent: 0, skipped: 'Outside 8am-7pm Sydney time' };
  const tomorrow = sydneyNow(1).date;
  const jobs = (await env.DB.prepare(
    `SELECT j.id, j.scheduled_start, c.name, c.phone FROM jobs j JOIN clients c ON c.id=j.client_id
     WHERE date(j.scheduled_start)=? AND j.status='work_order' AND j.reminder_sent_at IS NULL AND c.phone IS NOT NULL AND c.phone!='' LIMIT 10`).bind(tomorrow).all()).results;
  let sent = 0, failed = 0;
  for (const j of jobs) {
    if (!normalisePhone(j.phone)) {
      await env.DB.prepare(`UPDATE jobs SET reminder_sent_at='skipped: bad phone' WHERE id=?`).bind(j.id).run();
      continue;
    }
    const w = whenParts(j.scheduled_start);
    const body = fillTemplate(s.sms_reminder_template, { name: firstName(j.name), business: s.business_name, date: w.date, time: w.time || 'the scheduled time', phone: s.phone });
    const r = await sendSms(env, j.phone, body);
    await env.DB.prepare('INSERT INTO sms_log (job_id,to_addr,body,kind,ok,detail) VALUES (?,?,?,?,?,?)').bind(j.id, j.phone, body, 'reminder', r.ok ? 1 : 0, r.detail).run();
    if (r.ok) { sent++; await env.DB.prepare(`UPDATE jobs SET reminder_sent_at=datetime('now') WHERE id=?`).bind(j.id).run(); } else failed++;
  }
  return { sent, failed, checked: jobs.length };
}

// ---------------------------------------------------------------- Public portal: pay by card
export async function portalPay({ env, request, token, json, err }) {
  if (!env.STRIPE_SECRET_KEY) return err('Online payments are not enabled', 503);
  if (!token || token.length < 20) return err('Not found', 404);
  const job = await env.DB.prepare('SELECT j.id,j.title,c.email FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.portal_token=?').bind(token).first();
  if (!job) return err('Not found', 404);
  const invoice = await env.DB.prepare('SELECT number,paid_at FROM invoices WHERE job_id=?').bind(job.id).first();
  if (!invoice || invoice.paid_at) return err('There is nothing to pay on this job');
  const t = await totals(env, job.id);
  const cents = Math.round(t.balance * 100);
  if (cents < 50) return err('There is nothing to pay on this job');
  try {
    const url = await createCheckout(env, { origin: new URL(request.url).origin, job, invoice, cents, email: job.email, token });
    return json({ url });
  } catch (e) {
    console.error('stripe checkout', e.message);
    return err('Could not start the card payment. Please try again or use the bank details on the invoice.', 502);
  }
}

// ---------------------------------------------------------------- CSV import
async function importRows(env, type, rows, update) {
  const out = { type, added: 0, updated: 0, skipped: 0, errors: [] };
  const stmts = [];
  const fail = (row, msg) => out.errors.push({ row: row._row || null, error: msg });

  if (type === 'clients') {
    const ex = (await env.DB.prepare('SELECT id, lower(email) AS e, lower(name) AS n, COALESCE(phone,\'\') AS p FROM clients').all()).results;
    const keyOf = (e, n, p) => (e ? 'e:' + e : 'n:' + n + '|' + p);
    const map = new Map(ex.map((r) => [keyOf(r.e || '', r.n, r.p), r.id]));
    for (const r of rows) {
      const name = s1(r.name, 120);
      if (!name) { fail(r, 'Name is required'); continue; }
      const email = s1(r.email, 200); const phone = s1(r.phone, 40);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail(r, `Invalid email "${email}"`); continue; }
      const key = keyOf((email || '').toLowerCase(), name.toLowerCase(), phone || '');
      const hit = map.get(key);
      const vals = [s1(r.address, 300), s1(r.notes, 2000)];
      if (hit) {
        if (update) {
          stmts.push(env.DB.prepare(`UPDATE clients SET name=?, email=COALESCE(?,email), phone=COALESCE(?,phone), address=COALESCE(?,address), notes=COALESCE(?,notes) WHERE id=?`).bind(name, email, phone, ...vals, hit));
          out.updated++;
        } else out.skipped++;
        continue;
      }
      map.set(key, -1);
      stmts.push(env.DB.prepare(`INSERT INTO clients (name,email,phone,address,notes,source) VALUES (?,?,?,?,?,'import')`).bind(name, email, phone, ...vals));
      out.added++;
    }
  } else if (type === 'suppliers') {
    const ex = (await env.DB.prepare('SELECT id, lower(name) AS n FROM suppliers').all()).results;
    const map = new Map(ex.map((r) => [r.n, r.id]));
    for (const r of rows) {
      const name = s1(r.name, 120);
      if (!name) { fail(r, 'Name is required'); continue; }
      const email = s1(r.email, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail(r, `Invalid email "${email}"`); continue; }
      const v = [s1(r.contact, 120), email, s1(r.phone, 40), s1(r.address, 300), s1(r.abn, 20), s1(r.notes, 2000)];
      const hit = map.get(name.toLowerCase());
      if (hit) {
        if (update) {
          stmts.push(env.DB.prepare(`UPDATE suppliers SET contact=COALESCE(?,contact), email=COALESCE(?,email), phone=COALESCE(?,phone), address=COALESCE(?,address), abn=COALESCE(?,abn), notes=COALESCE(?,notes) WHERE id=?`).bind(...v, hit));
          out.updated++;
        } else out.skipped++;
        continue;
      }
      map.set(name.toLowerCase(), -1);
      stmts.push(env.DB.prepare('INSERT INTO suppliers (name,contact,email,phone,address,abn,notes) VALUES (?,?,?,?,?,?,?)').bind(name, ...v));
      out.added++;
    }
  } else if (type === 'pricelist') {
    const ex = (await env.DB.prepare('SELECT id, lower(name) AS n FROM price_list').all()).results;
    const map = new Map(ex.map((r) => [r.n, r.id]));
    for (const r of rows) {
      const name = s1(r.name, 200);
      if (!name) { fail(r, 'Name is required'); continue; }
      const price = money(r.unit_price);
      if (price === null) { fail(r, `Invalid price "${r.unit_price ?? ''}"`); continue; }
      const cost = r.cost === undefined || r.cost === '' ? 0 : money(r.cost);
      if (cost === null) { fail(r, `Invalid cost "${r.cost}"`); continue; }
      const cat = s1(r.category, 80); const labour = truthy(r.is_labour) ? 1 : 0;
      const hit = map.get(name.toLowerCase());
      if (hit) {
        if (update) {
          stmts.push(env.DB.prepare('UPDATE price_list SET unit_price=?, cost=?, category=COALESCE(?,category), is_labour=? WHERE id=?').bind(price, cost, cat, labour, hit));
          out.updated++;
        } else out.skipped++;
        continue;
      }
      map.set(name.toLowerCase(), -1);
      stmts.push(env.DB.prepare('INSERT INTO price_list (name,unit_price,cost,category,is_labour) VALUES (?,?,?,?,?)').bind(name, price, cost, cat, labour));
      out.added++;
    }
  } else throw new Error('Unknown import type');

  if (stmts.length) await env.DB.batch(stmts);
  return out;
}

// ---------------------------------------------------------------- Authenticated routes
export async function handlePhase3({ env, request, url, parts, body, user, json, err }) {
  const method = request.method;
  const [res, id, sub] = parts;
  const admin = user.role === 'admin';

  // ----- Suppliers
  if (res === 'suppliers') {
    if (!id && method === 'GET') {
      const q = `%${url.searchParams.get('q') || ''}%`;
      return json((await env.DB.prepare('SELECT * FROM suppliers WHERE name LIKE ?1 OR contact LIKE ?1 OR email LIKE ?1 OR phone LIKE ?1 ORDER BY name LIMIT 300').bind(q).all()).results);
    }
    if (!id && method === 'POST') {
      if (!s1(body.name, 120)) return err('Name required');
      const r = await env.DB.prepare('INSERT INTO suppliers (name,contact,email,phone,address,abn,notes) VALUES (?,?,?,?,?,?,?)')
        .bind(s1(body.name, 120), s1(body.contact, 120), s1(body.email, 200), s1(body.phone, 40), s1(body.address, 300), s1(body.abn, 20), s1(body.notes, 2000)).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (id && method === 'GET') {
      const sp = await env.DB.prepare('SELECT * FROM suppliers WHERE id=?').bind(id).first();
      if (!sp) return err('Not found', 404);
      const spend = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS v, COUNT(*) AS n FROM expenses WHERE lower(supplier)=lower(?)').bind(sp.name).first();
      return json({ ...sp, spend: r2(spend.v), expense_count: spend.n });
    }
    if (id && method === 'PUT') {
      if (!s1(body.name, 120)) return err('Name required');
      await env.DB.prepare('UPDATE suppliers SET name=?,contact=?,email=?,phone=?,address=?,abn=?,notes=? WHERE id=?')
        .bind(s1(body.name, 120), s1(body.contact, 120), s1(body.email, 200), s1(body.phone, 40), s1(body.address, 300), s1(body.abn, 20), s1(body.notes, 2000), id).run();
      return json({ ok: true });
    }
    if (id && method === 'DELETE') {
      if (!admin) return err('Admin only', 403);
      await env.DB.prepare('DELETE FROM suppliers WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ----- Bulk import (client parses the CSV and sends rows in chunks)
  if (res === 'import' && method === 'POST') {
    if (!admin) return err('Admin only', 403);
    if (!['clients', 'suppliers', 'pricelist'].includes(id)) return err('Unknown import type', 404);
    if (!Array.isArray(body.rows) || !body.rows.length) return err('No rows supplied');
    if (body.rows.length > 100) return err('Send at most 100 rows per request');
    return json(await importRows(env, id, body.rows.filter((r) => r && typeof r === 'object'), !!body.update));
  }

  // ----- Integrations status (booleans only: never returns secrets)
  if (res === 'integrations' && method === 'GET') {
    const s = await getSettings(env);
    return json({
      mailgun: !!env.MAILGUN_API_KEY,
      sms: { provider: smsProvider(env), auto: s.sms_auto_reminders === '1', template: s.sms_reminder_template || '' },
      stripe: { configured: !!env.STRIPE_SECRET_KEY, webhook: !!env.STRIPE_WEBHOOK_SECRET, webhook_url: `${url.origin}/api/spark/stripe-webhook` },
      xero: { ...(await xeroStatus(env)), redirect_uri: env.XERO_REDIRECT_URI || `${url.origin}/api/spark/xero/callback`, account_code: s.xero_account_code, tax_type: s.xero_tax_type, bank_code: s.xero_bank_code },
      cron: !!env.CRON_SECRET,
    });
  }

  // ----- Xero
  if (res === 'xero') {
    if (!admin) return err('Admin only', 403);
    if (id === 'connect' && method === 'GET') {
      try { return json({ url: await xeroConnectUrl(env, url.origin) }); } catch (e) { return err(e.message, 400); }
    }
    if (id === 'disconnect' && method === 'POST') { await xeroDisconnect(env); return json({ ok: true }); }
    if (id === 'sync-all' && method === 'POST') {
      if (!(await xeroStatus(env)).connected) return err('Xero is not connected');
      const todo = (await env.DB.prepare('SELECT job_id FROM invoices WHERE xero_invoice_id IS NULL ORDER BY id LIMIT 5').all()).results;
      const done = [], failed = [];
      for (const t of todo) {
        try { await xeroSyncJob(env, t.job_id); done.push(t.job_id); } catch (e) { failed.push({ job: t.job_id, error: e.message }); }
      }
      const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM invoices WHERE xero_invoice_id IS NULL').first()).n;
      return json({ synced: done.length, failed, remaining: left });
    }
  }

  // ----- Reminders
  if (res === 'sms' && id === 'run-reminders' && method === 'POST') {
    if (!admin) return err('Admin only', 403);
    return json(await runReminders(env, { force: true }));
  }

  // ----- Per-job: SMS + Xero
  if (res === 'jobs' && id && id !== 'new') {
    if (sub === 'sms' && method === 'GET') return json((await env.DB.prepare('SELECT * FROM sms_log WHERE job_id=? ORDER BY id DESC LIMIT 20').bind(id).all()).results);
    if (sub === 'sms' && method === 'POST') {
      if (!smsProvider(env)) return err('SMS is not configured. See the Integrations page.', 503);
      const j = await env.DB.prepare('SELECT j.id,j.scheduled_start,c.name,c.phone FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.id=?').bind(id).first();
      if (!j) return err('Not found', 404);
      if (!normalisePhone(j.phone)) return err('The client has no valid mobile number');
      const s = await getSettings(env);
      const w = whenParts(j.scheduled_start);
      const vars = { name: firstName(j.name), business: s.business_name, phone: s.phone, date: w.date || 'the scheduled day', time: w.time || '', staff: firstName(user.name) };
      let text;
      if (body.kind === 'reminder') text = fillTemplate(s.sms_reminder_template, vars);
      else if (body.kind === 'omw') text = fillTemplate('Hi {name}, {staff} from {business} is on the way. Call {phone} if you need us.', vars);
      else text = String(body.message || '').trim().slice(0, 320);
      if (!text) return err('Message required');
      const r = await sendSms(env, j.phone, text);
      await env.DB.prepare('INSERT INTO sms_log (job_id,to_addr,body,kind,ok,detail) VALUES (?,?,?,?,?,?)').bind(id, j.phone, text, body.kind || 'custom', r.ok ? 1 : 0, r.detail).run();
      if (!r.ok) return err('SMS failed: ' + r.detail, 502);
      await env.DB.prepare('INSERT INTO job_notes (job_id,user_id,body) VALUES (?,?,?)').bind(id, user.id, `SMS sent: ${text}`).run();
      return json({ ok: true });
    }
    if (sub === 'xero-sync' && method === 'POST') {
      if (!admin) return err('Admin only', 403);
      try { return json({ ok: true, ...(await xeroSyncJob(env, id)) }); } catch (e) { return err(e.message, 400); }
    }
  }

  // ----- Mobile: my jobs
  if (res === 'my-jobs' && method === 'GET') {
    const today = sydneyNow().date;
    const rows = (await env.DB.prepare(
      `SELECT j.id,j.title,j.status,j.scheduled_start,j.scheduled_end,j.site_address,c.name AS client_name,c.phone AS client_phone
       FROM jobs j JOIN clients c ON c.id=j.client_id
       WHERE j.assigned_to=? AND j.status IN ('work_order','completed') AND (j.scheduled_start IS NULL OR date(j.scheduled_start)>=date(?,'-1 day'))
       ORDER BY COALESCE(j.scheduled_start,'9999') LIMIT 60`).bind(user.id, today).all()).results;
    const running = await env.DB.prepare('SELECT t.job_id,t.started_at FROM time_entries t WHERE t.user_id=? AND t.ended_at IS NULL').bind(user.id).first();
    return json({ today, jobs: rows, running });
  }

  // ----- Extended reports
  if (res === 'reports-extra' && method === 'GET') {
    const received = (await env.DB.prepare(`SELECT substr(paid_on,1,7) AS m, ROUND(SUM(amount),2) AS v FROM payments WHERE paid_on >= date('now','start of month','-11 months') GROUP BY m ORDER BY m`).all()).results;
    const spent = (await env.DB.prepare(`SELECT substr(spent_on,1,7) AS m, ROUND(SUM(amount),2) AS v FROM expenses WHERE spent_on >= date('now','start of month','-11 months') GROUP BY m ORDER BY m`).all()).results;
    const months = [...new Set([...received, ...spent].map((x) => x.m))].sort();
    const rm = Object.fromEntries(received.map((x) => [x.m, x.v])), em = Object.fromEntries(spent.map((x) => [x.m, x.v]));
    const monthly = months.map((m) => ({ month: m, received: rm[m] || 0, expenses: em[m] || 0 }));
    const quotes = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN quote_accepted_at IS NOT NULL OR status IN ('work_order','completed','invoiced','paid') THEN 1 ELSE 0 END) AS won
      FROM jobs WHERE status!='cancelled' AND created_at >= datetime('now','-90 days')`).first();
    const byCategory = (await env.DB.prepare(
      `SELECT COALESCE(j.category,'Uncategorised') AS category, COUNT(DISTINCT j.id) AS jobs, ROUND(COALESCE(SUM(i.qty*i.unit_price),0),2) AS revenue_ex_gst
       FROM jobs j LEFT JOIN job_items i ON i.job_id=j.id WHERE j.status IN ('completed','invoiced','paid') GROUP BY category ORDER BY revenue_ex_gst DESC LIMIT 12`).all()).results;
    const profit = (await env.DB.prepare(
      `SELECT j.id, j.title, c.name AS client_name,
         ROUND(COALESCE((SELECT SUM(qty*unit_price) FROM job_items WHERE job_id=j.id),0),2) AS revenue,
         ROUND(COALESCE((SELECT SUM(qty*cost) FROM job_items WHERE job_id=j.id),0) + COALESCE((SELECT SUM(amount)/1.1 FROM expenses WHERE job_id=j.id),0),2) AS costs
       FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.status IN ('completed','invoiced','paid') ORDER BY j.id DESC LIMIT 15`).all()).results
      .map((p) => ({ ...p, margin: r2(p.revenue - p.costs) }));
    const suppliers = (await env.DB.prepare(`SELECT COALESCE(supplier,'(none)') AS supplier, ROUND(SUM(amount),2) AS total FROM expenses WHERE spent_on >= date('now','-365 days') GROUP BY supplier ORDER BY total DESC LIMIT 10`).all()).results;
    const sources = (await env.DB.prepare(`SELECT COALESCE(source,'manual') AS source, COUNT(*) AS jobs FROM jobs WHERE created_at >= datetime('now','-90 days') GROUP BY source`).all()).results;
    return json({ monthly, quotes: { total: quotes.n, won: quotes.won || 0 }, by_category: byCategory, profit, suppliers, sources });
  }

  return null;
}
