// Vercel Serverless Function + Daily 9:00 AM IST Cron (03:30 UTC)
// Automatically generates 25 Reasoning + 25 GK/GS (Bilingual EN+HI) via Free Gemini API
// and publishes to Firebase Firestore: daily_ssc_full_tests/{YYYY-MM-DD}

const FS_ROOT = 'https://firestore.googleapis.com/v1/projects/ssc-pro-6ca83/databases/(default)/documents';
const FS_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBs_w5tmFnNc-fygZ-t5wdS_C7KtsVie7k';

function getIstDateKey() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchFromFirestore(dateKey) {
  const res = await fetch(`${FS_ROOT}/daily_ssc_full_tests/${encodeURIComponent(dateKey)}?key=${encodeURIComponent(FS_KEY)}`);
  if (!res.ok) return null;
  const doc = await res.json();
  const raw = doc?.fields?.payload?.stringValue;
  return raw ? JSON.parse(raw) : null;
}

async function saveToFirestore(dateKey, dataObj) {
  const body = {
    fields: {
      dateKey: { stringValue: dateKey },
      createdAt: { stringValue: new Date().toISOString() },
      payload: { stringValue: JSON.stringify(dataObj) }
    }
  };
  const res = await fetch(`${FS_ROOT}/daily_ssc_full_tests/${encodeURIComponent(dateKey)}?key=${encodeURIComponent(FS_KEY)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Firestore save failed: ' + txt);
  }
}

async function generateSectionWithGemini(apiKey, sectionName, count, dateKey, topicsHint) {
  const prompt = `You are an expert SSC CGL/CHSL Tier-1 exam paper setter.
Generate exactly ${count} fresh, accurate, exam-level ${sectionName} MCQ questions for date ${dateKey} (SSC Tier-1 latest pattern).
Topics to cover evenly: ${topicsHint}.
Rules:
1. Every question MUST be Bilingual: "qEn" (clean English) AND "qHi" (natural Hindi in Devanagari).
2. Exactly 4 distinct options in "options" array (short, clear).
3. "ans" must be the 0-based integer index (0, 1, 2, or 3) of the single verified correct option.
4. "exp" must be a crisp 1-line explanation.
5. "topic" must be a short 1-3 word topic tag.
Return ONLY valid JSON matching: {"items":[{"topic":"...","qEn":"...","qHi":"...","options":["...","...","...","..."],"ans":0,"exp":"..."}]}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.85
      }
    })
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Gemini API error (${sectionName}): ${errTxt}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items.slice(0, count) : [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const dateKey = (req.query && req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      ? req.query.date
      : getIstDateKey();
    const force = req.query && req.query.force === '1';

    if (!force) {
      const existing = await fetchFromFirestore(dateKey);
      if (existing && Array.isArray(existing.reasoning) && existing.reasoning.length >= 20) {
        return res.status(200).json({ ok: true, cached: true, ...existing });
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: 'GEMINI_API_KEY is not set in Vercel Environment Variables.'
      });
    }

    const [reasoning, gk] = await Promise.all([
      generateSectionWithGemini(
        apiKey,
        'General Intelligence & Reasoning',
        25,
        dateKey,
        'Analogy, Coding-Decoding, Number Series, Letter Series, Odd One Out, Syllogism, Blood Relations, Mathematical Operations, Direction & Distance, Seating Arrangement, Order & Ranking, Dice, Missing Number, Mirror Image concept'
      ),
      generateSectionWithGemini(
        apiKey,
        'General Awareness (GK / GS)',
        25,
        dateKey,
        'Indian Polity & Constitution, Ancient/Medieval/Modern History, Indian Geography, Economics & RBI, Physics, Chemistry, Biology, Static GK (Classical Dances, Awards, Books, Sports, Festivals)'
      )
    ]);

    const payload = {
      dateKey,
      generatedAt: new Date().toISOString(),
      reasoning,
      gk
    };

    await saveToFirestore(dateKey, payload);
    return res.status(200).json({ ok: true, cached: false, ...payload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
