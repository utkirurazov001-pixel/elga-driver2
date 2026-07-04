// ─── Ovozli e'lonlar (TTS + backenddan boshqariladigan audio) ───
// Bu modul AppInner holatiga bog'liq emas. Modul yuklanganda audio rejimini
// sozlaydi va o'zbek ovozini keshlaydi.
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Ovozli e'lonlar telefon "jim" rejimida ham eshitilsin
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});

// expo-speech ovozini tabiiyroq qilish: qurilmada mavjud o'zbek ovozini
// tanlaymiz. undefined = hali tekshirilmagan, null = topilmadi.
let _uzVoice = undefined;
async function loadUzVoice() {
  if (_uzVoice !== undefined) return _uzVoice;
  _uzVoice = null;
  try {
    const voices = (await Speech.getAvailableVoicesAsync()) || [];
    const uz = voices.find((v) => /^uz/i.test(v.language || ''))
            || voices.find((v) => /uzbek/i.test(v.name || ''));
    if (uz?.identifier) _uzVoice = uz.identifier;
  } catch (_) {}
  return _uzVoice;
}
loadUzVoice(); // startupda keshlab qo'yamiz

// O'zbek tilida ovozli e'lon (expo-speech) — tabiiyroq sozlamalar bilan
export function speak(text) {
  try {
    Speech.stop();
    const opts = { language: 'uz-UZ', rate: 0.9, pitch: 1.03 };
    if (_uzVoice) opts.voice = _uzVoice;
    Speech.speak(String(text || ''), opts);
  } catch (e) {}
}

// ---- Backenddan boshqariladigan ovoz ----
// Server e'lon uchun audio URL bersa (super-admin tabiiy ovoz yozib qo'yadi)
// — shuni o'ynaymiz; bo'lmasa yoki xato bo'lsa TTS bilan gapiramiz.
let _annPlayer = null;
function stopAnnPlayer() {
  if (_annPlayer) { try { _annPlayer.remove(); } catch (_) {} _annPlayer = null; }
}
function playAnnouncementAudio(url) {
  // true = audio o'ynay boshladi; false = TTS'ga qaytamiz
  try {
    if (typeof url !== 'string' || !url.trim()) return false;
    stopAnnPlayer();
    const player = createAudioPlayer({ uri: url.trim() });
    _annPlayer = player;
    try {
      player.addListener('playbackStatusUpdate', (st) => {
        if (st?.didJustFinish) stopAnnPlayer();
      });
    } catch (_) {}
    player.play();
    return true;
  } catch (e) {
    stopAnnPlayer();
    return false;
  }
}

// Asosiy e'lon funksiyasi: audioUrl bo'lsa audio, bo'lmasa TTS.
export function announce(text, audioUrl) {
  if (!playAnnouncementAudio(audioUrl)) speak(text);
}

// ---- T-07: YANGI BUYURTMA OVOZI (haydovchi mashina haydayotgan bo'lsa ham eshitsin) ----
// Haydovchi ekranga qaramaydi — buyurtmani OVOZDAN biladi. Shuning uchun:
//   • BALAND (volume=1.0),
//   • TAKRORLANADIGAN (loop) — haydovchi javob berguncha yoki TTL tugagunca,
//   • telefon "jim" rejimida ham (setAudioModeAsync playsInSilentMode yuqorida).
// source: { uri } (admin yuklagan ovoz, lokalga keshlangan) YOKI require() bilan
// kelgan ilova ichidagi zaxira asset (admin ovoz bermasa — doim ishlaydi).
let _orderPlayer = null;
export function stopOrderAlert() {
  if (_orderPlayer) { try { _orderPlayer.remove(); } catch (_) {} _orderPlayer = null; }
}
export function playOrderAlert(source) {
  stopOrderAlert();
  try {
    const p = createAudioPlayer(source);
    try { p.volume = 1.0; } catch (_) {}
    try { p.loop = true; } catch (_) {}   // haydovchi javob bergunca takrorlanadi
    p.play();
    _orderPlayer = p;
    return true;
  } catch (e) {
    _orderPlayer = null;
    return false;
  }
}
