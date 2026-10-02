const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const clean = (v, max = 200) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
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

    try {
      const resp = await fetch(`${apiBase}/v3/${env.MAILGUN_DOMAIN}/messages`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa('api:' + env.MAILGUN_API_KEY) },
        body: form,
      });

      if (!resp.ok) {
        console.error('Mailgun error', resp.status, await resp.text());
        return json({ error: 'Failed to send email' }, 502);
      }
      return json({ ok: true });
    } catch (err) {
      console.error('send failed', err);
      return json({ error: 'Failed to send email' }, 502);
    }
  },
};
