export async function onRequest(context) {
  try {
    const req = context.request;
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });

    const data = await req.json();
    // Basic validation
    if (!data || !data.name || !data.email) {
      return new Response(JSON.stringify({ error: 'Name and email are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Construct email body
    const text = `New contact from OHMWORKS website\n\nName: ${data.name}\nEmail: ${data.email}\nPhone: ${data.phone || ''}\nSuburb: ${data.suburb || ''}\nServices: ${Array.isArray(data.services)?data.services.join(', '):''}\n\nMessage:\n${data.message || ''}`;

    // Send email using Mailgun or SendGrid — using Mailgun as example; expects MAILGUN_API_KEY and MAILGUN_DOMAIN
    const MAILGUN_API_KEY = context.env.MAILGUN_API_KEY;
    const MAILGUN_DOMAIN = context.env.MAILGUN_DOMAIN;
    const TO_EMAIL = 'glen@ohmworks.com.au';

    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      // If not configured, write to D1 or log — here we just return success for demo
      console.log('MAILGUN not configured; message:\n', text);
      return new Response(JSON.stringify({ ok: true, message: 'Mailgun not configured in environment. Message logged.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const body = new URLSearchParams();
    body.append('from', `OHMWORKS Website <mailgun@${MAILGUN_DOMAIN}>`);
    body.append('to', TO_EMAIL);
    body.append('subject', `New enquiry from OHMWORKS: ${data.name}`);
    body.append('text', text);

    const resp = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa('api:' + MAILGUN_API_KEY) },
      body
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: 'Failed to send email', details: txt }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
