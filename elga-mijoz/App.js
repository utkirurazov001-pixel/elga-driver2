// ============================================================
//  ELGA Mijoz — taksi chaqirish ilovasi (React Native / Expo)
//  Xarita: OpenStreetMap (Leaflet WebView)
//  Server: https://api.elga.uz
// ============================================================
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal, Linking, FlatList,
  Animated, Easing, Image, Dimensions, AppState, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
// expo-updates: Expo Go muhitida ishlatilmaydi (OTA faqat standalone APK uchun)
import { WebView } from 'react-native-webview';
import { io } from 'socket.io-client';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';

// ─── Ajratilgan modullar ───
import { fmt, fmtPhone } from './src/utils';
import { mapHTML } from './src/mapHtml';
import { captureException } from './src/crash';

const BASE = 'https://api.elga.uz';

// Faol (tugamagan) buyurtma holatlari — bularda buyurtma "tirik" hisoblanadi.
// completed/cancelled/paid — yakuniy holatlar (faol emas).
const ACTIVE_STATUSES = ['searching', 'assigned', 'accepted', 'arrived', 'in_progress'];

// Faol buyurtma lokal saqlanadigan kalit (crash/kill/OS-restart'da yo'qolmaydi).
const ACTIVE_ORDER_KEY = 'ACTIVE_ORDER';

// Ixtiyoriy NetInfo — internet qaytishini tez aniqlash uchun. Standalone (EAS) buildda
// to'liq ishlaydi; Expo Go yoki modul o'rnatilmagan bo'lsa xavfsiz o'tkazib yuboriladi
// (ilova qulamaydi — AppState + socket reconnect baribir holatni tiklaydi).
let NetInfo = null;
try { NetInfo = require('@react-native-community/netinfo').default; } catch (e) { NetInfo = null; }

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

// ============================================================
//  TARMOQ QATLAMI — zaif/uzilgan internetga chidamli (haydovchi ilovasi bilan bir xil)
//  • deviceId / requestId / Idempotency-Key — takror so'rovlardan himoya
//  • avtomatik qayta urinish (exponential backoff): 1s → 2s → 4s
//  • global onlayn/oflayn holat (NetMonitor) — UI banner shu yerga obuna
//  Sof JS — yangi native modul yo'q, OTA orqali yetkaziladi.
// ============================================================

// Soda UUID — crypto.randomUUID bo'lmagan RN muhitida ham ishlaydi
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Qurilma identifikatori — bir marta yaratiladi va saqlanadi (duplicate himoyasi)
let _deviceId = null;
async function getDeviceId() {
  if (_deviceId) return _deviceId;
  try {
    let id = await AsyncStorage.getItem('device_id');
    if (!id) { id = uuid(); await AsyncStorage.setItem('device_id', id); }
    _deviceId = id;
  } catch (e) { _deviceId = uuid(); }
  return _deviceId;
}

// Global tarmoq holati — UI shu yerga obuna bo'lib bannerni ko'rsatadi
const NetMonitor = {
  online: true,
  _subs: new Set(),
  set(v) {
    if (this.online === v) return;
    this.online = v;
    this._subs.forEach((fn) => { try { fn(v); } catch (e) {} });
  },
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// /health ni yengil so'rov bilan tekshirish (reachability probe)
async function pingHealth(timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + '/health', { method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch (e) {
    clearTimeout(timer);
    return false;
  }
}

async function api(path, method = 'GET', body = null, token = null, timeoutMs = 15000, opts = {}) {
  // opts: { retries, idempotencyKey, deviceId }
  // GET — idempotent, xavfsiz qayta urinadi. POST faqat idempotencyKey berilsa qayta
  // urinadi (server idempotency middleware / holat-tekshiruvi dubldan himoya qiladi).
  const isGet = method === 'GET';
  const maxRetries = opts.retries != null
    ? opts.retries
    : (isGet || opts.idempotencyKey ? 2 : 0);

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const did = opts.deviceId || _deviceId;
  if (did) headers['X-Device-Id'] = did;
  headers['X-Request-Id'] = uuid();
  headers['X-Client-Ts'] = String(Date.now());
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Sekin/uzilgan internetda so'rov cheksiz osilib qolmasin — timeout (ilova qotmaydi)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(BASE + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastErr = new Error(e.name === 'AbortError' ? "Internet sekin — qayta urinilmoqda" : "Ulanish yo'q — internetni tekshiring");
      lastErr.network = true;
      if (attempt < maxRetries) { await sleep(Math.min(8000, 1000 * Math.pow(2, attempt))); continue; }
      NetMonitor.set(false);
      throw lastErr;
    }
    clearTimeout(timer);
    NetMonitor.set(true);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Xato: ' + res.status);
      err.data = data; err.status = res.status;
      throw err;
    }
    return data;
  }
  throw lastErr || new Error('Tarmoq xatosi');
}

// fmt, fmtPhone — ./src/utils dan import qilinadi

// To'lov usuli ikonkalari
const PAY_ICONS = { cash: '💵', click: '🔵', payme: '🟢', card: '💳' };

// Tab panelining tizim navigatsiyasidan tashqari balandligi (safe-area pastdan qo'shiladi)
const TABBAR_H = 56;
// Ekran balandligi — pastdan ko'tariladigan sheet'larni cheklash uchun
const SCREEN_H = Dimensions.get('window').height;

// Mijoz balansi 0 yoki manfiy bo'lsa "Balans" blokini umuman yashirish
const HIDE_BALANCE_IF_NONPOSITIVE = true;

// Mashina klasslari (backend config bilan mos)
const CAR_CLASSES = [
  {
    id: 'ekonom', label: 'Tejamkor', seats: 4,
    color: '#3B82F6', badge: 'Mashhur',
    models: 'Cobalt · Spark · Gentra',
    features: ['A/C', 'Arzon narx'],
    icon: '🚗',
  },
  {
    id: 'komfort', label: 'Comfort', seats: 4,
    color: '#22C55E', badge: null,
    models: 'Nexia 3 · Lacetti · Tracker',
    features: ['A/C', 'USB', 'Keng salon'],
    icon: '🚙',
  },
  {
    id: 'oila', label: 'Oila', seats: 6,
    color: '#A855F7', badge: null,
    models: 'Damas · Orlando · Zafira',
    features: ['6 o\'rinli', 'Katta yuk'],
    icon: '🚐',
  },
  {
    id: 'ekspress', label: 'Ekspress', seats: 4,
    color: '#FFC700', badge: 'Premium',
    models: 'Malibu · Camry · Sonata',
    features: ['Tez topish', 'VIP'],
    icon: '⚡',
  },
  {
    id: 'yuk', label: 'Yuk tashish', seats: 2,
    color: '#F97316', badge: null,
    models: 'GAZelle · Porter · Sprinter',
    features: ['Katta yuk', 'Ko\'chirish'],
    icon: '🚚',
  },
];

// Bekor qilish sabablari
const CANCEL_REASONS = [
  'Haydovchi uzoq kutdirdi',
  'Boshqa transport topdim',
  'Manzilni xato belgiladim',
  'Rejam o\'zgardi',
  'Haydovchi javob bermayapti',
];

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=uz`,
      { headers: { 'User-Agent': 'ELGA-Taxi/1.0' } }
    );
    const d = await r.json();
    if (d.display_name) {
      // Qisqa format: ko'cha + shahar
      const a = d.address || {};
      return [a.road || a.street || a.pedestrian, a.city || a.town || a.village || a.county]
        .filter(Boolean).join(', ') || d.display_name.split(',').slice(0, 2).join(', ');
    }
  } catch (_) {}
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}


// ---- Crash / xato monitoringi ----
// reportCrash: backendga (mavjud bo'lsa) + Sentry'ga (DSN berilgan bo'lsa) yuboradi.
// Global handler async/timer/socket ichidagi fatal JS xatolarni ushlaydi.
let _lastCrashTs = 0;
function reportCrash(kind, error, stack) {
  try {
    const now = Date.now();
    if (now - _lastCrashTs < 3000) return; // spamga qarshi throttle
    _lastCrashTs = now;
    captureException(error || new Error(String(stack || kind)), { kind }); // Sentry (DSN bo'lsa)
    const payload = {
      kind,
      message: String(error?.message || error || 'unknown'),
      stack: String(error?.stack || stack || '').slice(0, 4000),
      platform: Platform.OS,
      ts: new Date().toISOString(),
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    fetch(`${BASE}/api/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).catch(() => {}).finally(() => clearTimeout(t));
  } catch (e) {}
}

(function installGlobalErrorHandler() {
  try {
    const g = global;
    if (g.__elgaErrHandlerInstalled || !g.ErrorUtils?.getGlobalHandler) return;
    g.__elgaErrHandlerInstalled = true;
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((error, isFatal) => {
      console.warn('[GlobalError]', isFatal ? 'FATAL' : 'non-fatal', error?.message);
      reportCrash(isFatal ? 'fatal' : 'error', error);
      if (typeof prev === 'function') prev(error, isFatal);
    });
  } catch (e) {}
})();

// ErrorBoundary — render xatosi (masalan buyurtma obyektida noto'g'ri maydon)
// butun ilovani OQ EKRANga aylantirib qulatmasin. "Qayta urinish" tugmasi ko'rsatiladi.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) {
    console.warn('[ErrorBoundary]', error?.message, info?.componentStack);
    reportCrash('render', error, info?.componentStack);
  }
  reset = () => this.setState({ hasError: false });
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>⚠️</Text>
          <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
            Kutilmagan xatolik
          </Text>
          <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            Ilova qayta ishga tushirilmoqda. Buyurtmalaringiz saqlanib qoladi.
          </Text>
          <TouchableOpacity
            onPress={this.reset}
            style={{ backgroundColor: YELLOW, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}
            activeOpacity={0.85}>
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Qayta urinish</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

// ===== ELGA brend wordmark (matn asosida — qo'shimcha paketsiz) =====
// EL → sariq, GA → oq, TAXI → sariq (brend spetsifikatsiyasi)
const CAR_CLASS_ICONS = {
  ekonom: 'car-outline',
  komfort: 'car-sport-outline',
  oila: 'bus-outline',
  ekspress: 'flash-outline',
  yuk: 'cube-outline',
};
function CarClassIcon({ c, size = 56, active, image }) {
  const color = active ? c.color : (c.color + 'BB');
  // Admin paneldan rasm yuklangan bo'lsa — haqiqiy mashina rasmini ko'rsatamiz
  if (image) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: active ? 2 : 0, borderColor: color }}>
          <Image source={{ uri: image }} style={{ width: size * 0.86, height: size * 0.86, borderRadius: size / 2 }} resizeMode="cover" />
        </View>
      </View>
    );
  }
  const iconName = active
    ? (CAR_CLASS_ICONS[c.id] || 'car-outline').replace('-outline', '')
    : (CAR_CLASS_ICONS[c.id] || 'car-outline');
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={iconName} size={Math.round(size * 0.48)} color={color} />
      </View>
    </View>
  );
}

function ElgaLogo({ size = 56, tagline = false }) {
  const tx = Math.round(size * 0.32);
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: size, fontWeight: '800', letterSpacing: -size * 0.02, lineHeight: size * 1.05 }}>
        <Text style={{ color: YELLOW }}>EL</Text>
        <Text style={{ color: WHITE }}>GA</Text>
      </Text>
      <Text style={{ color: YELLOW, fontSize: tx, fontWeight: '800', letterSpacing: tx * 0.5, marginTop: -size * 0.08 }}>
        TAXI
      </Text>
      {tagline && (
        <Text style={{ color: GRAY1, fontSize: Math.max(10, size * 0.18), fontWeight: '600', letterSpacing: 2, marginTop: 8 }}>
          XIZMAT OLIY HIMMAT
        </Text>
      )}
    </View>
  );
}

// Boot ekrani uchun: logo yumshoq paydo bo'lib, sekin nafas oladi (juda yengil).
function BootLogo() {
  const a = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  const scale = Animated.add(
    a.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }),
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0, 0.025] }),
  );
  return (
    <Animated.View style={{ opacity: a, transform: [{ scale }] }}>
      <ElgaLogo size={72} tagline />
    </Animated.View>
  );
}

// ClientMap — xaritani AppInner ning yuqori chastotali qayta-renderlaridan ajratamiz.
// driver_location (har ~2 sek), order_update, meter holatlari tez-tez yangilanadi va
// har safar butun daraxtni qayta render qilib, WebView elementini ham qayta moslashtirardi.
// React.memo + forwardRef bilan barqaror proplar (source/style/onMessage) berib,
// xarita ostki daraxti bu yangilanishlarda QAYTA RENDER BO'LMAYDI. Xarita imperativ
// injectJavaScript (pushMap) orqali yangilanishda davom etadi.
const ClientMap = React.memo(React.forwardRef(function ClientMap({ source, style, onMessage }, ref) {
  return (
    <WebView
      ref={ref}
      style={style}
      originWhitelist={['*']}
      source={source}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}));

function AppInner() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  // Login
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState('phone');
  const [regToken, setRegToken] = useState(null);
  const [loading, setLoading] = useState(false);

  // PIN
  const [pinStep, setPinStep] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [storedPin, setStoredPin] = useState(null);

  // Asosiy
  const [tab, setTab] = useState('order');
  const [myLoc, setMyLoc] = useState(null);

  // Yangi buyurtma oqimi: 'dest' → 'confirm' → 'tariff' → null (buyurtma ketdi)
  const [orderStep, setOrderStep] = useState('dest');
  const [pickup, setPickup] = useState(null);   // { lat, lng, address }
  const [dest, setDest] = useState(null);        // { lat, lng, address }
  const [searchOpen, setSearchOpen] = useState(false); // "Qayerga?" qidiruv oynasi ochiqmi

  // Safar davomida manzilni o'zgartirish (narx qayta hisoblanadi)
  const [changeDestModal, setChangeDestModal] = useState(false);
  const [cdQ, setCdQ] = useState('');
  const [cdResults, setCdResults] = useState([]);

  // Tez kirish joylari
  const [homePlace, setHomePlace] = useState(null); // { lat, lng, address }
  const [workPlace, setWorkPlace] = useState(null);
  const [recentPlaces, setRecentPlaces] = useState([]); // oxirgi 5 ta noyob to_address

  const [estimates, setEstimates] = useState({});
  const [estLoading, setEstLoading] = useState(false);
  const estCacheKey = useRef(null);
  const [order, setOrder] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [carClass, setCarClass] = useState('ekonom');
  const [payMethod, setPayMethod] = useState('cash');
  const [payMethods, setPayMethods] = useState([{ id: 'cash', name: 'Naqd', active: true }]);
  // Admin paneldan boshqariladigan tarif rasmlari: { ekonom: 'data:image/...', ... }
  const [carImages, setCarImages] = useState({});

  // Modallar
  const [cancelModal, setCancelModal] = useState(false);
  const [customReason, setCustomReason] = useState('');
  const [rateModal, setRateModal] = useState(false);
  const [rateOrderId, setRateOrderId] = useState(null);
  const [completedOrder, setCompletedOrder] = useState(null); // yakunlangan safar tafsiloti
  const [stars, setStars] = useState(5);
  const [tipAmount, setTipAmount] = useState(0);

  // In-trip chat
  const [tripChatModal, setTripChatModal] = useState(false);
  const [tripChat, setTripChat] = useState([]);
  const [tripChatInput, setTripChatInput] = useState('');

  // SOS modal
  const [sosModal, setSosModal] = useState(false);

  // 🎙 Ovozli buyurtma (AI/hisoblagich) — mijoz manzilni gapirib aytadi, haydovchi eshitadi
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [voiceModal, setVoiceModal] = useState(false); // ovoz yozish oynasi ochiqmi
  const [recording, setRecording] = useState(false);   // hozir yozilyaptimi
  const [voiceSec, setVoiceSec] = useState(0);          // yozilgan soniya (taymer)
  const voiceTimer = useRef(null);
  const recordingRef = useRef(false);                   // tez bosishda holat poygasiga qarshi
  // AI ovozli buyurtma (nutq -> matn -> AI -> manzil avto-to'ldirish)
  const [voiceParsing, setVoiceParsing] = useState(false);   // AI tahlil qilyaptimi
  const [voiceClarify, setVoiceClarify] = useState('');      // aniqlashtirish savoli (noaniq manzil)
  const [voiceHeard, setVoiceHeard] = useState('');          // AI eshitgan matn (transcript)

  // Arrived bildirishnomasi bir marta chiqsin
  const arrivedNotified = useRef(false);

  // Qidiruv
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Tarix / profil / chat
  const [trips, setTrips] = useState([]);
  // Tarix ro'yxatini kunlar bo'yicha guruhlash — faqat trips o'zgarganda
  // qayta hisoblanadi (avval har render'da, GPS tick'larida ham qayta
  // hisoblanib ilovani sekinlashtirardi).
  const groupedTrips = useMemo(() => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    let lastDay = null;
    const result = [];
    trips.forEach(t => {
      const d = new Date(t.created_at).toDateString();
      if (d !== lastDay) {
        lastDay = d;
        result.push({
          type: 'header',
          label: d === today ? 'BUGUN' : d === yesterday ? 'KECHA' : new Date(t.created_at).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long' })
        });
      }
      result.push({ type: 'trip', item: t });
    });
    return result;
  }, [trips]);
  const [balance, setBalance] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // New state: favorites, popular places, pin animation
  const [favorites, setFavorites] = useState([]);
  const [popularPlaces, setPopularPlaces] = useState([]);
  const [placeEst, setPlaceEst] = useState({}); // qidiruv qatorlari uchun narx: "lat,lng" -> { price, duration_min }
  const pinAnim = useRef(new Animated.Value(0)).current;

  // 🔴 Jonli taximetr (hisoblagich/metered buyurtmalar)
  const [liveKm, setLiveKm] = useState(0);
  const [liveFare, setLiveFare] = useState(0);
  const [liveMin, setLiveMin] = useState(0);
  // 🔴 Jonli kutish haqi (arrived holat)
  const [liveWait, setLiveWait] = useState({ sec: 0, fee: 0, freeLeft: 0 });

  const socketRef = useRef(null);
  const webviewRef = useRef(null);
  const creatingOrderRef = useRef(false);                 // ikki marta buyurtma yaratilmasin (double-tap)
  const healthTimerRef = useRef(null);                    // reachability heartbeat timeri
  const [netOnline, setNetOnline] = useState(true);       // internet bormi (banner uchun)
  const mapSource = useRef({ html: mapHTML() }).current; // bir marta yaratiladi, qayta yuklanmaydi
  const mapDataRef = useRef({});                          // joriy xarita ma'lumoti (so'nggi)
  const orderStepRef = useRef(null);                      // onWebViewMessage barqaror bo'lishi uchun (orderStep ref orqali o'qiladi)
  const [mapReady, setMapReady] = useState(false);

  // Xarita tayyor bo'lgach va joylashuv/haydovchi/manzil o'zgarganda — markerlarni
  // qayta yuklamasdan inject orqali yangilaymiz (lag bo'lmaydi).
  useEffect(() => {
    if (mapReady) pushMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup, myLoc, dest, driverLoc, nearby, order, orderStep]);
  const tokenRef = useRef(null);
  const nearbyTimer = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => { tokenRef.current = token; }, [token]);

  // ---- Boot ----
  useEffect(() => {
    (async () => {
      // OTA yangilanish: faqat standalone APK da ishlaydi, Expo Go da o'tkazib yuboriladi

      try {
        const t = await AsyncStorage.getItem('token');
        const u = await AsyncStorage.getItem('user');
        const p = await AsyncStorage.getItem('pin');
        const hp = await AsyncStorage.getItem('home_place');
        const wp = await AsyncStorage.getItem('work_place');
        if (t && u) {
          setToken(t); setUser(JSON.parse(u));
          if (p) { setStoredPin(p); setPinStep('enter'); }
          // Crash recovery: oxirgi faol buyurtmani lokaldan DARHOL ko'rsatamiz
          // (internet kelguncha bo'sh ekran chiqmaydi). Keyin server bilan sinxron.
          try {
            const ao = await AsyncStorage.getItem(ACTIVE_ORDER_KEY);
            if (ao) { const o = JSON.parse(ao); if (o && ACTIVE_STATUSES.includes(o.status)) { setOrder(o); setOrderStep(null); } }
          } catch (e) {}
        }
        if (hp) setHomePlace(JSON.parse(hp));
        if (wp) setWorkPlace(JSON.parse(wp));
      } catch (e) {}
      setBooting(false);
    })();
  }, []);

  // ---- Kirgandan so'ng ----
  useEffect(() => {
    if (!token || pinStep) return;
    (async () => {
      try { await Notifications.requestPermissionsAsync(); } catch (e) {}
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyLoc({ lat, lng });
        // Pickup auto — GPS + reverse geocode
        const addr = await reverseGeocode(lat, lng);
        setPickup({ lat, lng, address: addr });
      }
      connectSocket();
      resumeActiveOrder();
      loadPayMethods();
      loadCarImages();
      loadRecentPlaces();
      loadFavorites();
      loadPopularPlaces();
      startPinHalo();
    })();
    return () => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      if (nearbyTimer.current) clearInterval(nearbyTimer.current);
    };
  }, [token, pinStep]);

  // ---- Faol buyurtmani lokal saqlash (crash recovery) ----
  // app kill / crash / OS restart bo'lsa ham buyurtma yo'qolmaydi.
  useEffect(() => {
    if (order && ACTIVE_STATUSES.includes(order.status)) {
      AsyncStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(order)).catch(() => {});
    } else {
      AsyncStorage.removeItem(ACTIVE_ORDER_KEY).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status]);

  // ---- Foreground / internet qaytganda faol buyurtmani tiklash (#40) ----
  // Telefon bloklanib ochilsa, boshqa ilovadan qaytilsa, internet uzilib qaytsa ishlaydi.
  useEffect(() => {
    if (!token || pinStep) return;
    const onAppState = (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev && /inactive|background/.test(prev) && next === 'active') {
        ensureSocketConnected();
        resumeActiveOrder();
      }
    };
    const appSub = AppState.addEventListener('change', onAppState);

    let netUnsub = null;
    if (NetInfo) {
      try {
        let wasOffline = false;
        netUnsub = NetInfo.addEventListener((state) => {
          const isOnline = !!state.isConnected && state.isInternetReachable !== false;
          NetMonitor.set(isOnline); // bannerni tez yangilaydi
          if (isOnline && wasOffline) { ensureSocketConnected(); resumeActiveOrder(); }
          wasOffline = !isOnline;
        });
      } catch (e) {}
    }

    return () => {
      try { appSub.remove(); } catch (e) {}
      try { netUnsub && netUnsub(); } catch (e) {}
    };
  }, [token, pinStep]);

  // ---- Tarmoq holatiga obuna + reachability heartbeat (banner uchun) ----
  useEffect(() => {
    getDeviceId();
    const unsub = NetMonitor.subscribe((v) => setNetOnline(v));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!token || pinStep) return;
    let stopped = false;
    const tick = async () => {
      const ok = await pingHealth();
      if (stopped) return;
      NetMonitor.set(ok);
      if (ok) ensureSocketConnected();
      healthTimerRef.current = setTimeout(tick, ok ? 20000 : 5000);
    };
    healthTimerRef.current = setTimeout(tick, 8000);
    return () => { stopped = true; if (healthTimerRef.current) clearTimeout(healthTimerRef.current); };
  }, [token, pinStep]);

  // ---- Yaqindagi mashinalar ----
  useEffect(() => {
    if (!token || pinStep || !myLoc) return;
    if (nearbyTimer.current) clearInterval(nearbyTimer.current);
    if (!order) {
      loadNearby();
      nearbyTimer.current = setInterval(loadNearby, 15000);
    }
    return () => { if (nearbyTimer.current) clearInterval(nearbyTimer.current); };
  }, [token, pinStep, myLoc, order]);

  // ---- Trips tab load ----
  useEffect(() => {
    if (tab === 'trips' && token) loadTrips();
  }, [tab]);

  // ---- Faol buyurtmani davriy yangilash (socket push o'tkazib yuborilsa ham) ----
  // Haydovchi qabul qilganda uning ma'lumotlari mijozga aniq ko'rinishi uchun
  // kutish/yo'ldagi holatda har 5 sekundda serverdan faol buyurtmani olamiz.
  useEffect(() => {
    const st = order?.status;
    const oid = order?.id;
    if (!oid || !['searching', 'assigned', 'accepted', 'arrived'].includes(st)) return;
    let stopped = false;
    const poll = async () => {
      try {
        let r = await api('/api/orders/active', 'GET', null, tokenRef.current || token).catch(() => null);
        let fresh = r?.order;
        if (!fresh) {
          const r2 = await api('/api/me/active-order', 'GET', null, tokenRef.current || token).catch(() => null);
          fresh = r2?.order;
        }
        if (stopped || !fresh || fresh.id !== oid) return;
        // Endigina qabul qilindi -> bildirishnoma (faqat o'tish payti)
        if ((st === 'searching' || st === 'assigned') && fresh.status === 'accepted') {
          arrivedNotified.current = false;
          const nm = fresh.driver_name || 'Haydovchi';
          const car = fresh.driver_car ? ` · ${fresh.driver_car}${fresh.driver_plate ? ' ' + fresh.driver_plate : ''}` : '';
          notify('Haydovchi topildi! 🚗', `${nm}${car} yo'lda`);
        }
        setOrder((prev) => (prev && prev.id === fresh.id) ? { ...prev, ...fresh } : prev);
      } catch (_) {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => { stopped = true; clearInterval(iv); };
  }, [order?.id, order?.status, token]);

  // ---- Profile tab load ----
  useEffect(() => {
    if (tab === 'profile' && token) { loadBalance(); loadFavorites(); }
  }, [tab, token]);

  async function loadNearby() {
    if (!myLoc) return;
    try {
      const r = await api(`/api/drivers/nearby?lat=${myLoc.lat}&lng=${myLoc.lng}`, 'GET', null, tokenRef.current);
      setNearby(r.cars || []);
    } catch (e) {}
  }

  async function loadPayMethods() {
    try {
      const r = await api('/api/pay/methods', 'GET');
      if (r.methods) {
        const methods = [...r.methods];
        if (!methods.some((m) => m.id === 'card'))
          methods.push({ id: 'card', name: 'Karta', active: false });
        setPayMethods(methods);
      }
    } catch (e) {}
  }

  async function loadCarImages() {
    try {
      const r = await api('/api/config/classes', 'GET');
      if (r && Array.isArray(r.classes)) {
        const map = {};
        for (const c of r.classes) if (c.image) map[c.id] = c.image;
        setCarImages(map);
      }
    } catch (e) {}
  }

  async function loadRecentPlaces() {
    try {
      const r = await api('/api/me/trips?limit=30', 'GET', null, tokenRef.current);
      const seen = new Set();
      const unique = [];
      for (const t of (r.trips || [])) {
        if (t.to_address && !seen.has(t.to_address) && t.to_lat && t.to_lng) {
          seen.add(t.to_address);
          unique.push({ address: t.to_address, lat: Number(t.to_lat), lng: Number(t.to_lng) });
          if (unique.length >= 5) break;
        }
      }
      setRecentPlaces(unique);
    } catch (e) {}
  }

  async function loadFavorites() {
    try { const r = await api('/api/me/favorites', 'GET', null, tokenRef.current || token); setFavorites(r.favorites || []); } catch (e) {}
  }

  async function loadPopularPlaces() {
    if (!myLoc) return;
    try { const r = await api(`/api/places/popular?lat=${myLoc.lat}&lng=${myLoc.lng}`, 'GET'); setPopularPlaces(r.places || []); } catch (e) {}
  }

  // Qidiruv qatorlari uchun narx kaliti va parallel hisoblash (keshlanadi)
  function estKey(p) { return `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`; }
  async function fetchPlaceEstimates(places) {
    const from = pickup || myLoc;
    if (!from || !places?.length) return;
    const todo = places.filter((p) => p && p.lat && p.lng && !placeEst[estKey(p)]);
    if (!todo.length) return;
    const results = await Promise.all(todo.map((p) =>
      api('/api/orders/estimate', 'POST', { from, to: { lat: Number(p.lat), lng: Number(p.lng) }, car_class: 'ekonom' }, token)
        .then((est) => [estKey(p), { price: est.price, duration_min: est.duration_min || est.time_min }])
        .catch(() => [estKey(p), null])
    ));
    setPlaceEst((prev) => {
      const next = { ...prev };
      results.forEach(([k, v]) => { if (v) next[k] = v; });
      return next;
    });
  }

  // Qidiruv qatorining o'ng tomonidagi narx + vaqt (yoki yuklanayotgan bo'lsa skeleton)
  function placePriceNode(p) {
    if (!(pickup || myLoc) || !p?.lat || !p?.lng) return null;
    const e = placeEst[estKey(p)];
    if (e) return (
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '600' }}>~{fmt(e.price)} so'm</Text>
        <Text style={{ color: GRAY1, fontSize: 11, marginTop: 2 }}>{e.duration_min} daq</Text>
      </View>
    );
    return (
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Skeleton width={62} height={11} />
        <Skeleton width={38} height={9} />
      </View>
    );
  }

  async function addFavorite(place) {
    try { await api('/api/me/favorites', 'POST', { name: place.address, address: place.address, lat: place.lat, lng: place.lng }, token); loadFavorites(); Alert.alert('Saqlandi ✓', place.address); } catch (e) { Alert.alert('Xato', e.message); }
  }

  async function removeFavorite(id) {
    try { await api(`/api/me/favorites/${id}`, 'DELETE', null, token); loadFavorites(); } catch (e) {}
  }

  function startPinHalo() {
    Animated.loop(Animated.sequence([
      Animated.timing(pinAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.timing(pinAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
    ])).start();
  }

  function connectSocket() {
    if (socketRef.current?.connected) return; // allaqachon ulangan — takror yaratmaymiz
    // Eski soketni TO'LIQ tozalaymiz. Aks holda effekt qayta ishga tushganda
    // (masalan pinStep o'zgarsa) eski soket listenerlari bilan qoladi va
    // reconnection:Infinity tufayli qayta ulanib, 'driver_location'/'meter'
    // hodisalarini IKKI marta yuboradi — markerlar va re-renderlar takrorlanadi. (duplicate events / memory leak)
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }
    // Exponential backoff: 1s → 30s (zaif tarmoqda serverni bombardimon qilmaydi)
    const s = io(BASE, {
      auth: { token }, transports: ['websocket', 'polling'],
      reconnection: true, reconnectionAttempts: Infinity,
      reconnectionDelay: 1000, reconnectionDelayMax: 30000, randomizationFactor: 0.5, timeout: 20000,
    });
    socketRef.current = s;
    // Qayta ulanganda faol buyurtma holatini serverdan qayta tiklaymiz (#40 — internet uzilsa holat yo'qolmaydi)
    s.on('reconnect', () => { NetMonitor.set(true); resumeActiveOrder(); });
    s.on('connect', () => { NetMonitor.set(true); resumeActiveOrder(); });
    s.on('order_update', (o) => {
      setOrder((prev) => prev ? { ...prev, ...o } : o);
      if (o.status === 'accepted') {
        arrivedNotified.current = false;
        const nm = o.driver_name || 'Haydovchi';
        const car = o.driver_car ? ` · ${o.driver_car}${o.driver_plate ? ' ' + o.driver_plate : ''}` : '';
        notify('Haydovchi topildi! 🚗', `${nm}${car} yo'lda`);
      }
      if (o.status === 'arrived' && !arrivedNotified.current) {
        arrivedNotified.current = true;
        notify('Haydovchi yetib keldi ✅', 'Mashina sizni kutmoqda');
      }
      if (o.status === 'completed') {
        notify('Safar yakunlandi 🏁', 'Rahmat! Haydovchini baholang');
        setCompletedOrder(o);          // hisob-kitob ko'rsatish uchun saqlayмиз
        setRateOrderId(o.id); setStars(5); setTipAmount(0); setRateModal(true);
        resetOrder();
      }
      if (o.status === 'cancelled') { notify('Buyurtma bekor qilindi', ''); resetOrder(); }
    });
    s.on('driver_location', (loc) => {
      // Bir xil koordinata kelsa re-render qilmaymiz (xarita ham o'zgarmaydi)
      setDriverLoc((prev) => (prev && loc && prev.lat === loc.lat && prev.lng === loc.lng) ? prev : loc);
      setOrder((prev) => {
        if (prev && prev.status === 'accepted' && !arrivedNotified.current && loc.lat && loc.lng && prev.from_lat) {
          const d = distKm(loc.lat, loc.lng, prev.from_lat, prev.from_lng);
          if (d < 0.15) {
            arrivedNotified.current = true;
            notify('Haydovchi yaqinlashmoqda 🚗', '~1 daqiqada yetib keladi');
          }
        }
        return prev;
      });
    });
    s.on('chat_message', (msg) => {
      setTripChat((prev) => [...prev, msg]);
      if (!tripChatModal) notify('💬 Haydovchi xabar yubordi', msg.text || '');
    });
    // Jonli kutish haqi (arrived) — backend har 5 sekunda yuboradi
    s.on('wait_update', (d) => {
      setLiveWait({ sec: d.waitSec || 0, fee: d.waitFee || 0, freeLeft: d.freeLeft || 0 });
      setOrder((prev) => prev ? { ...prev, wait_fee: d.waitFee || 0, price: d.totalFare || prev.price } : prev);
    });
    // Jonli taximetr (in_progress, hisoblagich) — backend har 5 sekunda yuboradi
    s.on('meter', (d) => {
      // Faqat o'zgargan qiymatda yangilaymiz — bekorga re-render qilmaymiz
      setLiveKm((p) => p === (d.km || 0) ? p : (d.km || 0));
      setLiveFare((p) => p === (d.fare || 0) ? p : (d.fare || 0));
      setLiveMin((p) => p === (d.minutes || 0) ? p : (d.minutes || 0));
      setOrder((prev) => (prev && d.fare && prev.price !== d.fare) ? { ...prev, price: d.fare } : prev);
    });
  }

  // Haydovchiga socket orqali chat xabari yuborish
  function sendTripChat() {
    const text = tripChatInput.trim();
    if (!text || !order) return;
    socketRef.current?.emit('chat', { orderId: order.id, text });
    setTripChat((prev) => [...prev, { role: 'customer', text }]);
    setTripChatInput('');
  }

  // Sayohatni ulashish
  async function shareTrip() {
    if (!order?.share_token) { Alert.alert('Ulashib bo\'lmadi', 'Token mavjud emas'); return; }
    const url = `${BASE}/api/orders/share/${order.share_token}`;
    const msg = `Men ELGA taxi bilan sayohatdaman!\nKuzatish: ${url}`;
    try {
      await Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(msg)}`);
    } catch (_) {
      Alert.alert('Havola', url, [{ text: 'Nusxalash', onPress: () => Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(url)}`) }]);
    }
  }

  // Masofa (km) — Haversine soddalashtirilgan
  function distKm(lat1, lng1, lat2, lng2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Socket uzilib qolgan bo'lsa qayta ulaymiz (foreground / internet qaytganda).
  function ensureSocketConnected() {
    const s = socketRef.current;
    if (!s) { connectSocket(); return; }
    if (!s.connected) { try { s.connect(); } catch (e) {} }
  }

  // Faol buyurtmani serverdan tiklash — server YAGONA haqiqat manbai.
  // Ilova ochilganda, socket connect/reconnect, internet/foreground qaytganda chaqiriladi.
  // Tarmoq xatosida lokal holat saqlanadi (tozalanmaydi).
  async function resumeActiveOrder() {
    try {
      const r = await api('/api/me/active-order', 'GET', null, tokenRef.current || token);
      if (r?.order) {
        setOrder((prev) => (prev && prev.id === r.order.id) ? { ...prev, ...r.order } : r.order);
        setOrderStep(null);
      } else if (r) {
        // Server: faol buyurtma yo'q → lokaldagi eskirgan buyurtmani tozalaymiz
        setOrder((prev) => (prev && ACTIVE_STATUSES.includes(prev.status)) ? null : prev);
        setOrderStep((s) => (s === null ? 'dest' : s));
      }
    } catch (e) {
      // Tarmoq xatosi — lokal (saqlangan) holatni saqlab qolamiz
    }
  }

  // Faol buyurtma ekranini ochish. Avval 409 javobidagi active_order'dan,
  // bo'lmasa GET /api/orders/active dan olamiz. Ochilsa true qaytaradi.
  async function openActiveOrder(errOr409) {
    const fromErr = errOr409?.data?.active_order;
    if (fromErr) { setOrder(fromErr); setOrderStep(null); return true; }
    try {
      const r = await api('/api/orders/active', 'GET', null, tokenRef.current || token);
      if (r?.order) { setOrder(r.order); setOrderStep(null); return true; }
    } catch (_) {}
    // Eski endpoint — zaxira
    try {
      const r2 = await api('/api/me/active-order', 'GET', null, tokenRef.current || token);
      if (r2?.order) { setOrder(r2.order); setOrderStep(null); return true; }
    } catch (_) {}
    return false;
  }

  async function notify(title, body) {
    try { await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }); } catch (e) {}
  }

  function resetOrder() {
    setOrder(null); setDest(null); setEstimates({}); estCacheKey.current = null;
    setDriverLoc(null); setOrderStep('dest'); setSearchQ(''); setSearchResults([]); setSearchOpen(false);
  }

  // ---- Xarita hodisalari ----
  // Xaritaga joriy ma'lumotni yuborish (qayta yuklamasdan)
  function pushMap() {
    if (!webviewRef.current) return;
    webviewRef.current.injectJavaScript(`window.updateMap(${JSON.stringify(mapDataRef.current)});true;`);
  }

  // Barqaror handler (useCallback []) — ClientMap memoizatsiyasi buzilmasligi uchun.
  // Joriy orderStep ni orderStepRef orqali o'qiymiz; pushMap faqat ref'lardan
  // foydalanadi, shuning uchun birinchi render closure'i ham har doim to'g'ri ishlaydi.
  const onWebViewMessage = useCallback(async (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'mapReady') { setMapReady(true); pushMap(); return; }
      if (msg.type === 'mapClick') {
        if (orderStepRef.current === 'confirm') {
          const addr = await reverseGeocode(msg.lat, msg.lng);
          setPickup({ lat: msg.lat, lng: msg.lng, address: addr });
        }
      }
      if (msg.type === 'pickupDrag') {
        const addr = await reverseGeocode(msg.lat, msg.lng);
        setPickup({ lat: msg.lat, lng: msg.lng, address: addr });
      }
    } catch (_) {}
  }, []);

  // ---- Manzil qidirish ----
  async function searchPlaces(q) {
    setSearchQ(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    try {
      const loc = pickup || myLoc;
      const ll = loc ? `&lat=${loc.lat}&lng=${loc.lng}` : '';
      const r = await api(`/api/places/search?q=${encodeURIComponent(q)}${ll}`, 'GET');
      setSearchResults(r.places || []);
    } catch (e) {}
  }

  function pickDest(place) {
    setDest({ lat: place.lat, lng: place.lng, address: place.address || place.name });
    setSearchResults([]); setSearchQ(''); setSearchOpen(false);
    setEstimates({}); estCacheKey.current = null;
    setOrderStep('confirm');
  }

  // ---- Safar davomida manzilni o'zgartirish ----
  async function cdSearch(q) {
    setCdQ(q);
    if (q.trim().length < 2) { setCdResults([]); return; }
    try {
      const loc = pickup || myLoc;
      const ll = loc ? `&lat=${loc.lat}&lng=${loc.lng}` : '';
      const r = await api(`/api/places/search?q=${encodeURIComponent(q)}${ll}`, 'GET');
      setCdResults(r.places || []);
    } catch (e) {}
  }

  async function applyChangeDest(place) {
    if (!order) return;
    setLoading(true);
    try {
      const r = await api(`/api/orders/${order.id}/destination`, 'POST', {
        to_lat: place.lat, to_lng: place.lng,
        to_address: place.address || place.name,
      }, token);
      if (r.order) {
        setOrder(r.order);
        setDest({ lat: place.lat, lng: place.lng, address: place.address || place.name });
      }
      setChangeDestModal(false); setCdQ(''); setCdResults([]);
      Alert.alert('✅ Manzil o\'zgartirildi', r.recalculated
        ? `Yangi narx: ${fmt(r.order?.price || 0)} so'm`
        : 'Manzil yangilandi');
    } catch (e) { Alert.alert('Xato', e.message); }
    setLoading(false);
  }

  // ---- Uy/Ish saqlash ----
  async function saveHomeWork(type, place) {
    const key = type === 'home' ? 'home_place' : 'work_place';
    await AsyncStorage.setItem(key, JSON.stringify(place));
    if (type === 'home') setHomePlace(place);
    else setWorkPlace(place);
    Alert.alert(type === 'home' ? 'Uy manzili saqlandi' : 'Ish manzili saqlandi', place.address);
  }

  // ---- Narx: har bir tarif uchun parallel + kesh ----
  async function fetchAllEstimates() {
    const from = pickup || myLoc;
    if (!from || !dest) return;
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
    if (estCacheKey.current === key && Object.keys(estimates).length) return;
    estCacheKey.current = key;
    setEstLoading(true);
    try {
      const results = await Promise.all(
        CAR_CLASSES.map((c) =>
          api('/api/orders/estimate', 'POST', { from, to: dest, car_class: c.id }, token)
            .then((est) => [c.id, est])
            .catch(() => [c.id, null])
        )
      );
      const map = {};
      results.forEach(([id, est]) => { if (est) map[id] = est; });
      setEstimates(map);
    } catch (e) {}
    setEstLoading(false);
  }

  useEffect(() => {
    if (orderStep === 'tariff' && dest && (pickup || myLoc) && !order) fetchAllEstimates();
  }, [orderStep, dest, pickup, myLoc]);

  // Qidiruv oynasi ochilganda: oxirgi + mashhur joylar uchun narxlarni hisoblash
  useEffect(() => {
    if (searchOpen && (pickup || myLoc)) fetchPlaceEstimates([...recentPlaces, ...popularPlaces]);
  }, [searchOpen, recentPlaces, popularPlaces, pickup, myLoc]);

  // Qidiruv natijalari kelganda ular uchun ham narx
  useEffect(() => {
    if (searchOpen && searchResults.length) fetchPlaceEstimates(searchResults);
  }, [searchResults]);

  // Olib ketish nuqtasi o'zgarsa — narx keshini tozalaymiz (eskirmasin)
  useEffect(() => { setPlaceEst({}); }, [pickup?.lat, pickup?.lng]);

  // ---- Buyurtma ----
  async function createOrder() {
    const from = pickup || myLoc;
    if (!from || !dest) return;
    if (creatingOrderRef.current) return; // ikki marta bosilsa — ikkinchisini e'tiborsiz qoldiramiz
    creatingOrderRef.current = true;
    setLoading(true);
    try {
      // Idempotency-Key: tarmoq uzilib qayta urinilsa ham AYNAN BITTA buyurtma yaratiladi
      // (server idempotency middleware bir xil kalitga keshlangan javobni qaytaradi).
      const r = await api('/api/orders', 'POST', {
        from, to: dest, car_class: carClass, payment_method: payMethod,
      }, token, 15000, { idempotencyKey: uuid(), retries: 2 });
      const o = r.order || r;
      setOrder(o);
      setOrderStep(null);
      notify('Buyurtma berildi 🚖', 'Haydovchi qidirilmoqda...');
      if (payMethod !== 'cash') openPayment(o.id, payMethod);
    } catch (e) {
      // "Sizda faol buyurtma bor" (409) -> yangi buyurtma o'rniga faolini ochamiz
      if (e?.status === 409) {
        const opened = await openActiveOrder(e);
        if (opened) notify('Faol buyurtma', 'Sizda faol buyurtma bor — ochildi');
        else Alert.alert('Faol buyurtma', e.message || 'Sizda faol buyurtma bor');
      } else {
        Alert.alert('Xato', e.message);
      }
    }
    creatingOrderRef.current = false;
    setLoading(false);
  }

  // ---- 🎙 Ovozli buyurtma ----
  // Mijoz manzilni ovozda aytadi → hisoblagich (manzilsiz) buyurtma yaratiladi,
  // haydovchi ovozni eshitadi. Narx safar oxirida km+vaqt bo'yicha.
  function openVoiceOrder() {
    if (order) { Alert.alert('Faol buyurtma', 'Avval joriy buyurtmani yakunlang yoki bekor qiling'); return; }
    setVoiceSec(0); setRecording(false); setVoiceParsing(false); setVoiceClarify(''); setVoiceHeard(''); setVoiceModal(true);
  }
  function closeVoiceOrder() {
    if (voiceTimer.current) { clearInterval(voiceTimer.current); voiceTimer.current = null; }
    if (recordingRef.current) { recordingRef.current = false; audioRecorder.stop().catch(() => {}); }
    setRecording(false); setVoiceSec(0); setVoiceModal(false);
    setVoiceParsing(false); setVoiceClarify(''); setVoiceHeard('');
  }
  async function startVoiceRecording() {
    if (recordingRef.current) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Mikrofon', 'Ovozli buyurtma uchun mikrofon ruxsati kerak'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordingRef.current = true;
      setRecording(true); setVoiceSec(0);
      voiceTimer.current = setInterval(() => setVoiceSec(v => {
        if (v >= 60) { stopVoiceRecording(); return v; } // 60s cheklov
        return v + 1;
      }), 1000);
    } catch (e) { Alert.alert('Xato', "Ovoz yozib bo'lmadi: " + e.message); }
  }
  async function stopVoiceRecording() {
    if (voiceTimer.current) { clearInterval(voiceTimer.current); voiceTimer.current = null; }
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri || voiceSec < 1) { Alert.alert('Qisqa', 'Manzilni biroz uzunroq gapiring'); return; }
      // Avval AI tahlil (nutq -> manzil avto-to'ldirish). Endpoint yo'q/xato bo'lsa
      // eski oqimga qaytamiz (haydovchi ovozni eshitadi) — nol regressiya.
      const handled = await parseVoiceAndFill(uri);
      if (!handled) await sendVoiceOrder(uri);
    } catch (e) { Alert.alert('Xato', e.message); }
  }
  // Lokal audio faylni base64 data-URL ga aylantiradi (backend order_voice formati)
  async function fileToDataUrl(uri) {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }
  async function sendVoiceOrder(uri) {
    const from = pickup || myLoc;
    if (!from) { Alert.alert('Joylashuv', 'Olib ketish joyi aniqlanmadi'); return; }
    if (creatingOrderRef.current) return; // ikki marta yuborilmasin
    creatingOrderRef.current = true;
    setLoading(true);
    try {
      const voice = await fileToDataUrl(uri);
      // Idempotency-Key: qayta urinilsa ham bitta buyurtma (dubl bo'lmaydi)
      const r = await api('/api/orders', 'POST', {
        from, metered: true, voice, payment_method: payMethod,
      }, token, 45000, { idempotencyKey: uuid(), retries: 1 }); // ovoz katta — sekin internetga uzunroq timeout
      const o = r.order || r;
      setOrder(o); setOrderStep(null); setVoiceModal(false); setVoiceSec(0);
      notify('Ovozli buyurtma berildi 🎙', 'Haydovchi qidirilmoqda...');
    } catch (e) {
      if (e?.status === 409) {
        setVoiceModal(false);
        const opened = await openActiveOrder(e);
        if (opened) notify('Faol buyurtma', 'Sizda faol buyurtma bor — ochildi');
        else Alert.alert('Faol buyurtma', e.message || 'Sizda faol buyurtma bor');
      } else {
        Alert.alert('Xato', e.message);
      }
    }
    creatingOrderRef.current = false;
    setLoading(false);
  }

  // Matnli manzilni koordinataga aylantirish — mavjud joy qidiruvi orqali.
  async function geocodeText(q, near) {
    if (!q || typeof q !== 'string') return null;
    try {
      const ll = near ? `&lat=${near.lat}&lng=${near.lng}` : '';
      const r = await api(`/api/places/search?q=${encodeURIComponent(q.trim())}${ll}`, 'GET');
      const top = (r?.places || [])[0];
      if (top && top.lat != null && top.lng != null) {
        return { lat: Number(top.lat), lng: Number(top.lng), address: top.address || top.name || q };
      }
    } catch (_) {}
    return null;
  }

  // AI tahlilidan kelgan pickup/destination'ni hal qilib, tasdiqlash ekraniga o'tamiz.
  async function resolveAndGoConfirm(p, from) {
    // Pickup: CURRENT_LOCATION bo'lsa GPS, aks holda matnni geokodlaymiz
    let pk = from;
    if (p.pickup_text && p.pickup_text !== 'CURRENT_LOCATION') {
      const g = await geocodeText(p.pickup_text, from);
      if (g) pk = g;
    }
    // Destination matnini koordinataga aylantiramiz
    const dst = await geocodeText(p.destination_text, from);
    if (!dst) {
      // Topilmadi -> qidiruvni oldindan to'ldirib ochamiz, mijoz tanlaydi
      setVoiceModal(false); setVoiceParsing(false);
      setSearchQ(p.destination_text || '');
      setSearchOpen(true);
      if (p.destination_text) searchPlaces(p.destination_text);
      return;
    }
    if (pk) setPickup({ lat: pk.lat, lng: pk.lng, address: pk.address || pickup?.address });
    setDest({ lat: dst.lat, lng: dst.lng, address: dst.address });
    setEstimates({}); estCacheKey.current = null;
    setVoiceModal(false); setVoiceParsing(false); setVoiceSec(0); setVoiceClarify(''); setVoiceHeard('');
    setOrderStep('confirm');
  }

  // 🎙 AI ovozli buyurtma: audio -> backend STT+AI -> JSON -> manzil avto-to'ldirish.
  // true qaytarsa AI ishladi (yoki aniqlashtirish so'raldi); false -> eski oqimga qaytamiz.
  async function parseVoiceAndFill(uri) {
    const from = pickup || myLoc;
    setVoiceParsing(true); setVoiceClarify(''); setVoiceHeard('');
    try {
      const audio = await fileToDataUrl(uri);
      const r = await api('/api/voice/parse', 'POST', {
        audio, lang: 'uz',
        lat: from?.lat ?? null, lng: from?.lng ?? null,
      }, token, 45000);
      const p = (r && r.parsed) ? r.parsed : (r || {});
      if (typeof p.transcript === 'string') setVoiceHeard(p.transcript);
      else if (typeof r?.transcript === 'string') setVoiceHeard(r.transcript);
      // Noaniq manzil yoki destination yo'q -> aniqlashtirish so'raymiz (modalda qoldik)
      if (p.needs_clarification || !p.destination_text || p.destination_known === false) {
        setVoiceClarify(p.clarification_question || 'Qaysi manzilga bormoqchisiz?');
        setVoiceParsing(false);
        return true;
      }
      await resolveAndGoConfirm(p, from);
      return true;
    } catch (e) {
      // 404 (endpoint hali yo'q) yoki boshqa xato -> eski oqim (haydovchi eshitadi)
      console.warn('[voice/parse]', e?.status, e?.message);
      setVoiceParsing(false); setVoiceClarify(''); setVoiceHeard('');
      return false;
    }
  }

  async function openPayment(orderId, provider) {
    try {
      const r = await api('/api/pay/create', 'POST', { order_id: orderId, provider }, token);
      if (r.url) Linking.openURL(r.url);
    } catch (e) { Alert.alert("To'lov", "To'lov havolasini ochib bo'lmadi, naqd to'lashingiz mumkin"); }
  }

  // ---- Bekor qilish ----
  async function confirmCancel(reason) {
    setCancelModal(false);
    setLoading(true);
    try {
      const r = await api(`/api/orders/${order.id}/cancel`, 'POST', { reason }, token);
      if (r.cancel_fee > 0) Alert.alert('Bekor qilindi', `Jarima: ${fmt(r.cancel_fee)} so'm (haydovchi yetib kelgan edi)`);
      resetOrder();
    } catch (e) { Alert.alert('Xato', e.message); }
    setCustomReason('');
    setLoading(false);
  }

  // ---- Baholash + tip ----
  async function submitRating() {
    setLoading(true);
    try {
      await api(`/api/me/rate/${rateOrderId}`, 'POST', { stars }, token);
      if (tipAmount > 0)
        await api(`/api/orders/${rateOrderId}/tip`, 'POST', { amount: tipAmount }, token).catch(() => {});
    } catch (e) {}
    setRateModal(false); setCompletedOrder(null); setLoading(false);
  }

  function callDriver() {
    if (order?.driver_phone) Linking.openURL(`tel:${order.driver_phone}`);
  }

  async function doLogout() {
    await AsyncStorage.multiRemove(['token', 'user', 'pin', ACTIVE_ORDER_KEY]);
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    setToken(null); setUser(null); setStep('phone');
    setPhone(''); setCode(''); setName('');
    setPinStep(null); setPinInput(''); setStoredPin(null);
    resetOrder(); setTab('order');
  }
  function confirmLogout() {
    Alert.alert('Chiqish', 'Hisobdan chiqishni tasdiqlaysizmi?', [
      { text: 'Bekor qilish', style: 'cancel' },
      { text: 'Chiqish', style: 'destructive', onPress: doLogout },
    ]);
  }

  async function loadTrips() {
    try { const r = await api('/api/me/trips?limit=30', 'GET', null, token); setTrips(r.trips || []); } catch (e) {}
  }
  async function loadBalance() {
    try { const r = await api('/api/me/balance', 'GET', null, token); setBalance(r); } catch (e) {}
  }
  async function claimCashback() {
    try {
      const r = await api('/api/me/claim-cashback', 'POST', {}, token);
      Alert.alert('Keshbek', `${fmt(r.claimed)} so'm balansga qo'shildi`);
      loadBalance();
    } catch (e) { Alert.alert('Xato', e.message); }
  }
  async function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const next = [...chat, { role: 'user', text }];
    setChat(next); setChatInput(''); setChatLoading(true);
    try {
      const r = await api('/api/ai/chat', 'POST', { messages: next, order_id: order?.id, context_role: 'customer' }, token);
      const reply = r.reply + (r.ticket ? `\n\n📋 Murojaat raqami: ${r.ticket}` : '');
      setChat([...next, { role: 'assistant', text: reply }]);
    } catch (e) {
      setChat([...next, { role: 'assistant', text: 'Kechirasiz, javob berib bo\'lmadi. Keyinroq urinib ko\'ring.' }]);
    }
    setChatLoading(false);
  }

  // ====================== EKRANLAR ======================

  // BOOTING
  if (booting)
    return (
      <View style={s.fill}>
        <StatusBar style="light" />
        <View style={s.bootScreen}>
          <BootLogo />
          <FadeInView delay={350} from={8}>
            <ActivityIndicator color={YELLOW} style={{ marginTop: 36 }} />
          </FadeInView>
        </View>
      </View>
    );

  // PIN SCREEN
  if (pinStep === 'enter' || pinStep === 'setup') {
    const isSetup = pinStep === 'setup';
    return (
      <View style={s.loginWrap}>
        <StatusBar style="light" />
        <FadeInView delay={0} from={20}>
        <View style={{ alignItems: 'center' }}><ElgaLogo size={56} /></View>
        <Text style={{ color: WHITE, fontSize: 24, fontWeight: '600', textAlign: 'center', marginTop: 8 }}>
          {isSetup ? "PIN o'rnating" : 'PIN kiriting'}
        </Text>
        {isSetup && (
          <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginTop: 6 }}>
            Keyingi kirishlarda SMS shart bo'lmaydi
          </Text>
        )}
        <TextInput
          style={[s.input, { fontSize: 32, letterSpacing: 20, textAlign: 'center', marginTop: 32 }]}
          placeholder="• • • •"
          placeholderTextColor={GRAY2}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          value={pinInput}
          onChangeText={setPinInput}
          autoFocus
        />
        <PressableScale
          style={s.ctaBtn}
          onPress={isSetup
            ? async () => {
                if (pinInput.length !== 4) { Alert.alert('Xato', '4 ta raqam kiriting'); return; }
                await AsyncStorage.setItem('pin', pinInput);
                setStoredPin(pinInput); setPinInput(''); setPinStep(null);
              }
            : () => {
                if (pinInput === storedPin) { setPinStep(null); setPinInput(''); }
                else { Alert.alert('Xato', "PIN noto'g'ri"); setPinInput(''); }
              }
          }
        >
          <Text style={s.ctaBtnTxt}>DAVOM ETISH</Text>
        </PressableScale>
        {isSetup
          ? <TouchableOpacity onPress={() => setPinStep(null)} activeOpacity={0.7}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>O'tkazib yuborish</Text>
            </TouchableOpacity>
          : <TouchableOpacity activeOpacity={0.7} onPress={async () => {
              await AsyncStorage.multiRemove(['token', 'user', 'pin', ACTIVE_ORDER_KEY]);
              setToken(null); setUser(null); setStoredPin(null);
              setPinStep(null); setPinInput(''); setStep('phone');
            }}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>SMS orqali kirish</Text>
            </TouchableOpacity>
        }
        </FadeInView>
      </View>
    );
  }

  // LOGIN SCREEN
  if (!token) {
    return (
      <View style={s.loginWrap}>
        <StatusBar style="light" />
        <FadeInView delay={0} from={24} duration={500}>
          <View style={{ alignItems: 'center' }}><ElgaLogo size={56} /></View>
          <Text style={{ color: GRAY1, fontSize: 15, textAlign: 'center', marginTop: 6 }}>Mijoz ilovasi</Text>
        </FadeInView>

        {step === 'phone' && (
          <FadeInView key="phone" delay={120} from={20}>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder="+998..."
              placeholderTextColor={GRAY2}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <PressableScale style={s.ctaBtn} onPress={async () => {
              if (phone.replace(/\D/g, '').length < 9) { Alert.alert('Xato', "To'g'ri telefon raqam kiriting"); return; }
              setLoading(true);
              try { await api('/api/auth/send-code', 'POST', { phone }); setStep('code'); Alert.alert('Yuborildi', 'SMS kod yuborildi'); }
              catch (e) { Alert.alert('Xato', e.message); }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>SMS KOD OLISH</Text>}
            </PressableScale>
          </FadeInView>
        )}

        {step === 'code' && (
          <FadeInView key="code" delay={60} from={20}>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder="SMS kod"
              placeholderTextColor={GRAY2}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
            />
            <PressableScale style={s.ctaBtn} onPress={async () => {
              if (code.length < 4) { Alert.alert('Xato', 'Kodni kiriting'); return; }
              setLoading(true);
              try {
                const r = await api('/api/auth/verify', 'POST', { phone, code });
                await AsyncStorage.setItem('token', r.token);
                await AsyncStorage.setItem('user', JSON.stringify(r.user));
                setToken(r.token); setUser(r.user);
                const p = await AsyncStorage.getItem('pin');
                if (!p) setPinStep('setup');
              } catch (e) {
                if (e.data?.new_user && e.data?.reg_token) { setRegToken(e.data.reg_token); setStep('name'); }
                else { Alert.alert('Xato', e.message); }
              }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>TASDIQLASH</Text>}
            </PressableScale>
            <TouchableOpacity onPress={() => setStep('phone')} activeOpacity={0.7}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 12 }}>← Raqamni o'zgartirish</Text>
            </TouchableOpacity>
          </FadeInView>
        )}

        {step === 'name' && (
          <FadeInView key="name" delay={60} from={20}>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder="Ismingiz"
              placeholderTextColor={GRAY2}
              value={name}
              onChangeText={setName}
            />
            <PressableScale style={s.ctaBtn} onPress={async () => {
              if (name.trim().length < 2) { Alert.alert('Xato', 'Ismingizni kiriting'); return; }
              setLoading(true);
              try {
                const r = await api('/api/auth/verify', 'POST', { phone, code, name: name.trim(), role: 'customer', reg_token: regToken });
                await AsyncStorage.setItem('token', r.token);
                await AsyncStorage.setItem('user', JSON.stringify(r.user));
                setToken(r.token); setUser(r.user);
                const p = await AsyncStorage.getItem('pin');
                if (!p) setPinStep('setup');
              } catch (e) { Alert.alert('Xato', e.message); }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>DAVOM ETISH</Text>}
            </PressableScale>
          </FadeInView>
        )}
      </View>
    );
  }

  // ====================== ASOSIY INTERFEYS ======================

  // Xarita: bitta barqaror WebView, ma'lumot inject orqali yangilanadi (qayta yuklanmaydi).
  const mapBase = pickup || myLoc;
  const hasMap = !!mapBase;       // dest/tariff/confirm ekranlari uchun
  const hasMapActive = !!order;   // faol buyurtma ekrani uchun
  // onWebViewMessage barqaror (useCallback) — joriy orderStep ni ref orqali o'qiydi.
  orderStepRef.current = orderStep;
  // Joriy holatga qarab xarita ma'lumotini tayyorlaymiz (so'nggi qiymat ref'da turadi).
  mapDataRef.current = order ? {
    lat: mapBase?.lat ?? 0, lng: mapBase?.lng ?? 0,
    destLat: dest?.lat ?? null, destLng: dest?.lng ?? null,
    driverLat: driverLoc?.lat ?? null, driverLng: driverLoc?.lng ?? null,
    nearby: [], pickupMode: false,
  } : orderStep === 'confirm' ? {
    lat: mapBase?.lat ?? null, lng: mapBase?.lng ?? null,
    destLat: null, destLng: null, driverLat: null, driverLng: null,
    nearby: [], pickupMode: true,
  } : {
    lat: mapBase?.lat ?? null, lng: mapBase?.lng ?? null,
    destLat: dest?.lat ?? null, destLng: dest?.lng ?? null,
    driverLat: driverLoc?.lat ?? null, driverLng: driverLoc?.lng ?? null,
    nearby, pickupMode: false,
  };

  return (
    <View style={s.fill}>
      <StatusBar style="light" />

      {/* Tarmoq holati banneri — internet yo'q bo'lsa ko'rinadi */}
      {!netOnline && (
        <View style={{
          position: 'absolute', top: insets.top, left: 0, right: 0, zIndex: 999,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#3A1212',
        }}>
          <Ionicons name="cloud-offline-outline" size={14} color="#FF6B6B" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
            Internet yo'q. Qayta ulanish kutilmoqda…
          </Text>
        </View>
      )}

      {/* ===== BUYURTMA TAB ===== */}
      {tab === 'order' && (

        /* ── ACTIVE ORDER ── */
        order ? (
          <View style={s.fill}>
            {hasMapActive ? (
              <ClientMap
                ref={webviewRef}
                style={s.mapFull}
                source={mapSource}
                onMessage={onWebViewMessage}
              />
            ) : (
              <View style={[s.fill, s.center]}>
                <ActivityIndicator color={YELLOW} size="large" />
              </View>
            )}

            <AnimatedSheet style={[s.activeSheet, { bottom: TABBAR_H + insets.bottom }]}>
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER }} />
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={s.activeStatusTxt}>{statusText(order.status)}</Text>

              {order.driver_name && !['searching', 'assigned'].includes(order.status) && (
                <View style={s.driverCard}>
                  <View style={s.driverAvatar}>
                    <Text style={{ fontSize: 26, color: GRAY1 }}>{(order.driver_name?.[0] || 'H').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: YELLOW, fontSize: 16, fontWeight: '700' }}>{order.driver_name}</Text>
                    {order.driver_rating && <Text style={{ color: GRAY1, fontSize: 13 }}>⭐ {order.driver_rating}</Text>}
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>
                      {[order.driver_car, order.driver_color, order.driver_plate].filter(Boolean).join(' · ')}
                    </Text>
                    {driverLoc && pickup && order.status === 'accepted' && (
                      <Text style={{ color: GREEN, fontSize: 12, marginTop: 2 }}>
                        📍 {(distKm(driverLoc.lat, driverLoc.lng, (pickup || myLoc).lat, (pickup || myLoc).lng) * 1000).toFixed(0)} m uzoqlikda
                      </Text>
                    )}
                  </View>
                  <View style={{ gap: 8 }}>
                    {order.driver_phone && (
                      <TouchableOpacity style={s.callCircle} onPress={callDriver}>
                        <Ionicons name="call" size={20} color={GREEN} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.chatCircle} onPress={() => setTripChatModal(true)}>
                      <Ionicons name="chatbubble" size={18} color="#007AFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {['searching', 'assigned'].includes(order.status) && (
                <View style={{ alignItems: 'center', padding: 20, gap: 12 }}>
                  <ActivityIndicator color={YELLOW} size="large" />
                  <Text style={{ color: WHITE, fontSize: 16, fontWeight: '600' }}>Haydovchi qidirilmoqda</Text>
                  <Text style={{ color: GRAY1, fontSize: 13 }}>Bir oz kuting...</Text>
                </View>
              )}

              {order.status === 'arrived' && <CustomerWaitTimer arrivedAt={order.arrived_at} />}

              {order.price > 0 && (
                <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginTop: 8 }}>
                  {fmt(order.price)} so'm · {order.payment_method === 'cash' ? 'Naqd' : order.payment_method}
                </Text>
              )}

              {['accepted', 'arrived', 'in_progress'].includes(order.status) && (
                <TouchableOpacity
                  style={[s.outlineBtn, { marginTop: 12, marginHorizontal: 16, justifyContent: 'center' }]}
                  onPress={() => { setChangeDestModal(true); setCdQ(''); setCdResults([]); }}>
                  <Ionicons name="location" size={16} color={YELLOW} style={{ marginRight: 6 }} />
                  <Text style={{ color: YELLOW, fontSize: 14, fontWeight: '600' }}>Manzilni o'zgartirish</Text>
                </TouchableOpacity>
              )}

              {/* ====== JONLI TAXIMETR (in_progress) ====== */}
              {order.status === 'in_progress' && (
                <View style={s.taxiMeterBox}>
                  {/* Asosiy narx */}
                  <View style={{ alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 1 }}>
                      {order.metered ? 'HISOBLAGICH' : 'SAFAR NARXI'}
                    </Text>
                    <Text style={{ color: YELLOW, fontSize: 44, fontWeight: '800', lineHeight: 52, marginTop: 4 }}>
                      {fmt(order.metered ? (liveFare || order.price || 0) : (order.price || 0))}
                    </Text>
                    <Text style={{ color: GRAY1, fontSize: 14 }}>so'm</Text>
                  </View>
                  {/* Km · Daqiqa · Kutish */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingTop: 10 }}>
                    {!!order.metered && (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>
                          {liveKm > 0 ? liveKm.toFixed(1) : (order.distance_km || 0).toFixed(1)}
                        </Text>
                        <Text style={{ color: GRAY1, fontSize: 11 }}>km</Text>
                      </View>
                    )}
                    {!!order.metered && (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>
                          {liveMin > 0 ? Math.round(liveMin) : '—'}
                        </Text>
                        <Text style={{ color: GRAY1, fontSize: 11 }}>daqiqa</Text>
                      </View>
                    )}
                    {(order.wait_fee > 0 || liveWait.fee > 0) && (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: RED, fontSize: 18, fontWeight: '700' }}>
                          +{fmt(Math.max(order.wait_fee || 0, liveWait.fee))}
                        </Text>
                        <Text style={{ color: GRAY1, fontSize: 11 }}>kutish</Text>
                      </View>
                    )}
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: GRAY1, fontSize: 13, fontWeight: '600' }}>
                        {order.payment_method === 'cash' ? '💵 Naqd' : '💳 Karta'}
                      </Text>
                      <Text style={{ color: GRAY2, fontSize: 11 }}>to'lov</Text>
                    </View>
                  </View>
                </View>
              )}

              {order.status === 'in_progress' && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingHorizontal: 16 }}>
                  <TouchableOpacity style={s.outlineBtn} onPress={shareTrip}>
                    <Ionicons name="share-social" size={16} color={WHITE} style={{ marginRight: 6 }} />
                    <Text style={{ color: WHITE, fontSize: 14 }}>Ulashish</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.outlineBtn, { borderColor: RED }]} onPress={() => setSosModal(true)}>
                    <Text style={{ color: RED, fontSize: 14, fontWeight: '700' }}>🆘 SOS</Text>
                  </TouchableOpacity>
                </View>
              )}

              {['searching', 'assigned', 'accepted', 'arrived'].includes(order.status) && (
                <TouchableOpacity
                  style={[s.outlineBtn, { borderColor: RED, marginTop: 12, marginHorizontal: 16, justifyContent: 'center' }]}
                  onPress={() => setCancelModal(true)}
                  disabled={loading}>
                  <Text style={{ color: RED, fontSize: 14, fontWeight: '600' }}>Buyurtmani bekor qilish</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            </AnimatedSheet>
          </View>

        ) : orderStep === 'dest' ? (
          /* ── DEST STEP ── */
          <View style={s.fill}>
            {hasMap ? (
              <ClientMap
                ref={webviewRef}
                style={s.mapFull}
                source={mapSource}
                onMessage={onWebViewMessage}
              />
            ) : (
              <View style={[s.fill, s.center]}>
                <ActivityIndicator color={YELLOW} size="large" />
                <Text style={{ color: GRAY1, marginTop: 12 }}>GPS aniqlanmoqda...</Text>
              </View>
            )}

            {/* Greeting pill */}
            <View style={[s.greetPill, { top: insets.top + 12, left: 16 }]}>
              <Text style={s.greetPillTxt}>👋 {user?.name?.split(' ')[0] || 'Salom'}</Text>
            </View>

            {/* Avatar circle */}
            <TouchableOpacity style={[s.avatarCircle, { top: insets.top + 8, right: 16 }]} onPress={() => setTab('profile')}>
              <Text style={s.avatarInitial}>{(user?.name?.[0] || 'U').toUpperCase()}</Text>
            </TouchableOpacity>

            {/* Animated pin halo */}
            <View style={s.mapCenterPin} pointerEvents="none">
              <Animated.View style={[s.pinHalo, {
                opacity: pinAnim,
                transform: [{ scale: pinAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.2] }) }]
              }]} />
              <View style={s.pinDot} />
            </View>

            {/* Recenter button */}
            <TouchableOpacity
              style={[s.recenterBtn, { bottom: TABBAR_H + insets.bottom + 180 }]}
              onPress={async () => {
                const pos = await Location.getCurrentPositionAsync({});
                const lat = pos.coords.latitude, lng = pos.coords.longitude;
                setMyLoc({ lat, lng });
                const addr = await reverseGeocode(lat, lng);
                setPickup({ lat, lng, address: addr });
              }}>
              <Ionicons name="locate" size={20} color={WHITE} />
            </TouchableOpacity>

            {/* Bottom sheet */}
            <AnimatedSheet style={[s.homeSheet, { bottom: TABBAR_H + insets.bottom }]}>
              {/* Drag handle */}
              <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER }} />
              </View>
              <View style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '500', letterSpacing: 0.3 }}>
                      Salom, {user?.name?.split(' ')[0] || 'Foydalanuvchi'} 👋
                    </Text>
                    <Text style={{ color: WHITE, fontSize: 24, fontWeight: '800', marginTop: 1, letterSpacing: -0.5 }}>
                      Qayerga boramiz?
                    </Text>
                  </View>
                  {balance != null && balance > 0 && (
                    <View style={{ backgroundColor: YELLOW + '20', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: YELLOW + '50' }}>
                      <Text style={{ color: YELLOW, fontSize: 12, fontWeight: '700' }}>💰 {fmt(balance)}</Text>
                    </View>
                  )}
                </View>
              </View>

              {nearby.length > 0 && (
                <View style={s.nearbyCard}>
                  <View style={s.nearbyDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }}>🚕 {nearby.length} ta mashina mavjud</Text>
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>⏱ Taxminiy kutish: ~{nearby.length > 3 ? 2 : 4} daqiqa</Text>
                  </View>
                </View>
              )}

              <TouchableOpacity style={s.qayergaBtn} onPress={() => setSearchOpen(true)} activeOpacity={0.85}>
                <View style={s.qayergaIconWrap}>
                  <Ionicons name="search" size={20} color="#1A1A1A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>Qayerga borasiz?</Text>
                  <Text style={{ color: GRAY1, fontSize: 12, marginTop: 1 }}>Manzilni kiriting yoki tanlang</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={GRAY1} />
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                {/* Chap tomon: Uy va Ish (ixcham, yonma-yon) */}
                <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={s.shortBtnSm} activeOpacity={0.75}
                    onPress={() => homePlace ? pickDest(homePlace) : setSearchOpen(true)}
                    onLongPress={() => pickup && saveHomeWork('home', pickup)}>
                    <View style={s.shortBtnIconWrap}><Ionicons name="home" size={18} color={YELLOW} /></View>
                    <Text style={{ color: WHITE, fontSize: 13, fontWeight: '600', marginTop: 4 }}>Uy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.shortBtnSm} activeOpacity={0.75}
                    onPress={() => workPlace ? pickDest(workPlace) : setSearchOpen(true)}
                    onLongPress={() => pickup && saveHomeWork('work', pickup)}>
                    <View style={s.shortBtnIconWrap}><Ionicons name="briefcase" size={18} color={YELLOW} /></View>
                    <Text style={{ color: WHITE, fontSize: 13, fontWeight: '600', marginTop: 4 }}>Ish</Text>
                  </TouchableOpacity>
                </View>
                {/* O'ng tomon: 🎙 Ovozli buyurtma (eski "Ish" tugmasi o'rnida) */}
                <TouchableOpacity style={s.voiceBtn} activeOpacity={0.85} onPress={openVoiceOrder}>
                  <View style={s.voiceBtnIconWrap}><Ionicons name="mic" size={20} color="#1A1A1A" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#1A1A1A', fontSize: 14, fontWeight: '700' }}>Ovozli buyurtma</Text>
                    <Text style={{ color: '#1A1A1A', fontSize: 11, marginTop: 1, opacity: 0.7 }}>Manzilni gapiring 🎙</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </AnimatedSheet>

            {/* SEARCH OVERLAY */}
            {searchOpen && (
              <AnimatedSheet style={[s.searchOverlay, { paddingTop: insets.top }]}>
                <View style={s.searchTopBar}>
                  <TouchableOpacity style={s.searchBackBtn} onPress={() => { setSearchOpen(false); setSearchQ(''); setSearchResults([]); }}>
                    <Ionicons name="arrow-back" size={20} color={WHITE} />
                  </TouchableOpacity>
                  <TextInput
                    style={s.searchBigInput}
                    placeholder="Maktab, bozor, ko'cha..."
                    placeholderTextColor={GRAY2}
                    value={searchQ}
                    onChangeText={searchPlaces}
                    autoFocus
                    returnKeyType="search"
                  />
                </View>

                {pickup && (
                  <View style={s.pickupPill}>
                    <Ionicons name="ellipse" size={8} color={GREEN} style={{ marginRight: 6 }} />
                    <Text style={{ color: GRAY1, fontSize: 13 }} numberOfLines={1}>{pickup.address}</Text>
                  </View>
                )}

                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  showsVerticalScrollIndicator={false}>
                  {searchQ.length === 0 && (
                    <View style={s.listSection}>
                      <Text style={s.listSectionTitle}>SAQLANGAN</Text>
                      <TouchableOpacity style={s.placeRow}
                        onPress={() => homePlace ? pickDest(homePlace) : Alert.alert('Uy manzili', 'Uzun bosib saqlang')}
                        onLongPress={() => pickup ? saveHomeWork('home', pickup) : null}>
                        <View style={s.placeIconCircle}><Ionicons name="home" size={18} color={YELLOW} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.placeName}>Uy</Text>
                          <Text style={s.placeSub} numberOfLines={1}>{homePlace?.address || 'Uzun bosib saqlang'}</Text>
                        </View>
                      </TouchableOpacity>
                      <View style={s.placeSep} />
                      <TouchableOpacity style={s.placeRow}
                        onPress={() => workPlace ? pickDest(workPlace) : Alert.alert('Ish manzili', 'Uzun bosib saqlang')}
                        onLongPress={() => pickup ? saveHomeWork('work', pickup) : null}>
                        <View style={s.placeIconCircle}><Ionicons name="briefcase" size={18} color={YELLOW} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.placeName}>Ish</Text>
                          <Text style={s.placeSub} numberOfLines={1}>{workPlace?.address || 'Uzun bosib saqlang'}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  {searchResults.length > 0 && (
                    <View style={s.listSection}>
                      <Text style={s.listSectionTitle}>QIDIRUV NATIJALARI</Text>
                      {searchResults.slice(0, 6).map((p, i) => (
                        <View key={p.id || i}>
                          <TouchableOpacity style={s.placeRow} activeOpacity={0.7} onPress={() => pickDest({ ...p, address: p.name })}>
                            <View style={s.placeIconCircle}><Ionicons name="location" size={18} color={GRAY1} /></View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.placeName}>{p.name}</Text>
                              {p.district && <Text style={s.placeSub}>{p.district}</Text>}
                            </View>
                            {placePriceNode(p)}
                          </TouchableOpacity>
                          {i < searchResults.length - 1 && <View style={s.placeSep} />}
                        </View>
                      ))}
                    </View>
                  )}

                  {searchQ.length === 0 && recentPlaces.length > 0 && (
                    <View style={s.listSection}>
                      <Text style={s.listSectionTitle}>SO'NGGI MANZILLAR</Text>
                      {recentPlaces.map((p, i) => (
                        <View key={i}>
                          <TouchableOpacity style={s.placeRow} activeOpacity={0.7}
                            onPress={() => pickDest(p)}
                            onLongPress={() => Alert.alert('Sevimliga qo\'shish?', p.address, [{ text: 'Ha', onPress: () => addFavorite(p) }, { text: 'Yo\'q', style: 'cancel' }])}>
                            <View style={s.placeIconCircle}><Ionicons name="time" size={18} color={GRAY1} /></View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.placeName} numberOfLines={1}>{p.address}</Text>
                            </View>
                            {placePriceNode(p)}
                          </TouchableOpacity>
                          {i < recentPlaces.length - 1 && <View style={s.placeSep} />}
                        </View>
                      ))}
                    </View>
                  )}

                  {searchQ.length === 0 && popularPlaces.length > 0 && (
                    <View style={s.listSection}>
                      <Text style={s.listSectionTitle}>MASHHUR JOYLAR</Text>
                      {popularPlaces.map((p, i) => (
                        <View key={p.id || i}>
                          <TouchableOpacity style={s.placeRow} activeOpacity={0.7} onPress={() => pickDest({ lat: p.lat, lng: p.lng, address: p.name })}>
                            <View style={[s.placeIconCircle, { backgroundColor: '#1A1400' }]}><Ionicons name="location" size={18} color={YELLOW} /></View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.placeName}>{p.name}</Text>
                              {p.district && <Text style={s.placeSub}>{p.district}</Text>}
                            </View>
                            {placePriceNode(p)}
                          </TouchableOpacity>
                          {i < popularPlaces.length - 1 && <View style={s.placeSep} />}
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>
              </AnimatedSheet>
            )}
          </View>

        ) : orderStep === 'confirm' ? (
          /* ── CONFIRM STEP ── */
          <View style={s.fill}>
            {hasMap ? (
              <ClientMap
                ref={webviewRef}
                style={s.mapFull}
                source={mapSource}
                onMessage={onWebViewMessage}
              />
            ) : (
              <View style={[s.fill, s.center]}>
                <ActivityIndicator color={YELLOW} size="large" />
              </View>
            )}

            <View style={[s.floatTopBar, { top: insets.top + 12 }]}>
              <TouchableOpacity style={s.floatBackBtn} onPress={() => { setOrderStep('dest'); setDest(null); }}>
                <Ionicons name="arrow-back" size={20} color={WHITE} />
              </TouchableOpacity>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="ellipse" size={10} color={GREEN} />
                  <Text style={s.routeAddr} numberOfLines={1}>{pickup?.address || '...'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="square" size={10} color={YELLOW} />
                  <Text style={s.routeAddr} numberOfLines={1}>{dest?.address || '...'}</Text>
                </View>
              </View>
            </View>

            <AnimatedSheet style={[s.confirmSheet, { bottom: TABBAR_H + insets.bottom }]}>
              <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                Olib ketish nuqtasini xaritada to'g'rilang yoki tasdiqlang
              </Text>
              <TouchableOpacity style={s.ctaBtn} onPress={() => { setEstimates({}); estCacheKey.current = null; setOrderStep('tariff'); }}>
                <Text style={s.ctaBtnTxt}>TASDIQLASH →</Text>
              </TouchableOpacity>
            </AnimatedSheet>
          </View>

        ) : orderStep === 'tariff' ? (
          /* ── TARIFF STEP ── */
          <View style={s.fill}>
            {hasMap ? (
              <ClientMap
                ref={webviewRef}
                style={s.mapFull}
                source={mapSource}
                onMessage={onWebViewMessage}
              />
            ) : (
              <View style={[s.fill, s.center]}>
                <ActivityIndicator color={YELLOW} size="large" />
              </View>
            )}

            <View style={[s.floatTopBar, { top: insets.top + 12 }]}>
              <TouchableOpacity style={s.floatBackBtn} onPress={() => setOrderStep('confirm')}>
                <Ionicons name="arrow-back" size={20} color={WHITE} />
              </TouchableOpacity>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="ellipse" size={10} color={GREEN} />
                  <Text style={s.routeAddr} numberOfLines={1}>{pickup?.address || '...'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="square" size={10} color={YELLOW} />
                  <Text style={s.routeAddr} numberOfLines={1}>{dest?.address || '...'}</Text>
                </View>
              </View>
            </View>

            <AnimatedSheet style={[s.tariffScroll, { bottom: TABBAR_H + insets.bottom }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingTop: 16 }}>
              {estLoading && Object.keys(estimates).length === 0 ? (
                CAR_CLASSES.map((c) => (
                  <View key={c.id} style={s.tariffCard}>
                    <Skeleton width={56} height={56} radius={28} />
                    <View style={{ flex: 1, marginLeft: 14, gap: 8 }}>
                      <Skeleton width={100} height={15} />
                      <Skeleton width={160} height={11} />
                      <Skeleton width={120} height={10} />
                    </View>
                    <Skeleton width={80} height={20} />
                  </View>
                ))
              ) : CAR_CLASSES.map((c) => {
                const est = estimates[c.id];
                const active = carClass === c.id;
                return (
                  <TouchableOpacity key={c.id}
                    style={[s.tariffCard, active && s.tariffCardActive, active && { borderColor: c.color }]}
                    activeOpacity={0.8}
                    onPress={() => setCarClass(c.id)}>
                    {/* Left color accent bar */}
                    <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: active ? c.color : 'transparent' }} />
                    <CarClassIcon c={c} size={56} active={active} image={carImages[c.id]} />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: active ? c.color : WHITE, fontSize: 16, fontWeight: '700' }}>{c.label}</Text>
                        {c.badge && (
                          <View style={{ backgroundColor: c.color + '33', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ color: c.color, fontSize: 10, fontWeight: '700' }}>{c.badge}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: GRAY1, fontSize: 11, marginTop: 2 }}>{c.models}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          <Text style={{ fontSize: 10 }}>👤</Text>
                          <Text style={{ color: GRAY2, fontSize: 11 }}>{c.seats} o'rin</Text>
                        </View>
                        {c.features.map((f) => (
                          <View key={f} style={{ backgroundColor: CARD, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ color: GRAY1, fontSize: 10 }}>{f}</Text>
                          </View>
                        ))}
                        {est?.surge > 1 && <View style={{ backgroundColor: '#FF6B0022', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: '#FF6B00', fontSize: 10 }}>⚡ Talabga qarab</Text></View>}
                        {est?.is_night && <View style={{ backgroundColor: '#1E3A5F', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: '#93C5FD', fontSize: 10 }}>🌙 Tungi</Text></View>}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', minWidth: 88 }}>
                      {est ? (
                        <>
                          {est.discount_percent > 0 && <Text style={{ color: GRAY2, fontSize: 11, textDecorationLine: 'line-through' }}>{fmt(est.base_price)}</Text>}
                          <Text style={{ color: active ? c.color : WHITE, fontSize: active ? 20 : 17, fontWeight: '800' }}>
                            {fmt(est.price)}
                          </Text>
                          <Text style={{ color: GRAY2, fontSize: 10 }}>so'm</Text>
                          {est.duration_min && <Text style={{ color: GRAY1, fontSize: 11, marginTop: 2 }}>~{est.duration_min} daq</Text>}
                        </>
                      ) : estLoading ? <ActivityIndicator color={c.color} size="small" /> : <Text style={{ color: GRAY2, fontSize: 12 }}>—</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}

              <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 10, letterSpacing: 0.5, marginHorizontal: 16 }}>TO'LOV USULI</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, paddingHorizontal: 16 }}>
                {payMethods.map((m) => {
                  const active = payMethod === m.id;
                  const disabled = m.active === false;
                  return (
                    <TouchableOpacity key={m.id}
                      style={[s.payChip, active && s.payChipActive, disabled && { opacity: 0.4 }]}
                      disabled={disabled}
                      activeOpacity={0.75}
                      onPress={() => setPayMethod(m.id)}>
                      <Text style={[s.payChipTxt, active && { color: '#000', fontWeight: '700' }]}>
                        {PAY_ICONS[m.id] || '💳'} {m.name}{disabled ? ' (tez kunda)' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={[s.orderCta, (!estimates[carClass] || loading) && { opacity: 0.5 }]}
                activeOpacity={0.85}
                onPress={createOrder}
                disabled={loading || !estimates[carClass]}>
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.orderCtaTxt}>🚖 BUYURTMA BERISH{estimates[carClass] ? ` · ${fmt(estimates[carClass].price)} so'm` : ''}</Text>}
              </TouchableOpacity>
            </ScrollView>
            </AnimatedSheet>
          </View>
        ) : null
      )}

      {/* ===== TRIPS TAB ===== */}
      {tab === 'trips' && (
        <View style={[s.tabBody, { paddingTop: insets.top }]}>
          <View style={s.tabHeaderArea}>
            <Text style={s.tabHeaderSub}>Sayohatlaringiz</Text>
            <Text style={s.tabHeaderTitle}>Tarix</Text>
          </View>

          <FlatList
            data={groupedTrips}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            keyExtractor={(item, i) => item.type === 'header' ? 'h' + i : String(item.item.id)}
            ListEmptyComponent={
              <View style={s.emptyState}>
                <Text style={{ fontSize: 48 }}>🚕</Text>
                <Text style={{ color: GRAY1, fontSize: 15, marginTop: 12 }}>Hali safar yo'q</Text>
              </View>
            }
            renderItem={({ item: row }) => {
              if (row.type === 'header') return (
                <Text style={s.dayLabel}>{row.label}</Text>
              );
              const t = row.item;
              const isCompleted = t.status === 'completed';
              const isCancelled = t.status === 'cancelled';
              const timeStr = t.created_at ? new Date(t.created_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <TouchableOpacity style={s.tripCard} activeOpacity={0.85}
                  onLongPress={() => pickDest({ lat: Number(t.to_lat), lng: Number(t.to_lng), address: t.to_address })}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={{ color: GRAY1, fontSize: 13 }}>{timeStr}</Text>
                    <View style={[s.statusBadge, isCompleted && s.statusBadgeGreen, isCancelled && s.statusBadgeGray]}>
                      <Text style={[s.statusBadgeTxt, isCompleted && { color: '#000' }, isCancelled && { color: GRAY1 }]}>
                        {isCompleted ? 'Yakunlangan' : isCancelled ? 'Bekor qilingan' : statusText(t.status)}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ alignItems: 'center', paddingTop: 3 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: GRAY1 }} />
                      <View style={{ width: 1.5, height: 24, backgroundColor: GRAY2, marginVertical: 2 }} />
                      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: YELLOW }} />
                    </View>
                    <View style={{ flex: 1, gap: 14 }}>
                      <Text style={{ color: GRAY1, fontSize: 13 }} numberOfLines={1}>{t.from_address || '—'}</Text>
                      <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{t.to_address || '—'}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Text style={{ color: WHITE, fontSize: 15, fontWeight: '700' }}>{fmt(t.price)} so'm</Text>
                      {t.distance_km && <Text style={{ color: GRAY1, fontSize: 13 }}>{t.distance_km} km</Text>}
                    </View>
                    {t.to_lat && t.to_lng && (
                      <TouchableOpacity onPress={() => pickDest({ lat: Number(t.to_lat), lng: Number(t.to_lng), address: t.to_address })}>
                        <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '600' }}>↻ Takrorlash</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TABBAR_H + insets.bottom + 16 }}
          />
        </View>
      )}

      {/* ===== HELP TAB ===== */}
      {tab === 'help' && (
        <View style={[s.tabBody, { paddingTop: insets.top }]}>
          <View style={s.tabHeaderArea}>
            <Text style={s.tabHeaderSub}>Sizga qanday yordam bera olamiz?</Text>
            <Text style={s.tabHeaderTitle}>Yordam markazi</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TABBAR_H + insets.bottom + 16 }}>
            <TouchableOpacity style={s.operatorHeroCard} onPress={() => Linking.openURL('tel:+998712345678')} activeOpacity={0.85}>
              <View style={s.operatorIconWrap}>
                <Ionicons name="call" size={28} color={YELLOW} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700' }}>Operator bilan bog'lanish</Text>
                <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>24/7 jonli qo'llab-quvvatlash</Text>
              </View>
              <View style={s.onlineBadge}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN, marginRight: 5 }} />
                <Text style={{ color: GREEN, fontSize: 12, fontWeight: '600' }}>Onlayn</Text>
              </View>
            </TouchableOpacity>

            <Text style={[s.listSectionTitle, { paddingHorizontal: 0, marginTop: 20 }]}>MAVZULAR</Text>
            <View style={s.helpTopicsCard}>
              {[
                { icon: 'document-text', label: 'Tez-tez beriladigan savollar', sub: "FAQ — eng ko'p so'raladi",
                  answer: "❓ Tez-tez beriladigan savollar\n\n🔹 Haydovchi qancha kutadi?\n3 daqiqa bepul, keyin har daqiqaga qo'shimcha haq.\n\n🔹 Bekor qilsam jarima bo'ladimi?\nHaydovchi yetib kelgandan so'ng bekor qilsangiz — ha, kichik jarima.\n\n🔹 Bonus qanday ishlaydi?\nHar safardan % keshbek hisoblanadi, keyingi safarda ishlatiladi.\n\n🔹 Ovozli buyurtma nima?\nManzilni ovozda ayting — haydovchi eshitib keladi. Narx km+vaqt bo'yicha." },
                { icon: 'card', label: "To'lov muammolari", sub: 'Karta, balans, cashback',
                  answer: "💳 To'lov bo'yicha yordam\n\n🔹 Naqd to'lov: haydovchiga safar oxirida berasiz.\n\n🔹 Bonus balans: profil bo'limida ko'rinadi. Safar buyurtmasida 'Bonus ishlatish' ni yoqing.\n\n🔹 Karta to'lovi: tez kunda faollashtiriladi.\n\n🔹 Muammo bo'lsa — operator bilan bog'laning (yuqoridagi chat tugmasi)." },
                { icon: 'person', label: 'Safar muammolari', sub: 'Buyurtma, kutish, manzil',
                  answer: "🚕 Safar muammolari\n\n🔹 Haydovchi kelmayapti — /holat tugmasini bosing, haydovchi bilan bog'laning.\n\n🔹 Manzilni o'zgartirish — safar davomida 'Manzilni o'zgartirish' tugmasini bosing.\n\n🔹 Narx kutilgandan ko'p — narx km+kutish asosida hisoblanadi, app'dagi taxmin yo'l qisqaligiga bog'liq.\n\n🔹 Muammo davom etsa — operatorga murojaat qiling." },
                { icon: 'flag', label: 'Haydovchi shikoyati', sub: 'Xizmat sifati, xulq',
                  answer: "🚩 Haydovchi haqida shikoyat\n\nSafar yakunlangach yulduz bering va izoh qoldiring — bu bizga muhim.\n\nJiddiy muammo bo'lsa:\n• Operatorga chat orqali yozing\n• Yoki +998 XX XXX-XX-XX ga qo'ng'iroq qiling\n\nBarcha shikoyatlar 24 soat ichida ko'rib chiqiladi." },
              ].map((item, idx, arr) => (
                <View key={idx}>
                  <TouchableOpacity style={s.helpTopicRow} activeOpacity={0.7} onPress={() => Alert.alert(item.label, item.answer)}>
                    <View style={s.helpTopicIconWrap}><Ionicons name={item.icon} size={18} color={GRAY1} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: WHITE, fontSize: 15 }}>{item.label}</Text>
                      <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>{item.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={GRAY2} />
                  </TouchableOpacity>
                  {idx < arr.length - 1 && <View style={s.placeSep} />}
                </View>
              ))}
            </View>

            <TouchableOpacity style={s.aiEntryCard} activeOpacity={0.8} onPress={() => {}}>
              <Ionicons name="sparkles" size={18} color={YELLOW} style={{ marginRight: 10 }} />
              <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>ELGA AI yordamchi</Text>
              <View style={{ backgroundColor: GRAY2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: WHITE, fontSize: 11, fontWeight: '600' }}>Beta</Text>
              </View>
            </TouchableOpacity>

            {chat.length > 0 && (
              <ScrollView style={{ maxHeight: 200, marginTop: 8 }} showsVerticalScrollIndicator={false}>
                {chat.map((m, i) => (
                  <View key={i} style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAI]}>
                    <Text style={m.role === 'user' ? s.bubbleUserTxt : s.bubbleAITxt}>{m.text}</Text>
                  </View>
                ))}
                {chatLoading && <ActivityIndicator color={YELLOW} style={{ marginTop: 8 }} />}
              </ScrollView>
            )}
            <View style={[s.chatRow, { marginTop: 10 }]}>
              <TextInput
                style={s.chatInput}
                placeholder="Savolingiz..."
                placeholderTextColor={GRAY2}
                value={chatInput}
                onChangeText={setChatInput}
              />
              <TouchableOpacity style={s.chatSendBtn} onPress={sendChat}>
                <Ionicons name="send" size={18} color="#000" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}

      {/* ===== PROFILE TAB ===== */}
      {tab === 'profile' && (
        <ScrollView style={[s.tabBody, { paddingTop: insets.top }]} contentContainerStyle={{ paddingBottom: TABBAR_H + insets.bottom + 24 }}>
          <View style={s.tabHeaderArea}>
            <Text style={s.tabHeaderTitle}>Profil</Text>
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            <View style={s.profileCard}>
              <View style={s.profileAvatarRing}>
                <View style={s.profileAvatarInner}>
                  <Text style={{ fontSize: 28, color: YELLOW, fontWeight: '700' }}>{(user?.name?.[0] || 'U').toUpperCase()}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: WHITE, fontSize: 20, fontWeight: '700' }}>{user?.name || 'Mijoz'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  {!!user?.rating && <Text style={{ color: GRAY1, fontSize: 14 }}>⭐ {user.rating}</Text>}
                  <Text style={{ color: GRAY1, fontSize: 14 }}>{fmtPhone(user?.phone)}</Text>
                </View>
              </View>
            </View>

            {balance && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                {!(HIDE_BALANCE_IF_NONPOSITIVE && Number(balance.balance) <= 0) && (
                  <View style={[s.statCard, { flex: 1 }]}>
                    <Ionicons name="wallet" size={16} color={GRAY1} style={{ marginBottom: 6 }} />
                    <Text style={{ color: GRAY1, fontSize: 11, fontWeight: '600' }}>Balans</Text>
                    <Text style={{ color: YELLOW, fontSize: 20, fontWeight: '700', marginTop: 2 }}>{fmt(balance.balance)}</Text>
                    <Text style={{ color: GRAY1, fontSize: 11 }}>so'm</Text>
                  </View>
                )}
                <View style={[s.statCard, { flex: 1 }]}>
                  <Ionicons name="gift" size={16} color={GRAY1} style={{ marginBottom: 6 }} />
                  <Text style={{ color: GRAY1, fontSize: 11, fontWeight: '600' }}>Cashback</Text>
                  <Text style={{ color: WHITE, fontSize: 20, fontWeight: '700', marginTop: 2 }}>{fmt(balance.pending_cashback)}</Text>
                  <Text style={{ color: GRAY1, fontSize: 11 }}>so'm</Text>
                  {balance.pending_cashback > 0 && (
                    <TouchableOpacity style={[s.ctaBtn, { marginTop: 8, paddingVertical: 8 }]} onPress={claimCashback}>
                      <Text style={[s.ctaBtnTxt, { fontSize: 12 }]}>OLISH</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {balance?.referral_code && (
              <TouchableOpacity style={s.referralCard} activeOpacity={0.85}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Ionicons name="gift" size={22} color={YELLOW} style={{ marginRight: 12 }} />
                  <View>
                    <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }}>Do'stni taklif qiling</Text>
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>
                      Referal kodi: <Text style={{ color: YELLOW, fontWeight: '700' }}>{balance.referral_code}</Text>
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={GRAY1} />
              </TouchableOpacity>
            )}

            <View style={[s.menuCard, { marginTop: 16 }]}>
              {[
                { icon: 'heart', label: 'Sevimli joylar', value: favorites.length > 0 ? `${favorites.length}` : null, onPress: () => Alert.alert('Sevimli joylar', favorites.length > 0 ? favorites.map(f => f.name).join('\n') : "Hali yo'q") },
                { icon: 'card', label: "To'lov usullari", value: null, onPress: () => Alert.alert("To'lov usullari", "💵 Naqd — haydovchiga to'laysiz\n\n💰 Bonus balans — har safardan keshbek, keyingi safarda ishlatiladi\n\n💳 Karta — tez kunda. Payme, Click, Uzcard qo'shiladi") },
                { icon: 'time', label: 'Safarlar tarixi', value: null, onPress: () => { setTab('trips'); loadTrips(); } },
                { icon: 'shield-checkmark', label: 'Xavfsizlik va SOS', value: null, onPress: () => setSosModal(true) },
                { icon: 'headset', label: 'Yordam markazi', value: null, onPress: () => setTab('help') },
              ].map((item, idx, arr) => (
                <View key={idx}>
                  <TouchableOpacity style={s.menuRow} onPress={item.onPress} activeOpacity={0.7}>
                    <View style={s.menuIconWrap}><Ionicons name={item.icon} size={18} color={GRAY1} /></View>
                    <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>{item.label}</Text>
                    {item.value && <Text style={{ color: GRAY1, fontSize: 13, marginRight: 6 }}>{item.value}</Text>}
                    <Ionicons name="chevron-forward" size={15} color={GRAY2} />
                  </TouchableOpacity>
                  {idx < arr.length - 1 && <View style={s.placeSep} />}
                </View>
              ))}
            </View>

            <TouchableOpacity style={s.logoutBtn} onPress={confirmLogout} activeOpacity={0.8}>
              <Ionicons name="log-out" size={18} color={RED} style={{ marginRight: 8 }} />
              <Text style={{ color: RED, fontSize: 15, fontWeight: '600' }}>Chiqish</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ===== TAB BAR ===== */}
      <View style={[s.tabBar, { height: TABBAR_H + insets.bottom, paddingBottom: insets.bottom }]}>
        {[
          { id: 'order', icon: 'car', label: 'Buyurtma' },
          { id: 'trips', icon: 'time', label: 'Tarix', onLoad: loadTrips },
          { id: 'help', icon: 'headset', label: 'Yordam' },
          { id: 'profile', icon: 'person', label: 'Profil', onLoad: loadBalance },
        ].map(t => {
          const active = tab === t.id;
          return (
            <TouchableOpacity key={t.id} style={s.tabItem} activeOpacity={0.7}
              onPress={() => { setTab(t.id); t.onLoad?.(); }}>
              <Ionicons name={active ? t.icon : t.icon + '-outline'} size={24} color={active ? YELLOW : GRAY2} />
              <Text style={{ fontSize: 10, color: active ? YELLOW : GRAY2, marginTop: 3, fontWeight: active ? '600' : '400' }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ===== MODALS ===== */}

      {/* Trip Chat Modal */}
      <Modal visible={tripChatModal} transparent animationType="slide" onRequestClose={() => setTripChatModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { height: '70%', paddingBottom: insets.bottom + 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Text style={s.modalTitle}>Haydovchi bilan chat</Text>
              <TouchableOpacity onPress={() => setTripChatModal(false)} style={{ marginLeft: 'auto' }}>
                <Ionicons name="close" size={24} color={GRAY1} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }}>
              {tripChat.map((m, i) => (
                <View key={i} style={[s.bubble, m.role === 'customer' ? s.bubbleUser : s.bubbleAI]}>
                  <Text style={m.role === 'customer' ? s.bubbleUserTxt : s.bubbleAITxt}>{m.text}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={s.chatRow}>
              <TextInput
                style={s.chatInput}
                placeholder="Xabar..."
                placeholderTextColor={GRAY2}
                value={tripChatInput}
                onChangeText={setTripChatInput}
              />
              <TouchableOpacity style={s.chatSendBtn} onPress={sendTripChat}>
                <Ionicons name="send" size={18} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SOS Modal */}
      {/* 🎙 Ovozli buyurtma modali */}
      <Modal visible={voiceModal} transparent animationType="slide" onRequestClose={closeVoiceOrder}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16, alignItems: 'center' }]}>
            <Text style={[s.modalTitle, { color: WHITE }]}>🎙 Ovozli buyurtma</Text>
            <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginBottom: 20, paddingHorizontal: 10 }}>
              Tugmani bosib ushlab turing va qayerga borishingizni tabiiy gapiring.
              Masalan: «Meni Muzrabot bozoriga olib boring».
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={voiceParsing}
              onPressIn={startVoiceRecording}
              onPressOut={stopVoiceRecording}
              style={[s.voiceRecBtn, recording && { backgroundColor: RED, transform: [{ scale: 1.08 }] }, voiceParsing && { opacity: 0.6 }]}>
              <Ionicons name={recording ? 'radio' : 'mic'} size={48} color="#1A1A1A" />
            </TouchableOpacity>

            {voiceParsing ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
                <ActivityIndicator color={YELLOW} />
                <Text style={{ color: GRAY1, fontSize: 15, fontWeight: '600' }}>Tahlil qilinmoqda…</Text>
              </View>
            ) : (
              <Text style={{ color: recording ? RED : GRAY1, fontSize: 15, fontWeight: '600', marginTop: 18 }}>
                {recording ? `● Yozilmoqda… ${voiceSec}s` : 'Bosib ushlab turing'}
              </Text>
            )}

            {/* AI eshitgan matn */}
            {!!voiceHeard && !voiceParsing && (
              <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginTop: 10, paddingHorizontal: 10, fontStyle: 'italic' }} numberOfLines={2}>
                «{voiceHeard}»
              </Text>
            )}

            {/* Aniqlashtirish savoli (noaniq manzil) */}
            {!!voiceClarify && !voiceParsing && (
              <View style={{ backgroundColor: CARD2, borderRadius: 12, padding: 14, marginTop: 14, width: '100%', borderWidth: 1, borderColor: YELLOW + '66' }}>
                <Text style={{ color: YELLOW, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{voiceClarify}</Text>
                <Text style={{ color: GRAY1, fontSize: 12, textAlign: 'center', marginTop: 6 }}>
                  Tugmani bosib qayta gapiring yoki qo'lda qidiring.
                </Text>
                <TouchableOpacity
                  onPress={() => { setVoiceModal(false); setVoiceClarify(''); setSearchOpen(true); }}
                  style={{ marginTop: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: YELLOW, borderRadius: 10 }} activeOpacity={0.85}>
                  <Text style={{ color: '#1A1A1A', fontSize: 14, fontWeight: '700' }}>🔍 Qo'lda qidirish</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity onPress={closeVoiceOrder} style={{ marginTop: 20, alignItems: 'center' }}>
              <Text style={{ color: GRAY1, fontSize: 15 }}>Yopish</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={sosModal} transparent animationType="slide" onRequestClose={() => setSosModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={[s.modalTitle, { color: RED }]}>🆘 Favqulodda yordam</Text>
            {[{ num: '101', label: "Yong'in" }, { num: '102', label: 'Militsiya' }, { num: '103', label: 'Tez yordam' }].map(s_ => (
              <TouchableOpacity key={s_.num} style={[s.ctaBtn, { backgroundColor: RED, marginBottom: 10 }]}
                onPress={() => Linking.openURL(`tel:${s_.num}`)}>
                <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>{s_.num} — {s_.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.ctaBtn} onPress={shareTrip}>
              <Text style={s.ctaBtnTxt}>📍 Joylashuvni ulashish</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSosModal(false)} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: GRAY1, fontSize: 15 }}>Bekor qilish</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manzilni o'zgartirish modali */}
      <Modal visible={changeDestModal} transparent animationType="slide" onRequestClose={() => setChangeDestModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16, maxHeight: '75%' }]}>
            <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>Yangi manzil</Text>
            <Text style={{ color: GRAY1, fontSize: 12, marginBottom: 12 }}>
              Manzil o'zgarsa, narx yangi masofa bo'yicha qayta hisoblanadi.
            </Text>
            <TextInput
              style={s.searchBigInput}
              placeholder="Manzilni qidiring..."
              placeholderTextColor="#555"
              value={cdQ}
              onChangeText={cdSearch}
              autoFocus
            />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 8 }}>
              {cdResults.map((p, i) => (
                <TouchableOpacity
                  key={p.id || i}
                  style={s.placeRow}
                  activeOpacity={0.7}
                  onPress={() => applyChangeDest(p)}
                  disabled={loading}
                >
                  <View style={[s.placeIconCircle, { backgroundColor: '#1A1400' }]}>
                    <Ionicons name="location" size={18} color={YELLOW} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.placeName}>{p.name}</Text>
                    {p.district && <Text style={s.placeSub}>{p.district}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
              {cdQ.length >= 2 && cdResults.length === 0 && (
                <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>Topilmadi</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[s.outlineBtn, { justifyContent: 'center', marginTop: 12 }]}
              onPress={() => setChangeDestModal(false)}
            >
              <Text style={{ color: GRAY1, fontSize: 14 }}>Bekor</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Cancel Modal */}
      <Modal visible={cancelModal} transparent animationType="slide" onRequestClose={() => setCancelModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.modalTitle}>Bekor qilish sababi</Text>
            <View style={s.helpTopicsCard}>
              {CANCEL_REASONS.map((r, i, arr) => (
                <View key={i}>
                  <TouchableOpacity style={s.helpTopicRow} onPress={() => confirmCancel(r)}>
                    <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>{r}</Text>
                    <Ionicons name="chevron-forward" size={15} color={GRAY2} />
                  </TouchableOpacity>
                  {i < arr.length - 1 && <View style={s.placeSep} />}
                </View>
              ))}
            </View>
            <TextInput
              style={[s.chatInput, { marginTop: 12 }]}
              placeholder="Boshqa sabab..."
              placeholderTextColor={GRAY2}
              value={customReason}
              onChangeText={setCustomReason}
            />
            {customReason.trim().length > 2 && (
              <TouchableOpacity style={[s.ctaBtn, { backgroundColor: RED, marginTop: 10 }]} onPress={() => confirmCancel(customReason)}>
                <Text style={{ color: WHITE, fontWeight: '700', fontSize: 15 }}>BEKOR QILISH</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setCancelModal(false)} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: GRAY1 }}>Ortga</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rate Modal */}
      <Modal visible={rateModal} transparent animationType="slide" onRequestClose={() => setRateModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            {/* Safar yakuni sarlavhasi */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: GREEN + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Ionicons name="checkmark-circle" size={30} color={GREEN} />
              </View>
              <Text style={s.modalTitle}>Safar yakunlandi</Text>
            </View>

            {/* Hisob-kitob (wait_fee bo'lsa qatorlar bilan) */}
            {completedOrder && (() => {
              const waitFee = Number(completedOrder.wait_fee || 0);
              const total   = Number(completedOrder.price || 0);
              const base    = waitFee > 0 ? total - waitFee : total;
              return (
                <View style={{ backgroundColor: CARD2, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 16 }}>
                  {waitFee > 0 && (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: GRAY1, fontSize: 13 }}>Safar narxi</Text>
                        <Text style={{ color: WHITE, fontSize: 13, fontWeight: '500' }}>{fmt(base)} so'm</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Ionicons name="time" size={13} color={RED} />
                          <Text style={{ color: RED, fontSize: 13 }}>Kutish haqi</Text>
                        </View>
                        <Text style={{ color: RED, fontSize: 13, fontWeight: '600' }}>+{fmt(waitFee)} so'm</Text>
                      </View>
                      <View style={{ height: 1, backgroundColor: BORDER, marginBottom: 10 }} />
                    </>
                  )}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>Jami to'lov</Text>
                    <Text style={{ color: YELLOW, fontSize: 22, fontWeight: '800' }}>{fmt(total)} so'm</Text>
                  </View>
                  <Text style={{ color: GRAY1, fontSize: 12, marginTop: 4 }}>
                    {completedOrder.payment_method === 'cash' ? '💵 Naqd to\'lov' : '💳 Karta orqali'}
                    {completedOrder.distance_km ? ` · ${completedOrder.distance_km} km` : ''}
                  </Text>
                </View>
              );
            })()}

            {/* Yulduzli baho */}
            <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginBottom: 10 }}>Haydovchini baholang</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setStars(n)}>
                  <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={38} color={YELLOW} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Choychaqa */}
            <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 8 }}>Choychaqa (ixtiyoriy)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
              {[0, 2000, 5000, 10000].map(a => (
                <TouchableOpacity key={a} style={[s.payChip, tipAmount === a && s.payChipActive]}
                  onPress={() => setTipAmount(a)}>
                  <Text style={[s.payChipTxt, tipAmount === a && { color: '#000', fontWeight: '700' }]}>
                    {a === 0 ? "Yo'q" : `${fmt(a)}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.ctaBtn} onPress={submitRating} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>BAHOLASH</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function statusText(status) {
  const m = {
    searching:   '🔍 Haydovchi qidirilmoqda...',
    assigned:    '🔍 Haydovchi qidirilmoqda...',
    accepted:    "🚗 Haydovchi yo'lda",
    arrived:     '✅ Haydovchi yetib keldi!',
    in_progress: '🛣️ Safar davom etmoqda',
    completed:   '🏁 Safar yakunlandi',
    cancelled:   '❌ Bekor qilindi',
    paid:        "✅ To'landi",
  };
  return m[status] || status;
}

// Kutish haqi (backend config bilan mos: FREE_WAIT_SEC=120, WAIT_PER_MIN=500, max 20000)
const FREE_WAIT_SEC = 120;
const WAIT_PER_MIN = 500;
const WAIT_FEE_MAX = 20000;
function waitFeeFromSec(sec) {
  const bill = Math.max(0, (sec || 0) - FREE_WAIT_SEC);
  return Math.min(WAIT_FEE_MAX, Math.ceil(bill / 60) * WAIT_PER_MIN);
}

// Jonli kutish taymeri — haydovchi yetib kelgach mijozga ko'rsatiladi
function CustomerWaitTimer({ arrivedAt }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const start = arrivedAt
      ? Date.parse(String(arrivedAt).replace(' ', 'T') + 'Z') || Date.now()
      : Date.now();
    const tick = () => setSec(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [arrivedAt]);
  const free = sec < FREE_WAIT_SEC;
  const remain = Math.max(0, FREE_WAIT_SEC - sec);
  const mm = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const fee = waitFeeFromSec(sec);
  return (
    <View style={{
      backgroundColor: CARD2, borderRadius: 14, padding: 14, marginTop: 12, marginHorizontal: 16,
      alignItems: 'center', borderWidth: 1, borderColor: free ? GREEN + '40' : RED + '40',
    }}>
      <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>⏱ Haydovchi kutmoqda · {mm(sec)}</Text>
      {free ? (
        <Text style={{ color: GREEN, fontSize: 13, marginTop: 4 }}>Bepul kutish: {mm(remain)} qoldi</Text>
      ) : (
        <Text style={{ color: RED, fontSize: 13, fontWeight: '600', marginTop: 4 }}>
          Pullik kutish · {fmt(fee)} so'm qo'shiladi
        </Text>
      )}
    </View>
  );
}

// Skeleton shimmer — yuklanish paytida joy ushlab turadi (reference: .elga-skeleton)
function Skeleton({ width = '100%', height = 16, radius = 8, style }) {
  const op = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 1, duration: 750, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0.35, duration: 750, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: '#1E1E1E', opacity: op }, style]} />;
}

// Pastki sheet'lar uchun yumshoq "pastdan ko'tarilish" animatsiyasi (reference: elgaSheetUp)
function AnimatedSheet({ style, children, ...rest }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 140, mass: 0.8 }).start();
  }, []);
  return (
    <Animated.View
      {...rest}
      style={[style, {
        opacity: a,
        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}

// Yengil fade + yumshoq ko'tarilish. delay bilan ketma-ket (stagger) ishlaydi.
// useNativeDriver: true — UI thread'da, telefonni qiynamaydi.
function FadeInView({ children, delay = 0, from = 16, duration = 420, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(a, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// Bosilganda yumshoq kichrayadigan tugma — premium his, lekin yengil.
function PressableScale({ children, onPress, disabled, style, scaleTo = 0.96, ...rest }) {
  const sc = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(sc, { toValue: v, useNativeDriver: true, damping: 15, stiffness: 320, mass: 0.5 }).start();
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && to(scaleTo)}
      onPressOut={() => to(1)}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale: sc }] }]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}

// Design tokens (also available in styles)
const BG = '#0A0A0A';
const CARD = '#141414';
const CARD2 = '#1E1E1E';
const BORDER = '#282828';
const YELLOW = '#FFC700';
const GREEN = '#22C55E';
const RED = '#FF453A';
const WHITE = '#FFFFFF';
const GRAY1 = '#8E8E93';
const GRAY2 = '#48484A';

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  bootScreen: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  mapFull: { flex: 1 },
  loginWrap: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 32 },
  input: { backgroundColor: CARD2, borderRadius: 14, padding: 16, fontSize: 16, color: WHITE, marginTop: 12 },
  ctaBtn: { backgroundColor: YELLOW, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  ctaBtnTxt: { color: '#000', fontSize: 17, fontWeight: '700' },

  // Map overlays
  greetPill: {
    position: 'absolute',
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  greetPillTxt: { color: WHITE, fontSize: 13, fontWeight: '600' },
  avatarCircle: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD2,
    borderWidth: 2,
    borderColor: YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: YELLOW, fontSize: 18, fontWeight: '700' },
  mapCenterPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -15,
    marginTop: -15,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHalo: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: YELLOW + '30',
    borderWidth: 1.5,
    borderColor: YELLOW + '60',
  },
  pinDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: YELLOW },
  recenterBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD2,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Home sheet
  homeSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 24,
  },
  nearbyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  nearbyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  qayergaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: YELLOW,
    gap: 12,
  },
  qayergaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 14,
    height: 68,
    paddingHorizontal: 12,
    gap: 10,
  },
  shortBtnSm: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD2,
    borderRadius: 14,
    height: 68,
    paddingHorizontal: 6,
  },
  shortBtnIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: YELLOW,
    borderRadius: 14,
    height: 68,
    paddingHorizontal: 12,
    gap: 10,
  },
  voiceBtnIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceRecBtn: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  // Search overlay
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, zIndex: 100 },
  searchTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  searchBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CARD2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBigInput: {
    flex: 1,
    height: 52,
    backgroundColor: CARD2,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: WHITE,
  },
  pickupPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
  listSection: { paddingHorizontal: 16, marginTop: 16 },
  listSectionTitle: { color: GRAY2, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  placeIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeName: { color: WHITE, fontSize: 15, fontWeight: '500' },
  placeSub: { color: GRAY1, fontSize: 12, marginTop: 2 },
  placeSep: { height: 0.5, backgroundColor: BORDER, marginLeft: 52 },

  // Confirm / Tariff floating bar
  floatTopBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  floatBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeAddr: { color: WHITE, fontSize: 13, flex: 1 },
  confirmSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  tariffScroll: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Sheet faqat "bottom" bilan ankor edi -> kontent ekrandan baland bo'lsa
    // yuqoriga cheksiz cho'zilib, birinchi karta ("Tejamkor") ekrandan chiqib
    // ketardi va ichki ScrollView scroll qilmasdi. maxHeight bilan chegaralaymiz.
    maxHeight: SCREEN_H * 0.78,
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  tariffCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 16,
    padding: 14,
    paddingLeft: 18,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  tariffCardActive: { backgroundColor: '#111' },
  payChip: { backgroundColor: CARD2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  payChipActive: { backgroundColor: YELLOW },
  payChipTxt: { color: WHITE, fontSize: 14 },
  orderCta: {
    backgroundColor: YELLOW,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 4,
  },
  orderCtaTxt: { color: '#000', fontSize: 16, fontWeight: '700' },

  // Active order sheet
  activeSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '65%',
  },
  taxiMeterBox: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: CARD2,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: YELLOW + '40',
  },
  activeStatusTxt: {
    color: WHITE,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 12,
  },
  driverAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(48,209,88,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,122,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    height: 44,
    paddingHorizontal: 16,
    flex: 1,
  },

  // Tabs
  tabBody: { flex: 1, backgroundColor: BG },
  tabHeaderArea: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  tabHeaderSub: { color: GRAY1, fontSize: 14, fontWeight: '500' },
  tabHeaderTitle: { color: WHITE, fontSize: 34, fontWeight: '700', marginTop: 2 },
  dayLabel: {
    color: GRAY1,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  tripCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 10 },
  statusBadge: { backgroundColor: YELLOW, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeGreen: { backgroundColor: GREEN },
  statusBadgeGray: { backgroundColor: CARD2 },
  statusBadgeTxt: { color: '#000', fontSize: 12, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingTop: 60 },

  // Help tab
  operatorHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  operatorIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,204,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineBadge: { flexDirection: 'row', alignItems: 'center' },
  helpTopicsCard: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden' },
  helpTopicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  helpTopicIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiEntryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  // Profile tab
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    marginBottom: 4,
    gap: 14,
  },
  profileAvatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2.5,
    borderColor: YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CARD2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statCard: { backgroundColor: CARD, borderRadius: 14, padding: 14 },
  referralCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,204,0,0.08)',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,204,0,0.2)',
  },
  menuCard: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden' },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: RED,
    borderRadius: 14,
    height: 52,
    marginTop: 16,
  },

  // Tab bar
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: '#0A0A0A',
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalTitle: { color: WHITE, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 16 },

  // Chat bubbles
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 12, marginBottom: 6 },
  bubbleUser: { backgroundColor: YELLOW, alignSelf: 'flex-end' },
  bubbleAI: { backgroundColor: CARD2, alignSelf: 'flex-start' },
  bubbleUserTxt: { color: '#000', fontSize: 14 },
  bubbleAITxt: { color: WHITE, fontSize: 14 },
  chatRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chatInput: {
    flex: 1,
    backgroundColor: CARD2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: WHITE,
    fontSize: 15,
  },
  chatSendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
