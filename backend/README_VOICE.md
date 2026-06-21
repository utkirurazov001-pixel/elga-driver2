# AI Ovozli Buyurtma — backend integratsiyasi

Bu papka **mijoz ilovasidagi** AI ovozli buyurtma uchun backend endpointini o'z ichiga oladi.
Fayllarni **`elga-backend`** (api.elga.uz) loyihasiga ko'chiring.

## Oqim

```
Mijoz ilovasi (elga-mijoz)
  │  audio (base64 data-URL)  ──POST /api/voice/parse──►  elga-backend
  │                                                          │
  │                                          Whisper STT (nutq -> matn)
  │                                                          │
  │                                          Claude haiku-4-5 (matn -> JSON)
  │  ◄──────  { ok, transcript, parsed }  ──────────────────┘
  │
  ├─ parsed.destination_text -> joy qidiruvi -> koordinata
  ├─ pickup = CURRENT_LOCATION -> GPS
  └─ tasdiqlash ekrani -> buyurtma yaratish
```

## 1. Paketlar

```bash
npm install @anthropic-ai/sdk
# Node 18+ kerak (global fetch / FormData / Blob — Whisper STT uchun)
```

## 2. ENV o'zgaruvchilari

```
ANTHROPIC_API_KEY=sk-ant-...     # Claude (matn -> JSON tahlil)
OPENAI_API_KEY=sk-...            # Whisper STT (nutq -> matn)
# Ixtiyoriy:
VOICE_AI_MODEL=claude-haiku-4-5  # default
VOICE_STT_MODEL=whisper-1        # default
```

> **Eslatma:** Claude audioni transkripsiya qilmaydi — shuning uchun STT (nutq→matn)
> alohida provayder (Whisper) orqali bajariladi. Default OpenAI `whisper-1`.
> Boshqa STT (Google Speech, Groq, self-hosted faster-whisper) ishlatmoqchi bo'lsangiz,
> faqat `voiceParse.js` dagi `transcribeAudio()` funksiyasini almashtiring.

## 3. Route'ni ulash (Express)

```js
const { voiceParseHandler } = require('./voiceParse');

// Mavjud auth middleware'dan KEYIN — faqat login bo'lgan mijoz chaqira olsin.
// express.json limitini oshiring (audio base64 katta bo'lishi mumkin).
app.use('/api/voice', express.json({ limit: '15mb' }));
app.post('/api/voice/parse', authMiddleware, voiceParseHandler);
```

## 4. Javob formati

```json
{
  "ok": true,
  "transcript": "Meni Muzrabot bozoriga olib boring",
  "parsed": {
    "pickup_text": "CURRENT_LOCATION",
    "destination_text": "Muzrabot bozori",
    "pickup_known": true,
    "destination_known": true,
    "notes": "",
    "confidence": 0.98,
    "needs_clarification": false,
    "clarification_question": ""
  }
}
```

## 5. Frontend (allaqachon tayyor)

`elga-mijoz/App.js` `parseVoiceAndFill()` shu endpointga audio yuboradi va
`parsed` asosida manzilni avto-to'ldiradi. Endpoint hali yo'q bo'lsa (404),
ilova eski oqimga qaytadi (haydovchi ovozni eshitadi) — nol regressiya.

## Model tanlovi

`claude-haiku-4-5` — bu ajratish (extraction) vazifasiga arzon va tez, ideal.
Aniqlik kamlik qilsa `VOICE_AI_MODEL=claude-opus-4-8` ga o'zgartiring.
