# Performance profiling — past-quvvatli qurilmada (1GB RAM, Android 8, 2G)

Statik audit + optimizatsiyalar kiritildi. Endi **real qurilmada o'lchash** kerak,
chunki FPS/batareya faqat haqiqiy qurilmada aniq bo'ladi. Quyida aniq tartib.

## 0. Maqsadlar
| Metrika | Maqsad |
|---|---|
| O'rtacha FPS (xarita + safar) | ≥ 55 |
| Frame time | ≤ 16 ms (jank < 1%) |
| Sovuq ishga tushish (cold start) | ≤ 3 s (low-end) |
| RAM (faol safar) | ≤ 250 MB |
| Batareya (1 soat online, safarsiz) | ≤ 8% |

## 1. Test qurilmasi va build
- Qurilma: 1–2 GB RAM, Android 8/9 (masalan Samsung J/A seriyasi, Redmi 7A).
- **Release build** da o'lchang (dev build sekin — JS dev mode, bundler):
  ```bash
  eas build -p android --profile preview
  ```
- Tarmoqni cheklash: Android Dev Settings yoki router orqali 2G/3G; yoki
  Chrome DevTools "Slow 3G" (WebView qismi uchun).

## 2. FPS va frame time
- **Android GPU profiling:** Settings → Developer options → "Profile HWUI rendering" →
  "On screen as bars". Yashil chiziq (16ms) ustidagi ustunlar = jank.
- **Perf Monitor (dev build):** ilovada dev menu → "Show Perf Monitor" → JS/UI FPS.
- **Systrace / Perfetto:** chuqur tahlil uchun:
  ```bash
  npx react-native profile-hermes   # Hermes profil (agar Hermes yoqilgan bo'lsa)
  ```
- **Sentry Performance:** `tracesSampleRate` allaqachon yoqilgan — real foydalanuvchilarda
  sekin tranzaksiyalar ko'rinadi.

## 3. Tekshiriladigan ssenariylar (har birida FPS yozing)
1. Xarita ochiq, **safarsiz** (idle) — GPS endi ~20s da yangilanadi → re-render kam bo'lishi kerak.
2. **Faol safar** — GPS ~4s, `meter`/`wait_update` har 3-5s → marker silliq harakatlanishi kerak.
3. Buyurtma ro'yxati / tarix scroll.
4. Bildirishnoma + ovozli e'lon kelganda (audio dekod UI ni bloklamasligi kerak).
5. Internet uzilib-ulanganda (socket reconnect — duplicate event bo'lmasligi kerak).

## 4. Memory leak tekshiruvi
- Android Studio → **Profiler** → Memory → ilovani 10-15 daqiqa ishlating
  (bir necha safar oching/yoping). Grafik **doimiy o'smasligi** kerak (leak belgisi).
- Tekshirish: WebView, audio player (`expo-audio`), socket, timer/interval tozalanyaptimi.
  - `socket.removeAllListeners()` — ✅ kiritilgan
  - GPS watch `remove()` — ✅ `stopTracking()` da
  - audio `player.remove()` — ✅ `stopAnnPlayer()` da

## 5. Cold start
```bash
adb shell am start -W -n <package>/.MainActivity
# "TotalTime" qiymatini yozing
```
Hermes yoqilganligini tasdiqlang (`app.json` → `jsEngine: "hermes"`) — JS yuklash tezroq.

## 6. Natijalarni yozish (shablon)
```
Qurilma: __________  Android: ___  RAM: ___
Build: preview/release   Sana: ______

Idle FPS: ___    Faol safar FPS: ___    Scroll FPS: ___
Cold start: ___ ms    RAM (safar): ___ MB
Jank (>16ms frame %): ___
Topilgan muammolar:
  - ...
```

## 7. Agar jank topilsa — keyingi qadamlar
- Qaysi komponent re-render bo'layotganini aniqlang: `React DevTools → Profiler` (Highlight updates).
- Eng ko'p re-render bo'layotgan inline JSX ni alohida `React.memo` komponentga ajrating.
- Og'ir ro'yxatlar uchun `FlatList` + `getItemLayout` + `windowSize` sozlang.
- Katta JSON parse / route hisob-kitobni `InteractionManager.runAfterInteractions` ga qo'ying.
