// SPARK variations: extra work found during a job. Each variation has its own quote lines and must be
// approved by the customer (signature + printed name) before work on it proceeds.
// Approved lines are copied onto the job so they flow into the invoice.
import { getGst } from './_gst.js';
import { getSettings, sendMail, ensureToken, esc, money, r2 } from './_extra.js';

const EDITABLE = ['draft', 'declined'];
const label = (v) => `${v.job_id}-V${v.seq}`;
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

async function vTotals(env, variationId) {
  const t = await env.DB.prepare('SELECT COALESCE(SUM(qty*unit_price),0) AS s, COALESCE(SUM(qty*cost),0) AS c FROM variation_items WHERE variation_id=?').bind(variationId).first();
  const G = await getGst(env);
  const subtotal = r2(t.s), gst = r2(subtotal * G.rate);
  return { subtotal, gst, gst_on: G.enabled, gst_pct: G.pct, total: r2(subtotal + gst), cost: r2(t.c) };
}

async function withDetail(env, v) {
  const items = (await env.DB.prepare('SELECT * FROM variation_items WHERE variation_id=? ORDER BY id').bind(v.id).all()).results;
  return { ...v, label: label(v), items, totals: await vTotals(env, v.id) };
}

async function hasInvoice(env, jobId) {
  return !!(await env.DB.prepare('SELECT 1 FROM invoices WHERE job_id=?').bind(jobId).first());
}

async function buildVariationEmail(env, origin, job, v) {
  const s = await getSettings(env);
  const t = await vTotals(env, v.id);
  const items = (await env.DB.prepare('SELECT * FROM variation_items WHERE variation_id=? ORDER BY id').bind(v.id).all()).results;
  const link = `${origin}/spark/portal.html?t=${await ensureToken(env, job.id)}&v=${v.id}`;
  const cell = 'padding:6px;border-bottom:1px solid #ddd';
  const rows = items.map((i) => `<tr><td style="${cell}">${esc(i.description)}</td><td style="${cell};text-align:right">${i.qty}</td><td style="${cell};text-align:right">${money(i.unit_price * i.qty)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111">
    <table role="presentation" cellpadding="0" cellspacing="0" style="background:#000000;border-radius:8px;margin:0 0 10px 0;width:auto"><tr><td style="padding:10px 14px;background:#000000">
      <a href="http://www.ohmworks.com.au" style="text-decoration:none"><img src="https://www.ohmworks.com.au/images/logo.jpg" alt="OHMWORKS logo" height="56" style="height:56px;width:auto;vertical-align:middle;border:0;margin-right:14px"><img src="https://www.ohmworks.com.au/images/logo_name.jpg" alt="OHMWORKS" height="46" style="height:46px;width:auto;vertical-align:middle;border:0"></a>
    </td></tr></table>
    <div style="color:#555">ABN ${esc(s.abn)} · Lic ${esc(s.licence)} · ${esc(s.phone)} · <a href="http://www.ohmworks.com.au" style="color:#0b79d0">www.ohmworks.com.au</a></div>
    <h3>Variation ${esc(label(v))} – approval required</h3>
    <p>Hi ${esc(job.client_name)},</p>
    <p>While working on <b>${esc(job.title)}</b> we found additional work that was not in the original quote. We need your approval before we can proceed with it.</p>
    <p><b>${esc(v.title)}</b></p>
    ${v.description ? `<p style="white-space:pre-wrap;margin:0 0 12px">${esc(v.description)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse"><tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Amount</th></tr>${rows}
      <tr><td colspan="2" align="right">Subtotal</td><td align="right">${money(t.subtotal)}</td></tr>${t.gst_on === false ? '' : `<tr><td colspan="2" align="right">GST</td><td align="right">${money(t.gst)}</td></tr>`}
      <tr><td colspan="2" align="right"><b>Total</b></td><td align="right"><b>${money(t.total)}</b></td></tr></table>
    <p><a href="${link}" style="background:#0b79d0;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Review &amp; approve variation</a></p>
    <p style="color:#666;font-size:12px">This work will be added to your job and invoice only once you approve it.</p></div>`;
  const text = `Variation ${label(v)} - approval required\n\nHi ${job.client_name},\n\nAdditional work was found on "${job.title}": ${v.title}\n${v.description ? v.description + '\n' : ''}Total: ${money(t.total)}${t.gst_on === false ? '' : ' (inc GST)'}\n\nReview and approve: ${link}\n\n${s.business_name} ${s.phone}`;
  const biz = s.business_name || 'OHMWORKS';
  return { subject: `Variation ${label(v)} from ${biz} for ${job.client_name} – approval required`, html, text, replyTo: s.email };
}

// ---------- Staff API (login required) ----------
export async function handleVariations({ env, request, parts, body, user, json, err }) {
  const method = request.method;
  const [res, id, sub, subId] = parts;

  // jobs/:id/variations
  if (res === 'jobs' && id && sub === 'variations') {
    if (method === 'GET') {
      const list = (await env.DB.prepare('SELECT * FROM variations WHERE job_id=? ORDER BY seq').bind(id).all()).results;
      return json(await Promise.all(list.map((v) => withDetail(env, v))));
    }
    if (method === 'POST') {
      const job = await env.DB.prepare('SELECT id FROM jobs WHERE id=?').bind(id).first();
      if (!job) return err('Job not found', 404);
      const title = String(body.title || '').trim().slice(0, 200);
      if (!title) return err('Give the variation a title');
      if (await hasInvoice(env, id)) return err('This job is already invoiced. Create a new job for the extra work.');
      const n = await env.DB.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM variations WHERE job_id=?').bind(id).first();
      const r = await env.DB.prepare('INSERT INTO variations (job_id,seq,title,description,created_by) VALUES (?,?,?,?,?)')
        .bind(id, n.n, title, String(body.description || '').slice(0, 5000) || null, user.id).run();
      await env.DB.prepare('INSERT INTO job_notes (job_id,user_id,body) VALUES (?,?,?)').bind(id, user.id, `Variation ${id}-V${n.n} created: ${title}`).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
  }

  if (res !== 'variations') return null;

  // variations (all jobs) – for the Variations menu
  if (!id) {
    if (method !== 'GET') return null;
    const rows = (await env.DB.prepare(
      `SELECT v.*, j.title AS job_title, j.status AS job_status, c.name AS client_name,
        (SELECT COALESCE(SUM(qty*unit_price),0) FROM variation_items WHERE variation_id=v.id) AS subtotal
       FROM variations v JOIN jobs j ON j.id=v.job_id JOIN clients c ON c.id=j.client_id ORDER BY v.id DESC LIMIT 500`).all()).results;
    const G = await getGst(env);
    return json(rows.map((v) => ({ ...v, label: label(v), total: r2(v.subtotal * G.mult) })));
  }

  const v = await env.DB.prepare('SELECT * FROM variations WHERE id=?').bind(id).first();
  if (!v) return err('Not found', 404);

  if (!sub) {
    if (method === 'GET') return json(await withDetail(env, v));
    if (method === 'PUT') {
      if (!EDITABLE.includes(v.status)) return err('Withdraw the variation before editing it');
      const title = String(body.title || '').trim().slice(0, 200);
      if (!title) return err('Give the variation a title');
      await env.DB.prepare(`UPDATE variations SET title=?, description=?, status='draft' WHERE id=?`).bind(title, String(body.description || '').slice(0, 5000) || null, id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (v.status === 'approved') return err('An approved variation cannot be deleted');
      await env.DB.prepare('DELETE FROM variations WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (sub === 'items') {
    if (!EDITABLE.includes(v.status)) return err('Withdraw the variation before changing its lines');
    if (method === 'POST') {
      let description = String(body.description || '').trim().slice(0, 300);
      const qty = Number(body.qty) || 1;
      let price = body.unit_price === '' || body.unit_price == null ? null : Number(body.unit_price);
      let cost = Number(body.cost) || 0, itemId = null;
      // Price list item: its name, cost and price are the defaults; a price typed by the user overrides it.
      if (body.item_id !== '' && body.item_id != null) {
        const p = await env.DB.prepare('SELECT id, name, unit_price, cost FROM price_list WHERE id=?').bind(Number(body.item_id)).first();
        if (!p) return err('Price list item not found');
        itemId = p.id; cost = p.cost;
        if (!description) description = p.name;
        if (price === null) price = p.unit_price;
      }
      if (!description) return err('Description required');
      if (!Number.isFinite(qty) || qty <= 0 || price === null || !Number.isFinite(price)) return err('Enter a quantity and price');
      await env.DB.prepare('INSERT INTO variation_items (variation_id,description,qty,unit_price,cost,item_id) VALUES (?,?,?,?,?,?)').bind(id, description, qty, price, cost, itemId).run();
      await env.DB.prepare(`UPDATE variations SET status='draft' WHERE id=?`).bind(id).run();
      return json({ ok: true }, 201);
    }
    if (method === 'DELETE' && subId) {
      await env.DB.prepare('DELETE FROM variation_items WHERE id=? AND variation_id=?').bind(subId, id).run();
      return json({ ok: true });
    }
  }

  if (sub === 'send' && method === 'POST') {
    if (v.status === 'approved') return err('Already approved');
    if (await hasInvoice(env, v.job_id)) return err('This job is already invoiced');
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM variation_items WHERE variation_id=?').bind(id).first();
    if (!cnt.n) return err('Add at least one line to quote before sending');
    const job = await env.DB.prepare('SELECT j.*, c.name AS client_name, c.email AS client_email FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.id=?').bind(v.job_id).first();
    const to = String(body.to || job.client_email || '').trim();
    if (!validEmail(to)) return err('Client has no valid email address');
    const m = await buildVariationEmail(env, new URL(request.url).origin, job, v);
    const result = await sendMail(env, { to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo });
    await env.DB.prepare('INSERT INTO email_log (job_id,to_addr,subject,kind,ok,detail) VALUES (?,?,?,?,?,?)').bind(v.job_id, to, m.subject, 'variation', result.ok ? 1 : 0, result.detail).run();
    if (!result.ok) return err('Email failed: ' + result.detail, 502);
    await env.DB.prepare(`UPDATE variations SET status='sent', sent_at=datetime('now'), decided_at=NULL, decline_reason=NULL WHERE id=?`).bind(id).run();
    await env.DB.prepare('INSERT INTO job_notes (job_id,user_id,body) VALUES (?,?,?)').bind(v.job_id, user.id, `Variation ${label(v)} sent to ${to} for approval`).run();
    return json({ ok: true });
  }

  if (sub === 'link' && method === 'GET') {
    return json({ url: `${new URL(request.url).origin}/spark/portal.html?t=${await ensureToken(env, v.job_id)}&v=${v.id}` });
  }

  if (sub === 'withdraw' && method === 'POST') {
    if (v.status !== 'sent') return err('Only a variation awaiting approval can be withdrawn');
    await env.DB.prepare(`UPDATE variations SET status='draft', sent_at=NULL WHERE id=?`).bind(id).run();
    await env.DB.prepare('INSERT INTO job_notes (job_id,user_id,body) VALUES (?,?,?)').bind(v.job_id, user.id, `Variation ${label(v)} withdrawn`).run();
    return json({ ok: true });
  }

  return null;
}

// ---------- Customer portal (token protected, no login) ----------
export async function handlePortalVariations({ env, request, parts, body, json, err }) {
  const [, token, , vid, action] = parts; // portal/:token/variations[/:id/(approve|decline)]
  if (!token || token.length < 20) return err('Not found', 404);
  const job = await env.DB.prepare('SELECT j.id, j.title, c.name AS client_name FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.portal_token=?').bind(token).first();
  if (!job) return err('Not found', 404);

  if (request.method === 'GET') {
    const list = (await env.DB.prepare(`SELECT id,job_id,seq,title,description,status,sent_at,decided_at,approved_name,decline_reason FROM variations WHERE job_id=? AND status!='draft' ORDER BY seq`).bind(job.id).all()).results;
    return json(await Promise.all(list.map((v) => withDetail(env, v))));
  }

  if (request.method === 'POST' && vid && (action === 'approve' || action === 'decline')) {
    const v = await env.DB.prepare('SELECT * FROM variations WHERE id=? AND job_id=?').bind(vid, job.id).first();
    if (!v || v.status === 'draft') return err('Not found', 404);
    if (v.status !== 'sent') return json({ ok: true, status: v.status }); // already decided: idempotent
    const name = String(body.name || '').trim().slice(0, 100);
    if (action === 'approve') {
      if (!name) return err('Please print your name');
      if (!body.signature || !String(body.signature).startsWith('data:image/png') || body.signature.length > 300000) return err('Please sign to approve');
      if (await hasInvoice(env, job.id)) return err('This job has already been invoiced. Please contact us.');
      const upd = await env.DB.prepare(`UPDATE variations SET status='approved', decided_at=datetime('now'), approved_name=?, approval_signature=?, applied_at=datetime('now') WHERE id=? AND status='sent'`)
        .bind(name, body.signature, v.id).run();
      if (upd.meta.changes) {
        await env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price,cost,item_id) SELECT ?, ?||description, qty, unit_price, cost, item_id FROM variation_items WHERE variation_id=?')
          .bind(job.id, `Variation ${label(v)}: `, v.id).run();
        await env.DB.prepare('INSERT INTO job_notes (job_id,body) VALUES (?,?)').bind(job.id, `✅ Variation ${label(v)} APPROVED online by ${name}. You can proceed with this work.`).run();
      }
    } else {
      const reason = String(body.reason || '').trim().slice(0, 500);
      const upd = await env.DB.prepare(`UPDATE variations SET status='declined', decided_at=datetime('now'), decline_reason=?, approved_name=? WHERE id=? AND status='sent'`)
        .bind(reason || null, name || null, v.id).run();
      if (upd.meta.changes) await env.DB.prepare('INSERT INTO job_notes (job_id,body) VALUES (?,?)').bind(job.id, `❌ Variation ${label(v)} DECLINED by customer${name ? ' (' + name + ')' : ''}${reason ? ': ' + reason : ''}. Do not proceed with this work.`).run();
    }
    // Let the business know (best effort)
    try {
      const s = await getSettings(env);
      if (validEmail(s.email)) {
        const nv = await env.DB.prepare('SELECT status FROM variations WHERE id=?').bind(v.id).first();
        await sendMail(env, { to: s.email, subject: `Variation ${label(v)} ${nv.status} – ${job.client_name}`, html: `<p>Variation <b>${esc(label(v))}</b> (${esc(v.title)}) on job #${job.id} "${esc(job.title)}" was <b>${esc(nv.status)}</b> by ${esc(name || job.client_name)}.</p>`, text: `Variation ${label(v)} (${v.title}) on job #${job.id} was ${nv.status} by ${name || job.client_name}.` });
      }
    } catch { /* notification is optional */ }
    return json({ ok: true });
  }
  return err('Not found', 404);
}
