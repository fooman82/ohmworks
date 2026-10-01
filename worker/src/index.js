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

    if (!env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
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

    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.FROM_ADDRESS,
          to: [env.TO_ADDRESS],
          reply_to: email,
          subject: `New enquiry from ${name}`,
          text,
          html,
        }),
      });

      if (!resp.ok) {
        console.error('Resend error', resp.status, await resp.text());
        return json({ error: 'Failed to send email' }, 502);
      }
      return json({ ok: true });
    } catch (err) {
      console.error('send failed', err);
      return json({ error: 'Failed to send email' }, 502);
    }
  },
};
