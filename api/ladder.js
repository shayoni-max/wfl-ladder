const SHEET_ID = process.env.SHEET_ID;
const API_KEY  = process.env.SHEETS_API_KEY;
const BASE     = 'https://sheets.googleapis.com/v4/spreadsheets';

async function batchGet(ranges) {
  const params = new URLSearchParams({ key: API_KEY });
  ranges.forEach(r => params.append('ranges', r));
  const res = await fetch(`${BASE}/${SHEET_ID}/values:batchGet?${params}`);
  if (!res.ok) throw new Error(`Sheets API ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const vr of json.valueRanges || []) {
    const sheet = vr.range.split('!')[0].replace(/'/g, '');
    out[sheet] = vr.values || [];
  }
  return out;
}

function norm(s) {
  return (s || '').toLowerCase().replace(/\bfc\b/g, '').replace(/\bfary\b/g, 'fari').replace(/\s+/g, ' ').trim();
}

function num(v) {
  const n = parseInt(v);
  return isNaN(n) ? null : n;
}

export default async function handler(req, res) {
  try {
    const data = await batchGet([
      'Fixtures_Revised!A1:J60',
      'Points Table!A1:N35',
      'Player Stats!A1:E100',
      'Teams Master!A1:G89',
    ]);

    // Standings — rows 3-8 in the sheet (index 2-7)
    const ptRows = data['Points Table'] || [];
    const standings = [];
    for (let i = 2; i <= 7; i++) {
      const r = ptRows[i];
      if (!r || !r[1]?.trim()) continue;
      standings.push({
        name: r[1].trim(),
        p:   num(r[4])  ?? 0,
        w:   num(r[5])  ?? 0,
        d:   num(r[6])  ?? 0,
        l:   num(r[7])  ?? 0,
        gf:  num(r[8])  ?? 0,
        ga:  num(r[9])  ?? 0,
        gd:  num(r[10]) ?? 0,
        pts: num(r[13]) ?? 0,
      });
    }
    standings.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    // Score lookup from Points Table match rows
    const scoreMap = {};
    for (const r of ptRows) {
      if (!r?.[0] || isNaN(parseInt(r[0]))) continue;
      const hs = num(r[3]);
      const as = num(r[4]);
      if (hs === null || as === null) continue;
      scoreMap[`${norm(r[2])}|${norm(r[5])}`] = { hs, as };
    }

    // Fixtures grouped by block
    const blocks = {};
    for (const r of (data['Fixtures_Revised'] || []).slice(1)) {
      if (!r?.[0] || isNaN(parseInt(r[0]))) continue;
      const home  = (r[1] || '').trim();
      const away  = (r[3] || '').trim();
      const block = (r[4] || '').trim();
      if (!home || !away || !block) continue;
      const score = scoreMap[`${norm(home)}|${norm(away)}`] ?? null;
      if (!blocks[block]) blocks[block] = {
        label: block,
        start: (r[5] || '').trim(),
        end:   (r[6] || '').trim(),
        matches: [],
      };
      blocks[block].matches.push({
        no: parseInt(r[0]),
        home, away,
        hs: score?.hs ?? null,
        as: score?.as ?? null,
        match_date: (r[7] || '').trim(),
        start_time: (r[8] || '').trim(),
        end_time:   (r[9] || '').trim(),
      });
    }

    // Top scorers from Player Stats tab (skip header row)
    const scorers = [];
    for (const r of (data['Player Stats'] || []).slice(1)) {
      if (!r?.[0]?.trim()) continue;
      scorers.push({
        name:    r[0].trim(),
        team:    (r[1] || '').trim(),
        jersey:  (r[2] || '').trim(),
        goals:   num(r[3]) ?? 0,
        assists: num(r[4]) ?? 0,
      });
    }
    scorers.sort((a, b) => b.goals - a.goals || b.assists - a.assists);

    // Form guide — last 10 results per team (W/D/L), chronological order
    const formMap = {};
    const allMatches = Object.values(blocks).flatMap(b => b.matches).sort((a, b) => a.no - b.no);
    for (const m of allMatches) {
      if (m.hs === null) continue;
      const homeR = m.hs > m.as ? 'W' : m.hs < m.as ? 'L' : 'D';
      const awayR = m.hs > m.as ? 'L' : m.hs < m.as ? 'W' : 'D';
      if (!formMap[m.home]) formMap[m.home] = [];
      if (!formMap[m.away]) formMap[m.away] = [];
      formMap[m.home].push(homeR);
      formMap[m.away].push(awayR);
    }
    for (const s of standings) {
      const key = formMap[s.name] ? s.name : Object.keys(formMap).find(k => norm(k) === norm(s.name));
      s.form = key ? formMap[key].slice(-10) : [];
    }

    // Build rosters from Teams Master tab
    // Each team block: merged header row ("Team Name: X | ..."), col-header row (skip), then player rows (col B = Full Name)
    // Scan every cell in each row for "Team Name:" — merged cells can land in any column
    const rawRosters = {};
    let _curTeam = null, _skipNext = false;
    for (const r of (data['Teams Master'] || [])) {
      // "Team Name: X" and "Team Name : X" both exist in the sheet — match case-insensitively
      const hdrCell = (r || []).map(c => (c || '').trim()).find(c => c.toLowerCase().startsWith('team name'));
      if (hdrCell) {
        _curTeam = hdrCell.split('|')[0].replace(/team name\s*:\s*/i, '').replace(/[()]/g, '').trim();
        rawRosters[_curTeam] = [];
        _skipNext = true;
        continue;
      }
      if (_skipNext) { _skipNext = false; continue; }
      const name = (r?.[1] || '').trim();
      if (_curTeam && name && name !== 'Full Name') rawRosters[_curTeam].push(name);
    }

    // Re-key using exact fixture team names so frontend lookups work (handles "WADDLERS" vs "WADDLERS FC" etc.)
    const rosters = {};
    const fixtureTeams = new Set(Object.values(blocks).flatMap(b => b.matches.flatMap(m => [m.home, m.away])));
    for (const ft of fixtureTeams) {
      for (const [rt, players] of Object.entries(rawRosters)) {
        if (norm(rt) === norm(ft)) { rosters[ft] = players; break; }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ standings, blocks: Object.values(blocks), scorers, rosters, updated: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
