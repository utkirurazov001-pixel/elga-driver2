// ============================================================
//  ELGA Mijoz — taksi chaqirish ilovasi (React Native / Expo)
//  Xarita: OpenStreetMap (Leaflet WebView)
//  Server: https://api.elga.uz
// ============================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal, Linking, FlatList,
  Animated,
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

// Telefonni butun ilova bo'ylab yagona formatda ko'rsatish: +998 91 981 11 71
function fmtPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('998')) d = d.slice(3);
  if (d.length !== 9) return raw; // kutilmagan format — o'zini qaytaramiz
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

// To'lov usuli ikonkalari
const PAY_ICONS = { cash: '💵', click: '🔵', payme: '🟢', card: '💳' };

// Tab panelining tizim navigatsiyasidan tashqari balandligi (safe-area pastdan qo'shiladi)
const TABBAR_H = 56;

// Mijoz balansi 0 yoki manfiy bo'lsa "Balans" blokini umuman yashirish
const HIDE_BALANCE_IF_NONPOSITIVE = true;

// Mashina klasslari (backend config bilan mos)
const CAR_CLASSES = [
  { id: 'ekonom',   label: 'Tejamkor', icon: '🚗', seats: 4 },
  { id: 'komfort',  label: 'Comfort',  icon: '🚙', seats: 4 },
  { id: 'oila',     label: 'Oila',     icon: '🚐', seats: 6 },
  { id: 'ekspress', label: 'Ekspress', icon: '⚡', seats: 4 },
  { id: 'yuk',      label: 'Yuk',      icon: '🚚', seats: 2 },
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

function mapHTML(lat, lng, destLat, destLng, driverLat, driverLng, nearby, pickupMode) {
  const markers = [];
  // Pickup marker (always shown)
  markers.push(`
    var pickupMarker = L.marker([${lat}, ${lng}], {draggable:${pickupMode ? 'true' : 'false'}, icon: blueIcon}).addTo(map).bindPopup('Olib ketish');
    ${pickupMode ? `pickupMarker.on('dragend', function(e){ var ll = e.target.getLatLng(); window.ReactNativeWebView.postMessage(JSON.stringify({type:'pickupDrag',lat:ll.lat,lng:ll.lng})); });` : ''}
  `);
  if (destLat && destLng)
    markers.push(`L.marker([${destLat}, ${destLng}], {icon: redIcon}).addTo(map).bindPopup('Manzil');`);
  if (driverLat && driverLng)
    markers.push(`L.marker([${driverLat}, ${driverLng}], {icon: yellowIcon}).addTo(map).bindPopup('Haydovchi');`);
  (nearby || []).forEach((c) => {
    if (c.lat && c.lng) markers.push(`L.marker([${c.lat}, ${c.lng}], {icon: carIcon}).addTo(map);`);
  });

  const center = (destLat && destLng)
    ? `map.fitBounds([[${lat},${lng}],[${destLat},${destLng}]], {padding:[40,40]});`
    : `map.setView([${lat},${lng}],15);`;

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><script>
function colorIcon(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var blueIcon=colorIcon('blue'),redIcon=colorIcon('red'),yellowIcon=colorIcon('gold');
// Mashina ikonkasi (sariq taksi emoji)
var carIcon=L.divIcon({className:'',html:'<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">🚕</div>',iconSize:[26,26],iconAnchor:[13,13]});
// Zoom tugmalarini o'ngga ko'chiramiz — yuqori-chap banner berkitmasin
var map=L.map('map',{zoomControl:false});
L.control.zoom({position:'topright'}).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
${center}
${markers.join('\n')}
map.on('click',function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}));});
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

  // Modallar
  const [cancelModal, setCancelModal] = useState(false);
  const [customReason, setCustomReason] = useState('');
  const [rateModal, setRateModal] = useState(false);
  const [rateOrderId, setRateOrderId] = useState(null);
  const [stars, setStars] = useState(5);
  const [tipAmount, setTipAmount] = useState(0);

  // In-trip chat
  const [tripChatModal, setTripChatModal] = useState(false);
  const [tripChat, setTripChat] = useState([]);
  const [tripChatInput, setTripChatInput] = useState('');

  // SOS modal
  const [sosModal, setSosModal] = useState(false);

  // Arrived bildirishnomasi bir marta chiqsin
  const arrivedNotified = useRef(false);

  // Qidiruv
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Tarix / profil / chat
  const [trips, setTrips] = useState([]);
  const [balance, setBalance] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // New state: favorites, popular places, pin animation
  const [favorites, setFavorites] = useState([]);
  const [popularPlaces, setPopularPlaces] = useState([]);
  const [placeEst, setPlaceEst] = useState({}); // qidiruv qatorlari uchun narx: "lat,lng" -> { price, duration_min }
  const pinAnim = useRef(new Animated.Value(0)).current;

  const socketRef = useRef(null);
  const webviewRef = useRef(null);
  const tokenRef = useRef(null);
  const nearbyTimer = useRef(null);

  useEffect(() => { tokenRef.current = token; }, [token]);

  // ---- Boot ----
  useEffect(() => {
    (async () => {
      try {
        const t = await AsyncStorage.getItem('token');
        const u = await AsyncStorage.getItem('user');
        const p = await AsyncStorage.getItem('pin');
        const hp = await AsyncStorage.getItem('home_place');
        const wp = await AsyncStorage.getItem('work_place');
        if (t && u) {
          setToken(t); setUser(JSON.parse(u));
          if (p) { setStoredPin(p); setPinStep('enter'); }
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
      loadRecentPlaces();
      loadFavorites();
      loadPopularPlaces();
      startPinHalo();
    })();
    return () => {
      socketRef.current?.disconnect();
      if (nearbyTimer.current) clearInterval(nearbyTimer.current);
    };
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
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    socketRef.current = s;
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
        setRateOrderId(o.id); setStars(5); setTipAmount(0); setRateModal(true);
        resetOrder();
      }
      if (o.status === 'cancelled') { notify('Buyurtma bekor qilindi', ''); resetOrder(); }
    });
    s.on('driver_location', (loc) => {
      setDriverLoc(loc);
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

  async function resumeActiveOrder() {
    try {
      const r = await api('/api/me/active-order', 'GET', null, tokenRef.current || token);
      if (r?.order) { setOrder(r.order); setOrderStep(null); }
    } catch (e) {}
  }

  async function notify(title, body) {
    try { await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }); } catch (e) {}
  }

  function resetOrder() {
    setOrder(null); setDest(null); setEstimates({}); estCacheKey.current = null;
    setDriverLoc(null); setOrderStep('dest'); setSearchQ(''); setSearchResults([]); setSearchOpen(false);
  }

  // ---- Xarita hodisalari ----
  async function onWebViewMessage(e) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'mapClick') {
        if (orderStep === 'confirm') {
          const addr = await reverseGeocode(msg.lat, msg.lng);
          setPickup({ lat: msg.lat, lng: msg.lng, address: addr });
        }
      }
      if (msg.type === 'pickupDrag') {
        const addr = await reverseGeocode(msg.lat, msg.lng);
        setPickup({ lat: msg.lat, lng: msg.lng, address: addr });
      }
    } catch (_) {}
  }

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
    setLoading(true);
    try {
      const r = await api('/api/orders', 'POST', {
        from, to: dest, car_class: carClass, payment_method: payMethod,
      }, token);
      const o = r.order || r;
      setOrder(o);
      setOrderStep(null);
      notify('Buyurtma berildi 🚖', 'Haydovchi qidirilmoqda...');
      if (payMethod !== 'cash') openPayment(o.id, payMethod);
    } catch (e) { Alert.alert('Xato', e.message); }
    setLoading(false);
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
    setRateModal(false); setLoading(false);
  }

  function callDriver() {
    if (order?.driver_phone) Linking.openURL(`tel:${order.driver_phone}`);
  }

  async function doLogout() {
    await AsyncStorage.multiRemove(['token', 'user', 'pin']);
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
      const r = await api('/api/ai/chat', 'POST', { messages: next, order_id: order?.id }, token);
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
          <Text style={{ color: YELLOW, fontSize: 72, fontWeight: '800', letterSpacing: 4 }}>ELGA</Text>
          <Text style={{ color: GRAY1, fontSize: 14, fontWeight: '500', letterSpacing: 2, marginTop: 8 }}>Premium Mobility</Text>
          <ActivityIndicator color={YELLOW} style={{ marginTop: 32 }} />
        </View>
      </View>
    );

  // PIN SCREEN
  if (pinStep === 'enter' || pinStep === 'setup') {
    const isSetup = pinStep === 'setup';
    return (
      <View style={s.loginWrap}>
        <StatusBar style="light" />
        <Text style={{ color: YELLOW, fontSize: 56, fontWeight: '800', textAlign: 'center', letterSpacing: 3 }}>ELGA</Text>
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
        <TouchableOpacity
          style={s.ctaBtn}
          activeOpacity={0.8}
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
        </TouchableOpacity>
        {isSetup
          ? <TouchableOpacity onPress={() => setPinStep(null)} activeOpacity={0.7}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>O'tkazib yuborish</Text>
            </TouchableOpacity>
          : <TouchableOpacity activeOpacity={0.7} onPress={async () => {
              await AsyncStorage.multiRemove(['token', 'user', 'pin']);
              setToken(null); setUser(null); setStoredPin(null);
              setPinStep(null); setPinInput(''); setStep('phone');
            }}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>SMS orqali kirish</Text>
            </TouchableOpacity>
        }
      </View>
    );
  }

  // LOGIN SCREEN
  if (!token) {
    return (
      <View style={s.loginWrap}>
        <StatusBar style="light" />
        <Text style={{ color: YELLOW, fontSize: 56, fontWeight: '800', textAlign: 'center', letterSpacing: 3 }}>ELGA</Text>
        <Text style={{ color: GRAY1, fontSize: 15, textAlign: 'center', marginTop: 6 }}>Mijoz ilovasi</Text>

        {step === 'phone' && (
          <>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder="+998..."
              placeholderTextColor={GRAY2}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TouchableOpacity style={s.ctaBtn} activeOpacity={0.8} onPress={async () => {
              if (phone.replace(/\D/g, '').length < 9) { Alert.alert('Xato', "To'g'ri telefon raqam kiriting"); return; }
              setLoading(true);
              try { await api('/api/auth/send-code', 'POST', { phone }); setStep('code'); Alert.alert('Yuborildi', 'SMS kod yuborildi'); }
              catch (e) { Alert.alert('Xato', e.message); }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>SMS KOD OLISH</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 'code' && (
          <>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder="SMS kod"
              placeholderTextColor={GRAY2}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
            />
            <TouchableOpacity style={s.ctaBtn} activeOpacity={0.8} onPress={async () => {
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
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('phone')} activeOpacity={0.7}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 12 }}>← Raqamni o'zgartirish</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'name' && (
          <>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder="Ismingiz"
              placeholderTextColor={GRAY2}
              value={name}
              onChangeText={setName}
            />
            <TouchableOpacity style={s.ctaBtn} activeOpacity={0.8} onPress={async () => {
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
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // ====================== ASOSIY INTERFEYS ======================

  // Map HTML helpers
  const mapSrcDest = (pickup || myLoc) ? mapHTML(
    (pickup || myLoc).lat, (pickup || myLoc).lng,
    dest?.lat, dest?.lng,
    driverLoc?.lat, driverLoc?.lng,
    nearby, false
  ) : null;

  const mapSrcConfirm = (pickup || myLoc) ? mapHTML(
    (pickup || myLoc).lat, (pickup || myLoc).lng,
    dest?.lat, dest?.lng,
    null, null, [], true
  ) : null;

  const mapSrcActive = order ? mapHTML(
    (pickup || myLoc || { lat: 0, lng: 0 }).lat,
    (pickup || myLoc || { lat: 0, lng: 0 }).lng,
    dest?.lat, dest?.lng,
    driverLoc?.lat, driverLoc?.lng,
    [], false
  ) : null;

  return (
    <View style={s.fill}>
      <StatusBar style="light" />

      {/* ===== BUYURTMA TAB ===== */}
      {tab === 'order' && (

        /* ── ACTIVE ORDER ── */
        order ? (
          <View style={s.fill}>
            {mapSrcActive ? (
              <WebView
                ref={webviewRef}
                style={s.mapFull}
                originWhitelist={['*']}
                source={{ html: mapSrcActive }}
                onMessage={onWebViewMessage}
                javaScriptEnabled
                domStorageEnabled
              />
            ) : (
              <View style={[s.fill, s.center]}>
                <ActivityIndicator color={YELLOW} size="large" />
              </View>
            )}

            <AnimatedSheet style={[s.activeSheet, { bottom: TABBAR_H + insets.bottom }]}>
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

              {order.status === 'in_progress' && (
                <Text style={{ color: GREEN, fontSize: 13, textAlign: 'center', marginTop: 12 }}>🛣️ Yaxshi safar!</Text>
              )}
            </ScrollView>
            </AnimatedSheet>
          </View>

        ) : orderStep === 'dest' ? (
          /* ── DEST STEP ── */
          <View style={s.fill}>
            {mapSrcDest ? (
              <WebView
                ref={webviewRef}
                style={s.mapFull}
                originWhitelist={['*']}
                source={{ html: mapSrcDest }}
                onMessage={onWebViewMessage}
                javaScriptEnabled
                domStorageEnabled
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
              <View style={{ marginBottom: 8 }}>
                <Text style={{ color: GRAY1, fontSize: 13, fontWeight: '500' }}>Salom, {user?.name?.split(' ')[0] || 'Foydalanuvchi'}</Text>
                <Text style={{ color: WHITE, fontSize: 26, fontWeight: '700', marginTop: 2 }}>Qayerga boramiz?</Text>
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
                <Ionicons name="search" size={18} color={GRAY1} style={{ marginRight: 10 }} />
                <Text style={{ color: GRAY1, fontSize: 16 }}>Maktab, bozor, ko'cha...</Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <TouchableOpacity style={s.shortBtn} activeOpacity={0.75}
                  onPress={() => homePlace ? pickDest(homePlace) : setSearchOpen(true)}
                  onLongPress={() => pickup && saveHomeWork('home', pickup)}>
                  <View style={s.shortBtnIconWrap}><Ionicons name="home" size={18} color={YELLOW} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: WHITE, fontSize: 13, fontWeight: '600' }}>Uy</Text>
                    {homePlace && <Text style={{ color: GRAY1, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{homePlace.address}</Text>}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={s.shortBtn} activeOpacity={0.75}
                  onPress={() => workPlace ? pickDest(workPlace) : setSearchOpen(true)}
                  onLongPress={() => pickup && saveHomeWork('work', pickup)}>
                  <View style={s.shortBtnIconWrap}><Ionicons name="briefcase" size={18} color={YELLOW} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: WHITE, fontSize: 13, fontWeight: '600' }}>Ish</Text>
                    {workPlace && <Text style={{ color: GRAY1, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{workPlace.address}</Text>}
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

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
            {mapSrcConfirm ? (
              <WebView
                ref={webviewRef}
                style={s.mapFull}
                originWhitelist={['*']}
                source={{ html: mapSrcConfirm }}
                onMessage={onWebViewMessage}
                javaScriptEnabled
                domStorageEnabled
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
            {mapSrcDest ? (
              <WebView
                ref={webviewRef}
                style={s.mapFull}
                originWhitelist={['*']}
                source={{ html: mapSrcDest }}
                onMessage={onWebViewMessage}
                javaScriptEnabled
                domStorageEnabled
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
                    <Skeleton width={32} height={32} radius={8} />
                    <View style={{ flex: 1, marginLeft: 12, gap: 8 }}>
                      <Skeleton width={90} height={14} />
                      <Skeleton width={150} height={11} />
                    </View>
                    <Skeleton width={72} height={18} />
                  </View>
                ))
              ) : CAR_CLASSES.map((c) => {
                const est = estimates[c.id];
                const active = carClass === c.id;
                return (
                  <TouchableOpacity key={c.id} style={[s.tariffCard, active && s.tariffCardActive]} activeOpacity={0.8} onPress={() => setCarClass(c.id)}>
                    <Text style={{ fontSize: 32 }}>{c.icon}</Text>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[{ color: WHITE, fontSize: 16, fontWeight: '700' }, active && { color: YELLOW }]}>{c.label}</Text>
                      {est
                        ? <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>
                            👤{c.seats} · {est.distance_km} km · {est.duration_min || '?'} daq
                            {est.surge > 1 ? ' ⚡' : ''}{est.is_night ? ' 🌙' : ''}
                          </Text>
                        : <Text style={{ color: GRAY2, fontSize: 12 }}>👤{c.seats} o'rin</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {est ? (
                        <>
                          {est.discount_percent > 0 && <Text style={{ color: GRAY2, fontSize: 12, textDecorationLine: 'line-through' }}>{fmt(est.base_price)}</Text>}
                          <Text style={[{ color: WHITE, fontSize: 18, fontWeight: '700' }, active && { color: YELLOW, fontSize: 20 }]}>
                            {fmt(est.price)} so'm
                          </Text>
                        </>
                      ) : <ActivityIndicator color={GRAY2} size="small" />}
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
            data={(() => {
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
            })()}
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
                { icon: 'document-text', label: 'Tez-tez beriladigan savollar', sub: "FAQ — eng ko'p so'raladi" },
                { icon: 'card', label: "To'lov muammolari", sub: 'Karta, balans, cashback' },
                { icon: 'person', label: 'Safar muammolari', sub: 'Buyurtma, kutish, manzil' },
                { icon: 'flag', label: 'Haydovchi shikoyati', sub: 'Xizmat sifati, xulq' },
              ].map((item, idx, arr) => (
                <View key={idx}>
                  <TouchableOpacity style={s.helpTopicRow} activeOpacity={0.7} onPress={() => Alert.alert(item.label, "Tez kunda qo'shiladi")}>
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
                  {user?.rating && <Text style={{ color: GRAY1, fontSize: 14 }}>⭐ {user.rating}</Text>}
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
                { icon: 'card', label: "To'lov usullari", value: '2 ta karta', onPress: () => Alert.alert("To'lov usullari", 'Tez kunda') },
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
            <Text style={s.modalTitle}>Safarni baholang</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setStars(n)}>
                  <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={40} color={YELLOW} />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 10 }}>Choychaqa (ixtiyoriy)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
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

// Design tokens (also available in styles)
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
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 16,
    marginBottom: 10,
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
  shortBtnIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  tariffCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tariffCardActive: { borderColor: YELLOW, backgroundColor: '#1A1500' },
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
    maxHeight: '55%',
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