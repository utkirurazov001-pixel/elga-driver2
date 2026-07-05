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

// ---- T-14: YANGI BUYURTMA OVOZI — BOSHLASH/TO'XTATISH aniq boshqariladi ----
// Haydovchi ekranga qaramaydi — buyurtmani OVOZDAN biladi. Baland (volume=1.0),
// TAKRORLANADIGAN — LEKIN native `loop` EMAS. Native loop'да remove()'dan keyin ham
// ovoz davom etardi (accept/cancel/offline'да to'xtamas edi) va yangi taklifда
// ustma-ust chalinardi (DUBLIKAT). Endi: har o'ynash tugaganда O'ZIMIZ qayta
// o'ynaymiz (_orderStop bayrog'i bilan). stopOrderAlert() = bayroq + pause + remove:
// bir buyurtma = bir ovoz sessiyasi, DARROV to'xtaydi, dublikat yo'q.
let _orderPlayer = null;
let _orderStop = true;
export function stopOrderAlert() {
  _orderStop = true; // qayta o'ynash listeneri to'xtaydi
  if (_orderPlayer) {
    try { _orderPlayer.pause(); } catch (_) {}
    try { _orderPlayer.remove(); } catch (_) {}
    _orderPlayer = null;
  }
}
export function playOrderAlert(source) {
  stopOrderAlert();     // avvalgi sessiyani TO'LIQ to'xtatamiz — dublikat bo'lmaydi
  _orderStop = false;
  try {
    const p = createAudioPlayer(source);
    try { p.volume = 1.0; } catch (_) {}
    try {
      p.addListener('playbackStatusUpdate', (st) => {
        // Faqat SHU player hali faol va to'xtatilmagan bo'lsa qayta o'ynaymiz.
        if (st && st.didJustFinish && !_orderStop && _orderPlayer === p) {
          try { p.seekTo(0); p.play(); } catch (_) {}
        }
      });
    } catch (_) {}
    p.play();
    _orderPlayer = p;
    return true;
  } catch (e) {
    _orderPlayer = null;
    return false;
  }
}

// ---- T-17: HOLAT OVOZI (bir martalik) — admin yuklagan ovoz o'z holatда ----
// source: { uri } (admin ovozi, lokalga keshlangan) yoki null. Admin ovozi USTUN;
// bo'lmasa fallbackText TTS bilan aytiladi. Bir martalik (loop emas).
let _statusPlayer = null;
function stopStatusSound() { if (_statusPlayer) { try { _statusPlayer.remove(); } catch (_) {} _statusPlayer = null; } }
export function playStatusSound(source, fallbackText) {
  stopStatusSound();
  if (source) {
    try {
      const p = createAudioPlayer(source);
      try { p.volume = 1.0; } catch (_) {}
      try { p.addListener('playbackStatusUpdate', (st) => { if (st && st.didJustFinish) stopStatusSound(); }); } catch (_) {}
      p.play();
      _statusPlayer = p;
      return;
    } catch (e) { stopStatusSound(); }
  }
  if (fallbackText) speak(fallbackText); // zaxira: admin ovoz yo'q bo'lsa TTS
}
