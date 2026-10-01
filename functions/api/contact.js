// Pages Function: validates the form post and forwards it to the ohmworks-contact Worker,
// which sends the email through Cloudflare Email Routing.
// Required Pages settings: CONTACT_WORKER_URL (variable), CONTACT_SECRET (secret)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  try {
    const { CONTACT_WORKER_URL, CONTACT_SECRET } = context.env;

    let data;
    try {
      data = await context.request.json();
    } catch {
      return json({ error: 'Invalid request' }, 400);
    }

    if (!data || !data.name || !data.email || !data.phone || !data.description) {
      return json({ error: 'Name, email, phone, and project description are required' }, 400);
    }

    if (!CONTACT_WORKER_URL || !CONTACT_SECRET) {
      console.error('CONTACT_WORKER_URL / CONTACT_SECRET not configured');
      return json({ error: 'Email is not configured. Please call 0416 481 450.' }, 503);
    }

    const resp = await fetch(CONTACT_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Contact-Secret': CONTACT_SECRET },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        phone: data.phone,
        suburb: data.suburb,
        description: data.description,
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return json({ error: result.error || 'Failed to send. Please call 0416 481 450.' }, resp.status === 400 ? 400 : 502);
    }
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: 'Server error. Please call 0416 481 450.' }, 500);
  }
}

export async function onRequest() {
  return json({ error: 'Method not allowed' }, 405);
}
