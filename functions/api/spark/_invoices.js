// Invoices list: every invoice with totals, amount paid, balance and payment status, filterable.
// Totals only include job lines that are on the invoice (job_items.on_invoice = 1). GST is 10%.

const BASE = `
  SELECT v.id, v.number, v.job_id, v.issued_at, v.due_at, v.paid_at, j.title, c.id AS client_id, c.name AS client,
    ROUND(COALESCE((SELECT SUM(qty*unit_price) FROM job_items WHERE job_id=j.id AND on_invoice=1),0),2) AS subtotal,
    ROUND(COALESCE((SELECT SUM(qty*unit_price) FROM job_items WHERE job_id=j.id AND on_invoice=1),0)*1.1,2) AS total,
    ROUND(COALESCE((SELECT SUM(amount) FROM payments WHERE job_id=j.id),0),2) AS pay_sum
  FROM invoices v JOIN jobs j ON j.id=v.job_id JOIN clients c ON c.id=j.client_id`;

// paid amount / balance / status derived once so the list and the totals always agree
const DERIVED = `
  SELECT *, ROUND(total/11,2) AS gst,
    CASE WHEN paid_at IS NOT NULL THEN total ELSE MIN(pay_sum,total) END AS paid,
    CASE WHEN paid_at IS NOT NULL THEN 0 ELSE MAX(ROUND(total-pay_sum,2),0) END AS balance
  FROM (${BASE})`;

const STATUSED = `
  SELECT *, CASE
      WHEN balance <= 0.004 THEN 'paid'
      WHEN due_at IS NOT NULL AND due_at < date('now','localtime') THEN 'overdue'
      WHEN paid > 0.004 THEN 'partial'
      ELSE 'unpaid' END AS status,
    CASE WHEN balance > 0.004 AND due_at IS NOT NULL AND due_at < date('now','localtime')
         THEN CAST(julianday(date('now','localtime')) - julianday(due_at) AS INTEGER) ELSE 0 END AS days_overdue
  FROM (${DERIVED})`;

const FILTER = `
  WHERE (?1 = 'all'
         OR (?1 = 'unpaid' AND status != 'paid')
         OR (?1 = status))
    AND (?2 = '' OR number LIKE ?3 OR client LIKE ?3 OR title LIKE ?3)
    AND (?4 = '' OR issued_at >= ?4) AND (?5 = '' OR issued_at <= ?5)
    AND (?6 = 0 OR client_id = ?6)`;

const SORTS = {
  due: 'CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, id ASC',
  due_desc: 'due_at DESC, id DESC',
  issued: 'issued_at DESC, id DESC',
  issued_asc: 'issued_at ASC, id ASC',
  total: 'total DESC, id DESC',
  balance: 'balance DESC, id DESC',
  client: 'client COLLATE NOCASE ASC, due_at ASC',
  number: 'id DESC',
};

export async function handleInvoices({ env, request, url, parts, user, json }) {
  const [res, id] = parts;
  if (res !== 'invoices' || id || request.method !== 'GET') return null;

  const sp = url.searchParams;
  const status = ['all', 'unpaid', 'overdue', 'partial', 'paid'].includes(sp.get('status')) ? sp.get('status') : 'unpaid';
  const q = (sp.get('q') || '').trim().slice(0, 100);
  const date = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) || '') ? sp.get(k) : '');
  const from = date('from'), to = date('to');
  const client = Number(sp.get('client')) || 0;
  const order = SORTS[sp.get('sort')] || SORTS.due;
  const args = [status, q, `%${q}%`, from, to, client];

  const rows = (await env.DB.prepare(`SELECT * FROM (${STATUSED}) ${FILTER} ORDER BY ${order} LIMIT 500`).bind(...args).all()).results;
  const sum = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(gst),0) AS gst, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(paid),0) AS paid, COALESCE(SUM(balance),0) AS balance,
            COALESCE(SUM(CASE WHEN status='overdue' THEN balance ELSE 0 END),0) AS overdue,
            SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue_n
     FROM (${STATUSED}) ${FILTER}`).bind(...args).first();
  const clients = (await env.DB.prepare('SELECT DISTINCT c.id, c.name FROM invoices v JOIN jobs j ON j.id=v.job_id JOIN clients c ON c.id=j.client_id ORDER BY c.name COLLATE NOCASE').all()).results;

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  return json({
    status, rows, clients, truncated: rows.length >= 500,
    summary: { count: sum.n, subtotal: r2(sum.subtotal), gst: r2(sum.gst), total: r2(sum.total), paid: r2(sum.paid), balance: r2(sum.balance), overdue: r2(sum.overdue), overdue_count: sum.overdue_n || 0 },
  });
}
