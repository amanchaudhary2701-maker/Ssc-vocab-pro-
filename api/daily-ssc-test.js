// Vercel Serverless Function + Daily 9:00 AM IST Cron (03:30 UTC)
// Generates 25 Reasoning (Easy/Moderate/Hard mix + 6 Non-Verbal SVG Figures)
// + 25 GK/GS (Easy/Moderate/Hard mix + 6-7 Latest 6-Month / Latest-Year Current Affairs)
// via Free Gemini API and saves to Firebase Firestore: daily_ssc_full_tests/{YYYY-MM-DD}

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

async function generateSectionWithGemini(apiKey, sectionName, count, dateKey, topicsHint, includeSvgHint) {
  const prompt = `You are a senior SSC CGL/CHSL/CPO Tier-1 Eduquity paper setter.
Generate exactly ${count} fresh, 100% factually/mathematically verified ${sectionName} MCQ questions for exam date ${dateKey}.

STRICT DIFFICULTY MIX (must include all 3 levels):
- 9 Easy questions ("level": "Easy")
- 11 Moderate questions ("level": "Moderate")
- 5 Hard questions ("level": "Hard")

QUESTION TYPES & TOPICS TO COVER EVENLY:
${topicsHint}
${includeSvgHint ? `
NON-VERBAL VISUAL FIGURE REQUIREMENT:
- At least 5 questions MUST be visual figure questions (Counting Triangles/Squares, Dice Opposite Faces, Venn Diagram with numbers, Mirror Image, Paper Folding, or Figure Rotation Series).
- For every visual question, include a clean, self-contained inline "<svg viewBox='0 0 260 130' width='260' height='130'>...</svg>" string in the "svg" field (simple crisp geometric shapes/lines/text, no scripts, dark stroke #1e293b on light background). For non-visual questions, set "svg": "".` : ''}

RULES:
1. Every question MUST be Bilingual: "qEn" (clear English) AND "qHi" (natural Hindi in Devanagari).
2. Exactly 4 distinct options in "options" array.
3. "ans" MUST be the 0-based integer index (0, 1, 2, or 3) of the single verified correct option.
4. "exp" MUST be a clear step-by-step best solution + exam shortcut/fact.
5. "topic" MUST be a short 1-3 word topic tag, and "level" MUST be "Easy", "Moderate", or "Hard".
Return ONLY valid JSON: {"items":[{"topic":"...","level":"Easy|Moderate|Hard","qEn":"...","qHi":"...","svg":"","options":["...","...","...","..."],"ans":0,"exp":"..."}]}`;

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
      return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY is not set in Vercel Environment Variables.' });
    }

    const [reasoning, gk] = await Promise.all([
      generateSectionWithGemini(
        apiKey,
        'General Intelligence & Reasoning',
        25,
        dateKey,
        'Number Series (Easy & Hard double-diff), Letter Series, Coding-Decoding, Word & Number Analogy, Odd One Out, Syllogism (2 & 3 statements), Blood Relations (coded & pointing), Mathematical Operations, Direction & Distance, Seating Arrangement (Linear/Circular), Order & Ranking, Statement & Conclusion, Counting Figures (with SVG), Dice Opposite Faces (with SVG), Venn Diagram (with SVG), Mirror/Water Image (with SVG), Paper Folding (with SVG), Figure Rotation Series (with SVG)',
        true
      ),
      generateSectionWithGemini(
        apiKey,
        'General Awareness (Hard Mixed Multi-Statement, Match-Pairs, Conceptual GS + Latest Current Affairs — NEVER mention any exam name like UPSC, SSC, Railway, CGL, NTPC in questions/options/explanations)',
        25,
        dateKey,
        `MANDATORY MIX FOR SSC TIER-1:
- 6 to 7 LATEST CURRENT AFFAIRS questions (covering the last 6 months & latest year relative to ${dateKey}: Union Budget & Govt Schemes, Major National/International Appointments, Sports Winners, Padma/Nobel/National Awards, ISRO/DRDO Missions, Summits & Global Indices).
- 18 to 19 CORE GS & STATIC GK questions across Indian Polity, Ancient/Medieval/Modern History, Geography, Economics, Physics, Chemistry, Biology & Static GK.
- DIFFICULTY TYPES: 9 Easy (direct factual), 11 Moderate (multi-statement / chronological / scheme details), 5 Hard (Assertion-Reason / Match-the-Following / deep constitutional or scientific concepts).`,
        false
      )
    ]);

    const payload = { dateKey, generatedAt: new Date().toISOString(), reasoning, gk };
    await saveToFirestore(dateKey, payload);
    return res.status(200).json({ ok: true, cached: false, ...payload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
