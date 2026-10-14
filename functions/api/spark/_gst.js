// GST rate comes from the settings table (key gst_rate, a percentage such as 10).
// If gst_enabled is '0' (business not registered for GST) the rate is 0 everywhere.
export async function getGst(env) {
  let pct = 10, enabled = true;
  try {
    const rows = (await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('gst_rate','gst_enabled')`).all()).results;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const n = Number(m.gst_rate);
    if (m.gst_rate !== undefined && m.gst_rate !== '' && Number.isFinite(n) && n >= 0 && n <= 100) pct = n;
    if (m.gst_enabled === '0') enabled = false;
  } catch { /* use default */ }
  if (!enabled) pct = 0;
  const rate = pct / 100;
  return { pct, enabled, rate, mult: 1 + rate, share: rate / (1 + rate) };
}
