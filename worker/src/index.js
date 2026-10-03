const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const clean = (v, max = 200) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  // Hourly trigger (see wrangler.toml): asks SPARK to send tomorrow's SMS job reminders.
  // SPARK itself enforces the 8am-7pm Sydney window and de-duplicates, so extra runs are harmless.
  async scheduled(event, env, ctx) {
    if (!env.CRON_SECRET || !env.SPARK_URL) return;
    ctx.waitUntil(
      fetch(`${env.SPARK_URL}/api/spark/cron/reminders`, { method: 'POST', headers: { 'X-Cron-Secret': env.CRON_SECRET } })
        .then(async (r) => console.log('SPARK reminders', r.status, (await r.text()).slice(0, 200)))
        .catch((e) => console.error('SPARK reminders failed', e.message))
    );
  },

  async fetch(request, env) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    // Only accept requests from the Pages function
    if (!env.CONTACT_SECRET || request.headers.get('X-Contact-Secret') !== env.CONTACT_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }

    if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
      console.error('MAILGUN_API_KEY / MAILGUN_DOMAIN not configured');
      return json({ error: 'Email is not configured' }, 503);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: 'Invalid request' }, 400);
    }

    const name = clean(data.name, 100);
    const email = clean(data.email, 200);
    const phone = clean(data.phone, 40);
    const suburb = clean(data.suburb, 100);
    const description = String(data.description ?? '').trim().slice(0, 5000);

    if (!name || !email || !phone || !description) {
      return json({ error: 'Name, email, phone and project description are required' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address' }, 400);
    }

    const text =
      `New enquiry from the OHMWORKS website\n\n` +
      `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nSuburb: ${suburb || 'Not provided'}\n\n` +
      `Description:\n${description}\n`;

    const html =
      `<h2>New enquiry from the OHMWORKS website</h2>` +
      `<p><strong>Name:</strong> ${esc(name)}<br>` +
      `<strong>Email:</strong> ${esc(email)}<br>` +
      `<strong>Phone:</strong> ${esc(phone)}<br>` +
      `<strong>Suburb:</strong> ${esc(suburb || 'Not provided')}</p>` +
      `<p><strong>Description:</strong></p><p>${esc(description).replace(/\n/g, '<br>')}</p>`;

    // Mailgun HTTP API (use https://api.eu.mailgun.net for EU-region accounts)
    const apiBase = env.MAILGUN_API_BASE || 'https://api.mailgun.net';

    const form = new FormData();
    form.append('from', env.FROM_ADDRESS);
    form.append('to', env.TO_ADDRESS);
    form.append('h:Reply-To', email);
    form.append('subject', `New enquiry from ${name}`);
    form.append('text', text);
    form.append('html', html);

    // Trim stray whitespace/newlines that often sneak in when pasting a key
    const apiKey = String(env.MAILGUN_API_KEY).trim();
    const domain = String(env.MAILGUN_DOMAIN).trim();

    try {
      const resp = await fetch(`${apiBase}/v3/${domain}/messages`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa('api:' + apiKey) },
        body: form,
      });

      if (!resp.ok) {
        const detail = await resp.text();
        console.error('Mailgun error', resp.status, detail);
        if (resp.status === 401 || resp.status === 403) {
          // Diagnostics only: never log the key itself
          const shape = /^[0-9a-f]{32}-[0-9a-f]{8}-[0-9a-f]{8}$/i.test(apiKey) ? 'new-style key'
            : /^key-[0-9a-f]{32}$/i.test(apiKey) ? 'legacy key-xxxx'
            : /^[0-9a-f]{32}$/i.test(apiKey) ? '32-hex (public/webhook key?)'
            : 'unrecognised format';
          console.error(`Auth diagnostics: apiBase=${apiBase} domain=${domain} keyLength=${apiKey.length} keyShape=${shape} hadWhitespace=${apiKey !== String(env.MAILGUN_API_KEY)}`);

          // Probe the other region and the account's domain list (read-only) to pinpoint the cause
          const other = apiBase.includes('.eu.') ? 'https://api.mailgun.net' : 'https://api.eu.mailgun.net';
          const auth = { Authorization: 'Basic ' + btoa('api:' + apiKey) };
          const probeOther = await fetch(`${other}/v3/domains?limit=5`, { headers: auth });
          const probeThis = await fetch(`${apiBase}/v3/domains?limit=20`, { headers: auth });
          console.error(`Probe: this region domains=${probeThis.status}, other region (${other}) domains=${probeOther.status}`);
          // Domain names and states are not secret; log them so a name mismatch is obvious
          for (const [label, p] of [['this region', probeThis], ['other region', probeOther]]) {
            try {
              const body = await p.clone().json();
              const list = (body.items || []).map((d) => `${d.name}:${d.state}`).join(', ');
              console.error(`Domains (${label}): total=${body.total_count ?? 'n/a'} [${list}]`);
            } catch (e) {
              console.error(`Domains (${label}): could not read response`);
            }
          }
        }
        return json({ error: 'Failed to send email' }, 502);
      }
      return json({ ok: true });
    } catch (err) {
      console.error('send failed', err);
      return json({ error: 'Failed to send email' }, 502);
    }
  },
};
