// Quote templates: description of work, parts (price list items + qty) and labour hours.
// Applying a template COPIES the current sell price onto each job line, so later price list
// changes never alter a quote that has already been built or sent.

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : d; };

async function saveItems(env, tplId, items) {
  const stmts = [env.DB.prepare('DELETE FROM quote_template_items WHERE template_id=?').bind(tplId)];
  for (const it of Array.isArray(items) ? items.slice(0, 100) : []) {
    const q = num(it.qty, 1) || 1;
    if (!Number(it.item_id)) continue;
    const hasPrice = it.unit_price !== undefined && it.unit_price !== null && String(it.unit_price).trim() !== '';
    const price = hasPrice ? Number(it.unit_price) : null;
    if (hasPrice && !(Number.isFinite(price) && price >= 0)) return 'Sell price override is not valid';
    stmts.push(env.DB.prepare('INSERT INTO quote_template_items (template_id,item_id,qty,unit_price) VALUES (?,?,?,?)').bind(tplId, Number(it.item_id), q, price === null ? null : Math.round(price * 100) / 100));
  }
  await env.DB.batch(stmts);
  return null;
}

export async function handleTemplates({ env, request, parts, body, user, json, err }) {
  const method = request.method;
  const [res, id, sub] = parts;

  if (res === 'templates') {
    if (!id && method === 'GET') {
      return json((await env.DB.prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM quote_template_items WHERE template_id=t.id) AS parts FROM quote_templates t ORDER BY t.name COLLATE NOCASE`).all()).results);
    }
    if (!id && method === 'POST') {
      const name = String(body.name || '').trim().slice(0, 120);
      if (!name) return err('Name required');
      const r = await env.DB.prepare('INSERT INTO quote_templates (name,description,hours) VALUES (?,?,?)')
        .bind(name, String(body.description || '').slice(0, 4000) || null, num(body.hours)).run();
      const bad = await saveItems(env, r.meta.last_row_id, body.items);
      if (bad) { await env.DB.prepare('DELETE FROM quote_templates WHERE id=?').bind(r.meta.last_row_id).run(); return err(bad); }
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (id && /^\d+$/.test(id) && sub === 'copy' && method === 'POST') {
      const t = await env.DB.prepare('SELECT * FROM quote_templates WHERE id=?').bind(id).first();
      if (!t) return err('Not found', 404);
      const r = await env.DB.prepare('INSERT INTO quote_templates (name,description,hours) VALUES (?,?,?)')
        .bind(`${t.name} (copy)`.slice(0, 120), t.description, t.hours).run();
      await env.DB.prepare('INSERT INTO quote_template_items (template_id,item_id,qty,unit_price) SELECT ?,item_id,qty,unit_price FROM quote_template_items WHERE template_id=? ORDER BY id')
        .bind(r.meta.last_row_id, id).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if (id && /^\d+$/.test(id) && !sub) {
      if (method === 'GET') {
        const t = await env.DB.prepare('SELECT * FROM quote_templates WHERE id=?').bind(id).first();
        if (!t) return err('Not found', 404);
        const items = (await env.DB.prepare(
          `SELECT q.id, q.item_id, q.qty, q.unit_price AS override_price, p.name, p.unit_price, p.manufacturer FROM quote_template_items q JOIN price_list p ON p.id=q.item_id WHERE q.template_id=? ORDER BY q.id`).bind(id).all()).results;
        return json({ ...t, items });
      }
      if (method === 'PUT') {
        const name = String(body.name || '').trim().slice(0, 120);
        if (!name) return err('Name required');
        await env.DB.prepare('UPDATE quote_templates SET name=?,description=?,hours=? WHERE id=?')
          .bind(name, String(body.description || '').slice(0, 4000) || null, num(body.hours), id).run();
        const bad = await saveItems(env, id, body.items);
        if (bad) return err(bad);
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM quote_templates WHERE id=?').bind(id).run();
        return json({ ok: true });
      }
    }
  }

  // Apply a template to a job that is still a quote
  if (res === 'jobs' && id && /^\d+$/.test(id) && sub === 'apply-template' && method === 'POST') {
    const job = await env.DB.prepare('SELECT id, status, description, quote_accepted_at FROM jobs WHERE id=?').bind(id).first();
    if (!job) return err('Not found', 404);
    if (job.status !== 'quote' || job.quote_accepted_at) return err('Templates can only be applied to a quote that has not been accepted');
    const t = await env.DB.prepare('SELECT * FROM quote_templates WHERE id=?').bind(Number(body.template_id)).first();
    if (!t) return err('Template not found');
    const items = (await env.DB.prepare(
      `SELECT q.qty, p.id, p.name, COALESCE(q.unit_price, p.unit_price) AS unit_price, p.cost FROM quote_template_items q JOIN price_list p ON p.id=q.item_id WHERE q.template_id=? ORDER BY q.id`).bind(t.id).all()).results;
    const stmts = [];
    if (t.description) {
      const desc = job.description ? job.description + '\n\n' + t.description : t.description;
      stmts.push(env.DB.prepare('UPDATE jobs SET description=? WHERE id=?').bind(desc, id));
    }
    for (const it of items) {
      stmts.push(env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price,cost,item_id) VALUES (?,?,?,?,?,?)').bind(id, it.name, it.qty, it.unit_price, it.cost, it.id));
    }
    if (t.hours > 0) {
      const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='hourly_rate'`).first();
      const rate = Number(row && row.value) || 110;
      stmts.push(env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price,cost) VALUES (?,?,?,?,0)').bind(id, 'Labour (hours)', t.hours, rate));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, parts: items.length, hours: t.hours });
  }
  return null;
}
