// SPARK variations UI: a job-page card to raise, quote and send variations for customer approval,
// plus a "Variations" menu page listing every variation across all jobs.
(() => {
'use strict';
const S = window.SPARK;
const X = window.SPARK_X;
const { api, act, esc, money, fmtDT, shell, toast, formData, $ } = S;

const STATUS = { draft: ['Draft', 'background:#1f2a38'], sent: ['Awaiting approval', 'background:#3a2f0d;color:#f0b429'], approved: ['Approved', 'background:#0d3a2a;color:var(--ok)'], declined: ['Declined', 'background:#3a1212;color:var(--bad)'] };
const vbadge = (s) => `<span class="badge" style="${(STATUS[s] || STATUS.draft)[1]}">${esc((STATUS[s] || [s])[0])}</span>`;

// ---------- Job page card ----------
async function renderCard(jobId, job, card) {
  const list = await api(`jobs/${jobId}/variations`);
  const pl = await api('pricelist');
  const invoiced = !!job.invoice;
  const pending = list.filter((v) => v.status === 'sent').length;
  const canRaise = !invoiced && !['cancelled', 'paid'].includes(job.status);
  card.innerHTML = `<h2>Variations ${pending ? `<span class="badge" style="background:#3a2f0d;color:#f0b429">${pending} awaiting approval</span>` : ''}</h2>
    <p class="muted">Extra work found during the job. Each variation is quoted separately and must be approved by the customer before you proceed with it. Approved lines are added to the job and invoice automatically.</p>
    ${list.map((v) => {
      const editable = v.status === 'draft' || v.status === 'declined';
      return `<div class="card" style="margin:10px 0;background:transparent">
        <div class="row" style="justify-content:space-between;align-items:center"><div><b>${esc(v.label)}</b> · ${esc(v.title)} ${vbadge(v.status)}</div><div><b>${money(v.totals.total)}</b> <span class="muted">${v.totals.gst_on === false ? '' : 'inc GST'}</span></div></div>
        ${v.description ? `<p class="muted" style="white-space:pre-wrap;margin:6px 0">${esc(v.description)}</p>` : ''}
        ${v.items.length ? `<div class="tablewrap"><table>${v.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="right">${i.qty}</td><td class="right">${money(i.unit_price)}</td><td class="right">${money(i.qty * i.unit_price)}</td><td>${editable ? `<button class="sec" data-vdelitem="${v.id}:${i.id}">✕</button>` : ''}</td></tr>`).join('')}
          <tr><td colspan="3" class="right muted">Subtotal (ex GST)</td><td class="right">${money(v.totals.subtotal)}</td><td></td></tr></table></div>` : '<p class="muted">No lines yet.</p>'}
        ${v.status === 'approved' ? `<p class="ok">✅ Approved by <b>${esc(v.approved_name)}</b> on ${fmtDT(v.decided_at + 'Z')}. You can proceed with this work.</p>` : ''}
        ${v.status === 'declined' ? `<p style="color:var(--bad)">❌ Declined${v.decline_reason ? ': ' + esc(v.decline_reason) : ''}. <b>Do not proceed</b> with this work.</p>` : ''}
        ${v.status === 'sent' ? `<p class="muted">⏳ Sent ${fmtDT(v.sent_at + 'Z')}. <b>Do not proceed</b> until the customer approves.</p>` : ''}
        ${editable ? `<form class="row" data-vadd="${v.id}" style="margin-top:6px"><input type="hidden" name="item_id"><select data-vpick class="grow" required><option value="">Choose price list item…</option>${pl.map((p) => `<option value="${p.id}" data-n="${esc(p.name)}" data-p="${p.unit_price}">${esc(p.name)} — ${money(p.unit_price)}</option>`).join('')}</select>
          <input name="description" placeholder="Description (from price list)" class="grow" readonly tabindex="-1" style="opacity:.8"><input name="qty" type="number" step="0.01" value="1" style="width:80px"><input name="unit_price" type="number" step="0.01" placeholder="Unit $ ex GST" style="width:130px" required><button class="sec">Add line</button></form>` : ''}
        <div class="row" style="margin-top:8px">
          ${editable ? `<button data-vsend="${v.id}">✉ ${v.status === 'declined' ? 'Re-send' : 'Send'} for approval</button>` : ''}
          ${v.status === 'sent' ? `<button class="sec" data-vsend="${v.id}">✉ Resend</button><button class="sec" data-vwithdraw="${v.id}">Withdraw</button>` : ''}
          ${v.status !== 'draft' ? `<button class="sec" data-vlink="${v.id}">🔗 Copy approval link</button>` : ''}
          ${v.status !== 'approved' ? `<button class="bad" data-vdel="${v.id}">Delete</button>` : ''}
        </div></div>`;
    }).join('') || '<p class="muted">No variations on this job.</p>'}
    ${canRaise ? `<form class="form" id="vnew" style="margin-top:8px"><label>New variation title</label><input name="title" placeholder="e.g. Additional power points in garage" required>
      <label>Reason / description <span class="muted">(shown to the customer)</span></label><textarea name="description" rows="2"></textarea>
      <div class="row" style="margin-top:8px"><button>+ Raise variation</button></div></form>` : '<p class="muted">New variations cannot be raised once the job is invoiced or closed. Create a new job for further work.</p>'}`;

  const redo = () => renderCard(jobId, job, card);
  const [fn, sel] = [(q, f) => card.querySelectorAll(q).forEach(f), null];
  void sel;
  const nv = card.querySelector('#vnew');
  if (nv) nv.onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`jobs/${jobId}/variations`, 'POST', formData(e.target)); toast('Variation created. Add the quote lines.'); redo(); }); };
  fn('[data-vadd]', (f) => {
    // Choosing a price list item fills the (read-only) description and the sell price ex GST.
    f.querySelector('[data-vpick]').onchange = (e) => {
      const o = e.target.selectedOptions[0];
      f.querySelector('[name=item_id]').value = o.value;
      f.querySelector('[name=description]').value = o.value ? o.dataset.n : '';
      f.querySelector('[name=unit_price]').value = o.value ? o.dataset.p : '';
    };
    f.onsubmit = (e) => { e.preventDefault(); act(async () => { await api(`variations/${f.dataset.vadd}/items`, 'POST', formData(f)); redo(); }); };
  });
  fn('[data-vdelitem]', (b) => (b.onclick = () => act(async () => { const [v, i] = b.dataset.vdelitem.split(':'); await api(`variations/${v}/items/${i}`, 'DELETE'); redo(); })));
  fn('[data-vsend]', (b) => (b.onclick = () => confirm('Email this variation to the customer for approval?') && act(async () => { b.disabled = true; await api(`variations/${b.dataset.vsend}/send`, 'POST', {}); toast('Sent to customer for approval'); S.route(); })));
  fn('[data-vwithdraw]', (b) => (b.onclick = () => act(async () => { await api(`variations/${b.dataset.vwithdraw}/withdraw`, 'POST', {}); S.route(); })));
  fn('[data-vdel]', (b) => (b.onclick = () => confirm('Delete this variation?') && act(async () => { await api('variations/' + b.dataset.vdel, 'DELETE'); redo(); })));
  fn('[data-vlink]', (b) => (b.onclick = () => act(async () => { const r = await api(`variations/${b.dataset.vlink}/link`); try { await navigator.clipboard.writeText(r.url); toast('Approval link copied'); } catch { prompt('Approval link', r.url); } })));
}

const prevHook = X.jobHook;
X.jobHook = async (id, j) => {
  if (prevHook) await prevHook(id, j);
  if (!id || id === 'new' || !j) return;
  const card = document.createElement('div'); card.className = 'card';
  card.id = 'variations-card';
  const anchor = [...document.querySelectorAll('main .card')].find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Line items');
  if (anchor) anchor.after(card); else document.querySelector('main').appendChild(card);
  await renderCard(id, j, card);
};

// ---------- Variations menu page ----------
const filt = { status: 'sent' };
async function variations() {
  shell('variations', `<h1>Variations</h1>
    <div class="row"><select id="vs"><option value="">All</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === filt.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted">Extra work awaiting or given customer approval across all jobs.</span></div>
    <div class="card tablewrap" id="list"></div>`);
  const all = await api('variations');
  const draw = () => {
    const rows = all.filter((v) => !filt.status || v.status === filt.status);
    $('#list').innerHTML = rows.length ? `<table><tr><th>Variation</th><th>Job</th><th>Client</th><th>Status</th><th class="right">Total</th><th>Updated</th></tr>${rows.map((v) => `<tr class="click" onclick="location.hash='#/job/${v.job_id}'"><td><b>${esc(v.label)}</b><div class="muted" style="font-size:12px">${esc(v.title)}</div></td><td>#${v.job_id} ${esc(v.job_title)}</td><td>${esc(v.client_name)}</td><td>${vbadge(v.status)}</td><td class="right">${money(v.total)}</td><td>${fmtDT((v.decided_at || v.sent_at || v.created_at) + 'Z')}</td></tr>`).join('')}</table>` : '<p class="muted">No variations match.</p>';
  };
  $('#vs').onchange = (e) => { filt.status = e.target.value; draw(); };
  draw();
}
X.pages.variations = variations;
})();
