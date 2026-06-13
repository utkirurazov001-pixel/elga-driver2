// ============================================================
//  ELGA Haydovchi — ilova (React Native / Expo)
//  Xarita: OpenStreetMap (Leaflet WebView)
//  Server: https://api.elga.uz
// ============================================================
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Linking, Platform,
  Modal, KeyboardAvoidingView, FlatList, Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
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
const YELLOW = '#FFCC00';
const GREEN = '#30D158';
const RED = '#FF453A';
const WHITE = '#FFFFFF';
const GRAY1 = '#8E8E93';
const GRAY2 = '#48484A';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

async function api(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Xato: ' + res.status);
    err.data = data; err.status = res.status;
    throw err;
  }
  return data;
}

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

// Telefonni yagona formatda: +998 91 981 11 71
function fmtPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('998')) d = d.slice(3);
  if (d.length !== 9) return raw;
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

// ---- Xarita HTML (Leaflet + OSM) ----
function mapHTML(myLat, myLng, pickLat, pickLng, dropLat, dropLng) {
  const parts = [];
  if (myLat) parts.push(`L.marker([${myLat}, ${myLng}]).addTo(map).bindPopup('Siz');`);
  if (pickLat) parts.push(`L.marker([${pickLat}, ${pickLng}], {icon: greenIcon}).addTo(map).bindPopup('Mijoz');`);
  if (dropLat) parts.push(`L.marker([${dropLat}, ${dropLng}], {icon: redIcon}).addTo(map).bindPopup('Manzil');`);
  const center = myLat ? `[${myLat}, ${myLng}]` : (pickLat ? `[${pickLat}, ${pickLng}]` : '[41.31, 69.24]');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><script>
function ic(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var greenIcon=ic('green'),redIcon=ic('red');
var map=L.map('map').setView(${center},14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
${parts.join('\n')}
</script></body></html>`;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

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

  // Chat
  const [chatModal, setChatModal] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Jonli hisoblagich (taximetr) va safar yakuni
  const [meter, setMeter] = useState(null); // { km, minutes, fare }
  const [completedTrip, setCompletedTrip] = useState(null); // yakunlangan safar (baholash uchun)

  const socketRef = useRef(null);
  const watchRef = useRef(null);

  useEffect(() => {
    (async () => {
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
    };
  }, [token, pinStep]);

  function connectSocket() {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    socketRef.current = s;
    s.on('new_order', (o) => {
      setOrder(o);
      setChatMessages([]);
      notify('🚖 Yangi buyurtma!', `${o.from_address || 'Manzil'} → ${fmt(o.price)} so'm`);
    });
    s.on('order_cancelled', () => {
      notify('Buyurtma bekor qilindi', '');
      setOrder(null);
      setChatMessages([]);
    });
    s.on('order_update', (o) => setOrder((p) => p ? { ...p, ...o } : o));
    s.on('chat_message', (msg) => {
      setChatMessages((prev) => [...prev, msg]);
      if (!chatModal) notify('💬 Mijoz', msg.text || '');
    });
    s.on('meter', (m) => setMeter(m));
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

  // ---- GPS kuzatuv (onlayn bo'lganda socket orqali yuboriladi) ----
  async function startTracking() {
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 5000 },
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLoc(loc);
        socketRef.current?.emit('location', loc);
      }
    );
  }
  function stopTracking() {
    watchRef.current?.remove?.();
    watchRef.current = null;
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
      await api('/api/drivers/status', 'POST', { online: next }, token);
      setOnline(next);
      if (next) {
        // MUHIM: onlayn bo'lishi bilan joriy GPS'ni DARHOL serverga yuboramiz,
        // aks holda shu zahoti berilgan buyurtma bizni "joylashuvsiz" deb topmaydi.
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMyLoc(loc);
          socketRef.current?.emit('location', loc);
          await api('/api/drivers/location', 'POST', loc, token).catch(() => {});
        } catch (e) {}
        startTracking();
      } else {
        stopTracking();
      }
    } catch (e) {
      Alert.alert('Onlayn chiqib bo\'lmadi', e.message);
    }
    setLoading(false);
  }

  // ---- BUYURTMA AMALLARI ----
  async function orderAction(action) {
    if (!order) return;
    setLoading(true);
    try {
      const r = await api(`/api/orders/${order.id}/${action}`, 'POST', {}, token);
      if (action === 'complete') {
        // Safar yakunlandi — baholash/hisob ekranini ko'rsatamiz, keyin tozalanadi
        setCompletedTrip(r.order || order);
        setOrder(null);
        setMeter(null);
        setChatMessages([]);
        loadEarnings();
      } else if (action === 'reject') {
        setOrder(null);
        setMeter(null);
        setChatMessages([]);
        loadEarnings();
      } else {
        setOrder((p) => ({ ...p, ...(r.order || {}), status: r.order?.status || statusAfter(action) }));
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
    return <View style={s.center}><ActivityIndicator size="large" color="#FFD400" /></View>;

  // --- PIN ekrani ---
  if (pinStep === 'enter' || pinStep === 'setup') {
    const isSetup = pinStep === 'setup';
    return (
      <ScrollView contentContainerStyle={s.loginWrap}>
        <StatusBar style="light" />
        <Text style={s.logo}>ELGA</Text>
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
        <TouchableOpacity style={s.btn} onPress={isSetup ? savePin : checkPin}>
          <Text style={s.btnTxt}>{isSetup ? 'PIN SAQLASH' : 'KIRISH'}</Text>
        </TouchableOpacity>
        {isSetup ? (
          <TouchableOpacity onPress={() => setPinStep(null)}>
            <Text style={s.link}>O'tkazib yuborish</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={forgotPin}>
            <Text style={s.link}>SMS orqali kirish</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // --- LOGIN ---
  if (!token) {
    return (
      <ScrollView contentContainerStyle={s.loginWrap}>
        <StatusBar style="light" />
        <Text style={s.logo}>ELGA</Text>
        <Text style={s.sub}>Haydovchi ilovasi</Text>
        {step === 'phone' && <>
          <TextInput style={s.input} placeholder="+998..." placeholderTextColor="#888"
            keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TouchableOpacity style={s.btn} onPress={sendCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>KOD OLISH</Text>}
          </TouchableOpacity>
        </>}
        {step === 'code' && <>
          <TextInput style={s.input} placeholder="SMS kod" placeholderTextColor="#888"
            keyboardType="number-pad" value={code} onChangeText={setCode} />
          <TouchableOpacity style={s.btn} onPress={verifyCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>TASDIQLASH</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep('phone')}>
            <Text style={s.link}>← Raqamni o'zgartirish</Text>
          </TouchableOpacity>
        </>}
        {step === 'register' && <>
          <Text style={s.hint}>Haydovchi ro'yxati:</Text>
          <TextInput style={s.input} placeholder="Ismingiz" placeholderTextColor="#888" value={name} onChangeText={setName} />
          <TextInput style={s.input} placeholder="Mashina (masalan: Cobalt)" placeholderTextColor="#888" value={carModel} onChangeText={setCarModel} />
          <TextInput style={s.input} placeholder="Davlat raqami (01A123BC)" placeholderTextColor="#888" value={carNumber} onChangeText={setCarNumber} autoCapitalize="characters" />
          <TouchableOpacity style={s.btn} onPress={register} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={s.btnTxt}>RO'YXATDAN O'TISH</Text>}
          </TouchableOpacity>
        </>}
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
            style={s.map}
            originWhitelist={['*']}
            source={{ html: mapHTML(
              myLoc?.lat, myLoc?.lng,
              order?.from_lat, order?.from_lng,
              order?.to_lat, order?.to_lng
            )}}
            javaScriptEnabled domStorageEnabled
          />

          {/* ── Yuqori: avatar + ism + online pill ── */}
          <View style={[s.topBar, { top: insets.top + 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={s.topAvatar}>
                <Text style={{ color: YELLOW, fontSize: 18, fontWeight: '700' }}>
                  {(user?.name?.[0] || 'H').toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={s.topName}>{user?.name || 'Haydovchi'}</Text>
                {earnings?.stats?.rating && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="star" size={11} color={YELLOW} />
                    <Text style={{ color: GRAY1, fontSize: 12 }}>{earnings.stats.rating}</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={[s.onlinePill, { borderColor: online ? GREEN + '66' : BORDER }]}>
              <View style={[s.onlineDot, { backgroundColor: online ? GREEN : GRAY2 }]} />
              <Text style={[s.onlinePillTxt, { color: online ? GREEN : GRAY1 }]}>
                {online ? 'Onlayn' : 'Oflayn'}
              </Text>
            </View>
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
              />
            </ScrollView>
          )}
        </View>
      ) : tab === 'earnings' ? (
        <EarningsScreen earnings={earnings} onRefresh={loadEarnings} insets={insets} />
      ) : tab === 'history' ? (
        <DriverHistory trips={trips} insets={insets} />
      ) : (
        <DriverProfile user={user} earnings={earnings} onLogout={logout} insets={insets} />
      )}

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
function OrderPanel({ order, loading, meter, onAction, onNavigate, onCall, onChat }) {
  const st = order.status;
  const isNew = st === 'searching' || st === 'assigned';
  const showCustomer = ['accepted', 'arrived', 'in_progress'].includes(st) && order.customer_phone;
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
              <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 14 }} numberOfLines={1}>{order.from_address || 'Olib ketish nuqtasi'}</Text>
              <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                {order.to_address || 'Manzil'}
                {order.distance_km ? <Text style={{ color: GRAY1, fontWeight: '400' }}> · {order.distance_km} km</Text> : null}
              </Text>
            </View>
          </View>
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
          <Text style={s.orderTitle}>📍 {order.from_address || 'Olib ketish nuqtasi'}</Text>
          <Text style={s.orderSub}>→ {order.to_address || 'Manzil'}</Text>
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
              {(meter || order.metered) && (
                <View style={s.meterBox}>
                  <View>
                    <Text style={{ color: GREEN, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 }}>SAFAR DAVOM ETMOQDA</Text>
                    <Text style={{ color: GRAY1, fontSize: 13, marginTop: 4 }}>
                      {meter ? `${meter.km} km · ${meter.minutes} daq` : (order.distance_km ? `${order.distance_km} km` : '')}
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

// ---- Daromad ekrani ----
function EarningsScreen({ earnings, onRefresh, insets }) {
  const top = (insets?.top || 0) + 20;
  const bottom = TABBAR_H + (insets?.bottom || 0) + 20;
  return (
    <ScrollView style={s.earnWrap} contentContainerStyle={{ padding: 20, paddingTop: top, paddingBottom: bottom }}>
      <Text style={s.earnTitle}>💰 Daromad</Text>
      {!earnings ? <ActivityIndicator color="#FFD400" style={{ marginTop: 30 }} /> : <>
        <View style={s.card}>
          <Text style={s.cardLabel}>Bugun</Text>
          <Text style={s.cardValue}>{fmt(earnings.today?.earned)} so'm</Text>
          <Text style={s.cardSub}>{earnings.today?.trips || 0} ta safar</Text>
        </View>
        <View style={s.card}>
          <Text style={s.cardLabel}>Bu hafta</Text>
          <Text style={s.cardValue}>{fmt(earnings.week?.earned)} so'm</Text>
          <Text style={s.cardSub}>{earnings.week?.trips || 0} ta safar</Text>
        </View>
        <View style={s.card}>
          <Text style={s.cardLabel}>Jami</Text>
          <Text style={s.cardValue}>{fmt(earnings.total?.earned)} so'm</Text>
          <Text style={s.cardSub}>{earnings.total?.trips || 0} ta safar</Text>
        </View>
        {earnings.stats && (
          <View style={s.card}>
            <Text style={s.cardLabel}>Reyting</Text>
            <Text style={s.cardValue}>⭐ {earnings.stats.rating || '—'}</Text>
            <Text style={s.cardSub}>Qabul: {earnings.stats.accept_rate ?? '—'}%</Text>
          </View>
        )}
        <TouchableOpacity style={s.refreshBtn} onPress={onRefresh}>
          <Text style={s.btnTxt}>YANGILASH</Text>
        </TouchableOpacity>
      </>}
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
function DriverHistory({ trips, insets }) {
  const top = (insets?.top || 0) + 16;
  const bottom = TABBAR_H + (insets?.bottom || 0) + 20;
  const groups = {};
  (trips || []).forEach((t) => {
    const d = new Date(t.created_at || t.completed_at || Date.now());
    const today = new Date().toDateString();
    const yest = new Date(Date.now() - 86400000).toDateString();
    const key = d.toDateString() === today ? 'Bugun' : d.toDateString() === yest ? 'Kecha' : d.toLocaleDateString('ru-RU');
    (groups[key] = groups[key] || []).push(t);
  });
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
}

// ---- Profil ekrani ----
function DriverProfile({ user, earnings, onLogout, insets }) {
  const top = (insets?.top || 0) + 16;
  const bottom = TABBAR_H + (insets?.bottom || 0) + 20;
  const st = earnings?.stats || {};
  const car = user?.car_model || user?.car || '';
  const plate = user?.car_number || user?.plate || '';
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
        <ProfRow icon="car-outline" title="Avtomobil ma'lumotlari" />
        <ProfRow icon="document-text-outline" title="Hujjatlar" detail="Tasdiqlangan" />
        <ProfRow icon="card-outline" title="To'lov va karta" last />
      </View>
      <View style={s.profMenu}>
        <ProfRow icon="headset-outline" title="Yordam markazi" />
        <ProfRow icon="settings-outline" title="Sozlamalar" last />
      </View>

      <TouchableOpacity style={s.logoutBtn} onPress={onLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color={RED} style={{ marginRight: 8 }} />
        <Text style={{ color: RED, fontSize: 15, fontWeight: '600' }}>Chiqish</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ProfRow({ icon, title, detail, last }) {
  return (
    <View style={[s.profRowItem, !last && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
      <Ionicons name={icon} size={20} color={GRAY1} />
      <Text style={{ flex: 1, color: WHITE, fontSize: 15, marginLeft: 14 }}>{title}</Text>
      {detail && <Text style={{ color: GREEN, fontSize: 13, marginRight: 8 }}>{detail}</Text>}
      <Ionicons name="chevron-forward" size={18} color={GRAY2} />
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  map: { flex: 1 },
  loginWrap: { flexGrow: 1, backgroundColor: '#111', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 60 },
  logo: { color: '#FFD400', fontSize: 56, fontWeight: 'bold', textAlign: 'center' },
  sub: { color: '#aaa', fontSize: 16, textAlign: 'center', marginBottom: 36 },
  hint: { color: '#ccc', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  input: { backgroundColor: '#222', color: '#fff', fontSize: 18, padding: 16, borderRadius: 12, marginBottom: 14 },
  btn: { backgroundColor: '#FFD400', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  btnTxt: { color: '#000', fontSize: 17, fontWeight: 'bold' },
  btnTxtW: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  btnNav: { backgroundColor: '#1976D2', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  btnHalf: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', marginHorizontal: 4 },
  row: { flexDirection: 'row', marginTop: 8 },
  link: { color: '#FFD400', textAlign: 'center', marginTop: 14, fontSize: 15 },
  topBar: {
    position: 'absolute', top: 46, left: 12, right: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)', padding: 12, borderRadius: 14,
  },
  topName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  statusDot: { fontSize: 13, marginTop: 2 },
  logoutTxt: { color: '#FFD400', fontSize: 14 },
  bottom: {
    position: 'absolute', bottom: 78, left: 0, right: 0,
    backgroundColor: '#111', padding: 18, paddingBottom: 20,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
  },
  orderTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  orderSub: { color: '#aaa', fontSize: 14, marginTop: 2 },
  orderPrice: { color: '#FFD400', fontSize: 22, fontWeight: 'bold', marginTop: 8, marginBottom: 6 },
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
  cardValue: { color: '#FFD400', fontSize: 28, fontWeight: 'bold', marginTop: 4 },
  cardSub: { color: '#888', fontSize: 13, marginTop: 2 },
  refreshBtn: { backgroundColor: '#FFD400', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 8, marginBottom: 70 },
});