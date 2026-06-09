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

  // GET /api/vote?fan_id=xxx — active poll + vote counts + this fan's existing vote
  if (req.method === 'GET') {
    const { fan_id } = req.query;

    // Fetch active poll
    const pollRes = await sb('polls?is_active=eq.true&order=created_at.desc&limit=1&select=*');
    if (!pollRes.ok || !pollRes.data.length)
      return res.json({ poll: null });

    const poll = pollRes.data[0];

    // Fetch options for this poll
    const optsRes = await sb(`poll_options?poll_id=eq.${poll.id}&order=sort_order.asc&select=*`);
    const options = optsRes.ok ? optsRes.data : [];

    // Vote counts per option
    const countsRes = await sb(`votes?poll_id=eq.${poll.id}&select=option_id`);
    const counts = {};
    if (countsRes.ok) {
      for (const v of countsRes.data) {
        counts[v.option_id] = (counts[v.option_id] || 0) + 1;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    // This fan's vote (if any)
    let myVote = null;
    if (fan_id) {
      const myRes = await sb(`votes?fan_id=eq.${fan_id}&poll_id=eq.${poll.id}&select=option_id`);
      if (myRes.ok && myRes.data.length) myVote = myRes.data[0].option_id;
    }

    return res.json({
      poll,
      options: options.map(o => ({
        ...o,
        votes: counts[o.id] || 0,
        pct: total ? Math.round(((counts[o.id] || 0) / total) * 100) : 0,
      })),
      total_votes: total,
      my_vote: myVote,
    });
  }

  // POST /api/vote — cast a vote (one per fan per poll)
  // Body: { fan_id, poll_id, option_id }
  if (req.method === 'POST') {
    const { fan_id, poll_id, option_id } = req.body || {};
    if (!fan_id || !poll_id || !option_id)
      return res.status(400).json({ error: 'fan_id, poll_id and option_id are required' });

    // Check if already voted
    const existing = await sb(`votes?fan_id=eq.${fan_id}&poll_id=eq.${poll_id}&select=id`);
    if (existing.ok && existing.data.length)
      return res.status(409).json({ error: 'Already voted in this poll' });

    const r = await sb('votes', {
      method: 'POST',
      body: JSON.stringify({ fan_id, poll_id, option_id }),
    });
    if (!r.ok) return res.status(400).json({ error: 'Could not cast vote', detail: r.data });
    return res.json({ ok: true });
  }

  res.status(405).end();
}
