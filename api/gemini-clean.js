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
    const urls = [];

    // 1. Live Dynamic Model Discovery (finds the exact currently active Gemini Flash model on this key — ZERO 404s!)
    try {
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const lr = await fetch(listUrl);
      if (lr.ok) {
        const lj = await lr.json();
        const models = (lj.models || [])
          .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => String(m.name || '').replace(/^models\//, ''))
          .filter(n => /gemini/i.test(n) && !/embedding|imagen|veo|tts|audio|live/i.test(n));
        // Prefer latest flash models first
        models.sort((a, b) => {
          const score = (x) => (/flash/i.test(x) ? 100 : 0) + (/3\.|3-/i.test(x) ? 50 : (/2\.5/i.test(x) ? 30 : 0)) - (/lite|8b/i.test(x) ? 5 : 0);
          return score(b) - score(a);
        });
        models.slice(0, 6).forEach(m => {
          urls.push(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`);
          if (isVertex) urls.push(`https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`);
        });
      }
    } catch (e) {}

    // 2. Fallback current & latest aliases (both AI Studio & Vertex AI Express)
    const fallbackModels = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-3.0-flash', 'gemini-2.5-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-pro-latest'];
    fallbackModels.forEach(m => {
      if (isVertex) urls.push(`https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`);
      urls.push(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`);
    });

    const uniqueUrls = Array.from(new Set(urls));
    let lastErr = 'No working Gemini model found for this API key';

    for (const url of uniqueUrls) {
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
          lastErr = `Upstream ${r.status}: ${txt.slice(0, 140)}`;
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
