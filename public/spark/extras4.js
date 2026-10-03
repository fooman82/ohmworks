(() => {
'use strict';
const S = window.SPARK;
const X = window.SPARK_X;
const { api, act, esc, money, fmtDT, shell, toast, formData, $ } = S;
const isAdmin = () => S.me().role === 'admin';
const qty = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);

// ======================================================================= Price list
async function pricelist() {
  shell('pricelist', `<h1>Price list</h1>
    <div class="row"><input id="q" class="grow" placeholder="Search name, manufacturer, part number…"><select id="sf"><option value="0">All suppliers</option></select>
      <label class="row" style="gap:4px"><input type="checkbox" id="so"> Stock items only</label><button onclick="location.hash='#/item/new'">+ New item</button><a href="/api/spark/export/pricelist" style="padding:8px">⬇ CSV</a></div>
    <div class="card tablewrap" id="list"></div>`);
  const sups = await api('suppliers');
  $('#sf').innerHTML += sups.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const load = () => act(async () => {
    const rows = await api(`pricelist?q=${encodeURIComponent($('#q').value)}&supplier=${$('#sf').value}&stock=${$('#so').checked ? 1 : 0}`);
    $('#list').innerHTML = rows.length ? `<table><tr><th>Item</th><th>Manufacturer</th><th>Mfr part #</th><th>Suppliers (part # / cost)</th><th class="right">Cost</th><th class="right">Sell</th><th class="right">In stock</th></tr>
      ${rows.map((p) => `<tr class="click" onclick="location.hash='#/item/${p.id}'"><td>${esc(p.name)}</td><td>${esc(p.manufacturer || '')}</td><td>${esc(p.mfr_part_no || '')}</td>
        <td>${p.suppliers.map((s) => `${s.preferred ? '★ ' : ''}${esc(s.supplier)}${s.part_no ? ' · ' + esc(s.part_no) : ''} · ${money(s.cost)}`).join('<br>') || '<span class="muted">—</span>'}</td>
        <td class="right">${money(p.cost)}</td><td class="right">${money(p.unit_price)}</td>
        <td class="right">${p.track_stock ? `<b${p.stock_qty <= 0 ? ' style="color:#c0392b"' : ''}>${qty(p.stock_qty)}</b>` : '<span class="muted">n/a</span>'}</td></tr>`).join('')}</table>` : '<p class="muted">No items found.</p>';
  });
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('#sf').onchange = load; $('#so').onchange = load;
  load();
}

async function item(id) {
  const isNew = id === 'new';
  const p = isNew ? { track_stock: 0, stock_qty: 0, suppliers: [], moves: [] } : await api('pricelist/' + id);
  const sups = isNew ? [] : await api('suppliers');
  const mans = await api('pricelist/manufacturers').catch(() => []);
  const sel = (s) => (s ? ' checked' : '');
  shell('pricelist', `<h1>${isNew ? 'New price list item' : esc(p.name)}</h1>
    <div class="card"><form class="form" id="f">
      <label>Name</label><input name="name" value="${esc(p.name)}" required>
      <label>Manufacturer</label><input name="manufacturer" list="mans" value="${esc(p.manufacturer)}"><datalist id="mans">${mans.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <label>Manufacturer part number <span class="muted">(duplicates allowed)</span></label><input name="mfr_part_no" value="${esc(p.mfr_part_no)}">
      <label>Category</label><input name="category" value="${esc(p.category)}">
      <label>Sell price (ex GST)</label><input name="unit_price" type="number" step="0.01" min="0" value="${p.unit_price ?? ''}" required>
      <label>Cost ${!isNew && p.suppliers.length ? '<span class="muted">(set from supplier costs below)</span>' : ''}</label><input name="cost" type="number" step="0.01" min="0" value="${p.cost ?? 0}">
      <label class="row" style="gap:6px"><input type="checkbox" name="is_labour" value="1"${sel(p.is_labour)}> Labour item</label>
      <label class="row" style="gap:6px"><input type="checkbox" name="track_stock" value="1"${sel(p.track_stock)}> Track stock on hand</label>
      ${isNew ? '<label>Opening stock quantity</label><input name="stock_qty" type="number" step="0.001" min="0" value="0">' : ''}
      <div class="row" style="margin-top:12px"><button>Save</button>${!isNew && isAdmin() ? '<button type="button" class="bad" id="del">Delete</button>' : ''}<a href="#/pricelist" style="padding:8px">Back</a></div></form></div>
    ${isNew ? '<p class="muted">Save the item first, then add suppliers and part numbers.</p>' : `
    <div class="card"><h2>Suppliers</h2><div class="tablewrap">${p.suppliers.length ? `<table><tr><th>Supplier</th><th>Supplier part # <span class="muted">(unique per supplier)</span></th><th class="right">Cost (ex GST)</th><th>Preferred</th><th></th></tr>
      ${p.suppliers.map((s) => `<tr data-link="${s.id}"><td>${esc(s.supplier)}</td><td><input data-f="part" value="${esc(s.supplier_part_no)}" style="width:150px"></td>
        <td class="right"><input data-f="cost" type="number" step="0.01" min="0" value="${s.cost}" style="width:100px"></td>
        <td>${s.preferred ? '★ Preferred' : `<button class="sec" type="button" data-pref="${s.id}">Make preferred</button>`}</td>
        <td><button type="button" data-savelink="${s.id}">Save</button> <button type="button" class="sec" data-rmlink="${s.id}">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">No suppliers yet.</p>'}</div>
      <form class="row" id="addsup" style="margin-top:10px"><select name="supplier_id" required><option value="">Add supplier…</option>${sups.filter((s) => !p.suppliers.some((x) => x.supplier_id === s.id)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <input name="supplier_part_no" placeholder="Supplier part #"><input name="cost" type="number" step="0.01" min="0" placeholder="Cost ex GST" style="width:120px"><button>Add</button></form></div>
    <div class="card"><h2>Stock on hand: ${p.track_stock ? `<b>${qty(p.stock_qty)}</b>` : '<span class="muted">not tracked</span>'}</h2>
      <form class="row" id="adj"><select name="mode"><option value="adjust">Add / remove (+/−)</option><option value="set">Set count to</option></select>
        <input name="qty" type="number" step="0.001" placeholder="Quantity" style="width:120px" required><input name="reason" class="grow" placeholder="Reason (e.g. received order, stocktake)"><button>Update stock</button></form>
      ${p.moves.length ? `<div class="tablewrap"><table><tr><th>When</th><th class="right">Change</th><th class="right">After</th><th>Reason</th><th>By</th></tr>${p.moves.map((m) => `<tr><td>${fmtDT(m.created_at)}</td><td class="right">${m.delta > 0 ? '+' : ''}${qty(m.delta)}</td><td class="right">${qty(m.qty_after)}</td><td>${esc(m.reason || '')}</td><td>${esc(m.user_name || '')}</td></tr>`).join('')}</table></div>` : ''}</div>`}`);

  $('#f').onsubmit = (e) => { e.preventDefault(); act(async () => {
    const d = formData(e.target); d.is_labour = e.target.is_labour.checked ? 1 : 0; d.track_stock = e.target.track_stock.checked ? 1 : 0;
    if (isNew) { const r = await api('pricelist', 'POST', d); location.hash = '#/item/' + r.id; } else { await api('pricelist/' + id, 'PUT', d); toast('Saved'); item(id); }
  }); };
  if (isNew) return;
  const del = $('#del'); if (del) del.onclick = () => confirm('Delete this item?') && act(async () => { await api('pricelist/' + id, 'DELETE'); location.hash = '#/pricelist'; });
  $('#addsup').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`pricelist/${id}/suppliers`, 'POST', formData(e.target)); item(id); }); };
  document.querySelectorAll('[data-savelink]').forEach((b) => (b.onclick = () => act(async () => {
    const tr = b.closest('tr');
    await api(`pricelist/${id}/suppliers/${b.dataset.savelink}`, 'PUT', { supplier_part_no: tr.querySelector('[data-f=part]').value, cost: tr.querySelector('[data-f=cost]').value });
    toast('Saved'); item(id);
  })));
  document.querySelectorAll('[data-pref]').forEach((b) => (b.onclick = () => act(async () => { await api(`pricelist/${id}/suppliers/${b.dataset.pref}`, 'PUT', { preferred: 1 }); item(id); })));
  document.querySelectorAll('[data-rmlink]').forEach((b) => (b.onclick = () => confirm('Remove this supplier from the item?') && act(async () => { await api(`pricelist/${id}/suppliers/${b.dataset.rmlink}`, 'DELETE'); item(id); })));
  $('#adj').onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`pricelist/${id}/stock`, 'POST', formData(e.target)); toast('Stock updated'); item(id); }); };
}

// ======================================================================= Supplier page: items they supply
const origSupplier = X.pages.supplier;
async function supplier(id, params) {
  await origSupplier(id, params);
  if (id === 'new') return;
  const main = document.querySelector('main'); if (!main) return;
  const box = document.createElement('div'); box.className = 'card';
  box.innerHTML = '<h2>Items from this supplier</h2><input id="siq" placeholder="Search name or part number" style="margin-bottom:8px"><div class="tablewrap" id="sil"></div>';
  main.appendChild(box);
  const load = () => act(async () => {
    const rows = await api(`suppliers/${id}/items?q=${encodeURIComponent($('#siq').value)}`);
    $('#sil').innerHTML = rows.length ? `<table><tr><th>Item</th><th>Supplier part #</th><th>Manufacturer</th><th>Mfr part #</th><th class="right">Cost</th><th class="right">In stock</th></tr>
      ${rows.map((r) => `<tr class="click" onclick="location.hash='#/item/${r.item_id}'"><td>${esc(r.name)}</td><td>${esc(r.supplier_part_no || '')}</td><td>${esc(r.manufacturer || '')}</td><td>${esc(r.mfr_part_no || '')}</td>
        <td class="right">${money(r.cost)}</td><td class="right">${r.track_stock ? qty(r.stock_qty) : '—'}</td></tr>`).join('')}</table>` : '<p class="muted">No items linked yet. Add this supplier to an item from the Price list.</p>';
  });
  let t; $('#siq').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
}

Object.assign(X.pages, { pricelist, item, supplier });
})();
