// ============================================================
//  ELGA Haydovchi — ilova (React Native / Expo)
//  Xarita: OpenStreetMap (Leaflet WebView)
//  Server: https://api.elga.uz
// ============================================================
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Linking, Platform,
  Modal, KeyboardAvoidingView, FlatList, Animated, Vibration, Easing,
  AppState,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as KeepAwake from 'expo-keep-awake';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
// Ovozli buyurtma base64'ini vaqtinchalik faylga yozish uchun (legacy API —
// base64 yozishda eng ishonchli yo'l). expo-audio file URI'ni o'ynaydi.
import * as FileSystem from 'expo-file-system/legacy';
// expo-updates: Expo Go muhitida ishlatilmaydi (OTA faqat standalone APK uchun)
import { WebView } from 'react-native-webview';
import { io } from 'socket.io-client';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// ─── Ajratilgan modullar (modularizatsiya — App.js'ni yengillashtirish) ───
import { uuid, sleep, fmt, safeStr, haversineKm, fmtPhone } from './src/utils';
import { mapHTML } from './src/mapHtml';
import { speak, announce } from './src/voice';
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

// Tab panelining tizim navigatsiyasidan tashqari balandligi (safe-area pastdan qo'shiladi)
const TABBAR_H = 56;

// ---- Dizayn tokenlari (mijoz ilovasi bilan bir xil premium palitra) ----
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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

// Android: doimiy (sticky) bildirishnoma uchun alohida kanal — past muhimlik, jim
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('driver-active', {
    name: 'Haydovchi holati',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
  }).catch(() => {});
}

const PERSISTENT_ID = 'elga-driver-active';

// Fon ko'rsatkichi: ekranning yuqori qismida ELGA logosi bilan doimiy bildirishnoma
async function showPersistentNotif(status = 'Buyurtma kutilmoqda...') {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: PERSISTENT_ID,
      content: {
        title: '🚕 ELGA Haydovchi',
        body: status,
        sticky: true,          // Android: siljitib o'chirib bo'lmaydi
        priority: 'low',
        android: {
          channelId: 'driver-active',
          ongoing: true,       // Fon xizmati belgisi
          color: '#FFC700',
          smallIcon: 'notification_icon', // app.json da konfigurasiya qilinadi
        },
      },
      trigger: null,
    });
  } catch (e) {}
}

async function updatePersistentNotif(status) {
  // Mavjud bildirishnomani yangilash — o'chirib qayta chiqarish
  try { await Notifications.dismissNotificationAsync(PERSISTENT_ID); } catch (e) {}
  await showPersistentNotif(status);
}

async function hidePersistentNotif() {
  try { await Notifications.dismissNotificationAsync(PERSISTENT_ID); } catch (e) {}
}

// ============================================================
//  TARMOQ QATLAMI — zaif/uzilgan internetga chidamli (offline-first)
//  • deviceId / requestId / Idempotency-Key — takror so'rovlardan himoya
//  • avtomatik qayta urinish (exponential backoff): 1s → 2s → 4s
//  • global onlayn/oflayn holat (NetMonitor) — UI banner shu yerga obuna
//  Eslatma: bularning bari sof JS — yangi native modul YO'Q, shuning uchun
//  OTA (expo-updates) orqali darrov yetkaziladi (runtimeVersion o'zgarmaydi).
// ============================================================

// uuid() — ./src/utils dan import qilinadi

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

// sleep — ./src/utils dan import qilinadi

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
  // GET — idempotent, xavfsiz qayta urinadi. POST faqat idempotencyKey berilsa
  // qayta urinadi (server idempotency middleware / holat-tekshiruvi dubldan himoya qiladi).
  const isGet = method === 'GET';
  const maxRetries = opts.retries != null
    ? opts.retries
    : (isGet || opts.idempotencyKey ? 2 : 0);

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  // Duplicate himoyasi: har so'rovga deviceId + requestId + vaqt belgisi
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
      if (attempt < maxRetries) {
        await sleep(Math.min(8000, 1000 * Math.pow(2, attempt))); // 1s, 2s, 4s...
        continue;
      }
      NetMonitor.set(false); // urinishlar tugadi — oflaynmiz
      throw lastErr;
    }
    clearTimeout(timer);
    NetMonitor.set(true); // serverdan javob keldi — onlaynmiz
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Server mantiqiy javob qaytardi (4xx/5xx) — bu tarmoq xatosi emas, qayta urinmaymiz
      const err = new Error(data.error || 'Xato: ' + res.status);
      err.data = data; err.status = res.status;
      throw err;
    }
    return data;
  }
  throw lastErr || new Error('Tarmoq xatosi');
}

// ============================================================
//  OFLAYN NAVBAT — internet yo'qligida muhim amallarni saqlab,
//  qayta ulanganda avtomatik (tartib bilan) yuboradi.
//  Hozircha buyurtma holati o'zgarishlari (accept/arrived/start/complete/reject).
//  Har bir amal o'ziga xos id (idempotencyKey) bilan yuboriladi — dubl bo'lmaydi.
// ============================================================
const OFFLINE_QUEUE_KEY = 'offline_queue_v1';
const OfflineQueue = {
  items: [],
  loaded: false,
  flushing: false,
  onChange: null, // UI sonni yangilash uchun
  async load() {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      this.items = raw ? JSON.parse(raw) : [];
    } catch (e) { this.items = []; }
    this.loaded = true;
    this._notify();
  },
  async _persist() {
    try { await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.items)); } catch (e) {}
  },
  _notify() { try { this.onChange && this.onChange(this.items.length); } catch (e) {} },
  async enqueue(item) {
    await this.load();
    // Bir xil (orderId+action) takrorini qo'shmaymiz — dubl himoyasi
    const dup = this.items.find((x) => x.kind === item.kind && x.orderId === item.orderId && x.action === item.action);
    if (dup) return dup;
    const rec = { id: uuid(), ts: Date.now(), ...item };
    this.items.push(rec);
    await this._persist();
    this._notify();
    return rec;
  },
  async flush(token) {
    await this.load();
    if (this.flushing || !token || this.items.length === 0) return;
    this.flushing = true;
    try {
      while (this.items.length > 0) {
        const it = this.items[0];
        try {
          if (it.kind === 'order_action') {
            await api(`/api/orders/${it.orderId}/${it.action}`, 'POST', {}, token, 15000,
              { idempotencyKey: it.id, retries: 1 });
          }
          this.items.shift(); // muvaffaqiyat — navbatdan olib tashlaymiz
          await this._persist();
          this._notify();
        } catch (e) {
          if (e && e.network) break; // hali oflayn — keyinroq davom etamiz
          // Server mantiqiy xatosi (409 holat mos emas / 404 / 403): amal allaqachon
          // qo'llangan yoki endi mumkin emas — o'tkazib yuboramiz (cheksiz qotmasin).
          this.items.shift();
          await this._persist();
          this._notify();
        }
      }
    } finally {
      this.flushing = false;
    }
  },
};

// fmt, safeStr — ./src/utils dan import qilinadi

// speak, announce — ./src/voice dan import qilinadi
// haversineKm, fmtPhone — ./src/utils dan import qilinadi

// ============================================================
//  FON (BACKGROUND) GPS — ilova fonda/ekran o'chiq bo'lganda ham haydovchi
//  joylashuvini yuboradi. Socket fonda ishonchsiz, shuning uchun HTTP orqali
//  POST /api/drivers/location ga yuboramiz (mavjud endpoint). Foreground'da
//  socket allaqachon yuboradi — fonda ikkilantirmaymiz.
//  Hammasi try/catch — fon vazifasi hech qachon ilovani yiqitmaydi.
// ============================================================
const BG_LOCATION_TASK = 'elga-bg-location';

try {
  if (!TaskManager.isTaskDefined(BG_LOCATION_TASK)) {
    TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
      if (error) return;
      try {
        // Foreground'da socket yuboradi — fonda takror yubormaymiz
        if (AppState.currentState === 'active') return;
        const online = await AsyncStorage.getItem('drv_online');
        if (online !== '1') return;
        const token = await AsyncStorage.getItem('token');
        if (!token) return;
        const locs = (data && data.locations) || [];
        const last = locs[locs.length - 1];
        if (!last || !last.coords) return;
        const lat = last.coords.latitude, lng = last.coords.longitude;
        await fetch(BASE + '/api/drivers/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ lat, lng }),
        }).catch(() => {});
        AsyncStorage.setItem('last_loc', JSON.stringify({ lat, lng })).catch(() => {});
      } catch (e) {}
    });
  }
} catch (e) {}

async function startBackgroundLocation() {
  try {
    if (typeof Location.startLocationUpdatesAsync !== 'function') return; // SDK qo'llamasa
    // Fon ruxsati ixtiyoriy — berilmasa foreground watch baribir ishlaydi
    let granted = true;
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      granted = status === 'granted';
    } catch (e) { granted = false; }
    if (!granted) return;
    const already = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (already) return;
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy?.High ?? 4,
      timeInterval: 15000,     // fonda batareyani tejab ~15s
      distanceInterval: 30,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: '🚕 ELGA Haydovchi',
        notificationBody: 'Joylashuv kuzatilmoqda',
        notificationColor: '#FFC700',
      },
    });
  } catch (e) {}
}

async function stopBackgroundLocation() {
  try {
    const already = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (already) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch (e) {}
}

// safeStr — ./src/utils dan import qilinadi (yuqorida)

// mapHTML — ./src/mapHtml dan import qilinadi

// ---- Crash monitoring (yengil, tashqi SDK'siz, production-ready) ----
// Sentry/Crashlytics o'rnatish uchun native sozlama + DSN kerak; uni qo'shilguncha
// quyidagi best-effort reporter fatal xatolarni serverga (mavjud bo'lsa) yuboradi
// va eng muhimi — global handler ASYNC/timer/socket ichidagi fatal JS xatolar
// JS kontekstini jimgina o'ldirib qo'yishining oldini oladi.
let _lastCrashTs = 0;
function reportCrash(kind, error, stack) {
  try {
    const now = Date.now();
    if (now - _lastCrashTs < 3000) return; // spamga qarshi throttle
    _lastCrashTs = now;
    // Sentry yoqilgan bo'lsa (DSN berilgan) — xatoni o'sha yerga ham yuboramiz.
    // DSN yo'q bo'lsa bu jim o'tadi (no-op).
    captureException(error || new Error(String(stack || kind)), { kind });
    const payload = {
      kind,
      message: String(error?.message || error || 'unknown'),
      stack: String(error?.stack || stack || '').slice(0, 4000),
      platform: Platform.OS,
      ts: new Date().toISOString(),
    };
    // Backend endpoint mavjud bo'lsa qabul qiladi; bo'lmasa jim o'tadi.
    // Cheksiz osilib qolmasligi uchun AbortController bilan timeout.
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

// Global JS xato ushlagich — ErrorBoundary faqat RENDER xatolarini ushlaydi;
// bu esa async/timer/socket ichidagi fatal xatolarni ushlab, ilovani jimgina
// qulashdan saqlaydi (eski handler ham chaqiriladi).
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

// ErrorBoundary — render paytida kutilmagan xato bo'lsa (masalan, buyurtma
// obyektida noto'g'ri maydon), butun ilova OQ EKRANga aylanib qulamasligi uchun.
// Xato ushlanadi va foydalanuvchiga "Qayta urinish" tugmasi ko'rsatiladi.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    // Log + masofaviy hisobot (best-effort). Ilova qulamaydi.
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

// ===== ELGA brend wordmark (matn asosida) — EL sariq, GA oq, TAXI sariq =====
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

// Yengil fade + yumshoq ko'tarilish (useNativeDriver: true — UI thread, yengil).
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

// Bosilganda yumshoq kichrayadigan tugma — premium his, yengil.
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

// Boot ekrani: logo yumshoq paydo bo'lib sekin "nafas oladi".
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
      <ElgaLogo size={64} tagline />
    </Animated.View>
  );
}

// MapPanel — xaritani AppInner ning yuqori chastotali qayta-renderlaridan ajratamiz.
// AppInner da GPS (har 5 sek), taksometr (`meter`), `soloMeter` va `wait_update`
// holatlari tez-tez yangilanadi va har safar butun daraxtni qayta render qiladi.
// WebView'ni React.memo bilan o'rab, faqat barqaror proplar (source/style/onReady)
// berib, xarita ostki daraxti shu yangilanishlarda QAYTA RENDER BO'LMAYDI.
// Xarita o'zi imperativ `injectJavaScript` orqali yangilanishda davom etadi.
const MapPanel = React.memo(React.forwardRef(function MapPanel({ source, style, onReady }, ref) {
  return (
    <WebView
      ref={ref}
      style={style}
      originWhitelist={['*']}
      source={source}
      onMessage={(e) => {
        try {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'mapReady') onReady && onReady();
        } catch (err) {}
      }}
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
  // 🎙 Mijozning ovozli buyurtmasini tinglash (expo-audio + temp fayl orqali).
  // Hech qachon ilovani yiqitmaydi — xato bo'lsa faqat status o'zgaradi.
  const [voiceModal, setVoiceModal] = useState(false);
  // 'idle' | 'loading' | 'playing' | 'empty' | 'error'
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const voicePlayerRef = useRef(null);
  const orderForVoiceId = useRef(null); // "Qayta eshitish" uchun joriy buyurtma id

  // Login
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [carModel, setCarModel] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [step, setStep] = useState('phone');
  const [regToken, setRegToken] = useState(null);
  const [loading, setLoading] = useState(false);

  // PIN
  const [pinStep, setPinStep] = useState(null); // null | 'enter' | 'setup'
  const [pinInput, setPinInput] = useState('');
  const [storedPin, setStoredPin] = useState(null);

  // Holat
  const [online, setOnline] = useState(false);
  const [myLoc, setMyLoc] = useState(null);
  const [order, setOrder] = useState(null);
  const [earnings, setEarnings] = useState(null);
  // GPS callback'i stale closure'siz joriy buyurtmani o'qisin (har renderda yangilanadi)
  orderRef.current = order;
  const [trips, setTrips] = useState(null);
  const [tab, setTab] = useState('home'); // home | earnings | history | profile

  // Mustaqil taksometr (buyurtmasiz — narxni o'zi hisoblab beradi)
  const [soloMeter, setSoloMeter] = useState(null); // null | { startMs, km, prevLoc }
  const soloTimerRef = useRef(null);

  // Chat
  const [chatModal, setChatModal] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Jonli hisoblagich (taximetr) va safar yakuni
  const [meter, setMeter] = useState(null); // { km, minutes, fare }
  const [completedTrip, setCompletedTrip] = useState(null); // yakunlangan safar (baholash uchun)

  // Tarmoq holati (zaif internetga chidamlilik)
  const [netOnline, setNetOnline] = useState(true);        // internet bormi (reachability)
  const [socketConnected, setSocketConnected] = useState(false); // realtime kanal ulanganmi
  const [queuedCount, setQueuedCount] = useState(0);        // oflayn navbatdagi amallar soni
  const [gpsStale, setGpsStale] = useState(false);          // GPS 30s+ yangilanmadi ("arvoh"/signal yo'q)

  const socketRef = useRef(null);
  const watchRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const mapRef = useRef(null);
  // Tarmoq qatlami reflari
  const lastLocRef = useRef(null);   // oxirgi GPS — qayta ulanganda darrov yuboramiz
  const lastEmitRef = useRef(0);     // GPS socket emit throttle (adaptiv interval)
  const lastGpsRef = useRef(0);      // oxirgi GPS vaqti ("arvoh" aniqlash uchun)
  const lastUiLocRef = useRef(null); // state'ga (xaritaga) oxirgi yuborilgan joylashuv — re-render throttle
  const lastUiAtRef = useRef(0);     // state oxirgi yangilangan vaqt
  const orderRef = useRef(null);     // joriy buyurtma (GPS callback stale closure'siz o'qishi uchun)
  const watchActiveRef = useRef(false); // joriy GPS watch faol-buyurtma rejimidami
  const pollRef = useRef(null);      // backup polling intervali
  const healthRef = useRef(null);    // reachability heartbeat timeri
  const mapSource = useRef({ html: mapHTML() }).current; // bir marta yaratiladi, qayta yuklanmaydi
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    (async () => {
      // OTA yangilanish: faqat standalone APK da ishlaydi, Expo Go da o'tkazib yuboriladi

      try {
        const t = await AsyncStorage.getItem('token');
        const u = await AsyncStorage.getItem('user');
        const p = await AsyncStorage.getItem('pin');
        if (t && u) {
          setToken(t); setUser(JSON.parse(u));
          if (p) { setStoredPin(p); setPinStep('enter'); }
          // Crash recovery: oxirgi faol buyurtmani lokaldan DARHOL ko'rsatamiz
          // (internet kelguncha bo'sh ekran chiqmaydi). Keyin server bilan sinxron.
          try {
            const ao = await AsyncStorage.getItem(ACTIVE_ORDER_KEY);
            if (ao) { const o = JSON.parse(ao); if (o && ACTIVE_STATUSES.includes(o.status)) setOrder(o); }
          } catch (e) {}
        }
      } catch (e) {}
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    if (!token || pinStep) return;
    (async () => {
      try { await Notifications.requestPermissionsAsync(); } catch (e) {}
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
      connectSocket();
      loadEarnings();
      resumeActiveOrder();
    })();
    return () => {
      // Listenerlarni ham olib tashlaymiz — aks holda disconnect'dan keyin
      // qayta ulanishda eski handlerlar takror ishlab ketishi mumkin.
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      watchRef.current?.remove?.();
      try { if (typeof KeepAwake?.deactivateKeepAwakeAsync === 'function') KeepAwake.deactivateKeepAwakeAsync('driver').catch(() => {}); } catch (e) {}
      hidePersistentNotif();
    };
  }, [token, pinStep]);

  // ---- Tarmoq qatlami: navbat, qurilma ID, global holatga obuna (bir marta) ----
  useEffect(() => {
    OfflineQueue.onChange = (n) => setQueuedCount(n);
    OfflineQueue.load();
    getDeviceId();
    // Saqlangan oxirgi joylashuvni tiklaymiz (xarita darrov ko'rsatadi)
    (async () => {
      try {
        const l = await AsyncStorage.getItem('last_loc');
        if (l) { const p = JSON.parse(l); lastLocRef.current = p; setMyLoc((cur) => cur || p); }
      } catch (e) {}
    })();
    const unsub = NetMonitor.subscribe((v) => setNetOnline(v));
    return () => { unsub(); OfflineQueue.onChange = null; };
  }, []);

  // Faol buyurtmani lokal saqlash — app kill / crash / OS restart bo'lsa ham
  // buyurtma yo'qolmaydi. Status yoki id o'zgarganda yoziladi yoki o'chiriladi.
  // (Boot effektida ACTIVE_ORDER_KEY dan darrov tiklanadi.)
  useEffect(() => {
    if (order && ACTIVE_STATUSES.includes(order.status)) {
      AsyncStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(order)).catch(() => {});
    } else {
      AsyncStorage.removeItem(ACTIVE_ORDER_KEY).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status]);

  // ---- AppState + NetInfo: foreground'ga qaytganda yoki internet qaytganda
  // socket/buyurtma/navbatni sinxronlash (#40). NetInfo ixtiyoriy — bo'lmasa
  // reachability heartbeat baribir holatni tiklaydi. ----
  useEffect(() => {
    if (!token || pinStep) return;
    const onAppState = (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      // background/inactive -> active: foreground'ga qaytdi
      if (prev && /inactive|background/.test(prev) && next === 'active') {
        ensureSocket();
        resumeActiveOrder();
        OfflineQueue.flush(token);
        if (online && !watchRef.current) startTracking();
      }
    };
    const appSub = AppState.addEventListener('change', onAppState);

    let netUnsub = null;
    if (NetInfo) {
      try {
        let wasOffline = false;
        netUnsub = NetInfo.addEventListener((state) => {
          const isOnline = !!state.isConnected && state.isInternetReachable !== false;
          NetMonitor.set(isOnline); // bannerni tez yangilaydi (heartbeatni kutmaymiz)
          // offline -> online o'tishida tiklash (har bir state'da emas)
          if (isOnline && wasOffline) { ensureSocket(); resumeActiveOrder(); OfflineQueue.flush(token); }
          wasOffline = !isOnline;
        });
      } catch (e) {}
    }

    return () => {
      try { appSub.remove(); } catch (e) {}
      try { netUnsub && netUnsub(); } catch (e) {}
    };
  }, [token, pinStep, online]);

  // ---- Reachability heartbeat: /health ni davriy tekshirish ----
  // NetInfo bor-yo'qligidan qat'i nazar ishlaydi (universal fallback) va bannerni
  // haqiqiy server holatiga moslaydi. Onlayn ~20s, oflayn ~5s.
  useEffect(() => {
    if (!token || pinStep) return;
    let stopped = false;
    const tick = async () => {
      const ok = await pingHealth();
      if (stopped) return;
      NetMonitor.set(ok);
      if (ok) {
        ensureSocket(); // internet bor — socket o'lgan bo'lsa tiklaymiz
        OfflineQueue.flush(token);
      }
      healthRef.current = setTimeout(tick, ok ? 20000 : 5000);
    };
    healthRef.current = setTimeout(tick, 8000);
    return () => { stopped = true; if (healthRef.current) clearTimeout(healthRef.current); };
  }, [token, pinStep]);

  // ---- Backup polling: socket uzilgan paytda faol buyurtmani REST orqali olamiz ----
  useEffect(() => {
    if (!token || pinStep) return;
    if (socketConnected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { resumeActiveOrder(); }, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [token, pinStep, socketConnected]);

  // ---- GPS "arvoh" aniqlash (#33): 30s+ yangilanmasa "signal yo'q" ko'rsatkichi ----
  useEffect(() => {
    if (!online) { setGpsStale(false); return; }
    const iv = setInterval(() => {
      const elapsed = Date.now() - (lastGpsRef.current || 0);
      setGpsStale(elapsed > 30000);
    }, 10000);
    return () => clearInterval(iv);
  }, [online]);

  // Xarita tayyor bo'lgach va joylashuv/buyurtma o'zgarganda — markerlarni
  // qayta yuklamasdan yangilaymiz (lag bo'lmaydi).
  // Barqaror callback — MapPanel memoizatsiyasi buzilmasligi uchun useCallback.
  // Xarita tayyor bo'lganda faqat mapReady ni o'rnatadi; markerlarni quyidagi
  // effekt (mapReady deps) yuboradi.
  const onMapReady = useCallback(() => setMapReady(true), []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const d = {
      myLat: myLoc?.lat ?? null, myLng: myLoc?.lng ?? null,
      pickLat: order?.from_lat ?? null, pickLng: order?.from_lng ?? null,
      dropLat: order?.to_lat ?? null, dropLng: order?.to_lng ?? null,
    };
    mapRef.current.injectJavaScript(`window.updateMap(${JSON.stringify(d)});true;`);
  }, [mapReady, myLoc, order?.from_lat, order?.from_lng, order?.to_lat, order?.to_lng]);

  // Socketni kerakli holatga keltiramiz. Socket.IO o'zi (reconnectionAttempts: Infinity)
  // qayta ulanib turadi — uning backoff jarayonini bekorga uzmaymiz:
  //   • ulangan      → hech narsa qilmaymiz
  //   • qayta ulanmoqda (s.active) → connect() bilan yengil turtki beramiz
  //   • o'lgan/yo'q  → qaytadan yaratamiz
  function ensureSocket() {
    const s = socketRef.current;
    if (!s) { connectSocket(); return; }
    if (s.connected) return;
    if (s.active) { try { s.connect(); } catch (e) {} return; }
    connectSocket();
  }

  function connectSocket() {
    if (socketRef.current?.connected) return; // allaqachon ulangan
    // Eski soketni TO'LIQ tozalaymiz: faqat disconnect() listenerlarni saqlab
    // qoladi va reconnection:Infinity tufayli eski soket qayta ulanib, takroriy
    // 'new_order' (ikki marta vibratsiya/e'lon) yuborishi mumkin edi. (memory leak / duplicate events)
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }
    const s = io(BASE, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      // Exponential backoff: 1s dan boshlanib 30s gacha o'sadi (zaif tarmoqda
      // serverni bombardimon qilmaydi). randomizationFactor — "thundering herd" oldini oladi.
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 20000,
    });
    socketRef.current = s;

    const onUp = () => {
      NetMonitor.set(true);
      setSocketConnected(true);
      resumeActiveOrder();            // faol buyurtma holatini darrov tiklaymiz (#40)
      OfflineQueue.flush(token);      // navbatdagi amallarni yuboramiz
      // Oxirgi joylashuvni darrov yuboramiz — server "online" deb bilsin
      if (lastLocRef.current) { try { s.emit('location', lastLocRef.current); } catch (e) {} }
    };
    s.on('connect', () => { console.log('✓ Socket ulandi'); onUp(); });
    s.on('reconnect', onUp);         // internet uzilib qayta ulanganda
    s.on('disconnect', () => { setSocketConnected(false); });
    s.on('connect_error', (e) => { setSocketConnected(false); console.warn('Socket xato:', e.message); });

    s.on('new_order', (o) => {
      // Butun handler xavfsiz: noto'g'ri/yetishmaydigan maydonli (masalan ovozli)
      // buyurtma kelsa ham ilova qulamaydi.
      try {
        setOrder(o || null);
        setChatMessages([]);
        // Baland ovozli vibrasiya (3x)
        Vibration.vibrate([0, 400, 200, 400, 200, 400]);
        // Ovozli e'lon (o'zbek tilida)
        const addr = typeof o?.from_address === 'string' ? o.from_address : '';
        // Server e'lon audiosi bersa (super-admin sozlaydi) shuni o'ynaymiz,
        // bo'lmasa TTS. Backend kelishuvi: o.announce_audio yoki o.voice_url.
        announce(`Yangi buyurtma! ${fmt(o?.price)} so'm. ${addr}`, o?.announce_audio || o?.voice_url);
        notify('🚖 Yangi buyurtma!', `${addr || 'Manzil'} → ${fmt(o?.price)} so'm`);
        // Fon bildirishnomasi — buyurtma tafsiloti
        updatePersistentNotif(`Yangi buyurtma · ${fmt(o?.price)} so'm`);
        // Buyurtma ekranda ko'rinishi uchun ekranni yoqib qo'yamiz (xavfsiz wrapper)
        keepAwakeOn();
      } catch (e) {
        console.warn('[new_order]', e?.message);
      }
    });
    s.on('order_cancelled', () => {
      notify('Buyurtma bekor qilindi', '');
      setOrder(null);
      setChatMessages([]);
      updatePersistentNotif('Buyurtma kutilmoqda...');
    });
    s.on('order_update', (o) => setOrder((p) => p ? { ...p, ...o } : o));
    s.on('chat_message', (msg) => {
      setChatMessages((prev) => [...prev, msg]);
      if (!chatModal) notify('💬 Mijoz', msg.text || '');
    });
    // Faqat o'zgargan qiymatda yangilaymiz — bekorga re-render qilmaymiz
    s.on('meter', (m) => setMeter((prev) => {
      if (prev && m && prev.km === m.km && prev.minutes === m.minutes && prev.fare === m.fare) return prev;
      return m;
    }));
    // Jonli kutish haqi — backend 'arrived' holatida har 3 sek yuboradi
    s.on('wait_update', (d) => {
      setOrder((p) => p ? { ...p, wait_fee: d.waitFee || 0, price: d.totalFare || p.price } : p);
    });
    // Backend haydovchiga ham paid_wait_started yuborishi mumkin
    s.on('paid_wait_started', () => speak('Pullik kutish boshlandi. Har daqiqa uchun haq undiriladi.'));
  }

  async function notify(title, body) {
    try { await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }); } catch (e) {}
  }

  // Faol buyurtmani serverdan tiklash — server YAGONA haqiqat manbai.
  // Ilova ochilganda, socket connect/reconnect bo'lganda, internet/foreground
  // qaytganda chaqiriladi. Tarmoq xatosida lokal holat saqlanadi (tozalanmaydi).
  async function resumeActiveOrder() {
    try {
      // Yengil so'rov: bitta urinish, qisqa timeout (poll/reconnect baribir qayta chaqiradi)
      const r = await api('/api/me/active-order', 'GET', null, token, 8000, { retries: 0 });
      if (r && r.order) {
        // Bor buyurtma — eski holat bilan birlashtirib yangilaymiz (flicker bo'lmaydi)
        setOrder((prev) => (prev && prev.id === r.order.id) ? { ...prev, ...r.order } : r.order);
      } else if (r) {
        // Server: faol buyurtma yo'q → lokaldagi eskirgan (fantom) buyurtmani tozalaymiz
        setOrder((prev) => (prev && ACTIVE_STATUSES.includes(prev.status)) ? null : prev);
      }
    } catch (e) {
      // Tarmoq xatosi — lokal (saqlangan) holatni saqlab qolamiz
    }
  }

  async function loadEarnings() {
    try {
      const r = await api('/api/me/earnings', 'GET', null, token);
      setEarnings(r);
    } catch (e) {}
  }

  async function loadTrips() {
    try {
      const r = await api('/api/me/trips', 'GET', null, token);
      setTrips(r.trips || []);
    } catch (e) {}
  }

  // ---- KeepAwake xavfsiz wrapper (SDK versiyasiga qarab) ----
  const keepAwakeOn = async () => {
    try {
      if (typeof KeepAwake?.activateKeepAwakeAsync === 'function') await KeepAwake.activateKeepAwakeAsync('driver');
      else if (typeof KeepAwake?.activateKeepAwake === 'function') KeepAwake.activateKeepAwake('driver');
    } catch (e) {}
  };
  const keepAwakeOff = async () => {
    try {
      if (typeof KeepAwake?.deactivateKeepAwakeAsync === 'function') await KeepAwake.deactivateKeepAwakeAsync('driver');
      else if (typeof KeepAwake?.deactivateKeepAwake === 'function') KeepAwake.deactivateKeepAwake('driver');
    } catch (e) {}
  };

  // Faol buyurtma bormi (GPS callback ichida ref orqali, stale closure'siz)
  function isOrderActive() {
    const o = orderRef.current;
    return !!(o && ACTIVE_STATUSES.includes(o.status));
  }

  // ---- GPS kuzatuv (onlayn bo'lganda socket orqali yuboriladi) ----
  // Adaptiv: GPS apparat so'rovi va re-render/emit chastotasi faol buyurtma va
  // tarmoq holatiga qarab o'zgaradi. Bu batareyani tejaydi va bekorga re-render
  // (FPS pasayishi) qilmaydi:
  //   • faol buyurtma  → ~4s, har 10 m da yangilanish
  //   • bo'sh (idle)   → ~20s, har 40 m da yangilanish (kam re-render, kam batareya)
  //   • zaif tarmoq    → emit ~15s (trafik tejaladi)
  async function startTracking() {
    try {
      const accuracy = Location.Accuracy?.High ?? 4;
      const active = isOrderActive();
      watchActiveRef.current = active;
      // Apparat so'rov chastotasi: faol 4s/15m, idle 20s/40m (spec bo'yicha)
      const hwTime = active ? 4000 : 20000;
      const hwDist = active ? 15 : 40;
      watchRef.current = await Location.watchPositionAsync(
        { accuracy, distanceInterval: hwDist, timeInterval: hwTime },
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const now = Date.now();
          lastLocRef.current = loc;
          lastGpsRef.current = now;

          const act = isOrderActive();
          // Re-render throttle: state'ni (xarita markerini) faqat sezilarli
          // siljishda yoki vaqt o'tганда yangilaymiz — har GPS callback'da emas.
          const moveThresh = act ? 0.010 : 0.040; // km (10 m / 40 m)
          const uiGap = act ? 3000 : 20000;
          const prevUi = lastUiLocRef.current;
          const movedKm = prevUi ? haversineKm(prevUi.lat, prevUi.lng, loc.lat, loc.lng) : Infinity;
          if (!prevUi || movedKm >= moveThresh || now - lastUiAtRef.current >= uiGap) {
            lastUiLocRef.current = loc;
            lastUiAtRef.current = now;
            setMyLoc(loc);
          }

          // Oxirgi joylashuvni saqlaymiz — ilova qayta ochilganda darrov ko'rsatiladi
          AsyncStorage.setItem('last_loc', JSON.stringify(loc)).catch(() => {});

          // Adaptiv socket emit: faol+online ~4s, idle ~20s, zaif tarmoq ~15s.
          // (Server baribir sekundiga 1 tagacha cheklaydi.)
          const minGap = !NetMonitor.online ? 15000 : (act ? 4000 : 20000);
          if (socketRef.current?.connected && now - lastEmitRef.current >= minGap) {
            lastEmitRef.current = now;
            try { socketRef.current.emit('location', loc); } catch (e) {}
          }

          // Mustaqil taksometr — km hisoblab boradi (har GPS nuqtasida aniqlik uchun)
          setSoloMeter(prev => {
            if (!prev) return prev;
            let addKm = 0;
            if (prev.prevLoc) {
              const d = haversineKm(prev.prevLoc.lat, prev.prevLoc.lng, loc.lat, loc.lng);
              if (d > 0.008 && d < 2) addKm = d;
            }
            return { ...prev, km: (prev.km || 0) + addKm, prevLoc: loc };
          });
        }
      );
    } catch (e) {}
  }
  function stopTracking() {
    watchRef.current?.remove?.();
    watchRef.current = null;
  }

  // Faol buyurtma holati o'zgarganda GPS kuzatuvini mos chastotaga qayta moslaymiz
  // (idle ↔ faol). Watch ishlamayotgan bo'lsa tegmaymiz.
  useEffect(() => {
    const active = isOrderActive();
    if (watchRef.current && active !== watchActiveRef.current) {
      stopTracking();
      startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status]);

  // ---- Mustaqil taksometr ----
  function startSoloMeter() {
    if (!myLoc) { Alert.alert("GPS", "Avval GPS joylashuvingizni kuting"); return; }
    setSoloMeter({ startMs: Date.now(), km: 0, prevLoc: myLoc });
    if (!online) Alert.alert("Eslatma", "Taksometr ishlashi uchun Online bo'lishingiz kerak (GPS uzluksiz ishlaydi)");
  }
  function stopSoloMeter() {
    const m = soloMeter;
    if (!m) return;
    const mins = Math.round((Date.now() - m.startMs) / 60000);
    const fare = Math.round((5000 + (m.km || 0) * 2800) / 500) * 500;
    Alert.alert(
      '🚕 Safar yakunlandi',
      `Masofa: ${(m.km || 0).toFixed(2)} km\nVaqt: ${mins} daqiqa\nNarx: ${fare.toLocaleString('ru-RU')} so'm`,
      [{ text: 'Yopish', onPress: () => setSoloMeter(null) }]
    );
  }

  // ---- LOGIN ----
  async function sendCode() {
    if (phone.replace(/\D/g, '').length < 9) { Alert.alert('Xato', "To'g'ri raqam kiriting"); return; }
    setLoading(true);
    try {
      await api('/api/auth/send-code', 'POST', { phone });
      setStep('code');
      Alert.alert('Yuborildi', 'SMS kod yuborildi');
    } catch (e) { Alert.alert('Xato', e.message); }
    setLoading(false);
  }

  async function verifyCode() {
    if (code.length < 4) { Alert.alert('Xato', 'Kodni kiriting'); return; }
    setLoading(true);
    try {
      const r = await api('/api/auth/verify', 'POST', { phone, code });
      await saveAuth(r);
    } catch (e) {
      if (e.data?.new_user && e.data?.reg_token) {
        setRegToken(e.data.reg_token); setStep('register');
      } else { Alert.alert('Xato', e.message); }
    }
    setLoading(false);
  }

  async function register() {
    if (name.trim().length < 2) { Alert.alert('Xato', 'Ismingizni kiriting'); return; }
    if (carModel.trim().length < 2) { Alert.alert('Xato', 'Mashina rusumini kiriting'); return; }
    if (carNumber.trim().length < 3) { Alert.alert('Xato', 'Mashina raqamini kiriting'); return; }
    setLoading(true);
    try {
      const r = await api('/api/auth/verify', 'POST', {
        phone, code, name: name.trim(), role: 'driver',
        car_model: carModel.trim(), car_number: carNumber.trim(),
        offer_accepted: true, reg_token: regToken,
      });
      await saveAuth(r);
      Alert.alert('Tabriklaymiz!', "Ro'yxatdan o'tdingiz. Onlayn chiqish uchun admin tasdig'i kerak bo'lishi mumkin.");
    } catch (e) { Alert.alert('Xato', e.message); }
    setLoading(false);
  }

  async function saveAuth(r) {
    await AsyncStorage.setItem('token', r.token);
    await AsyncStorage.setItem('user', JSON.stringify(r.user));
    setToken(r.token); setUser(r.user);
    const p = await AsyncStorage.getItem('pin');
    if (!p) setPinStep('setup');
  }

  async function logout() {
    await AsyncStorage.multiRemove(['token', 'user', 'pin', ACTIVE_ORDER_KEY]);
    stopTracking();
    AsyncStorage.setItem('drv_online', '0').catch(() => {});
    stopBackgroundLocation();
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    keepAwakeOff();
    hidePersistentNotif();
    setToken(null); setUser(null); setStep('phone');
    setPhone(''); setCode(''); setName(''); setOnline(false); setOrder(null);
    setPinStep(null); setPinInput(''); setStoredPin(null);
  }

  // ---- PIN ----
  async function savePin() {
    if (pinInput.length !== 4) { Alert.alert('Xato', '4 ta raqam kiriting'); return; }
    await AsyncStorage.setItem('pin', pinInput);
    setStoredPin(pinInput);
    setPinInput('');
    setPinStep(null);
  }

  function checkPin() {
    if (pinInput === storedPin) {
      setPinStep(null);
      setPinInput('');
    } else {
      Alert.alert('Xato', "PIN noto'g'ri");
      setPinInput('');
    }
  }

  async function forgotPin() {
    await AsyncStorage.multiRemove(['token', 'user', 'pin']);
    setToken(null); setUser(null); setStoredPin(null);
    setPinStep(null); setPinInput(''); setStep('phone');
  }

  // ---- ONLAYN/OFFLAYN ----
  async function toggleOnline() {
    setLoading(true);
    try {
      const next = !online;
      if (next) {
        // GPS AVVAL olinadi, keyin online+GPS birga yuboriladi.
        // Aks holda matchPendingOrders lat=NULL da ishlab, buyurtmani o'tkazib yuboradi.
        let loc = null;
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch (e) {}
        // online va GPS bitta so'rovda — atomic
        await api('/api/drivers/status', 'POST', { online: true, ...(loc || {}) }, token);
        setOnline(true);
        if (loc) {
          setMyLoc(loc);
          socketRef.current?.emit('location', loc);
        }
        startTracking();
        // Fon GPS: ilova fonda/ekran o'chiq bo'lsa ham joylashuv yuborilsin
        AsyncStorage.setItem('drv_online', '1').catch(() => {});
        startBackgroundLocation();
        keepAwakeOn();
        showPersistentNotif('Buyurtma kutilmoqda...');
      } else {
        await api('/api/drivers/status', 'POST', { online: false }, token);
        setOnline(false);
        stopTracking();
        AsyncStorage.setItem('drv_online', '0').catch(() => {});
        stopBackgroundLocation();
        keepAwakeOff();
        hidePersistentNotif();
      }
    } catch (e) {
      Alert.alert('Onlayn chiqib bo\'lmadi', e.message);
    }
    setLoading(false);
  }

  // ---- 🎙 Mijoz ovozli buyurtmasini tinglash ----
  // Joriy ovoz pleyerini xavfsiz to'xtatish/bo'shatish
  function stopVoicePlayer() {
    try { voicePlayerRef.current?.remove?.(); } catch (_) {}
    voicePlayerRef.current = null;
  }

  // Server bergan ovoz qiymatini (URL / data-URI / xom base64) o'ynaladigan
  // URI'ga aylantiramiz. Xom base64 bo'lsa vaqtinchalik faylga yozamiz —
  // expo-audio data: URI'ni ishonchli o'ynamasligi mumkin. Har bir qadam himoyalangan.
  async function buildVoiceUri(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let v = raw.trim();
    // Tayyor o'ynaladigan manbalar
    if (/^https?:\/\//i.test(v) || /^file:\/\//i.test(v)) return v;
    // data:audio/...;base64,XXXX  yoki  xom base64
    let ext = 'm4a', base64 = v;
    const m = v.match(/^data:audio\/([a-z0-9.+-]+);base64,(.*)$/i);
    if (m) { ext = (m[1] || 'm4a').toLowerCase().replace('mpeg', 'mp3').replace('x-m4a', 'm4a'); base64 = m[2] || ''; }
    if (!base64) return null;
    try {
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) return null;
      const fileUri = `${dir}elga-voice-${Date.now()}.${ext}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' });
      return fileUri;
    } catch (e) {
      console.warn('[voice file]', e?.message);
      return null;
    }
  }

  // Ovozni o'ynash — HECH QACHON throw qilmaydi. Xato bo'lsa status 'error'/'empty'.
  async function playVoiceOrder(orderId) {
    if (voiceStatus === 'loading') return;
    orderForVoiceId.current = orderId;
    setVoiceModal(true);
    setVoiceStatus('loading');
    try {
      const r = await api(`/api/orders/${orderId}/voice`, 'GET', null, token, 45000);
      const raw = (r && typeof r.voice === 'string') ? r.voice : '';
      if (!raw) { setVoiceStatus('empty'); return; }
      const uri = await buildVoiceUri(raw);
      if (!uri) { setVoiceStatus('error'); return; }
      stopVoicePlayer();
      const player = createAudioPlayer({ uri });
      voicePlayerRef.current = player;
      try {
        player.addListener('playbackStatusUpdate', (st) => {
          if (st?.didJustFinish) { setVoiceStatus('idle'); stopVoicePlayer(); }
        });
      } catch (_) {}
      player.play();
      setVoiceStatus('playing');
    } catch (e) {
      console.warn('[playVoiceOrder]', e?.message);
      setVoiceStatus('error');
    }
  }

  function closeVoiceModal() {
    stopVoicePlayer();
    setVoiceStatus('idle');
    setVoiceModal(false);
  }

  // Ilova yopilganda/komponent o'chganda pleyerni bo'shatamiz
  useEffect(() => () => stopVoicePlayer(), []);

  // ---- BUYURTMA AMALLARI ----
  async function orderAction(action) {
    if (!order) return;
    const orderId = order.id;
    setLoading(true);
    try {
      const r = await api(`/api/orders/${orderId}/${action}`, 'POST', {}, token);
      if (action === 'complete') {
        const finishedOrder = r.order || order;
        const net = Number(finishedOrder.price || 0) - Number(finishedOrder.commission || 0);
        speak(`Safar yakunlandi. ${fmt(net)} so'm ishlandingiz.`);
        setCompletedTrip(finishedOrder);
        setOrder(null);
        setMeter(null);
        setChatMessages([]);
        loadEarnings();
        updatePersistentNotif('Buyurtma kutilmoqda...');
      } else if (action === 'reject') {
        setOrder(null);
        setMeter(null);
        setChatMessages([]);
        loadEarnings();
        updatePersistentNotif('Buyurtma kutilmoqda...');
      } else {
        const nextStatus = r.order?.status || statusAfter(action);
        if (action === 'start') {
          speak("Safar boshlandi. Yaxshi yo'l!");
          updatePersistentNotif('Safar davom etmoqda...');
        } else if (action === 'accept') {
          updatePersistentNotif('Buyurtma qabul qilindi · Yo\'lda');
        } else if (action === 'arrived') {
          updatePersistentNotif('Mijoz oldida · Kutilmoqda');
        }
        setOrder((p) => ({ ...p, ...(r.order || {}), status: nextStatus }));
      }
    } catch (e) {
      if (e && e.network) {
        // Internet yo'q — amalni navbatga qo'yamiz, qaytganda avtomatik yuboriladi.
        await OfflineQueue.enqueue({ kind: 'order_action', orderId, action });
        // Optimistik holat: haydovchi ish jarayonini to'xtatmasdan davom ettiradi
        if (action === 'complete') {
          setCompletedTrip(order);
          setOrder(null); setMeter(null); setChatMessages([]);
          updatePersistentNotif('Buyurtma kutilmoqda... (oflayn — sinxronlanadi)');
        } else if (action === 'reject') {
          setOrder(null); setMeter(null); setChatMessages([]);
        } else {
          setOrder((p) => (p ? { ...p, status: statusAfter(action) } : p));
        }
        Alert.alert('Oflayn rejim', "Internet yo'q. Amal saqlandi — internet qaytganda avtomatik yuboriladi.");
      } else if (e && e.status === 409) {
        // Server: holat allaqachon o'zgargan (amal qo'llangan) — joriy holatni tiklaymiz
        resumeActiveOrder();
      } else {
        Alert.alert('Xato', e.message);
      }
    }
    setLoading(false);
  }

  // ---- Yo'lovchini baholash ----
  async function rateCustomer(orderId, stars) {
    try {
      await api(`/api/me/rate-customer/${orderId}`, 'POST', { stars }, token);
    } catch (e) { /* baholash ixtiyoriy — jim */ }
  }

  // ---- Mijozga chat xabar yuborish ----
  function sendChat() {
    const text = chatInput.trim();
    if (!text || !order) return;
    socketRef.current?.emit('chat', { orderId: order.id, text });
    setChatMessages((prev) => [...prev, { sender_role: 'driver', text }]);
    setChatInput('');
  }

  // Buyurtma qabul qilingach mavjud xabarlarni yuklash
  async function loadChatHistory(orderId) {
    try {
      const r = await api(`/api/orders/${orderId}/messages`, 'GET', null, token);
      if (r.messages) setChatMessages(r.messages);
    } catch (e) {}
  }

  function statusAfter(action) {
    return { accept: 'accepted', arrived: 'arrived', start: 'in_progress', complete: 'completed' }[action];
  }

  // ---- Mijozga qo'ng'iroq qilish ----
  function callCustomer(phone) {
    if (!phone) return Alert.alert('Telefon yo\'q', 'Mijoz telefoni mavjud emas');
    const d = String(phone).replace(/\D/g, '');
    const tel = d.startsWith('998') ? '+' + d : (d.length === 9 ? '+998' + d : '+' + d);
    Linking.openURL('tel:' + tel).catch(() => Alert.alert('Xato', 'Qo\'ng\'iroq ochilmadi'));
  }

  // ---- Navigatsiya (tashqi xarita ilovasi) ----
  function navigateTo(lat, lng) {
    if (!lat) return;
    const url = Platform.select({
      android: `geo:${lat},${lng}?q=${lat},${lng}`,
      ios: `maps:0,0?q=${lat},${lng}`,
    });
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`)
    );
  }

  // ====================== EKRANLAR ======================
  if (booting)
    return (
      <View style={[s.center, { backgroundColor: BG }]}>
        <BootLogo />
        <FadeInView delay={350} from={8}>
          <ActivityIndicator size="large" color={YELLOW} style={{ marginTop: 32 }} />
        </FadeInView>
      </View>
    );

  // --- PIN ekrani ---
  if (pinStep === 'enter' || pinStep === 'setup') {
    const isSetup = pinStep === 'setup';
    return (
      <ScrollView contentContainerStyle={s.loginWrap}>
        <StatusBar style="light" />
        <FadeInView delay={0} from={20}>
        <View style={{ alignItems: "center", marginBottom: 8 }}><ElgaLogo size={56} /></View>
        <Text style={s.sub}>{isSetup ? "PIN o'rnating" : 'PIN kiriting'}</Text>
        {isSetup && <Text style={s.hint}>Keyingi kirishlarda SMS shart bo'lmaydi</Text>}
        <TextInput
          style={[s.input, { letterSpacing: 16, textAlign: 'center', fontSize: 30 }]}
          placeholder="• • • •"
          placeholderTextColor="#555"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          value={pinInput}
          onChangeText={setPinInput}
          autoFocus
        />
        <PressableScale style={s.btn} onPress={isSetup ? savePin : checkPin}>
          <Text style={s.btnTxt}>{isSetup ? 'PIN SAQLASH' : 'KIRISH'}</Text>
        </PressableScale>
        {isSetup ? (
          <TouchableOpacity onPress={() => setPinStep(null)}>
            <Text style={s.link}>O'tkazib yuborish</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={forgotPin}>
            <Text style={s.link}>SMS orqali kirish</Text>
          </TouchableOpacity>
        )}
        </FadeInView>
      </ScrollView>
    );
  }

  // --- LOGIN ---
  if (!token) {
    return (
      <ScrollView contentContainerStyle={s.loginWrap}>
        <StatusBar style="light" />
        <FadeInView delay={0} from={24} duration={500}>
          <View style={{ alignItems: "center", marginBottom: 8 }}><ElgaLogo size={56} /></View>
          <Text style={s.sub}>Haydovchi ilovasi</Text>
        </FadeInView>
        {step === 'phone' && <FadeInView key="phone" delay={120} from={20}>
          <TextInput style={s.input} placeholder="+998..." placeholderTextColor="#888"
            keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <PressableScale style={s.btn} onPress={sendCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>KOD OLISH</Text>}
          </PressableScale>
        </FadeInView>}
        {step === 'code' && <FadeInView key="code" delay={60} from={20}>
          <TextInput style={s.input} placeholder="SMS kod" placeholderTextColor="#888"
            keyboardType="number-pad" value={code} onChangeText={setCode} />
          <PressableScale style={s.btn} onPress={verifyCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>TASDIQLASH</Text>}
          </PressableScale>
          <TouchableOpacity onPress={() => setStep('phone')}>
            <Text style={s.link}>← Raqamni o'zgartirish</Text>
          </TouchableOpacity>
        </FadeInView>}
        {step === 'register' && <FadeInView key="register" delay={60} from={20}>
          <Text style={s.hint}>Haydovchi ro'yxati:</Text>
          <TextInput style={s.input} placeholder="Ismingiz" placeholderTextColor="#888" value={name} onChangeText={setName} />
          <TextInput style={s.input} placeholder="Mashina (masalan: Cobalt)" placeholderTextColor="#888" value={carModel} onChangeText={setCarModel} />
          <TextInput style={s.input} placeholder="Davlat raqami (01A123BC)" placeholderTextColor="#888" value={carNumber} onChangeText={setCarNumber} autoCapitalize="characters" />
          <PressableScale style={s.btn} onPress={register} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>RO'YXATDAN O'TISH</Text>}
          </PressableScale>
        </FadeInView>}
      </ScrollView>
    );
  }

  // --- SAFAR YAKUNI (baholash) — boshqa hamma narsadan ustun ---
  if (completedTrip) {
    return (
      <View style={s.flex}>
        <StatusBar style="light" />
        <TripComplete
          trip={completedTrip} insets={insets}
          onRate={rateCustomer}
          onDone={() => setCompletedTrip(null)}
        />
      </View>
    );
  }

  // --- ASOSIY EKRAN ---
  return (
    <View style={s.flex}>
      <StatusBar style="light" />

      {/* Tarmoq holati banneri — internet yo'q yoki navbat sinxronlanmoqda */}
      {(!netOnline || queuedCount > 0) && (
        <View style={[s.netBanner, { top: insets.top, backgroundColor: netOnline ? '#15391F' : '#3A1212' }]}>
          <Ionicons name={netOnline ? 'sync' : 'cloud-offline-outline'} size={14} color={netOnline ? GREEN : '#FF6B6B'} />
          <Text style={s.netBannerTxt}>
            {netOnline
              ? `Sinxronlanmoqda… (${queuedCount})`
              : "Internet yo'q. Qayta ulanish kutilmoqda…"}
          </Text>
        </View>
      )}

      {/* GPS "arvoh" ko'rsatkichi — internet bor, lekin GPS 30s+ yangilanmadi (#33) */}
      {online && gpsStale && netOnline && queuedCount === 0 && (
        <View style={[s.netBanner, { top: insets.top, backgroundColor: '#3A2E12' }]}>
          <Ionicons name="locate-outline" size={14} color={YELLOW} />
          <Text style={s.netBannerTxt}>GPS signal yo'q — joylashuv yangilanmayapti</Text>
        </View>
      )}

      {tab === 'home' ? (
        <View style={s.flex}>
          {/* Xarita — memoizatsiya qilingan (GPS/meter yangilanishlarida qayta render bo'lmaydi).
              `mapReady` true bo'lgach, quyidagi useEffect (mapReady deps) joriy
              joylashuv/buyurtma markerlarini imperativ ravishda yuboradi. */}
          <MapPanel ref={mapRef} style={s.map} source={mapSource} onReady={onMapReady} />

          {/* ── Yuqori panel: avatar + ism/reyting + online tugmasi ── */}
          <View style={[s.topBar, { top: insets.top + 6 }]}>
            {/* Chap: Avatar + ism + yulduz */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <View style={s.topAvatar}>
                <Text style={{ color: YELLOW, fontSize: 17, fontWeight: '700' }}>
                  {(user?.name?.[0] || 'H').toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.topName} numberOfLines={1}>{user?.name || 'Haydovchi'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 }}>
                  <Ionicons name="star" size={10} color={YELLOW} />
                  <Text style={{ color: GRAY1, fontSize: 11, fontWeight: '500' }}>
                    {earnings?.stats?.rating || '—'}
                  </Text>
                </View>
              </View>
            </View>
            {/* O'ng: Online/Oflayn pill (bosiladi) */}
            <TouchableOpacity
              style={[s.onlinePill, { borderColor: online ? GREEN + '55' : BORDER }]}
              onPress={toggleOnline}
              disabled={loading}
              activeOpacity={0.75}>
              {loading
                ? <ActivityIndicator size="small" color={online ? GREEN : GRAY1} style={{ width: 8, height: 8 }} />
                : <View style={[s.onlineDot, { backgroundColor: online ? GREEN : GRAY2 }]} />}
              <Text style={[s.onlinePillTxt, { color: online ? GREEN : GRAY1 }]}>
                {online ? 'Onlayn' : 'Oflayn'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Pastki panel — buyurtma YO'Q: online sheet ── */}
          {!order && (
            <View style={[s.bottom, { bottom: TABBAR_H + insets.bottom }]}>
              {online ? (
                <>
                  {/* Radar + "Buyurtma kutilmoqda" */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={s.radarRing1} />
                      <View style={s.radarRing2} />
                      <View style={s.radarDot} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>Buyurtma kutilmoqda...</Text>
                      <Text style={{ color: GRAY1, fontSize: 13, marginTop: 2 }}>Hududda talab yuqori</Text>
                    </View>
                  </View>
                  {/* Bugungi stats */}
                  {earnings && (
                    <View style={s.todayStats}>
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={s.statVal}>{fmt(earnings.today?.earned)}</Text>
                        <Text style={s.statLbl}>Bugun · so'm</Text>
                      </View>
                      <View style={s.statDiv} />
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={s.statVal}>{earnings.today?.trips || 0}</Text>
                        <Text style={s.statLbl}>Safarlar</Text>
                      </View>
                      <View style={s.statDiv} />
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={[s.statVal, { color: GRAY1 }]}>{earnings.stats?.rating || '—'}</Text>
                        <Text style={s.statLbl}>Reyting</Text>
                      </View>
                    </View>
                  )}
                  {/* Mustaqil taksometr */}
                  {soloMeter ? (
                    <View style={{ backgroundColor: CARD2, borderRadius: 14, borderWidth: 1, borderColor: GREEN + '55', padding: 14, marginBottom: 8 }}>
                      <Text style={{ color: GREEN, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>⏱ TAKSOMETR ISHLAYAPTI</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View>
                          <Text style={{ color: WHITE, fontSize: 22, fontWeight: '800' }}>
                            {(Math.round((5000 + (soloMeter.km || 0) * 2800) / 500) * 500).toLocaleString('ru-RU')}
                          </Text>
                          <Text style={{ color: GRAY1, fontSize: 12 }}>so'm · {(soloMeter.km || 0).toFixed(2)} km</Text>
                        </View>
                        <TouchableOpacity onPress={stopSoloMeter} style={{ backgroundColor: RED + '22', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
                          <Text style={{ color: RED, fontWeight: '700' }}>Tugatish</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={{ backgroundColor: CARD2, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingVertical: 12, alignItems: 'center', marginBottom: 8 }}
                      onPress={startSoloMeter} activeOpacity={0.8}>
                      <Text style={{ color: YELLOW, fontSize: 14, fontWeight: '600' }}>🚕 Mustaqil taksometr</Text>
                      <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>Buyurtmasiz narx hisoblash</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.offlineBtn} onPress={toggleOnline} disabled={loading} activeOpacity={0.8}>
                    {loading
                      ? <ActivityIndicator color={GRAY1} />
                      : <Text style={{ color: GRAY1, fontSize: 15, fontWeight: '600' }}>Oflayn bo'lish</Text>}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {earnings && (
                    <View style={[s.todayStats, { marginBottom: 14 }]}>
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={s.statVal}>{fmt(earnings.today?.earned)}</Text>
                        <Text style={s.statLbl}>Bugun · so'm</Text>
                      </View>
                      <View style={s.statDiv} />
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={s.statVal}>{earnings.today?.trips || 0}</Text>
                        <Text style={s.statLbl}>Safarlar</Text>
                      </View>
                      <View style={s.statDiv} />
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={[s.statVal, { color: GRAY1 }]}>{earnings.stats?.rating || '—'}</Text>
                        <Text style={s.statLbl}>Reyting</Text>
                      </View>
                    </View>
                  )}
                  <TouchableOpacity style={s.btn} onPress={toggleOnline} disabled={loading} activeOpacity={0.85}>
                    {loading
                      ? <ActivityIndicator color="#000" />
                      : <>
                          <Ionicons name="power" size={20} color="#1A1500" style={{ marginRight: 8 }} />
                          <Text style={s.btnTxt}>ONLAYN BO'LISH</Text>
                        </>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* ── Buyurtma BILAN: OrderPanel (scroll) ── */}
          {order && (
            <ScrollView
              style={[s.bottom, { bottom: insets.bottom }]}
              contentContainerStyle={{ paddingBottom: 8 }}>
              <OrderPanel
                order={order} loading={loading} meter={meter}
                onAction={orderAction} onNavigate={navigateTo}
                onCall={callCustomer} onChat={() => { loadChatHistory(order.id); setChatModal(true); }}
                onPlayVoice={playVoiceOrder} voiceBusy={voiceStatus === 'loading'}
              />
            </ScrollView>
          )}
        </View>
      ) : tab === 'earnings' ? (
        <EarningsScreen earnings={earnings} onRefresh={loadEarnings} insets={insets} token={token} />
      ) : tab === 'history' ? (
        <DriverHistory trips={trips} insets={insets} />
      ) : (
        <DriverProfile user={user} earnings={earnings} onLogout={logout} insets={insets} token={token} />
      )}

      {/* ===== 🎙 OVOZLI BUYURTMA TINGLASH MODALI (expo-audio) ===== */}
      <Modal visible={voiceModal} transparent animationType="fade" onRequestClose={closeVoiceModal}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 20 }}>
            <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700', marginBottom: 16 }}>🎙 Mijoz ovozli buyurtmasi</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
              {voiceStatus === 'loading' ? (
                <><ActivityIndicator color={YELLOW} /><Text style={{ color: GRAY1, fontSize: 14 }}>Yuklanmoqda...</Text></>
              ) : voiceStatus === 'playing' ? (
                <><Ionicons name="volume-high" size={22} color={GREEN} /><Text style={{ color: WHITE, fontSize: 14 }}>O'ynalmoqda...</Text></>
              ) : voiceStatus === 'empty' ? (
                <><Ionicons name="alert-circle-outline" size={22} color={GRAY1} /><Text style={{ color: GRAY1, fontSize: 14 }}>Ovozli xabar topilmadi</Text></>
              ) : voiceStatus === 'error' ? (
                <><Ionicons name="warning-outline" size={22} color={RED} /><Text style={{ color: GRAY1, fontSize: 14 }}>Ovozni o'ynab bo'lmadi</Text></>
              ) : (
                <><Ionicons name="checkmark-circle-outline" size={22} color={GREEN} /><Text style={{ color: GRAY1, fontSize: 14 }}>Tugadi</Text></>
              )}
            </View>

            {/* Qayta eshitish (xato yoki tugagan holatda) */}
            {orderForVoiceId.current && (voiceStatus === 'error' || voiceStatus === 'idle') ? (
              <TouchableOpacity onPress={() => playVoiceOrder(orderForVoiceId.current)} activeOpacity={0.8}
                style={{ marginTop: 16, paddingVertical: 12, alignItems: 'center', backgroundColor: CARD2, borderRadius: 10, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: YELLOW, fontWeight: '700', fontSize: 15 }}>↻ Qayta eshitish</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity onPress={closeVoiceModal} style={{ marginTop: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: YELLOW, borderRadius: 10 }} activeOpacity={0.85}>
              <Text style={{ color: '#000', fontWeight: '700', fontSize: 15 }}>Yopish</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ===== CHAT MODALI ===== */}
      <Modal visible={chatModal} transparent animationType="slide" onRequestClose={() => setChatModal(false)}>
        <KeyboardAvoidingView style={s.chatModalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.chatModalSheet}>
            <View style={s.chatModalHeader}>
              <Text style={s.chatModalTitle}>💬 {order?.customer_name || 'Mijoz'}</Text>
              <TouchableOpacity onPress={() => setChatModal(false)}>
                <Ionicons name="close" size={22} color={GRAY1} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={chatMessages}
              keyExtractor={(_, i) => String(i)}
              style={{ flex: 1, paddingHorizontal: 16 }}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
              renderItem={({ item }) => {
                const mine = item.sender_role === 'driver';
                return (
                  <View style={[s.chatBubble, mine ? s.chatMine : s.chatTheirs]}>
                    <Text style={{ color: mine ? '#000' : WHITE, fontSize: 15 }}>{item.text}</Text>
                  </View>
                );
              }}
            />
            <View style={s.chatInputRow}>
              <TextInput
                style={s.chatInput}
                placeholder="Xabar yozing..."
                placeholderTextColor={GRAY2}
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={sendChat}
                returnKeyType="send"
              />
              <TouchableOpacity style={s.chatSendBtn} onPress={sendChat}>
                <Ionicons name="send" size={20} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Tab bar — vektor ikonalar (faol: to'ldirilgan, nofaol: chiziqli) */}
      {!order && (
        <View style={[s.tabBar, { height: TABBAR_H + insets.bottom, paddingBottom: insets.bottom + 6 }]}>
          {[
            { id: 'home', label: 'Buyurtmalar', icon: 'navigate' },
            { id: 'earnings', label: 'Daromad', icon: 'wallet' },
            { id: 'history', label: 'Tarix', icon: 'time' },
            { id: 'profile', label: 'Profil', icon: 'person' },
          ].map((t) => {
            const on = tab === t.id;
            return (
              <TouchableOpacity key={t.id} style={s.tabItem} activeOpacity={0.7}
                onPress={() => {
                  setTab(t.id);
                  if (t.id === 'earnings') loadEarnings();
                  if (t.id === 'history') loadTrips();
                }}>
                <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={23} color={on ? YELLOW : GRAY2} />
                <Text style={[s.tabTxt, on && s.tabActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

// Kutish haqi (backend config bilan mos: FREE_WAIT_SEC=120, WAIT_PER_MIN=500, max 20000)
const FREE_WAIT_SEC = 120;
const WAIT_PER_MIN = 500;
const WAIT_FEE_MAX = 20000;
function waitFeeFromSec(sec) {
  const bill = Math.max(0, (sec || 0) - FREE_WAIT_SEC);
  return Math.min(WAIT_FEE_MAX, Math.ceil(bill / 60) * WAIT_PER_MIN);
}

// ---- Mijoz oldida kutish taymeri (arrived holatida) ----
function WaitTimer({ arrivedAt }) {
  const [sec, setSec] = useState(0);
  const spokenRef = useRef(false);
  useEffect(() => {
    const start = arrivedAt
      ? Date.parse(String(arrivedAt).replace(' ', 'T') + 'Z') || Date.now()
      : Date.now();
    const tick = () => {
      const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
      setSec(elapsed);
      if (elapsed >= FREE_WAIT_SEC && !spokenRef.current) {
        spokenRef.current = true;
        speak('Bepul kutish vaqti tugadi. Endi pullik kutish boshlandi.');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [arrivedAt]);
  const free = sec < FREE_WAIT_SEC;
  const remain = Math.max(0, FREE_WAIT_SEC - sec);
  const mm = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const fee = waitFeeFromSec(sec);
  return (
    <View style={s.waitBox}>
      <Text style={s.waitLabel}>⏱ Kutish vaqti: {mm(sec)}</Text>
      {free ? (
        <Text style={s.waitFree}>Bepul kutish: {mm(remain)} qoldi</Text>
      ) : (
        <Text style={s.waitPaid}>Pullik kutish · {fmt(fee)} so'm</Text>
      )}
    </View>
  );
}

// ---- Yangi buyurtma countdown (15s) ----
function CountdownBar() {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 0, duration: 15000, useNativeDriver: false }).start();
  }, []);
  return (
    <View style={{ height: 4, backgroundColor: BORDER, borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
      <Animated.View style={{ height: 4, backgroundColor: YELLOW, borderRadius: 4, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

// ---- Buyurtma paneli (holat tugmalari) ----
function OrderPanel({ order, loading, meter, onAction, onNavigate, onCall, onChat, onPlayVoice, voiceBusy }) {
  const st = order.status;
  const isNew = st === 'searching' || st === 'assigned';
  const showCustomer = ['accepted', 'arrived', 'in_progress'].includes(st) && !!order.customer_phone;
  return (
    <View>
      {/* Yangi buyurtma: header bilan narx + countdown */}
      {isNew ? (
        <>
          <CountdownBar />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <View>
              <Text style={{ color: YELLOW, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 }}>YANGI BUYURTMA</Text>
              <Text style={{ color: GRAY1, fontSize: 13, marginTop: 3 }}>
                {order.eta_min ? `${order.eta_min} daq uzoqlikda` : 'Yaqin atrofda'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: WHITE, fontSize: 28, fontWeight: '800', lineHeight: 30 }}>{fmt(order.price)}</Text>
              <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>so'm · {order.payment_method === 'cash' ? 'Naqd' : (order.payment_method || 'Naqd')}</Text>
            </View>
          </View>
          {/* Route timeline */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
            <View style={{ alignItems: 'center', paddingTop: 4 }}>
              <Ionicons name="ellipse-outline" size={11} color={GRAY1} />
              <View style={{ width: 2, height: 18, backgroundColor: BORDER, marginVertical: 3 }} />
              <Ionicons name="square" size={10} color={YELLOW} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 14 }} numberOfLines={1}>{safeStr(order.from_address, 'Olib ketish nuqtasi')}</Text>
              <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                {safeStr(order.to_address, 'Manzil')}
                {order.distance_km ? <Text style={{ color: GRAY1, fontWeight: '400' }}> · {order.distance_km} km</Text> : null}
              </Text>
            </View>
          </View>
          {/* 🔊 Ovozli buyurtma — mijoz manzilni gapirgan. Ovoz o'ynalmasa ham
              buyurtma ko'rinaveradi va qabul qilinadi. */}
          {order.is_voice ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD2, borderWidth: 1, borderColor: YELLOW, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 }}>
              <View style={{ backgroundColor: '#1A1400', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: YELLOW, fontSize: 12, fontWeight: '700' }}>🔊 Ovozli</Text>
              </View>
              <Text style={{ color: GRAY1, fontSize: 12, flex: 1 }}>Mijoz manzilni gapirgan</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: YELLOW, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 14 }}
                onPress={() => onPlayVoice && onPlayVoice(order.id)} disabled={voiceBusy} activeOpacity={0.8}>
                {voiceBusy
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>▶ Eshitish</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={s.row}>
            <TouchableOpacity style={[s.btnHalf, { backgroundColor: CARD2, borderWidth: 1, borderColor: BORDER }]}
              onPress={() => onAction('reject')} disabled={loading}>
              <Text style={{ color: GRAY1, fontSize: 15, fontWeight: '600' }}>Rad etish</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnHalf, { backgroundColor: YELLOW }]}
              onPress={() => onAction('accept')} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontSize: 15, fontWeight: '700' }}>Qabul qilish</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={s.orderTitle}>📍 {safeStr(order.from_address, 'Olib ketish nuqtasi')}</Text>
          <Text style={s.orderSub}>→ {safeStr(order.to_address, 'Manzil')}</Text>
          <Text style={s.orderPrice}>{fmt(order.price)} so'm · {order.distance_km || '?'} km</Text>

          {/* Mijoz ma'lumoti + qo'ng'iroq + xabar */}
          {showCustomer && (
            <View style={s.custRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.custName}>{order.customer_name || 'Mijoz'}</Text>
                <Text style={s.custPhone}>{fmtPhone(order.customer_phone)}</Text>
              </View>
              <TouchableOpacity style={[s.callBtn, { marginRight: 8, backgroundColor: '#0A2540' }]} onPress={() => onChat()}>
                <Ionicons name="chatbubble" size={18} color="#007AFF" />
              </TouchableOpacity>
              <TouchableOpacity style={s.callBtn} onPress={() => onCall(order.customer_phone)}>
                <Ionicons name="call" size={18} color={GREEN} />
              </TouchableOpacity>
            </View>
          )}

          {/* Kutish taymeri (mijoz oldida) */}
          {st === 'arrived' && <WaitTimer arrivedAt={order.arrived_at} />}

          {/* Qabul qilingan — navigatsiya + yetib keldim */}
          {st === 'accepted' && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <TouchableOpacity style={s.btnNav} onPress={() => onNavigate(order.from_lat, order.from_lng)} activeOpacity={0.8}>
                <Ionicons name="navigate" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={s.btnTxtW}>MIJOZGA YO'L</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => onAction('arrived')} disabled={loading} activeOpacity={0.85}>
                {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>YETIB KELDIM</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Yetib keldi — safarni boshlash */}
          {st === 'arrived' && (
            <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={() => onAction('start')} disabled={loading} activeOpacity={0.85}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>SAFARNI BOSHLASH</Text>}
            </TouchableOpacity>
          )}

          {/* Safar davomida — jonli hisoblagich + manzilga yo'l + yakunlash */}
          {st === 'in_progress' && (
            <View style={{ gap: 8, marginTop: 8 }}>
              {/* Jonli taximetr (hisoblagichli buyurtmalar uchun) */}
              {!!(meter || order.metered) && (
                <View style={s.meterBox}>
                  <View>
                    <Text style={{ color: GREEN, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 }}>SAFAR DAVOM ETMOQDA</Text>
                    <Text style={{ color: GRAY1, fontSize: 13, marginTop: 4 }}>
                      {meter ? `${meter.km} km · ${meter.minutes} daq` : (order.distance_km ? `${order.distance_km} km` : ' ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: WHITE, fontSize: 26, fontWeight: '800', lineHeight: 28 }}>
                      {fmt(meter ? meter.fare : order.price)}
                    </Text>
                    <Text style={{ color: GRAY1, fontSize: 11, marginTop: 2 }}>so'm</Text>
                  </View>
                </View>
              )}
              <TouchableOpacity style={s.btnNav} onPress={() => onNavigate(order.to_lat, order.to_lng)} activeOpacity={0.8}>
                <Ionicons name="navigate" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={s.btnTxtW}>MANZILGA YO'L</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => onAction('complete')} disabled={loading} activeOpacity={0.85}>
                {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>SAFARNI YAKUNLASH</Text>}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ---- Haftalik grafik (to'siq diagramma, tashqi kutubxonasiz) ----
function WeekChart({ days }) {
  if (!days || days.length === 0) return null;
  const values = days.map((d) => Number(d.earned || 0));
  const maxVal = Math.max(...values, 1);
  const DAY_NAMES = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Sh', 'Ya'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 100, marginTop: 8, marginBottom: 4 }}>
      {days.map((d, i) => {
        const ratio = values[i] / maxVal;
        const barH = Math.max(4, ratio * 80);
        const isTop = values[i] === maxVal && maxVal > 0;
        const label = d.date ? new Date(d.date).getDay() : i;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ flex: 1, justifyContent: 'flex-end', width: '70%' }}>
              <Animated.View style={{ height: barH, borderRadius: 6, backgroundColor: isTop ? YELLOW : CARD2, borderWidth: 1, borderColor: isTop ? YELLOW : BORDER }} />
            </View>
            <Text style={{ color: GRAY2, fontSize: 10, fontWeight: '500' }}>{typeof label === 'number' ? DAY_NAMES[label] : label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ---- Daromad ekrani (premium) ----
function EarningsScreen({ earnings, onRefresh, insets, token }) {
  const top = (insets?.top || 0) + 20;
  const bottom = TABBAR_H + (insets?.bottom || 0) + 20;
  const st = earnings?.stats || {};
  const weekEarned = Number(earnings?.week?.earned || 0);
  const totalEarned = Number(earnings?.total?.earned || 0);

  // Hisob to'ldirish (Click)
  const [topupModal, setTopupModal] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [driverBalance, setDriverBalance] = useState(null);

  // Balansni yuklaymiz
  React.useEffect(() => {
    if (token) {
      api('/api/me/balance', 'GET', null, token)
        .then(r => setDriverBalance(r?.balance ?? null))
        .catch(() => {});
    }
  }, [token]);

  async function doTopup() {
    const amount = parseInt(String(topupAmount).replace(/\D/g, ''), 10);
    if (!amount || amount < 5000) { Alert.alert('Xato', "Eng kam 5 000 so'm kiriting"); return; }
    setTopupLoading(true);
    try {
      const r = await api('/api/me/topup-create', 'POST', { amount }, token);
      setTopupModal(false);
      setTopupAmount('');
      await Linking.openURL(r.url);
    } catch (e) {
      Alert.alert('Xato', e.message || "To'ldirish imkoni yo'q");
    }
    setTopupLoading(false);
  }

  return (
    <ScrollView style={s.earnWrap} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: top, paddingBottom: bottom }}>
      <Text style={s.screenSub}>Moliya</Text>
      <Text style={s.screenTitle}>Daromad</Text>

      {!earnings ? (
        <ActivityIndicator color={YELLOW} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Balans kartasi */}
          <View style={[s.balanceCard, { marginTop: 20 }]}>
            <Text style={{ color: GRAY1, fontSize: 13, fontWeight: '500', letterSpacing: 0.3 }}>JAMI DAROMAD</Text>
            <Text style={{ color: WHITE, fontSize: 36, fontWeight: '800', marginTop: 6, lineHeight: 40 }}>
              {fmt(totalEarned)} <Text style={{ color: GRAY1, fontSize: 18, fontWeight: '500' }}>so'm</Text>
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN }} />
              <Text style={{ color: GRAY1, fontSize: 13 }}>Bu hafta: {fmt(weekEarned)} so'm</Text>
            </View>
            <TouchableOpacity
              style={s.withdrawBtn}
              onPress={() => Alert.alert('Yechib olish', 'Ushbu funksiya tez orada ishga tushadi.\nHozircha admin bilan bog\'laning.')}
              activeOpacity={0.8}>
              <Ionicons name="arrow-up-circle" size={18} color="#000" style={{ marginRight: 6 }} />
              <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>YECHIB OLISH</Text>
            </TouchableOpacity>
          </View>

          {/* Hisob to'ldirish (Click) */}
          <View style={{ backgroundColor: CARD, borderRadius: 16, padding: 16, marginTop: 14, borderWidth: 1, borderColor: BORDER }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <View>
                <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>HISOB BALANSI</Text>
                <Text style={{ color: driverBalance != null && driverBalance < 0 ? RED : WHITE, fontSize: 24, fontWeight: '800', marginTop: 4 }}>
                  {driverBalance != null ? fmt(driverBalance) : '—'} <Text style={{ color: GRAY1, fontSize: 14, fontWeight: '400' }}>so'm</Text>
                </Text>
              </View>
              <View style={{ backgroundColor: CARD2, borderRadius: 10, padding: 10 }}>
                <Ionicons name="wallet" size={24} color={YELLOW} />
              </View>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#005EEB', borderRadius: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onPress={() => setTopupModal(true)}
              activeOpacity={0.85}>
              <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700' }}>Click orqali to'ldirish</Text>
            </TouchableOpacity>
          </View>

          {/* Click topup modal */}
          <Modal visible={topupModal} transparent animationType="slide" onRequestClose={() => setTopupModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
              <View style={{ backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: (insets?.bottom || 0) + 24 }}>
                <Text style={{ color: WHITE, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 6 }}>Hisobni to'ldirish</Text>
                <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginBottom: 20 }}>Click orqali to'lov</Text>
                <Text style={{ color: GRAY1, fontSize: 12, marginBottom: 6 }}>Summani kiriting (so'm)</Text>
                <TextInput
                  style={{ backgroundColor: CARD2, borderRadius: 12, padding: 16, fontSize: 22, fontWeight: '700', color: WHITE, marginBottom: 12, textAlign: 'center' }}
                  placeholder="Masalan: 50000"
                  placeholderTextColor={GRAY2}
                  keyboardType="number-pad"
                  value={topupAmount}
                  onChangeText={setTopupAmount}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {[10000, 20000, 50000, 100000].map(a => (
                    <TouchableOpacity key={a} onPress={() => setTopupAmount(String(a))}
                      style={{ flex: 1, backgroundColor: CARD2, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: topupAmount === String(a) ? 1.5 : 0, borderColor: YELLOW }}>
                      <Text style={{ color: topupAmount === String(a) ? YELLOW : GRAY1, fontSize: 13, fontWeight: '600' }}>{fmt(a)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: '#005EEB', borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', opacity: topupLoading ? 0.6 : 1 }}
                  onPress={doTopup}
                  disabled={topupLoading}
                  activeOpacity={0.85}>
                  {topupLoading ? <ActivityIndicator color={WHITE} /> : <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700' }}>Click orqali to'lash</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setTopupModal(false); setTopupAmount(''); }} style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: GRAY1, fontSize: 15 }}>Bekor qilish</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* 4-stat grid */}
          <View style={s.statsGrid}>
            <View style={s.statCell}>
              <Text style={s.statCellVal}>{earnings.today?.trips || 0}</Text>
              <Text style={s.statCellLbl}>Bugungi safarlar</Text>
            </View>
            <View style={s.statCell}>
              <Text style={s.statCellVal}>{earnings.week?.trips || 0}</Text>
              <Text style={s.statCellLbl}>Haftalik safarlar</Text>
            </View>
            <View style={s.statCell}>
              <Text style={[s.statCellVal, { color: YELLOW }]}>{st.rating || '—'}</Text>
              <Text style={s.statCellLbl}>Reyting ⭐</Text>
            </View>
            <View style={s.statCell}>
              <Text style={[s.statCellVal, { color: GREEN }]}>{st.accept_rate != null ? st.accept_rate + '%' : '—'}</Text>
              <Text style={s.statCellLbl}>Qabul foizi</Text>
            </View>
          </View>

          {/* Haftalik grafik */}
          {earnings.days && earnings.days.length > 0 && (
            <View style={s.chartCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <Text style={{ color: WHITE, fontSize: 15, fontWeight: '700' }}>Haftalik grafik</Text>
                <Text style={{ color: GRAY1, fontSize: 13 }}>{fmt(weekEarned)} so'm</Text>
              </View>
              <WeekChart days={earnings.days} />
            </View>
          )}

          {/* Bugun karta */}
          <View style={s.earnDayCard}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '500' }}>BUGUN</Text>
              <Text style={{ color: YELLOW, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{fmt(earnings.today?.earned)} so'm</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '500' }}>SAFARLAR</Text>
              <Text style={{ color: WHITE, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{earnings.today?.trips || 0}</Text>
            </View>
          </View>

          <TouchableOpacity style={[s.btn, { marginTop: 8 }]} onPress={onRefresh} activeOpacity={0.85}>
            <Ionicons name="refresh" size={18} color="#000" style={{ marginRight: 8 }} />
            <Text style={s.btnTxt}>YANGILASH</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// ---- Safar yakuni: hisob-kitob + yo'lovchini baholash ----
function TripComplete({ trip, insets, onRate, onDone }) {
  const [stars, setStars] = useState(5);
  const [done, setDone] = useState(false);
  const gross = Number(trip.price || 0);
  const commission = Number(trip.commission || 0);
  const net = gross - commission;
  const top = (insets?.top || 0) + 40;
  const bottom = (insets?.bottom || 0) + 24;
  function finish() {
    if (!done) { onRate(trip.id, stars); setDone(true); }
    onDone();
  }
  return (
    <View style={[s.completeWrap, { paddingTop: top, paddingBottom: bottom }]}>
      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <View style={s.completeCheck}>
          <Ionicons name="checkmark" size={34} color={GREEN} />
        </View>
        <Text style={{ color: WHITE, fontSize: 21, fontWeight: '700' }}>Safar yakunlandi</Text>
      </View>

      {/* Hisob-kitob */}
      <View style={s.completeCard}>
        <View style={s.completeRow}>
          <Text style={s.completeLbl}>Safar haqi</Text>
          <Text style={{ color: WHITE, fontSize: 14, fontWeight: '500' }}>{fmt(gross)} so'm</Text>
        </View>
        <View style={s.completeRow}>
          <Text style={s.completeLbl}>ELGA komissiya</Text>
          <Text style={{ color: RED, fontSize: 14, fontWeight: '500' }}>−{fmt(commission)} so'm</Text>
        </View>
        <View style={[s.completeRow, { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 14, marginTop: 4, marginBottom: 0 }]}>
          <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>Sizning daromad</Text>
          <Text style={{ color: YELLOW, fontSize: 22, fontWeight: '800' }}>
            {fmt(net)} <Text style={{ color: GRAY1, fontSize: 13, fontWeight: '500' }}>so'm</Text>
          </Text>
        </View>
      </View>

      {/* Yo'lovchini baholash */}
      <View style={{ alignItems: 'center', marginVertical: 20 }}>
        <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 12 }}>Yo'lovchini baholang</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[1, 2, 3, 4, 5].map((sN) => (
            <TouchableOpacity key={sN} onPress={() => setStars(sN)} activeOpacity={0.7}>
              <Ionicons name={sN <= stars ? 'star' : 'star-outline'} size={32} color={sN <= stars ? YELLOW : GRAY2} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity style={[s.btn, { marginTop: 'auto' }]} onPress={finish} activeOpacity={0.85}>
        <Text style={s.btnTxt}>DAVOM ETISH</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---- Tarix ekrani (yakunlangan safarlar, kunlar bo'yicha) ----
// React.memo: ota komponent (AppInner) GPS/meter yangilanishlarida har 5 sek
// qayta render bo'lganda ham, bu ekran faqat trips/insets o'zgarsa render bo'ladi.
const DriverHistory = React.memo(function DriverHistory({ trips, insets }) {
  const top = (insets?.top || 0) + 16;
  const bottom = TABBAR_H + (insets?.bottom || 0) + 20;
  // Guruhlash faqat trips o'zgarganda hisoblanadi.
  const groups = useMemo(() => {
    const g = {};
    (trips || []).forEach((t) => {
      const d = new Date(t.created_at || t.completed_at || Date.now());
      const today = new Date().toDateString();
      const yest = new Date(Date.now() - 86400000).toDateString();
      const key = d.toDateString() === today ? 'Bugun' : d.toDateString() === yest ? 'Kecha' : d.toLocaleDateString('ru-RU');
      (g[key] = g[key] || []).push(t);
    });
    return g;
  }, [trips]);
  return (
    <ScrollView style={s.screenWrap} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: 20 }}>
      <Text style={s.screenSub}>Yakunlangan safarlar</Text>
      <Text style={s.screenTitle}>Tarix</Text>
      {trips === null ? (
        <ActivityIndicator color={YELLOW} style={{ marginTop: 30 }} />
      ) : trips.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 60 }}>
          <Ionicons name="time-outline" size={48} color={GRAY2} />
          <Text style={{ color: GRAY1, fontSize: 15, marginTop: 12 }}>Hozircha safarlar yo'q</Text>
        </View>
      ) : Object.keys(groups).map((day) => (
        <View key={day} style={{ marginTop: 18 }}>
          <Text style={s.histDay}>{day.toUpperCase()}</Text>
          {groups[day].map((t, i) => {
            const d = new Date(t.created_at || t.completed_at || Date.now());
            const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            return (
              <View key={t.id || i} style={s.histCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ color: GRAY1, fontSize: 13 }}>{time}</Text>
                  <Text style={{ color: YELLOW, fontSize: 15, fontWeight: '700' }}>
                    +{fmt(t.driver_earned || t.price)} <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '500' }}>so'm</Text>
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ alignItems: 'center', paddingTop: 4 }}>
                    <Ionicons name="ellipse-outline" size={11} color={GRAY1} />
                    <View style={s.histLine} />
                    <Ionicons name="square" size={10} color={YELLOW} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.histAddr} numberOfLines={1}>{t.from_address || '—'}</Text>
                    <Text style={[s.histAddr, { color: WHITE, fontWeight: '600', marginTop: 10 }]} numberOfLines={1}>{t.to_address || '—'}</Text>
                  </View>
                </View>
                <View style={s.histFoot}>
                  {t.distance_km != null && <Text style={s.histMeta}>{t.distance_km} km</Text>}
                  {t.status === 'cancelled' && <Text style={[s.histMeta, { color: RED }]}>Bekor qilingan</Text>}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
});

// ---- Profil ekrani ----
function DriverProfile({ user, earnings, onLogout, insets, token }) {
  const top = (insets?.top || 0) + 16;
  const bottom = TABBAR_H + (insets?.bottom || 0) + 20;
  const st = earnings?.stats || {};
  const car = user?.car_model || user?.car || '';
  const plate = user?.car_number || user?.plate || '';
  const color = user?.car_color || '';
  const bankCard = user?.bank_card || '';

  // Modal states
  const [carModal, setCarModal] = useState(false);
  const [cardModal, setCardModal] = useState(false);
  const [helpModal, setHelpModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);

  // Edit states
  const [editCar, setEditCar] = useState('');
  const [editPlate, setEditPlate] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editCard, setEditCard] = useState('');

  // Saving states
  const [savingCar, setSavingCar] = useState(false);
  const [savingCard, setSavingCard] = useState(false);

  // Settings
  const [soundNotif, setSoundNotif] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('sound_notif').then(val => {
      if (val !== null) setSoundNotif(val === 'true');
    });
  }, []);

  const toggleSound = async () => {
    const next = !soundNotif;
    setSoundNotif(next);
    await AsyncStorage.setItem('sound_notif', String(next));
  };

  const saveCar = async () => {
    setSavingCar(true);
    try {
      await api('/api/me/profile', 'PATCH', { car_model: editCar, car_number: editPlate, car_color: editColor }, token);
      Alert.alert('Saqlandi', 'Avtomobil ma\'lumotlari yangilandi');
      setCarModal(false);
    } catch (e) {
      Alert.alert('Xatolik', e.message || 'Saqlab bo\'lmadi');
    } finally {
      setSavingCar(false);
    }
  };

  const saveCard = async () => {
    setSavingCard(true);
    try {
      await api('/api/me/profile', 'PATCH', { bank_card: editCard.replace(/\s/g, '') }, token);
      Alert.alert('Saqlandi', 'Karta ma\'lumotlari yangilandi');
      setCardModal(false);
    } catch (e) {
      Alert.alert('Xatolik', e.message || 'Saqlab bo\'lmadi');
    } finally {
      setSavingCard(false);
    }
  };

  const formatCardInput = (val) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const detectBank = (num) => {
    const d = num.replace(/\s/g, '');
    if (d.startsWith('8600')) return { name: 'Uzcard', color: YELLOW };
    if (d.startsWith('9860')) return { name: 'Humo', color: '#3B82F6' };
    if (d.startsWith('4')) return { name: 'Visa', color: '#1A1F71' };
    if (d.startsWith('5')) return { name: 'Mastercard', color: '#EB001B' };
    return null;
  };

  const bank = detectBank(editCard);

  return (
    <ScrollView style={s.screenWrap} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: 20 }}>
      <Text style={s.screenTitle}>Profil</Text>
      {/* Avatar + reyting */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16, marginBottom: 20 }}>
        <View style={s.profAvatar}>
          <Text style={{ color: YELLOW, fontSize: 28, fontWeight: '700' }}>{(user?.name?.[0] || 'H').toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: WHITE, fontSize: 20, fontWeight: '700' }}>{user?.name || 'Haydovchi'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Ionicons name="star" size={14} color={YELLOW} />
            <Text style={{ color: GRAY1, fontSize: 14, fontWeight: '600' }}>{st.rating || '—'}</Text>
            <Text style={{ color: GRAY2, fontSize: 14 }}>·</Text>
            <Text style={{ color: GRAY1, fontSize: 14 }}>{fmtPhone(user?.phone)}</Text>
          </View>
        </View>
      </View>

      {/* Mashina kartasi */}
      {(car || plate) && (
        <View style={s.profCarCard}>
          <Ionicons name="car-sport" size={30} color={YELLOW} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>{car || 'Avtomobil'}</Text>
            <Text style={{ color: GRAY1, fontSize: 13, marginTop: 2 }}>Davlat raqami</Text>
          </View>
          {plate ? (
            <View style={s.plateBox}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: '#888', letterSpacing: 1 }}>UZ</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0B0B0B' }}>{plate}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Statistika */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
        <View style={s.profStat}>
          <Text style={s.profStatVal}>{st.trips_done ?? earnings?.total?.trips ?? 0}</Text>
          <Text style={s.profStatLbl}>Safarlar</Text>
        </View>
        <View style={s.profStat}>
          <Text style={[s.profStatVal, { color: YELLOW }]}>{st.accept_rate != null ? st.accept_rate + '%' : '—'}</Text>
          <Text style={s.profStatLbl}>Qabul foizi</Text>
        </View>
        <View style={s.profStat}>
          <Text style={s.profStatVal}>{st.rating || '—'}</Text>
          <Text style={s.profStatLbl}>Reyting</Text>
        </View>
      </View>

      {/* Menyu */}
      <View style={[s.profMenu, { marginTop: 20 }]}>
        <ProfRow icon="car-outline" title="Avtomobil ma'lumotlari" onPress={() => { setEditCar(car); setEditPlate(plate); setEditColor(color); setCarModal(true); }} />
        <ProfRow icon="document-text-outline" title="Hujjatlar" detail="Tasdiqlangan" />
        <ProfRow icon="card-outline" title="To'lov va karta" detail={bankCard ? '●●●● ' + bankCard.slice(-4) : undefined} last onPress={() => { setEditCard(bankCard ? formatCardInput(bankCard) : ''); setCardModal(true); }} />
      </View>
      <View style={s.profMenu}>
        <ProfRow icon="headset-outline" title="Yordam markazi" onPress={() => setHelpModal(true)} />
        <ProfRow icon="settings-outline" title="Sozlamalar" last onPress={() => setSettingsModal(true)} />
      </View>

      <TouchableOpacity style={s.logoutBtn} onPress={onLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color={RED} style={{ marginRight: 8 }} />
        <Text style={{ color: RED, fontSize: 15, fontWeight: '600' }}>Chiqish</Text>
      </TouchableOpacity>

      {/* ===== A. Avtomobil ma'lumotlari Modal ===== */}
      <Modal visible={carModal} animationType="slide" onRequestClose={() => setCarModal(false)}>
        <View style={{ flex: 1, backgroundColor: BG }}>
          <View style={{ paddingTop: (insets?.top || 0) + 16, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setCarModal(false)} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={24} color={WHITE} />
            </TouchableOpacity>
            <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>Avtomobil ma'lumotlari</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            <View style={{ backgroundColor: CARD2, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 8 }}>Mashina rusumi</Text>
              <TextInput
                style={[s.input, { marginBottom: 0 }]}
                placeholder="Masalan: Chevrolet Malibu"
                placeholderTextColor={GRAY2}
                value={editCar}
                onChangeText={setEditCar}
              />
            </View>
            <View style={{ backgroundColor: CARD2, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 8 }}>Davlat raqami</Text>
              <TextInput
                style={[s.input, { marginBottom: 0 }]}
                placeholder="Masalan: 01 A 123 BC"
                placeholderTextColor={GRAY2}
                value={editPlate}
                onChangeText={setEditPlate}
                autoCapitalize="characters"
              />
            </View>
            <View style={{ backgroundColor: CARD2, borderRadius: 14, padding: 16, marginBottom: 24 }}>
              <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 8 }}>Mashina rangi</Text>
              <TextInput
                style={[s.input, { marginBottom: 0 }]}
                placeholder="Masalan: Oq"
                placeholderTextColor={GRAY2}
                value={editColor}
                onChangeText={setEditColor}
              />
            </View>
            <TouchableOpacity style={s.btn} onPress={saveCar} activeOpacity={0.8} disabled={savingCar}>
              {savingCar
                ? <ActivityIndicator color="#000" />
                : <Text style={s.btnTxt}>Saqlash</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ===== B. To'lov va karta Modal ===== */}
      <Modal visible={cardModal} animationType="slide" onRequestClose={() => setCardModal(false)}>
        <View style={{ flex: 1, backgroundColor: BG }}>
          <View style={{ paddingTop: (insets?.top || 0) + 16, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setCardModal(false)} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={24} color={WHITE} />
            </TouchableOpacity>
            <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>To'lov va karta</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            <View style={{ backgroundColor: CARD2, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 6 }}>
                Keshbek hisobiga o'tkazish va bonus olish uchun karta qo'shing
              </Text>
              {bank && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ backgroundColor: bank.color, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: bank.color === YELLOW ? '#000' : WHITE, fontSize: 12, fontWeight: '700' }}>{bank.name}</Text>
                  </View>
                </View>
              )}
              <TextInput
                style={[s.input, { marginBottom: 0, letterSpacing: 2 }]}
                placeholder="1234 5678 9012 3456"
                placeholderTextColor={GRAY2}
                value={editCard}
                keyboardType="number-pad"
                maxLength={19}
                onChangeText={val => setEditCard(formatCardInput(val))}
              />
            </View>
            <View style={{ backgroundColor: CARD2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 24, flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="cash-outline" size={18} color={GREEN} style={{ marginRight: 8 }} />
              <Text style={{ color: GRAY1, fontSize: 13 }}>Naqd pul to'lovi har doim mavjud</Text>
            </View>
            <TouchableOpacity style={s.btn} onPress={saveCard} activeOpacity={0.8} disabled={savingCard}>
              {savingCard
                ? <ActivityIndicator color="#000" />
                : <Text style={s.btnTxt}>Saqlash</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ===== C. Yordam markazi Modal ===== */}
      <Modal visible={helpModal} animationType="slide" onRequestClose={() => setHelpModal(false)}>
        <View style={{ flex: 1, backgroundColor: BG }}>
          <View style={{ paddingTop: (insets?.top || 0) + 16, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setHelpModal(false)} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={24} color={WHITE} />
            </TouchableOpacity>
            <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>Yordam markazi</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            <View style={{ backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 16 }}>
              <TouchableOpacity onPress={() => Linking.openURL('tel:+998712000000')} activeOpacity={0.75}
                style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                <Text style={{ fontSize: 18, marginRight: 12 }}>📞</Text>
                <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>Operator bilan bog'lanish</Text>
                <Ionicons name="chevron-forward" size={18} color={GRAY2} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Linking.openURL('https://t.me/elgataxiuz')} activeOpacity={0.75}
                style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                <Text style={{ fontSize: 18, marginRight: 12 }}>✈️</Text>
                <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>Telegram kanal</Text>
                <Ionicons name="chevron-forward" size={18} color={GRAY2} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Linking.openURL('https://t.me/elgataxisupport')} activeOpacity={0.75}
                style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <Text style={{ fontSize: 18, marginRight: 12 }}>💬</Text>
                <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>Texnik yordam</Text>
                <Ionicons name="chevron-forward" size={18} color={GRAY2} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 }}>KO'P SO'RALADIGAN SAVOLLAR</Text>
            <View style={{ backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER }}>
              {[
                { q: 'Haydovchi hisobim blok bo\'ldi', a: 'Admin bilan bog\'laning: @elgataxiuz' },
                { q: 'To\'lov qachon chiqadi?', a: 'Har kuni 18:00 da avtomatik o\'tkaziladi' },
                { q: 'Reyting qanday hisoblanadi?', a: 'Mijozlar bergan 1-5 ball o\'rtachasi' },
                { q: 'Mashina ma\'lumotlarini o\'zgartirish', a: 'Profil → Avtomobil ma\'lumotlari bo\'limidan' },
              ].map((item, i, arr) => (
                <View key={i} style={[{ padding: 16 }, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
                  <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>{item.q}</Text>
                  <Text style={{ color: GRAY1, fontSize: 13 }}>{item.a}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ===== D. Sozlamalar Modal ===== */}
      <Modal visible={settingsModal} animationType="slide" onRequestClose={() => setSettingsModal(false)}>
        <View style={{ flex: 1, backgroundColor: BG }}>
          <View style={{ paddingTop: (insets?.top || 0) + 16, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setSettingsModal(false)} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={24} color={WHITE} />
            </TouchableOpacity>
            <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>Sozlamalar</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 }}>BILDIRISHNOMALAR</Text>
            <View style={{ backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>Yangi buyurtma ovozi</Text>
                <TouchableOpacity onPress={toggleSound} activeOpacity={0.8}
                  style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: soundNotif ? GREEN : CARD2, borderWidth: 1, borderColor: soundNotif ? GREEN : BORDER }}>
                  <Text style={{ color: soundNotif ? '#000' : GRAY1, fontSize: 12, fontWeight: '700' }}>{soundNotif ? 'Yoqiq' : 'O\'chiq'}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>Tun rejimi</Text>
                <View style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: CARD2, borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '700' }}>Doim yoqiq</Text>
                </View>
              </View>
            </View>

            <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 }}>ILOVA HAQIDA</Text>
            <View style={{ backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 16 }}>
              {[
                { label: 'Versiya', value: 'ELGA Haydovchi v1.0.0' },
                { label: 'Qurilgan', value: 'Expo SDK 54' },
                { label: 'Litsenziya', value: '© 2025 ELGA TAXI' },
              ].map((item, i, arr) => (
                <View key={i} style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
                  <Text style={{ color: GRAY1, fontSize: 14 }}>{item.label}</Text>
                  <Text style={{ color: WHITE, fontSize: 14, fontWeight: '500' }}>{item.value}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={{ borderWidth: 1, borderColor: RED, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
              activeOpacity={0.8}
              onPress={() => {
                Alert.alert(
                  'Ma\'lumotlarni tozalash',
                  'Kesh ma\'lumotlari tozalanadi. Davom etasizmi?',
                  [
                    { text: 'Bekor qilish', style: 'cancel' },
                    {
                      text: 'Tozalash', style: 'destructive', onPress: async () => {
                        try {
                          const savedToken = await AsyncStorage.getItem('token');
                          const savedUser = await AsyncStorage.getItem('user');
                          await AsyncStorage.clear();
                          if (savedToken) await AsyncStorage.setItem('token', savedToken);
                          if (savedUser) await AsyncStorage.setItem('user', savedUser);
                          Alert.alert('Tayyor', 'Kesh tozalandi');
                        } catch (e) {
                          Alert.alert('Xatolik', 'Tozalash amalga oshmadi');
                        }
                      }
                    },
                  ]
                );
              }}>
              <Text style={{ color: RED, fontSize: 15, fontWeight: '600' }}>Ma'lumotlarni tozalash</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

function ProfRow({ icon, title, detail, last, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}
      style={[s.profRowItem, !last && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
      <Ionicons name={icon} size={20} color={GRAY1} />
      <Text style={{ flex: 1, color: WHITE, fontSize: 15, marginLeft: 14 }}>{title}</Text>
      {detail && <Text style={{ color: GREEN, fontSize: 13, marginRight: 8 }}>{detail}</Text>}
      <Ionicons name="chevron-forward" size={18} color={GRAY2} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  map: { flex: 1 },
  loginWrap: { flexGrow: 1, backgroundColor: '#111', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 60 },
  logo: { color: '#FFC700', fontSize: 56, fontWeight: 'bold', textAlign: 'center' },
  sub: { color: '#aaa', fontSize: 16, textAlign: 'center', marginBottom: 36 },
  hint: { color: '#ccc', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  input: { backgroundColor: '#222', color: '#fff', fontSize: 18, padding: 16, borderRadius: 12, marginBottom: 14 },
  btn: { backgroundColor: '#FFC700', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  btnTxt: { color: '#000', fontSize: 17, fontWeight: 'bold' },
  btnTxtW: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  btnNav: { backgroundColor: '#1976D2', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  btnHalf: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', marginHorizontal: 4 },
  row: { flexDirection: 'row', marginTop: 8 },
  link: { color: '#FFC700', textAlign: 'center', marginTop: 14, fontSize: 15 },
  topBar: {
    position: 'absolute', top: 46, left: 12, right: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)', padding: 12, borderRadius: 14,
  },
  netBanner: {
    position: 'absolute', left: 0, right: 0, zIndex: 999,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  netBannerTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  topName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  statusDot: { fontSize: 13, marginTop: 2 },
  logoutTxt: { color: '#FFC700', fontSize: 14 },
  bottom: {
    position: 'absolute', bottom: 78, left: 0, right: 0,
    backgroundColor: '#111', padding: 18, paddingBottom: 20,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
  },
  orderTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  orderSub: { color: '#aaa', fontSize: 14, marginTop: 2 },
  orderPrice: { color: '#FFC700', fontSize: 22, fontWeight: 'bold', marginTop: 8, marginBottom: 6 },
  custRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c1c1c',
    borderRadius: 12, padding: 12, marginTop: 6, marginBottom: 2,
  },
  custName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  custPhone: { color: '#aaa', fontSize: 14, marginTop: 2 },
  callBtn: { backgroundColor: '#4CAF50', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  callTxt: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  waitBox: {
    backgroundColor: '#1c1c1c', borderRadius: 12, padding: 12, marginTop: 8,
    alignItems: 'center',
  },
  waitLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  waitFree: { color: '#4CAF50', fontSize: 14, marginTop: 3 },
  waitPaid: { color: '#FF9800', fontSize: 14, fontWeight: '600', marginTop: 3 },
  tabBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 8,
    flexDirection: 'row', backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  tabItem: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 3 },
  tabTxt: { color: GRAY2, fontSize: 11, fontWeight: '500' },
  tabActive: { color: YELLOW, fontWeight: '600' },

  // Tarix / Profil ekranlari
  screenWrap: { flex: 1, backgroundColor: BG },
  screenSub: { color: GRAY1, fontSize: 13, fontWeight: '500' },
  screenTitle: { color: WHITE, fontSize: 28, fontWeight: '700', marginTop: 2 },
  histDay: { color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10 },
  histCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 12 },
  histLine: { width: 2, height: 18, backgroundColor: BORDER, marginVertical: 3 },
  histAddr: { color: GRAY1, fontSize: 14 },
  histFoot: { flexDirection: 'row', gap: 14, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  histMeta: { color: GRAY1, fontSize: 13 },
  profAvatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: CARD2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: YELLOW,
  },
  profCarCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: CARD,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16,
  },
  plateBox: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 11, alignItems: 'center' },
  profStat: { flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, alignItems: 'center' },
  profStatVal: { color: WHITE, fontSize: 22, fontWeight: '800' },
  profStatLbl: { color: GRAY1, fontSize: 12, marginTop: 3 },
  profMenu: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 14, paddingHorizontal: 16 },
  profRowItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: RED, borderRadius: 14, paddingVertical: 14, marginTop: 6,
  },
  // OnlineHome
  topAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: CARD2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: YELLOW },
  onlinePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 100, backgroundColor: CARD, borderWidth: 1 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlinePillTxt: { fontSize: 13, fontWeight: '600' },
  todayStats: { flexDirection: 'row', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingVertical: 14 },
  statVal: { color: YELLOW, fontSize: 18, fontWeight: '800' },
  statLbl: { color: GRAY1, fontSize: 11, marginTop: 3 },
  statDiv: { width: 1, backgroundColor: BORDER },
  radarRing1: { position: 'absolute', inset: 0, borderRadius: 20, borderWidth: 1.5, borderColor: YELLOW, opacity: 0.6 },
  radarRing2: { position: 'absolute', inset: 4, borderRadius: 16, borderWidth: 1, borderColor: YELLOW, opacity: 0.35 },
  radarDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: YELLOW },
  offlineBtn: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  // Jonli taximetr
  meterBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: CARD2, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 4 },
  // Safar yakuni
  completeWrap: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  completeCheck: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(48,209,88,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  completeCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 18 },
  completeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  completeLbl: { color: GRAY1, fontSize: 14 },
  // Chat
  chatModalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  chatModalSheet: { backgroundColor: CARD, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '75%', minHeight: 320 },
  chatModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  chatModalTitle: { color: WHITE, fontSize: 17, fontWeight: '700' },
  chatBubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, marginBottom: 8 },
  chatMine: { backgroundColor: YELLOW, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  chatTheirs: { backgroundColor: CARD2, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: BORDER },
  chatInput: { flex: 1, backgroundColor: CARD2, color: WHITE, fontSize: 15, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: BORDER },
  chatSendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: YELLOW, alignItems: 'center', justifyContent: 'center' },
  earnWrap: { flex: 1, backgroundColor: BG },
  earnTitle: { color: WHITE, fontSize: 26, fontWeight: 'bold', marginBottom: 18 },
  card: { backgroundColor: '#1c1c1c', borderRadius: 16, padding: 18, marginBottom: 12 },
  cardLabel: { color: '#aaa', fontSize: 14 },
  cardValue: { color: '#FFC700', fontSize: 28, fontWeight: 'bold', marginTop: 4 },
  cardSub: { color: '#888', fontSize: 13, marginTop: 2 },
  refreshBtn: { backgroundColor: '#FFC700', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 8, marginBottom: 70 },
  // Premium Earnings
  balanceCard: {
    backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    padding: 20, marginBottom: 16,
  },
  withdrawBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: YELLOW, borderRadius: 12, paddingVertical: 12, marginTop: 16,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCell: {
    width: '47%', backgroundColor: CARD, borderRadius: 16, borderWidth: 1,
    borderColor: BORDER, padding: 16,
  },
  statCellVal: { color: WHITE, fontSize: 24, fontWeight: '800' },
  statCellLbl: { color: GRAY1, fontSize: 12, marginTop: 4 },
  chartCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 16 },
  earnDayCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    padding: 18, marginBottom: 16,
  },
});
