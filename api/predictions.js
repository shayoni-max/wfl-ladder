const SB  = process.env.SUPABASE_URL?.trim();
const KEY = process.env.SUPABASE_ANON_KEY?.trim();

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

  // GET /api/predictions?fan_id=xxx  — fetch all predictions for a fan
  if (req.method === 'GET') {
    const { fan_id } = req.query;
    if (!fan_id) return res.status(400).json({ error: 'fan_id required' });
    const r = await sb(`predictions?fan_id=eq.${fan_id}&select=*&order=match_no.asc`);
    if (!r.ok) return res.status(500).json({ error: 'Failed to fetch predictions' });
    return res.json({ predictions: r.data });
  }

  // POST /api/predictions — save or update a prediction
  // Body: { fan_id, match_no, predicted_winner, predicted_home_score, predicted_away_score, predicted_scorer }
  if (req.method === 'POST') {
    const { fan_id, match_no, predicted_winner, predicted_home_score, predicted_away_score, predicted_scorer } = req.body || {};
    if (!fan_id || !match_no || !predicted_winner)
      return res.status(400).json({ error: 'fan_id, match_no and predicted_winner are required' });

    // Upsert — insert or update if (fan_id, match_no) already exists
    const r = await sb('predictions', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        fan_id,
        match_no,
        predicted_winner,
        predicted_home_score: predicted_home_score ?? null,
        predicted_away_score: predicted_away_score ?? null,
        predicted_scorer:     predicted_scorer?.trim() || null,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) return res.status(400).json({ error: 'Could not save prediction', detail: r.data });
    return res.json({ prediction: r.data[0] });
  }

  res.status(405).end();
}
