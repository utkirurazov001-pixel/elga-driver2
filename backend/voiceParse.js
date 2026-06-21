// ============================================================
//  ELGA TAXI — AI Ovozli Buyurtma backend moduli
//  POST /api/voice/parse
//  Oqim:  audio (base64 data-URL)  ->  Whisper STT (matn)
//         ->  Claude (claude-haiku-4-5) tahlil  ->  JSON
//
//  Bu fayl elga-backend (api.elga.uz) ichiga qo'shilishi kerak.
//  Integratsiya: README_VOICE.md ga qarang.
//
//  ENV:
//    ANTHROPIC_API_KEY   — Claude (matn -> JSON tahlil)
//    OPENAI_API_KEY      — Whisper STT (nutq -> matn). Boshqa STT bilan
//                          almashtirilishi mumkin (transcribeAudio funksiyasi).
//    VOICE_STT_MODEL     — ixtiyoriy, default "whisper-1"
//    VOICE_AI_MODEL      — ixtiyoriy, default "claude-haiku-4-5"
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY env'dan o'qiladi
const AI_MODEL = process.env.VOICE_AI_MODEL || 'claude-haiku-4-5';
const STT_MODEL = process.env.VOICE_STT_MODEL || 'whisper-1';

// Surxondaryo hududlari va umumiy joy turlari — AI shularni tanishi kerak.
const SYSTEM_PROMPT = `Sen ELGA TAXI ilovasining ovozli buyurtma tahlilchisisan.
Foydalanuvchining o'zbekcha (sheva/og'zaki nutq ham) gapidan taksi buyurtmasini ajratasan.

FAQAT JSON qaytar. Hech qanday izoh, markdown yoki qo'shimcha matn YO'Q.

Maydonlar:
- pickup_text: qayerdan. Agar aytilmasa "CURRENT_LOCATION".
- destination_text: qayerga (asosiy maqsad).
- pickup_known: pickup aniqmi (CURRENT_LOCATION ham aniq hisoblanadi -> true).
- destination_known: destination aniq, bitta joymi.
- notes: qo'shimcha izohlar (masalan "tezroq", "yuk bor").
- confidence: 0..1 ishonch darajasi.
- needs_clarification: manzil noaniq bo'lsa true.
- clarification_question: noaniq bo'lsa o'zbekcha aniqlashtiruvchi savol, aks holda "".

QOIDALAR:
1) Faqat manzil aytilsa: pickup = CURRENT_LOCATION, destination = aytilgan joy.
2) Ikki manzil aytilsa: pickup va destination ikkalasi to'ldiriladi.
3) Manzil noaniq bo'lsa (masalan shunchaki "bozor", "maktab"): needs_clarification = true,
   clarification_question to'ldiriladi (masalan "Qaysi bozorga bormoqchisiz?").
4) Joylashuv aytilmasa pickup = CURRENT_LOCATION.
5) Hududlarni tani: Termiz, Muzrabot, Angor, Sherobod, Jarqo'rg'on, Denov, Boysun,
   Qumqo'rg'on, Sariosiyo, Uzun, Sho'rchi, Oltinsoy. Hamda umumiy joylar:
   Aeroport, Temir yo'l vokzali, Bozor, Kasalxona, Maktab, Universitet, Mahalla, Ko'cha.
6) Imlo xatolarini to'g'rila: "muzrabot"->"Muzrabot", "termz"->"Termiz",
   "sherbot"->"Sherobod".
7) Sheva/og'zaki nutqni tushun: "tashab qo'ying", "taksi kere", "obor", "ketaman".

MISOL INPUT: "Meni Muzrabot bozoriga olib boring"
MISOL OUTPUT: {"pickup_text":"CURRENT_LOCATION","destination_text":"Muzrabot bozori","pickup_known":true,"destination_known":true,"notes":"","confidence":0.98,"needs_clarification":false,"clarification_question":""}

MISOL INPUT: "Meni bozorga olib boring"
MISOL OUTPUT: {"pickup_text":"CURRENT_LOCATION","destination_text":"Bozor","pickup_known":true,"destination_known":false,"notes":"","confidence":0.54,"needs_clarification":true,"clarification_question":"Qaysi bozorga bormoqchisiz?"}`;

// Strukturalangan chiqish sxemasi — Claude aynan shu shaklda JSON qaytaradi.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pickup_text: { type: 'string' },
    destination_text: { type: 'string' },
    pickup_known: { type: 'boolean' },
    destination_known: { type: 'boolean' },
    notes: { type: 'string' },
    confidence: { type: 'number' },
    needs_clarification: { type: 'boolean' },
    clarification_question: { type: 'string' },
  },
  required: [
    'pickup_text', 'destination_text', 'pickup_known', 'destination_known',
    'notes', 'confidence', 'needs_clarification', 'clarification_question',
  ],
};

// data:audio/...;base64,XXXX  ->  { buffer, mime, ext }
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) {
    // Prefiks bo'lmasa ham xom base64 deb qabul qilamiz (default m4a)
    if (/^[A-Za-z0-9+/=\s]+$/.test(dataUrl) && dataUrl.length > 64) {
      return { buffer: Buffer.from(dataUrl, 'base64'), mime: 'audio/m4a', ext: 'm4a' };
    }
    return null;
  }
  const mime = m[1].toLowerCase();
  let ext = mime.split('/')[1] || 'm4a';
  ext = ext.replace('mpeg', 'mp3').replace('x-m4a', 'm4a').replace('mp4', 'm4a');
  return { buffer: Buffer.from(m[2], 'base64'), mime, ext };
}

// Nutqni matnga aylantirish (Whisper). Node 18+ global fetch/FormData/Blob.
// Boshqa STT (Google, faster-whisper, Groq) bilan almashtirmoqchi bo'lsangiz —
// faqat shu funksiyani o'zgartiring; qolgan oqim tegmaydi.
async function transcribeAudio({ buffer, ext }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY (Whisper STT) sozlanmagan');
  const form = new FormData();
  form.append('file', new Blob([buffer]), `voice.${ext}`);
  form.append('model', STT_MODEL);
  form.append('language', 'uz'); // o'zbek tili
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`STT xato ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.text || '').trim();
}

// Matnni Claude bilan JSON'ga tahlil qilish.
async function parseTranscript(transcript) {
  const resp = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [{ role: 'user', content: transcript }],
  });
  // output_config.format tufayli javob — sxemaga mos JSON matn.
  const textBlock = (resp.content || []).find((b) => b.type === 'text');
  const raw = textBlock ? textBlock.text : '{}';
  return JSON.parse(raw);
}

// Express route handler. Mavjud autentifikatsiya middleware'ingizdan keyin ulang.
async function voiceParseHandler(req, res) {
  try {
    const audio = req.body && req.body.audio;
    const parsedAudio = parseDataUrl(audio);
    if (!parsedAudio) {
      return res.status(400).json({ ok: false, error: 'audio (base64) yuborilmadi' });
    }
    const transcript = await transcribeAudio(parsedAudio);
    if (!transcript) {
      return res.json({
        ok: true,
        transcript: '',
        parsed: {
          pickup_text: 'CURRENT_LOCATION', destination_text: '',
          pickup_known: true, destination_known: false,
          notes: '', confidence: 0, needs_clarification: true,
          clarification_question: 'Eshitilmadi. Iltimos, qayta gapiring.',
        },
      });
    }
    const parsed = await parseTranscript(transcript);
    return res.json({ ok: true, transcript, parsed });
  } catch (e) {
    console.warn('[voice/parse]', e && e.message);
    return res.status(500).json({ ok: false, error: 'Ovozni tahlil qilib bo\'lmadi' });
  }
}

module.exports = { voiceParseHandler, transcribeAudio, parseTranscript, SYSTEM_PROMPT };
