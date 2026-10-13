// GST rate comes from the settings table (key gst_rate, a percentage such as 10). Defaults to 10.
export async function getGst(env) {
  let pct = 10;
  try {
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='gst_rate'`).first();
    const n = Number(row && row.value);
    if (row && row.value !== '' && Number.isFinite(n) && n >= 0 && n <= 100) pct = n;
  } catch { /* use default */ }
  const rate = pct / 100;
  // mult: ex -> inc multiplier; div: inc / div = GST portion of an inc-GST amount
  return { pct, rate, mult: 1 + rate, div: (1 + rate) / rate || 1, share: rate / (1 + rate) };
}
