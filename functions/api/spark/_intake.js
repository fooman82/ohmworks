// Website enquiry intake: creates (or reuses) a client and creates a job at the "quote" stage.
// Used by /api/contact. Must never throw into the caller's email flow, so callers wrap it in try/catch.

const one = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function createEnquiry(env, d) {
  if (!env.DB) return null;
  const name = one(d.name, 120);
  const email = one(d.email, 200).toLowerCase();
  const phone = one(d.phone, 40);
  const suburb = one(d.suburb, 120);
  const description = String(d.description ?? '').trim().slice(0, 4000);
  if (!name || !description) return null;

  // Crude flood protection: this endpoint is public.
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE source='website' AND created_at > datetime('now','-1 hour')`).first();
  if (recent.n >= 30) return { skipped: 'rate-limited' };

  let client = email ? await env.DB.prepare('SELECT id,phone,address FROM clients WHERE lower(email)=?').bind(email).first() : null;
  if (!client && phone) client = await env.DB.prepare('SELECT id,phone,address FROM clients WHERE lower(name)=? AND phone=?').bind(name.toLowerCase(), phone).first();

  let clientId, newClient = false;
  if (client) {
    clientId = client.id;
    if ((!client.phone && phone) || (!client.address && suburb)) {
      await env.DB.prepare('UPDATE clients SET phone=COALESCE(NULLIF(phone,\'\'),?), address=COALESCE(NULLIF(address,\'\'),?) WHERE id=?')
        .bind(phone || null, suburb || null, clientId).run();
    }
  } else {
    const r = await env.DB.prepare(`INSERT INTO clients (name,email,phone,address,notes,source) VALUES (?,?,?,?,?,'website')`)
      .bind(name, email || null, phone || null, suburb || null, 'Created from website contact form').run();
    clientId = r.meta.last_row_id;
    newClient = true;
  }

  // A double-click or retry within a day reuses the existing job instead of duplicating it.
  const dup = await env.DB.prepare(`SELECT id FROM jobs WHERE client_id=? AND source='website' AND description=? AND created_at > datetime('now','-1 day')`)
    .bind(clientId, description).first();
  if (dup) return { clientId, jobId: dup.id, newClient, duplicate: true };

  const firstLine = description.split('\n')[0].trim();
  const title = 'Enquiry: ' + (firstLine.length > 70 ? firstLine.slice(0, 67) + '...' : firstLine);
  const j = await env.DB.prepare(
    `INSERT INTO jobs (client_id,title,description,site_address,status,category,source) VALUES (?,?,?,?,'quote','Website enquiry','website')`)
    .bind(clientId, title, description, suburb || null).run();
  const jobId = j.meta.last_row_id;
  await env.DB.prepare('INSERT INTO job_notes (job_id,body) VALUES (?,?)')
    .bind(jobId, `Created from the website contact form${suburb ? ` (suburb: ${suburb})` : ''}. Contact: ${phone || 'no phone'}${email ? ', ' + email : ''}`).run();
  return { clientId, jobId, newClient, duplicate: false };
}
