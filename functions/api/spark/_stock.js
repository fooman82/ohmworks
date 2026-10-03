// SPARK phase 4: price list with manufacturer, per-supplier part numbers and cost, and stock on hand.
//
// Data model (see migrations/0004_stock_suppliers.sql):
//   price_list      one row per item: manufacturer, mfr_part_no (duplicates allowed), stock_qty, track_stock
//   supplier_items  one row per (item, supplier): supplier_part_no (UNIQUE per supplier), cost, preferred
//   stock_moves     audit trail of every change to stock_qty
//   job_items       item_id links a job line to the price list; stock_deducted is what has been taken from stock

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const s1 = (v, n) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, n) : null; };
const money = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
const qtyOf = (v) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? r3(n) : null; };
const truthy = (v) => /^(1|y|yes|true|t|x|on)$/i.test(String(v ?? '').trim());
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Stock is taken from the shelf once a job is completed (and stays taken through invoiced/paid).
const DEDUCT_STATUSES = ['completed', 'invoiced', 'paid'];

// An item's default cost follows its preferred supplier; with no preferred supplier, the cheapest non-zero supplier cost.
// With no supplier lines at all the manually entered cost is left alone.
const RECOST = `UPDATE price_list SET cost = COALESCE(
  (SELECT cost FROM supplier_items WHERE item_id = price_list.id AND preferred = 1 ORDER BY id LIMIT 1),
  (SELECT MIN(cost) FROM supplier_items WHERE item_id = price_list.id AND cost > 0), cost) WHERE id = `;

// Run statements in small batches. Statements inside a batch run in order inside one transaction.
export async function runBatches(env, stmts, size = 80) {
  for (let i = 0; i < stmts.length; i += size) await env.DB.batch(stmts.slice(i, i + size));
}

const partConflict = (env, supplierId, partNo, exceptLinkId) => {
  if (!partNo) return null;
  return env.DB.prepare(
    `SELECT si.id, p.name FROM supplier_items si JOIN price_list p ON p.id = si.item_id
     WHERE si.supplier_id = ? AND si.supplier_part_no = ? COLLATE NOCASE AND si.id != ?`).bind(supplierId, partNo, exceptLinkId || 0).first();
};
const dupMsg = (partNo, name) => `Supplier part number "${partNo}" is already used for "${name}" by this supplier. A supplier part number can only belong to one item per supplier.`;
const isUniqueError = (e) => /UNIQUE/i.test(String(e && e.message));

function parseItem(b) {
  const name = s1(b.name, 200);
  if (!name) return { error: 'Name required' };
  const unit_price = money(blank(b.unit_price) ? 0 : b.unit_price);
  if (unit_price === null) return { error: 'Sell price is not valid' };
  const cost = money(blank(b.cost) ? 0 : b.cost);
  if (cost === null) return { error: 'Cost is not valid' };
  return {
    name, unit_price, cost, category: s1(b.category, 80), manufacturer: s1(b.manufacturer, 120), mfr_part_no: s1(b.mfr_part_no, 80),
    is_labour: truthy(b.is_labour) ? 1 : 0, track_stock: truthy(b.track_stock) ? 1 : 0,
  };
}

const LIST_SQL = `
  SELECT p.*, (SELECT json_group_array(json_object('id', si.id, 'supplier_id', si.supplier_id, 'supplier', s.name,
                 'part_no', si.supplier_part_no, 'cost', si.cost, 'preferred', si.preferred))
               FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id WHERE si.item_id = p.id) AS sj
  FROM price_list p
  WHERE (?1 = '' OR p.name LIKE ?2 OR p.manufacturer LIKE ?2 OR p.mfr_part_no LIKE ?2 OR p.category LIKE ?2
         OR EXISTS (SELECT 1 FROM supplier_items x WHERE x.item_id = p.id AND x.supplier_part_no LIKE ?2))
    AND (?3 = 0 OR EXISTS (SELECT 1 FROM supplier_items y WHERE y.item_id = p.id AND y.supplier_id = ?3))
    AND (?4 = 0 OR p.track_stock = 1)
  ORDER BY p.name COLLATE NOCASE LIMIT 500`;

function shapeItem(row) {
  const { sj, ...p } = row;
  let sup = [];
  try { sup = JSON.parse(sj || '[]'); } catch { sup = []; }
  p.suppliers = sup.sort((a, b) => (b.preferred - a.preferred) || String(a.supplier).localeCompare(String(b.supplier)));
  return p;
}

// Bring stock in line with a job's current status. Safe to call any number of times (idempotent):
// items are deducted when the job is completed/invoiced/paid and returned if it moves back or is cancelled/deleted.
export async function syncStock(env, jobId, userId, release = false) {
  const job = await env.DB.prepare('SELECT status FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) return;
  const deduct = !release && DEDUCT_STATUSES.includes(job.status);
  const rows = (await env.DB.prepare(
    `SELECT ji.id, ji.item_id, ji.qty, ji.stock_deducted AS ded FROM job_items ji
     JOIN price_list p ON p.id = ji.item_id WHERE ji.job_id = ? AND p.track_stock = 1`).bind(jobId).all()).results;
  const stmts = [];
  for (const r of rows) {
    const want = deduct ? r3(r.qty) : 0;
    const delta = r3(r.ded - want); // positive = stock returned, negative = stock used
    if (!delta) continue;
    stmts.push(env.DB.prepare('UPDATE price_list SET stock_qty = ROUND(stock_qty + ?, 3) WHERE id = ?').bind(delta, r.item_id));
    stmts.push(env.DB.prepare('UPDATE job_items SET stock_deducted = ? WHERE id = ?').bind(want, r.id));
    stmts.push(env.DB.prepare('INSERT INTO stock_moves (item_id, delta, qty_after, reason, user_id) VALUES (?, ?, (SELECT stock_qty FROM price_list WHERE id = ?), ?, ?)')
      .bind(r.item_id, delta, r.item_id, `Job #${jobId} ${deduct ? 'used' : 'released'}`, userId || null));
  }
  await runBatches(env, stmts);
}

export async function handleStock({ env, request, url, parts, body, user, json, err }) {
  const method = request.method;
  const [res, id, sub, subId] = parts;
  const admin = user.role === 'admin';

  try {
    // ------------------------------------------------------------------ Price list
    if (res === 'pricelist') {
      if (!id) {
        if (method === 'GET') {
          const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
          const sup = Number(url.searchParams.get('supplier')) || 0;
          const stockOnly = url.searchParams.get('stock') === '1' ? 1 : 0;
          const rows = (await env.DB.prepare(LIST_SQL).bind(q, `%${q}%`, sup, stockOnly).all()).results;
          return json(rows.map(shapeItem));
        }
        if (method === 'POST') {
          const f = parseItem(body);
          if (f.error) return err(f.error);
          const stock = f.track_stock && !blank(body.stock_qty) ? qtyOf(body.stock_qty) : 0;
          if (stock === null) return err('Opening stock is not a valid number');
          const r = await env.DB.prepare('INSERT INTO price_list (name,unit_price,cost,category,is_labour,manufacturer,mfr_part_no,track_stock,stock_qty) VALUES (?,?,?,?,?,?,?,?,?)')
            .bind(f.name, f.unit_price, f.cost, f.category, f.is_labour, f.manufacturer, f.mfr_part_no, f.track_stock, stock).run();
          const newId = r.meta.last_row_id;
          if (stock) await env.DB.prepare('INSERT INTO stock_moves (item_id,delta,qty_after,reason,user_id) VALUES (?,?,?,?,?)').bind(newId, stock, stock, 'Opening stock', user.id).run();
          return json({ id: newId }, 201);
        }
        return null;
      }

      if (id === 'manufacturers' && method === 'GET') {
        return json((await env.DB.prepare(`SELECT DISTINCT manufacturer AS name FROM price_list WHERE manufacturer IS NOT NULL AND manufacturer != '' ORDER BY manufacturer COLLATE NOCASE LIMIT 300`).all()).results.map((r) => r.name));
      }
      if (!/^\d+$/.test(String(id))) return err('Not found', 404);

      if (!sub) {
        if (method === 'GET') {
          const p = await env.DB.prepare('SELECT * FROM price_list WHERE id = ?').bind(id).first();
          if (!p) return err('Not found', 404);
          const suppliers = (await env.DB.prepare(
            `SELECT si.*, s.name AS supplier FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id
             WHERE si.item_id = ? ORDER BY si.preferred DESC, s.name COLLATE NOCASE`).bind(id).all()).results;
          const moves = (await env.DB.prepare(
            `SELECT m.*, u.name AS user_name FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 30`).bind(id).all()).results;
          return json({ ...p, suppliers, moves });
        }
        if (method === 'PUT') {
          const f = parseItem(body);
          if (f.error) return err(f.error);
          const cur = await env.DB.prepare('SELECT id FROM price_list WHERE id = ?').bind(id).first();
          if (!cur) return err('Not found', 404);
          await env.DB.batch([
            env.DB.prepare('UPDATE price_list SET name=?,unit_price=?,cost=?,category=?,manufacturer=?,mfr_part_no=?,is_labour=?,track_stock=? WHERE id=?')
              .bind(f.name, f.unit_price, f.cost, f.category, f.manufacturer, f.mfr_part_no, f.is_labour, f.track_stock, id),
            env.DB.prepare(RECOST + '?').bind(id), // supplier cost wins over a typed-in cost when supplier lines exist
          ]);
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          if (!admin) return err('Admin only', 403);
          await env.DB.prepare('DELETE FROM price_list WHERE id = ?').bind(id).run();
          return json({ ok: true });
        }
        return null;
      }

      // ---- stock adjustment: { mode: 'adjust' | 'set', qty, reason }
      if (sub === 'stock' && method === 'POST') {
        const n = qtyOf(body.qty);
        if (n === null || (body.mode !== 'set' && n === 0) || (body.mode === 'set' && n < 0)) return err('Enter a valid quantity');
        const p = await env.DB.prepare('SELECT stock_qty FROM price_list WHERE id = ?').bind(id).first();
        if (!p) return err('Not found', 404);
        const delta = body.mode === 'set' ? r3(n - p.stock_qty) : n;
        if (!delta) return json({ ok: true, stock_qty: p.stock_qty });
        const reason = s1(body.reason, 200) || (body.mode === 'set' ? 'Stock count' : delta > 0 ? 'Stock received' : 'Stock removed');
        await env.DB.batch([
          env.DB.prepare('UPDATE price_list SET stock_qty = ROUND(stock_qty + ?, 3), track_stock = 1 WHERE id = ?').bind(delta, id),
          env.DB.prepare('INSERT INTO stock_moves (item_id, delta, qty_after, reason, user_id) VALUES (?, ?, (SELECT stock_qty FROM price_list WHERE id = ?), ?, ?)').bind(id, delta, id, reason, user.id),
        ]);
        const now = await env.DB.prepare('SELECT stock_qty FROM price_list WHERE id = ?').bind(id).first();
        return json({ ok: true, stock_qty: now.stock_qty });
      }

      // ---- supplier lines for an item
      if (sub === 'suppliers') {
        if (method === 'POST') {
          const supplierId = Number(body.supplier_id);
          const sup = supplierId ? await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(supplierId).first() : null;
          if (!sup) return err('Choose a supplier');
          if (!(await env.DB.prepare('SELECT id FROM price_list WHERE id = ?').bind(id).first())) return err('Not found', 404);
          if (await env.DB.prepare('SELECT id FROM supplier_items WHERE item_id = ? AND supplier_id = ?').bind(id, supplierId).first()) return err('This item already has that supplier. Edit the existing line instead.', 409);
          const pn = s1(body.supplier_part_no, 80);
          const clash = await partConflict(env, supplierId, pn, 0);
          if (clash) return err(dupMsg(pn, clash.name), 409);
          const cost = money(blank(body.cost) ? 0 : body.cost);
          if (cost === null) return err('Cost is not valid');
          const hasPref = await env.DB.prepare('SELECT 1 AS x FROM supplier_items WHERE item_id = ? AND preferred = 1').bind(id).first();
          const pref = truthy(body.preferred) || !hasPref ? 1 : 0;
          const stmts = [];
          if (pref) stmts.push(env.DB.prepare('UPDATE supplier_items SET preferred = 0 WHERE item_id = ?').bind(id));
          stmts.push(env.DB.prepare('INSERT INTO supplier_items (item_id, supplier_id, supplier_part_no, cost, preferred) VALUES (?,?,?,?,?)').bind(id, supplierId, pn, cost, pref));
          stmts.push(env.DB.prepare(RECOST + '?').bind(id));
          await env.DB.batch(stmts);
          return json({ ok: true }, 201);
        }
        if (method === 'PUT' && subId) {
          const link = await env.DB.prepare('SELECT * FROM supplier_items WHERE id = ? AND item_id = ?').bind(subId, id).first();
          if (!link) return err('Not found', 404);
          const pn = 'supplier_part_no' in body ? s1(body.supplier_part_no, 80) : link.supplier_part_no;
          const cost = 'cost' in body ? money(blank(body.cost) ? 0 : body.cost) : link.cost;
          if (cost === null) return err('Cost is not valid');
          const clash = await partConflict(env, link.supplier_id, pn, link.id);
          if (clash) return err(dupMsg(pn, clash.name), 409);
          const stmts = [];
          if (truthy(body.preferred)) {
            stmts.push(env.DB.prepare('UPDATE supplier_items SET preferred = 0 WHERE item_id = ?').bind(id));
            stmts.push(env.DB.prepare(`UPDATE supplier_items SET supplier_part_no=?, cost=?, preferred=1, updated_at=datetime('now') WHERE id=?`).bind(pn, cost, link.id));
          } else {
            stmts.push(env.DB.prepare(`UPDATE supplier_items SET supplier_part_no=?, cost=?, updated_at=datetime('now') WHERE id=?`).bind(pn, cost, link.id));
          }
          stmts.push(env.DB.prepare(RECOST + '?').bind(id));
          await env.DB.batch(stmts);
          return json({ ok: true });
        }
        if (method === 'DELETE' && subId) {
          await env.DB.batch([
            env.DB.prepare('DELETE FROM supplier_items WHERE id = ? AND item_id = ?').bind(subId, id),
            // if the preferred line was removed, promote the cheapest remaining one
            env.DB.prepare(`UPDATE supplier_items SET preferred = 1 WHERE id = (SELECT id FROM supplier_items WHERE item_id = ? ORDER BY cost, id LIMIT 1)
                            AND NOT EXISTS (SELECT 1 FROM supplier_items WHERE item_id = ? AND preferred = 1)`).bind(id, id),
            env.DB.prepare(RECOST + '?').bind(id),
          ]);
          return json({ ok: true });
        }
      }
      return null;
    }

    // ------------------------------------------------------------------ Items a supplier provides
    if (res === 'suppliers' && id && sub === 'items' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      const rows = (await env.DB.prepare(
        `SELECT si.id AS link_id, si.supplier_part_no, si.cost, si.preferred, p.id AS item_id, p.name, p.manufacturer, p.mfr_part_no, p.unit_price, p.stock_qty, p.track_stock
         FROM supplier_items si JOIN price_list p ON p.id = si.item_id
         WHERE si.supplier_id = ?1 AND (?2 = '' OR p.name LIKE ?3 OR si.supplier_part_no LIKE ?3 OR p.mfr_part_no LIKE ?3)
         ORDER BY p.name COLLATE NOCASE LIMIT 500`).bind(id, q, `%${q}%`).all()).results;
      return json(rows);
    }

    // ------------------------------------------------------------------ Job line items (link to price list, cost, stock)
    if (res === 'jobs' && id && id !== 'new' && sub === 'items') {
      if (method === 'POST') {
        const job = await env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(id).first();
        if (!job) return err('Not found', 404);
        let description = String(body.description || '').trim().slice(0, 300);
        let unit = Number(body.unit_price) || 0;
        let cost = Number(body.cost) || 0;
        let itemId = null;
        if (!blank(body.item_id)) {
          const p = await env.DB.prepare('SELECT id, name, unit_price, cost FROM price_list WHERE id = ?').bind(Number(body.item_id)).first();
          if (!p) return err('Price list item not found');
          itemId = p.id; cost = p.cost;
          if (!description) description = p.name;
          if (blank(body.unit_price)) unit = p.unit_price;
        }
        if (!description) return err('Description required');
        const r = await env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price,cost,item_id) VALUES (?,?,?,?,?,?)')
          .bind(id, description, Number(body.qty) || 1, unit, cost, itemId).run();
        await syncStock(env, id, user.id); // if the job is already completed the stock is taken straight away
        return json({ id: r.meta.last_row_id }, 201);
      }
      if (method === 'DELETE' && subId) {
        const it = await env.DB.prepare('SELECT id, item_id, stock_deducted FROM job_items WHERE id = ? AND job_id = ?').bind(subId, id).first();
        if (!it) return json({ ok: true });
        const stmts = [];
        if (it.item_id && it.stock_deducted) {
          stmts.push(env.DB.prepare('UPDATE price_list SET stock_qty = ROUND(stock_qty + ?, 3) WHERE id = ?').bind(it.stock_deducted, it.item_id));
          stmts.push(env.DB.prepare('INSERT INTO stock_moves (item_id, delta, qty_after, reason, user_id) VALUES (?, ?, (SELECT stock_qty FROM price_list WHERE id = ?), ?, ?)')
            .bind(it.item_id, it.stock_deducted, it.item_id, `Job #${id} line removed`, user.id));
        }
        stmts.push(env.DB.prepare('DELETE FROM job_items WHERE id = ?').bind(it.id));
        await env.DB.batch(stmts);
        return json({ ok: true });
      }
    }
  } catch (e) {
    if (isUniqueError(e)) return err('That supplier part number is already used for this supplier.', 409);
    return err('Server error: ' + e.message, 500);
  }
  return null;
}

// ---------------------------------------------------------------------- CSV import of the price list (items + supplier lines)
// One row per (item, supplier). Rows that repeat an item name add further supplier lines to that item.
// Never throws on bad data: invalid rows are reported in `fail` and create nothing.
export async function importPriceList(env, rows, update, out, fail, stmts) {
  const itemByName = new Map();
  for (const r of (await env.DB.prepare('SELECT id, lower(name) AS n, stock_qty AS q FROM price_list ORDER BY id').all()).results) if (!itemByName.has(r.n)) itemByName.set(r.n, r);
  const sups = new Map((await env.DB.prepare('SELECT id, lower(name) AS n FROM suppliers').all()).results.map((r) => [r.n, r.id]));
  const linkMap = new Map();   // `${itemKey}|${supplierId}` -> { pn }
  const partOwner = new Map(); // `${supplierId}|${lowerPartNo}` -> itemKey
  const hasPref = new Set();   // itemKeys that already have a preferred supplier
  for (const l of (await env.DB.prepare('SELECT item_id, supplier_id, lower(supplier_part_no) AS pn, preferred FROM supplier_items').all()).results) {
    const ik = String(l.item_id);
    linkMap.set(`${ik}|${l.supplier_id}`, { pn: l.pn });
    if (l.pn) partOwner.set(`${l.supplier_id}|${l.pn}`, ik);
    if (l.preferred) hasPref.add(ik);
  }
  const seen = new Map(); // name -> { id|null, itemKey, existing }

  for (const r of rows) {
    const name = s1(r.name, 200);
    if (!name) { fail(r, 'Name is required'); continue; }
    const key = name.toLowerCase();
    let st = seen.get(key);
    const firstRow = !st;
    const hit = itemByName.get(key);

    // ---- item-level fields (only read from the first row for each item)
    let f = null;
    if (firstRow) {
      const price = money(r.unit_price);
      if (price === null) { fail(r, `Invalid price "${r.unit_price ?? ''}"`); continue; }
      const cost = blank(r.cost) ? null : money(r.cost);
      if (!blank(r.cost) && cost === null) { fail(r, `Invalid cost "${r.cost}"`); continue; }
      const stock = blank(r.stock_qty) ? null : qtyOf(r.stock_qty);
      if (!blank(r.stock_qty) && stock === null) { fail(r, `Invalid stock quantity "${r.stock_qty}"`); continue; }
      let track = blank(r.track_stock) ? null : truthy(r.track_stock) ? 1 : 0;
      if (track === null && stock !== null) track = 1; // giving a stock figure implies the item is tracked
      f = { price, cost, stock, track, category: s1(r.category, 80), mfr: s1(r.manufacturer, 120), mpn: s1(r.mfr_part_no, 80), labour: blank(r.is_labour) ? null : truthy(r.is_labour) ? 1 : 0 };
    }

    // ---- supplier line (validated before anything is written, so a rejected row changes nothing)
    const supName = s1(r.supplier, 120);
    let supId = null, spn = null, scost = null, pref = null;
    if (supName) {
      supId = sups.get(supName.toLowerCase());
      if (!supId) { fail(r, `Supplier "${supName}" not found. Import your suppliers first.`); continue; }
      spn = s1(r.supplier_part_no, 80);
      if (!blank(r.supplier_cost)) { scost = money(r.supplier_cost); if (scost === null) { fail(r, `Invalid supplier cost "${r.supplier_cost}"`); continue; } }
      else if (!blank(r.cost)) { scost = money(r.cost); if (scost === null) { fail(r, `Invalid cost "${r.cost}"`); continue; } }
      pref = blank(r.preferred) ? null : truthy(r.preferred) ? 1 : 0;
    } else if (!blank(r.supplier_part_no) || !blank(r.supplier_cost)) {
      fail(r, 'A supplier part number or supplier cost was given without a supplier'); continue;
    }

    const itemKey = st ? st.itemKey : hit ? String(hit.id) : 'n:' + key;
    if (supId && spn) {
      const owner = partOwner.get(`${supId}|${spn.toLowerCase()}`);
      if (owner && owner !== itemKey) { fail(r, `Supplier part number "${spn}" is already used for a different item by ${supName}`); continue; }
    }

    // ---- write the item
    if (firstRow) {
      st = { id: hit ? hit.id : null, itemKey, existing: !!hit };
      seen.set(key, st);
      if (!hit) {
        stmts.push(env.DB.prepare('INSERT INTO price_list (name,unit_price,cost,category,is_labour,manufacturer,mfr_part_no,stock_qty,track_stock) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(name, f.price, f.cost ?? 0, f.category, f.labour ?? 0, f.mfr, f.mpn, f.stock ?? 0, f.track ?? 0));
        if (f.stock) stmts.push(env.DB.prepare(`INSERT INTO stock_moves (item_id,delta,qty_after,reason) VALUES ((SELECT id FROM price_list WHERE lower(name)=? ORDER BY id LIMIT 1),?,?,'CSV import')`).bind(key, f.stock, f.stock));
        out.added++;
      } else if (update) {
        stmts.push(env.DB.prepare('UPDATE price_list SET unit_price=?, cost=COALESCE(?,cost), category=COALESCE(?,category), is_labour=COALESCE(?,is_labour), manufacturer=COALESCE(?,manufacturer), mfr_part_no=COALESCE(?,mfr_part_no), track_stock=COALESCE(?,track_stock) WHERE id=?')
          .bind(f.price, f.cost, f.category, f.labour, f.mfr, f.mpn, f.track, hit.id));
        if (f.stock !== null && r3(f.stock - hit.q) !== 0) {
          stmts.push(env.DB.prepare('UPDATE price_list SET stock_qty=? WHERE id=?').bind(f.stock, hit.id));
          stmts.push(env.DB.prepare(`INSERT INTO stock_moves (item_id,delta,qty_after,reason) VALUES (?,?,?,'CSV import')`).bind(hit.id, r3(f.stock - hit.q), f.stock));
        }
        out.updated++;
      } else {
        out.skipped++;
      }
    }

    // ---- write the supplier line. Existing lines are only changed when "update" is ticked; new lines are always added.
    if (supId) {
      const idExpr = st.id ? '?' : '(SELECT id FROM price_list WHERE lower(name)=? ORDER BY id LIMIT 1)';
      const idBind = st.id ? st.id : key;
      const lkKey = `${st.itemKey}|${supId}`;
      const lk = linkMap.get(lkKey);
      if (!lk) {
        const makePref = pref === 1 || (pref === null && !hasPref.has(st.itemKey));
        if (makePref) stmts.push(env.DB.prepare(`UPDATE supplier_items SET preferred=0 WHERE item_id=${idExpr}`).bind(idBind));
        stmts.push(env.DB.prepare(`INSERT INTO supplier_items (item_id,supplier_id,supplier_part_no,cost,preferred) VALUES (${idExpr},?,?,?,?)`).bind(idBind, supId, spn, scost ?? 0, makePref ? 1 : 0));
        stmts.push(env.DB.prepare(RECOST + idExpr).bind(idBind));
        linkMap.set(lkKey, { pn: spn ? spn.toLowerCase() : null });
        if (spn) partOwner.set(`${supId}|${spn.toLowerCase()}`, st.itemKey);
        if (makePref) hasPref.add(st.itemKey);
        out.links++;
      } else if (update) {
        if (spn && lk.pn && lk.pn !== spn.toLowerCase()) partOwner.delete(`${supId}|${lk.pn}`);
        if (pref === 1) {
          stmts.push(env.DB.prepare(`UPDATE supplier_items SET preferred=0 WHERE item_id=${idExpr}`).bind(idBind));
          hasPref.add(st.itemKey);
        }
        stmts.push(env.DB.prepare(`UPDATE supplier_items SET supplier_part_no=COALESCE(?,supplier_part_no), cost=COALESCE(?,cost)${pref === 1 ? ', preferred=1' : ''}, updated_at=datetime('now') WHERE item_id=${idExpr} AND supplier_id=?`)
          .bind(spn, scost, idBind, supId));
        stmts.push(env.DB.prepare(RECOST + idExpr).bind(idBind));
        if (spn) { lk.pn = spn.toLowerCase(); partOwner.set(`${supId}|${lk.pn}`, st.itemKey); }
        out.links++;
      }
    }
  }
}
