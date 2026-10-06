// SPARK phase 3 integrations: SMS (Twilio / ClickSend), Stripe Checkout, Xero.
// Secrets are read from Pages environment variables and are never returned to the browser.
import { getSettings, totals, syncPaid, r2 } from './_extra.js';

const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Current Sydney date/hour. Job times are stored as Sydney wall-clock text, so "today" must be Sydney's.
export function sydneyNow(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function getInt(env, key) {
  const r = await env.DB.prepare('SELECT value FROM integrations WHERE key=?').bind(key).first();
  return r ? r.value : null;
}
async function setInt(env, key, value) {
  await env.DB.prepare(`INSERT INTO integrations (key,value,updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).bind(key, value).run();
}

// ---------------------------------------------------------------- SMS
export function normalisePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) { /* already international */ }
  else if (p.startsWith('00')) p = '+' + p.slice(2);
  else if (p.startsWith('0')) p = '+61' + p.slice(1);
  else if (p.startsWith('61')) p = '+' + p;
  else return null;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

export function smsProvider(env) {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.SMS_FROM || env.TWILIO_FROM)) return 'twilio';
  if (env.CLICKSEND_USERNAME && env.CLICKSEND_API_KEY) return 'clicksend';
  return null;
}

export async function sendSms(env, rawTo, body) {
  const to = normalisePhone(rawTo);
  if (!to) return { ok: false, detail: 'Phone number is not valid' };
  const provider = smsProvider(env);
  if (!provider) return { ok: false, detail: 'No SMS provider configured' };
  const text = String(body).slice(0, 480);
  try {
    if (provider === 'twilio') {
      const sid = String(env.TWILIO_ACCOUNT_SID).trim();
      const form = new URLSearchParams({ To: to, From: String(env.SMS_FROM || env.TWILIO_FROM).trim(), Body: text });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${sid}:${String(env.TWILIO_AUTH_TOKEN).trim()}`) }, body: form,
      });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, detail: r.ok ? d.sid || 'sent' : String(d.message || r.status).slice(0, 200) };
    }
    const msg = { source: 'spark', body: text, to };
    if (env.SMS_FROM) msg.from = env.SMS_FROM;
    const r = await fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${String(env.CLICKSEND_USERNAME).trim()}:${String(env.CLICKSEND_API_KEY).trim()}`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [msg] }),
    });
    const d = await r.json().catch(() => ({}));
    const m = d.data && d.data.messages && d.data.messages[0];
    const ok = r.ok && d.response_code === 'SUCCESS' && (!m || m.status === 'SUCCESS');
    return { ok, detail: ok ? 'sent' : String((m && m.status) || d.response_msg || r.status).slice(0, 200) };
  } catch (e) {
    return { ok: false, detail: 'SMS request failed: ' + e.message };
  }
}

export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

// "2026-10-05 09:30" -> { date: 'Mon 5 Oct', time: '9:30am' }  (no timezone conversion: values are Sydney wall-clock)
export function whenParts(s) {
  const [d, t = ''] = String(s || '').split(/[ T]/);
  const dt = new Date(d + 'T00:00:00Z');
  const date = isNaN(dt) ? d : dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  let time = '';
  if (t) { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; time = `${h}:${String(m || 0).padStart(2, '0')}${ap}`; }
  return { date, time };
}

// ---------------------------------------------------------------- Stripe
export async function createCheckout(env, { origin, job, invoice, cents, email, token }) {
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('success_url', `${origin}/spark/portal.html?t=${token}&paid=1`);
  f.set('cancel_url', `${origin}/spark/portal.html?t=${token}`);
  f.set('client_reference_id', String(job.id));
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) f.set('customer_email', email);
  f.set('line_items[0][quantity]', '1');
  f.set('line_items[0][price_data][currency]', 'aud');
  f.set('line_items[0][price_data][unit_amount]', String(cents));
  f.set('line_items[0][price_data][product_data][name]', `Invoice ${invoice.number} - ${job.title}`.slice(0, 250));
  f.set('metadata[job_id]', String(job.id));
  f.set('metadata[invoice]', invoice.number);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + String(env.STRIPE_SECRET_KEY).trim() }, body: f,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url) throw new Error((d.error && d.error.message) || 'Stripe error ' + r.status);
  return d.url;
}

async function verifyStripeSignature(raw, header, secret) {
  let t = null; const sigs = [];
  for (const kv of String(header || '').split(',')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length || !(Math.abs(Date.now() / 1000 - Number(t)) <= 300)) return false;
  const key = await crypto.subtle.importKey('raw', enc(String(secret).trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc(`${t}.${raw}`)));
  return sigs.some((s) => safeEqual(s, mac));
}

// POST /api/spark/stripe-webhook  (raw body is required for signature checking)
export async function stripeWebhook(env, request) {
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (!env.STRIPE_WEBHOOK_SECRET) return reply({ error: 'Webhook not configured' }, 503);
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return reply({ error: 'Bad signature' }, 400);
  let event;
  try { event = JSON.parse(raw); } catch { return reply({ error: 'Bad payload' }, 400); }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return reply({ ok: true, ignored: true });
  const s = event.data && event.data.object;
  if (!s || s.payment_status !== 'paid') return reply({ ok: true, ignored: true });
  const jobId = Number(s.metadata && s.metadata.job_id);
  if (!jobId || !(s.amount_total > 0)) return reply({ ok: true, ignored: true });
  try {
    const job = await env.DB.prepare('SELECT id FROM jobs WHERE id=?').bind(jobId).first();
    if (!job) return reply({ ok: true, ignored: true });
    // The unique index on stripe_session makes retries and duplicate events harmless.
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO payments (job_id,amount,method,reference,paid_on,stripe_session) VALUES (?,?,'card',?,?,?)`)
      .bind(jobId, r2(s.amount_total / 100), 'Stripe ' + String(s.id).slice(-10), sydneyNow().date, s.id).run();
    if (r.meta.changes) {
      await syncPaid(env, jobId);
      await env.DB.prepare('INSERT INTO job_notes (job_id,body) VALUES (?,?)').bind(jobId, `Card payment of $${(s.amount_total / 100).toFixed(2)} received via Stripe`).run();
    }
    return reply({ ok: true });
  } catch (e) {
    console.error('stripe webhook', e);
    return reply({ error: 'Server error' }, 500); // non-2xx makes Stripe retry
  }
}

// ---------------------------------------------------------------- Xero
const XERO_AUTH = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN = 'https://identity.xero.com/connect/token';
const xeroScopes = (env) => env.XERO_SCOPES || 'offline_access accounting.invoices accounting.payments accounting.contacts';
const xeroRedirect = (env, origin) => env.XERO_REDIRECT_URI || `${origin}/api/spark/xero/callback`;
const basic = (env) => 'Basic ' + btoa(`${String(env.XERO_CLIENT_ID).trim()}:${String(env.XERO_CLIENT_SECRET).trim()}`);
export const xeroConfigured = (env) => !!(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET);

export async function xeroStatus(env) {
  const tenant = JSON.parse((await getInt(env, 'xero_tenant')) || 'null');
  return { configured: xeroConfigured(env), connected: !!tenant && !!(await getInt(env, 'xero_tokens')), tenant: tenant && tenant.name };
}

export async function xeroConnectUrl(env, origin) {
  if (!xeroConfigured(env)) throw new Error('XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set');
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  await setInt(env, 'xero_state', JSON.stringify({ s: state, exp: Date.now() + 10 * 60e3 }));
  const q = new URLSearchParams({ response_type: 'code', client_id: String(env.XERO_CLIENT_ID).trim(), redirect_uri: xeroRedirect(env, origin), scope: xeroScopes(env), state });
  return `${XERO_AUTH}?${q.toString().replace(/\+/g, '%20')}`;
}

export async function xeroDisconnect(env) {
  await env.DB.prepare(`DELETE FROM integrations WHERE key LIKE 'xero_%'`).run();
}

async function tokenRequest(env, params) {
  const r = await fetch(XERO_TOKEN, { method: 'POST', headers: { Authorization: basic(env), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || 'Xero token error ' + r.status);
  await setInt(env, 'xero_tokens', JSON.stringify({ access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 1800) * 1000 }));
  return d;
}

// GET /api/spark/xero/callback  (browser redirect from Xero; protected by the one-time state value, not the session cookie)
export async function xeroCallback(env, request, url) {
  const back = (qs) => new Response(null, { status: 302, headers: { location: `/spark/#/integrations?${qs}` } });
  try {
    if (url.searchParams.get('error')) return back('xero=error&msg=' + encodeURIComponent(url.searchParams.get('error_description') || url.searchParams.get('error')));
    const saved = JSON.parse((await getInt(env, 'xero_state')) || 'null');
    await env.DB.prepare(`DELETE FROM integrations WHERE key='xero_state'`).run();
    const state = url.searchParams.get('state') || '';
    if (!saved || Date.now() > saved.exp || !safeEqual(saved.s, state)) return back('xero=error&msg=' + encodeURIComponent('Connection attempt expired. Please try again.'));
    const d = await tokenRequest(env, { grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: xeroRedirect(env, new URL(request.url).origin) });
    const cr = await fetch('https://api.xero.com/connections', { headers: { Authorization: 'Bearer ' + d.access_token } });
    const conns = await cr.json().catch(() => []);
    if (!Array.isArray(conns) || !conns.length) return back('xero=error&msg=' + encodeURIComponent('No Xero organisation was authorised'));
    await setInt(env, 'xero_tenant', JSON.stringify({ id: conns[0].tenantId, name: conns[0].tenantName }));
    return back('xero=connected');
  } catch (e) {
    return back('xero=error&msg=' + encodeURIComponent(e.message));
  }
}

async function xeroAccessToken(env) {
  const t = JSON.parse((await getInt(env, 'xero_tokens')) || 'null');
  if (!t) throw new Error('Xero is not connected');
  if (t.exp - 60e3 > Date.now()) return t.access;
  try {
    return (await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: t.refresh })).access_token;
  } catch {
    throw new Error('Xero connection has expired. Reconnect Xero on the Integrations page.');
  }
}

async function xeroApi(env, method, path, body) {
  const token = await xeroAccessToken(env);
  const tenant = JSON.parse((await getInt(env, 'xero_tenant')) || 'null');
  if (!tenant) throw new Error('Xero is not connected');
  const r = await fetch('https://api.xero.com/api.xro/2.0' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Xero-Tenant-Id': tenant.id, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let d = {}; try { d = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    if (r.status === 401) throw new Error('Xero rejected the request (401). Reconnect Xero; if it persists the app scopes may need changing (XERO_SCOPES).');
    if (r.status === 429) throw new Error('Xero rate limit reached. Try again in a minute.');
    const v = d.Elements && d.Elements[0] && d.Elements[0].ValidationErrors;
    throw new Error('Xero: ' + ((v && v.map((e) => e.Message).join('; ')) || d.Message || d.Detail || text.slice(0, 200)));
  }
  return d;
}

// Push a job's invoice (and any unsynced payments) to Xero. Safe to run repeatedly.
export async function xeroSyncJob(env, jobId) {
  const s = await getSettings(env);
  const job = await env.DB.prepare('SELECT j.id,j.title, c.id AS cid, c.name, c.email, c.xero_contact_id FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.id=?').bind(jobId).first();
  if (!job) throw new Error('Job not found');
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE job_id=?').bind(jobId).first();
  if (!inv) throw new Error('Create the invoice first');
  const result = { invoice: 'already in Xero', payments: 0 };
  let xeroId = inv.xero_invoice_id;

  if (!xeroId) {
    const items = (await env.DB.prepare('SELECT description,qty,unit_price FROM job_items WHERE job_id=? AND on_invoice=1 ORDER BY id').bind(jobId).all()).results;
    if (!items.length) throw new Error('The job has no line items');
    let contactId = job.xero_contact_id;
    if (!contactId && !job.name.includes('"')) {
      const f = await xeroApi(env, 'GET', '/Contacts?where=' + encodeURIComponent(`Name=="${job.name}"`));
      if (f.Contacts && f.Contacts[0]) contactId = f.Contacts[0].ContactID;
    }
    if (!contactId) {
      const c = await xeroApi(env, 'POST', '/Contacts', { Contacts: [{ Name: job.name, ...(job.email ? { EmailAddress: job.email } : {}) }] });
      contactId = c.Contacts[0].ContactID;
    }
    await env.DB.prepare('UPDATE clients SET xero_contact_id=? WHERE id=?').bind(contactId, job.cid).run();
    const created = await xeroApi(env, 'POST', '/Invoices', { Invoices: [{
      Type: 'ACCREC', Contact: { ContactID: contactId }, Date: inv.issued_at, DueDate: inv.due_at || inv.issued_at,
      InvoiceNumber: inv.number, Reference: job.title.slice(0, 250), LineAmountTypes: 'Exclusive', Status: 'AUTHORISED',
      LineItems: items.map((i) => ({ Description: i.description, Quantity: i.qty, UnitAmount: i.unit_price, AccountCode: s.xero_account_code || '200', TaxType: s.xero_tax_type || 'OUTPUT' })),
    }] });
    xeroId = created.Invoices[0].InvoiceID;
    await env.DB.prepare(`UPDATE invoices SET xero_invoice_id=?, xero_synced_at=datetime('now') WHERE job_id=?`).bind(xeroId, jobId).run();
    result.invoice = 'created in Xero';
  }

  if (s.xero_bank_code) {
    const pays = (await env.DB.prepare('SELECT * FROM payments WHERE job_id=? AND xero_payment_id IS NULL ORDER BY id').bind(jobId).all()).results;
    for (const p of pays) {
      const x = await xeroApi(env, 'POST', '/Payments', { Payments: [{ Invoice: { InvoiceID: xeroId }, Account: { Code: s.xero_bank_code }, Date: p.paid_on, Amount: p.amount, Reference: p.reference || p.method }] });
      await env.DB.prepare('UPDATE payments SET xero_payment_id=? WHERE id=?').bind(x.Payments[0].PaymentID, p.id).run();
      result.payments++;
    }
  }
  return result;
}

export { totals };
