import { EmailMessage } from 'cloudflare:email';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const clean = (v, max = 200) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

const b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n');

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    // Only accept requests from the Pages function
    if (!env.CONTACT_SECRET || request.headers.get('X-Contact-Secret') !== env.CONTACT_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
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

    const body =
      `New enquiry from the OHMWORKS website\r\n\r\n` +
      `Name: ${name}\r\nEmail: ${email}\r\nPhone: ${phone}\r\nSuburb: ${suburb || 'Not provided'}\r\n\r\n` +
      `Description:\r\n${description.replace(/\r?\n/g, '\r\n')}\r\n`;

    const raw = [
      `From: OHMWORKS Website <${env.FROM_ADDRESS}>`,
      `To: ${env.TO_ADDRESS}`,
      `Reply-To: ${email}`,
      `Subject: =?UTF-8?B?${b64(`New enquiry from ${name}`)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@ohmworks.com.au>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(body)),
      '',
    ].join('\r\n');

    try {
      await env.EMAIL.send(new EmailMessage(env.FROM_ADDRESS, env.TO_ADDRESS, raw));
      return json({ ok: true });
    } catch (err) {
      console.error('send failed', err);
      return json({ error: 'Failed to send email' }, 502);
    }
  },
};
