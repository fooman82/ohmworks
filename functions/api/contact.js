export async function onRequest(context) {
  try {
    const req = context.request;
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });

    const data = await req.json();
    // Basic validation
    if (!data || !data.name || !data.email || !data.phone || !data.description) {
      return new Response(JSON.stringify({ error: 'Name, email, phone, and project description are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Construct email body
    const text = `New enquiry from OHMWORKS website\n\n=== CUSTOMER DETAILS ===\nName: ${data.name}\nEmail: ${data.email}\nPhone: ${data.phone || 'Not provided'}\nSuburb/Location: ${data.suburb || 'Not provided'}\n\n=== PROJECT DESCRIPTION ===\n${data.description || 'No description provided'}`;

    // Send email using Mailgun or SendGrid — using Mailgun as example; expects MAILGUN_API_KEY and MAILGUN_DOMAIN
    const MAILGUN_API_KEY = context.env.MAILGUN_API_KEY;
    const MAILGUN_DOMAIN = context.env.MAILGUN_DOMAIN;
    const TO_EMAIL = 'glen@ohmworks.com.au';

    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      // Not configured: log it and report failure so the customer is told to phone instead
      console.error('MAILGUN not configured; message not sent:\n', text);
      return new Response(JSON.stringify({ error: 'Email is not configured. Please call 0416 481 450.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
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
