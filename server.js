import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(express.static(path.join(here, 'public')));

const subjects = new Set(['General', 'Physics', 'Chemistry', 'Biology', 'Higher Math', 'English', 'Bangla', 'ICT', 'General Knowledge']);
const hasGemini = Boolean(process.env.GEMINI_API_KEY);
const hasGroq = Boolean(process.env.GROQ_API_KEY);

app.get('/api/health', (_req, res) => res.json({ ok: true, configured: hasGemini || hasGroq, providers: { gemini: hasGemini, groq: hasGroq } }));

function isRetryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function geminiAnswer({ prompt, image }) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = [{ text: prompt }];
  if (image) {
    const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
    if (!match) throw new Error('ছবির ফরম্যাট সঠিক নয়।');
    parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You are StudyMate AI, a friendly and accurate tutor for Bangladesh admission-test preparation. Explain step by step, show formulas and units where relevant, and clearly mark the final answer. For MCQs, state the correct option and briefly explain why. If the question is ambiguous or unreadable, ask for clarification rather than guessing. Be honest when uncertain.' }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 1400, temperature: 0.4 }
    }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Gemini request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
  if (!answer) throw new Error('Gemini থেকে উত্তর পাওয়া যায়নি।');
  return answer;
}

async function groqAnswer({ prompt, image }) {
  const model = image
    ? (process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b')
    : (process.env.GROQ_MODEL || 'openai/gpt-oss-20b');
  const content = [{ type: 'text', text: prompt }];
  if (image) content.push({ type: 'image_url', image_url: { url: image } });
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_completion_tokens: 1400, temperature: 0.4 }),
    signal: AbortSignal.timeout(45000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Groq request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('Groq থেকে উত্তর পাওয়া যায়নি।');
  return answer;
}

app.post('/api/chat', async (req, res) => {
  const { message, subject = 'General', language = 'both', image } = req.body ?? {};
  if ((!message || typeof message !== 'string' || !message.trim()) && !image) return res.status(400).json({ error: 'প্রশ্ন লিখুন অথবা একটি ছবি দিন।' });
  if (message && message.length > 12000) return res.status(413).json({ error: 'প্রশ্নটি একটু ছোট করে পাঠান।' });
  if (!subjects.has(subject)) return res.status(400).json({ error: 'বিষয়টি সঠিক নয়।' });
  if (image && (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > 9_000_000)) return res.status(400).json({ error: 'ছবিটি PNG, JPG বা WEBP হতে হবে এবং ৬ MB-এর কম হতে হবে।' });
  if (!hasGemini && !hasGroq) return res.status(503).json({ error: 'AI চালু করতে server-এর environment-এ Gemini অথবা Groq API key যোগ করতে হবে।' });

  const langRule = language === 'bn' ? 'Answer in clear Bangla.' : language === 'en' ? 'Answer in clear English.' : 'Answer in Bangla, and include important English terms in brackets when useful.';
  const prompt = `Subject: ${subject}. ${langRule}\n${message?.trim() || 'ছবির প্রশ্নটি পড়ে সমাধান করো।'}\nExplain the method step by step, show formulas and units where relevant, and clearly mark the final answer. For MCQs, state the correct option and briefly explain why; if choices are missing, say so. If the question is ambiguous or unreadable, ask for clarification rather than guessing. Help the student learn; do not claim guaranteed admission or perfect accuracy. Keep explanations age-appropriate.`;

  const providers = [];
  if (hasGemini) providers.push(['Gemini', geminiAnswer]);
  if (hasGroq) providers.push(['Groq', groqAnswer]);
  let lastError;
  for (const [name, call] of providers) {
    try {
      const answer = await call({ prompt, image });
      return res.json({ answer, provider: name });
    } catch (error) {
      lastError = error;
      console.error(`${name} provider error:`, error?.status || '', error?.message || 'request failed');
      // Switch to the backup for quota/rate-limit, transient server, timeout, and network failures.
      if (error?.status && !isRetryable(error.status)) continue;
    }
  }
  const status = lastError?.status === 429 ? 429 : 503;
  return res.status(status).json({ error: 'Gemini ও Groq—দুটির কোনোটিই এখন উত্তর দিতে পারছে না। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
});

app.get('/{*splat}', (_req, res) => res.sendFile(path.join(here, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`StudyMate AI running on port ${PORT}`));
