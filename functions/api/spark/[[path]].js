// SPARK backend API (Cloudflare Pages Function + D1). Mounted at /api/spark/*
const JOB_STATUSES = ['quote', 'work_order', 'completed', 'invoiced', 'paid', 'cancelled'];
const GST = 0.1;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function hashPw(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}
const randToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, '');

function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

async function currentUser(env, req) {
  const token = getCookie(req, 'spark_session');
  if (!token) return null;
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`).bind(token).first();
}

async function createSession(env, userId) {
  const token = randToken();
  await env.DB.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+14 days'))`).bind(token, userId).run();
  return `spark_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${14 * 86400}`;
}

const pick = (o, keys) => keys.map((k) => (o[k] === undefined || o[k] === '' ? null : o[k]));

async function jobTotals(env, jobId) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(qty*unit_price),0) AS subtotal FROM job_items WHERE job_id = ?').bind(jobId).first();
  const subtotal = Math.round(r.subtotal * 100) / 100;
  const gst = Math.round(subtotal * GST * 100) / 100;
  return { subtotal, gst, total: Math.round((subtotal + gst) * 100) / 100 };
}

export async function onRequest({ request, env, params }) {
  if (!env.DB) return err('Database not bound', 500);
  const parts = [].concat(params.path || []);
  const method = request.method;
  const url = new URL(request.url);
  const [res, id, sub, subId] = parts;
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    try { body = await request.json(); } catch { body = {}; }
  }

  try {
    // ---------- Auth ----------
    if (res === 'auth') {
      if (id === 'status' && method === 'GET') {
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        return json({ needsSetup: c.n === 0 });
      }
      if (id === 'setup' && method === 'POST') {
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        if (c.n > 0) return err('Already set up', 403);
        if (!body.email || !body.name || !body.password || body.password.length < 10) return err('Name, email and a password of 10+ characters required');
        const salt = randToken();
        const r = await env.DB.prepare(`INSERT INTO users (email, name, role, pass_hash, pass_salt) VALUES (?, ?, 'admin', ?, ?)`)
          .bind(body.email.toLowerCase(), body.name, await hashPw(body.password, salt), salt).run();
        return json({ ok: true }, 200, { 'set-cookie': await createSession(env, r.meta.last_row_id) });
      }
      if (id === 'login' && method === 'POST') {
        const u = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1').bind((body.email || '').toLowerCase()).first();
        if (!u || (await hashPw(body.password || '', u.pass_salt)) !== u.pass_hash) return err('Invalid email or password', 401);
        return json({ ok: true }, 200, { 'set-cookie': await createSession(env, u.id) });
      }
      if (id === 'logout' && method === 'POST') {
        const t = getCookie(request, 'spark_session');
        if (t) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(t).run();
        return json({ ok: true }, 200, { 'set-cookie': 'spark_session=; Path=/; HttpOnly; Secure; Max-Age=0' });
      }
    }

    // ---------- Everything below requires login ----------
    const user = await currentUser(env, request);
    if (!user) return err('Unauthorised', 401);
    if (res === 'auth' && id === 'me') return json(user);

    // CSRF defence: state-changing requests must be same-origin
    if (method !== 'GET') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return err('Bad origin', 403);
    }

    // ---------- Dashboard ----------
    if (res === 'dashboard') {
      const counts = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all();
      const today = await env.DB.prepare(
        `SELECT j.id, j.title, j.scheduled_start, j.status, c.name AS client_name FROM jobs j JOIN clients c ON c.id = j.client_id
         WHERE date(j.scheduled_start) = date('now','localtime') AND j.status NOT IN ('cancelled','paid') ORDER BY j.scheduled_start`).all();
      const unpaid = await env.DB.prepare(
        `SELECT COALESCE(SUM(i.qty*i.unit_price),0)*1.1 AS amt FROM job_items i JOIN jobs j ON j.id=i.job_id WHERE j.status='invoiced'`).first();
      return json({ counts: counts.results, today: today.results, outstanding: Math.round(unpaid.amt * 100) / 100 });
    }

    // ---------- Clients ----------
    if (res === 'clients') {
      if (!id) {
        if (method === 'GET') {
          const q = `%${url.searchParams.get('q') || ''}%`;
          const r = await env.DB.prepare('SELECT * FROM clients WHERE name LIKE ?1 OR email LIKE ?1 OR phone LIKE ?1 OR address LIKE ?1 ORDER BY name LIMIT 200').bind(q).all();
          return json(r.results);
        }
        if (method === 'POST') {
          if (!body.name) return err('Name required');
          const r = await env.DB.prepare('INSERT INTO clients (name,email,phone,address,notes) VALUES (?,?,?,?,?)').bind(...pick(body, ['name', 'email', 'phone', 'address', 'notes'])).run();
          return json({ id: r.meta.last_row_id }, 201);
        }
      } else {
        if (method === 'GET') {
          const c = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
          if (!c) return err('Not found', 404);
          const jobs = await env.DB.prepare('SELECT id,title,status,scheduled_start FROM jobs WHERE client_id = ? ORDER BY id DESC').bind(id).all();
          return json({ ...c, jobs: jobs.results });
        }
        if (method === 'PUT') {
          if (!body.name) return err('Name required');
          await env.DB.prepare('UPDATE clients SET name=?,email=?,phone=?,address=?,notes=? WHERE id=?').bind(...pick(body, ['name', 'email', 'phone', 'address', 'notes']), id).run();
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          if (user.role !== 'admin') return err('Admin only', 403);
          await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
          return json({ ok: true });
        }
      }
    }

    // ---------- Jobs ----------
    if (res === 'jobs') {
      if (!id) {
        if (method === 'GET') {
          const status = url.searchParams.get('status');
          const from = url.searchParams.get('from'), to = url.searchParams.get('to');
          let sql = `SELECT j.*, c.name AS client_name, u.name AS assigned_name FROM jobs j
                     JOIN clients c ON c.id=j.client_id LEFT JOIN users u ON u.id=j.assigned_to WHERE 1=1`;
          const args = [];
          if (status) { sql += ' AND j.status = ?'; args.push(status); }
          if (from) { sql += ' AND date(j.scheduled_start) >= date(?)'; args.push(from); }
          if (to) { sql += ' AND date(j.scheduled_start) <= date(?)'; args.push(to); }
          sql += ' ORDER BY COALESCE(j.scheduled_start, j.created_at) DESC LIMIT 500';
          return json((await env.DB.prepare(sql).bind(...args).all()).results);
        }
        if (method === 'POST') {
          if (!body.client_id || !body.title) return err('Client and title required');
          const status = JOB_STATUSES.includes(body.status) ? body.status : 'quote';
          const r = await env.DB.prepare(
            'INSERT INTO jobs (client_id,title,description,site_address,status,assigned_to,scheduled_start,scheduled_end) VALUES (?,?,?,?,?,?,?,?)')
            .bind(body.client_id, body.title, body.description || null, body.site_address || null, status, body.assigned_to || null, body.scheduled_start || null, body.scheduled_end || null).run();
          return json({ id: r.meta.last_row_id }, 201);
        }
      } else {
        if (!sub) {
          if (method === 'GET') {
            const j = await env.DB.prepare(
              `SELECT j.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.address AS client_address, u.name AS assigned_name
               FROM jobs j JOIN clients c ON c.id=j.client_id LEFT JOIN users u ON u.id=j.assigned_to WHERE j.id=?`).bind(id).first();
            if (!j) return err('Not found', 404);
            const items = await env.DB.prepare('SELECT * FROM job_items WHERE job_id=? ORDER BY id').bind(id).all();
            const notes = await env.DB.prepare('SELECT n.*, u.name AS user_name FROM job_notes n LEFT JOIN users u ON u.id=n.user_id WHERE job_id=? ORDER BY n.id DESC').bind(id).all();
            const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE job_id=?').bind(id).first();
            return json({ ...j, items: items.results, notes: notes.results, invoice, totals: await jobTotals(env, id) });
          }
          if (method === 'PUT') {
            if (!body.title || !body.client_id) return err('Client and title required');
            if (body.status && !JOB_STATUSES.includes(body.status)) return err('Bad status');
            await env.DB.prepare(
              `UPDATE jobs SET client_id=?,title=?,description=?,site_address=?,status=?,assigned_to=?,scheduled_start=?,scheduled_end=?,updated_at=datetime('now') WHERE id=?`)
              .bind(body.client_id, body.title, body.description || null, body.site_address || null, body.status || 'quote', body.assigned_to || null, body.scheduled_start || null, body.scheduled_end || null, id).run();
            return json({ ok: true });
          }
          if (method === 'DELETE') {
            if (user.role !== 'admin') return err('Admin only', 403);
            await env.DB.prepare('DELETE FROM jobs WHERE id=?').bind(id).run();
            return json({ ok: true });
          }
        }
        if (sub === 'status' && method === 'POST') {
          if (!JOB_STATUSES.includes(body.status)) return err('Bad status');
          await env.DB.prepare(`UPDATE jobs SET status=?, updated_at=datetime('now') WHERE id=?`).bind(body.status, id).run();
          return json({ ok: true });
        }
        if (sub === 'items') {
          if (method === 'POST') {
            if (!body.description) return err('Description required');
            const r = await env.DB.prepare('INSERT INTO job_items (job_id,description,qty,unit_price) VALUES (?,?,?,?)')
              .bind(id, body.description, Number(body.qty) || 1, Number(body.unit_price) || 0).run();
            return json({ id: r.meta.last_row_id }, 201);
          }
          if (method === 'DELETE' && subId) {
            await env.DB.prepare('DELETE FROM job_items WHERE id=? AND job_id=?').bind(subId, id).run();
            return json({ ok: true });
          }
        }
        if (sub === 'notes' && method === 'POST') {
          if (!body.body) return err('Note required');
          await env.DB.prepare('INSERT INTO job_notes (job_id,user_id,body) VALUES (?,?,?)').bind(id, user.id, body.body).run();
          return json({ ok: true }, 201);
        }
        if (sub === 'invoice' && method === 'POST') {
          const existing = await env.DB.prepare('SELECT * FROM invoices WHERE job_id=?').bind(id).first();
          if (existing) return json(existing);
          const n = await env.DB.prepare('SELECT COALESCE(MAX(id),0)+1 AS n FROM invoices').first();
          const number = 'INV-' + String(1000 + n.n);
          await env.DB.prepare(`INSERT INTO invoices (job_id,number,due_at) VALUES (?,?,date('now','+14 days'))`).bind(id, number).run();
          await env.DB.prepare(`UPDATE jobs SET status='invoiced', updated_at=datetime('now') WHERE id=?`).bind(id).run();
          return json({ number }, 201);
        }
        if (sub === 'paid' && method === 'POST') {
          await env.DB.prepare(`UPDATE invoices SET paid_at=date('now') WHERE job_id=?`).bind(id).run();
          await env.DB.prepare(`UPDATE jobs SET status='paid', updated_at=datetime('now') WHERE id=?`).bind(id).run();
          return json({ ok: true });
        }
      }
    }

    // ---------- Price list ----------
    if (res === 'pricelist') {
      if (!id && method === 'GET') return json((await env.DB.prepare('SELECT * FROM price_list ORDER BY name').all()).results);
      if (!id && method === 'POST') {
        if (!body.name) return err('Name required');
        await env.DB.prepare('INSERT INTO price_list (name,unit_price) VALUES (?,?)').bind(body.name, Number(body.unit_price) || 0).run();
        return json({ ok: true }, 201);
      }
      if (id && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM price_list WHERE id=?').bind(id).run();
        return json({ ok: true });
      }
    }

    // ---------- Staff ----------
    if (res === 'users') {
      if (!id && method === 'GET') return json((await env.DB.prepare('SELECT id,email,name,role,active FROM users ORDER BY name').all()).results);
      if (user.role !== 'admin') return err('Admin only', 403);
      if (!id && method === 'POST') {
        if (!body.email || !body.name || !body.password || body.password.length < 10) return err('Name, email and a password of 10+ characters required');
        const salt = randToken();
        try {
          await env.DB.prepare('INSERT INTO users (email,name,role,pass_hash,pass_salt) VALUES (?,?,?,?,?)')
            .bind(body.email.toLowerCase(), body.name, body.role === 'admin' ? 'admin' : 'staff', await hashPw(body.password, salt), salt).run();
        } catch { return err('Email already exists'); }
        return json({ ok: true }, 201);
      }
      if (id && method === 'PUT') {
        await env.DB.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?')
          .bind(body.name, body.role === 'admin' ? 'admin' : 'staff', body.active ? 1 : 0, id).run();
        return json({ ok: true });
      }
    }

    return err('Not found', 404);
  } catch (e) {
    return err('Server error: ' + e.message, 500);
  }
}
