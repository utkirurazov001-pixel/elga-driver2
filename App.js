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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
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

const BASE = 'https://api.elga.uz';

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

async function api(path, method = 'GET', body = null, token = null, timeoutMs = 15000) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
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
    const err = new Error(e.name === 'AbortError' ? "Internet sekin — qayta urinib ko'ring" : "Ulanish yo'q — internetni tekshiring");
    err.network = true;
    throw err;
  }
  clearTimeout(timer);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Xato: ' + res.status);
    err.data = data; err.status = res.status;
    throw err;
  }
  return data;
}

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

// Matnni xavfsiz string'ga keltirish — obyekt/null kelib qolsa ham React
// "Objects are not valid as a React child" deb qulamaydi (ayniqsa ovozli
// buyurtmada manzil maydonlari to'liq bo'lmasligi mumkin).
const safeStr = (v, fallback = '') => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
};

// Ovozli e'lonlar telefon "jim" rejimida ham eshitilsin
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});

// expo-speech ovozini tabiiyroq qilish: qurilmada mavjud o'zbek ovozini
// tanlaymiz (ko'p qurilmada uz-UZ aniq ko'rsatilmasa robot/aksent bo'lardi).
// undefined = hali tekshirilmagan, null = topilmadi.
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
function speak(text) {
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
function announce(text, audioUrl) {
  if (!playAnnouncementAudio(audioUrl)) speak(text);
}

// Haversine masofasi (km)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Telefonni yagona formatda: +998 91 981 11 71
function fmtPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('998')) d = d.slice(3);
  if (d.length !== 9) return raw;
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

// ---- Xarita HTML (Leaflet + OSM) ----
// Xarita BIR MARTA yuklanadi (barqaror HTML). Keyin markerlar/joylashuv
// injectJavaScript -> window.updateMap(...) orqali yangilanadi — WebView qayta
// yuklanmaydi (avval har GPS yangilanishida butun xarita qayta yuklanib, ilova
// qotib qolardi).
function mapHTML() {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><script>
function ic(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var greenIcon=ic('green'),redIcon=ic('red');
var map=L.map('map').setView([41.31,69.24],14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var myMarker=null,pickMarker=null,dropMarker=null,centeredOnce=false;
window.updateMap=function(d){
  try{
    if(d.myLat!=null){ if(myMarker){myMarker.setLatLng([d.myLat,d.myLng]);} else {myMarker=L.marker([d.myLat,d.myLng]).addTo(map).bindPopup('Siz');} }
    if(d.pickLat!=null){ if(pickMarker){pickMarker.setLatLng([d.pickLat,d.pickLng]);} else {pickMarker=L.marker([d.pickLat,d.pickLng],{icon:greenIcon}).addTo(map).bindPopup('Mijoz');} } else if(pickMarker){map.removeLayer(pickMarker);pickMarker=null;}
    if(d.dropLat!=null){ if(dropMarker){dropMarker.setLatLng([d.dropLat,d.dropLng]);} else {dropMarker=L.marker([d.dropLat,d.dropLng],{icon:redIcon}).addTo(map).bindPopup('Manzil');} } else if(dropMarker){map.removeLayer(dropMarker);dropMarker=null;}
    var c=d.myLat!=null?[d.myLat,d.myLng]:(d.pickLat!=null?[d.pickLat,d.pickLng]:null);
    if(c&&!centeredOnce){ map.setView(c,14); centeredOnce=true; }
  }catch(e){}
};
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}));
</script></body></html>`;
}

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
    // Faqat log — ilova qulamaydi
    console.warn('[ErrorBoundary]', error?.message, info?.componentStack);
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

  const socketRef = useRef(null);
  const watchRef = useRef(null);
  const mapRef = useRef(null);
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
      socketRef.current?.disconnect();
      watchRef.current?.remove?.();
      try { if (typeof KeepAwake?.deactivateKeepAwakeAsync === 'function') KeepAwake.deactivateKeepAwakeAsync('driver').catch(() => {}); } catch (e) {}
      hidePersistentNotif();
    };
  }, [token, pinStep]);

  // Xarita tayyor bo'lgach va joylashuv/buyurtma o'zgarganda — markerlarni
  // qayta yuklamasdan yangilaymiz (lag bo'lmaydi).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const d = {
      myLat: myLoc?.lat ?? null, myLng: myLoc?.lng ?? null,
      pickLat: order?.from_lat ?? null, pickLng: order?.from_lng ?? null,
      dropLat: order?.to_lat ?? null, dropLng: order?.to_lng ?? null,
    };
    mapRef.current.injectJavaScript(`window.updateMap(${JSON.stringify(d)});true;`);
  }, [mapReady, myLoc, order?.from_lat, order?.from_lng, order?.to_lat, order?.to_lng]);

  function connectSocket() {
    if (socketRef.current?.connected) return; // allaqachon ulangan
    socketRef.current?.disconnect();
    const s = io(BASE, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
    socketRef.current = s;

    s.on('connect', () => { console.log('✓ Socket ulandi'); resumeActiveOrder(); });
    s.on('connect_error', (e) => console.warn('Socket xato:', e.message));
    // Internet uzilib qayta ulanganda faol buyurtma holatini tiklaymiz (#40)
    s.on('reconnect', () => { resumeActiveOrder(); });

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
    s.on('meter', (m) => setMeter(m));
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

  async function resumeActiveOrder() {
    try {
      const r = await api('/api/me/active-order', 'GET', null, token);
      if (r && r.order) setOrder(r.order);
    } catch (e) {}
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

  // ---- GPS kuzatuv (onlayn bo'lganda socket orqali yuboriladi) ----
  async function startTracking() {
    try {
      const accuracy = Location.Accuracy?.High ?? 4;
      watchRef.current = await Location.watchPositionAsync(
        { accuracy, distanceInterval: 20, timeInterval: 5000 },
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMyLoc(loc);
          socketRef.current?.emit('location', loc);
          // Mustaqil taksometr — km hisoblab boradi
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
    await AsyncStorage.multiRemove(['token', 'user', 'pin']);
    stopTracking();
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
        keepAwakeOn();
        showPersistentNotif('Buyurtma kutilmoqda...');
      } else {
        await api('/api/drivers/status', 'POST', { online: false }, token);
        setOnline(false);
        stopTracking();
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
    setLoading(true);
    try {
      const r = await api(`/api/orders/${order.id}/${action}`, 'POST', {}, token);
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
    } catch (e) { Alert.alert('Xato', e.message); }
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

      {tab === 'home' ? (
        <View style={s.flex}>
          {/* Xarita */}
          <WebView
            ref={mapRef}
            style={s.map}
            originWhitelist={['*']}
            source={mapSource}
            onMessage={(e) => {
              try {
                const m = JSON.parse(e.nativeEvent.data);
                if (m.type === 'mapReady') {
                  setMapReady(true);
                  // Xarita yangi yuklandi — joriy ma'lumotni darhol yuboramiz
                  const d = {
                    myLat: myLoc?.lat ?? null, myLng: myLoc?.lng ?? null,
                    pickLat: order?.from_lat ?? null, pickLng: order?.from_lng ?? null,
                    dropLat: order?.to_lat ?? null, dropLng: order?.to_lng ?? null,
                  };
                  mapRef.current?.injectJavaScript(`window.updateMap(${JSON.stringify(d)});true;`);
                }
              } catch (err) {}
            }}
            javaScriptEnabled domStorageEnabled
          />

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
