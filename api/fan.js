const SB  = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

async function sb(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts.headers,
    },
  });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; }
  catch { return { ok: r.ok, status: r.status, data: t }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { name, phone } = req.body || {};
    if (!name?.trim() || !phone?.trim())
      return res.status(400).json({ error: 'Name and phone are required.' });

    // Return existing fan or create new one
    const existing = await sb(`fans?phone=eq.${encodeURIComponent(phone.trim())}&select=id,name,phone`);
    if (existing.ok && existing.data.length > 0)
      return res.json({ fan: existing.data[0], isNew: false });

    const created = await sb('fans', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
    });
    if (!created.ok) return res.status(400).json({ error: 'Could not register. Try again.', _debug: created.data });
    return res.json({ fan: created.data[0], isNew: true });
  }

  if (req.method === 'GET') {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const r = await sb(`fans?phone=eq.${encodeURIComponent(phone)}&select=id,name,phone`);
    if (!r.ok || !r.data.length) return res.status(404).json({ error: 'Not found' });
    return res.json({ fan: r.data[0] });
  }

  res.status(405).end();
}
