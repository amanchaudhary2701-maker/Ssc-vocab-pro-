export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const apiKey = String(body.apiKey || '').trim();
    const prompt = String(body.prompt || '').trim();
    if (!apiKey || !prompt) return res.status(400).json({ error: 'Missing apiKey or prompt' });

    const isVertex = /^AQ\./i.test(apiKey);
    const urls = isVertex ? [
      `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
    ] : [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`
    ];

    let lastErr = 'All Gemini endpoints failed';
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
          })
        });
        const txt = await r.text();
        if (!r.ok) {
          lastErr = `Upstream ${r.status}: ${txt.slice(0, 160)}`;
          continue;
        }
        const j = JSON.parse(txt);
        const outText = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (outText) return res.status(200).json({ text: outText });
      } catch (e) {
        lastErr = e && e.message ? e.message : 'Fetch error';
      }
    }
    return res.status(502).json({ error: lastErr });
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : 'Server error' });
  }
}
