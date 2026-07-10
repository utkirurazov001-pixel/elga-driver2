// ============================================================
//  KetdikGo — taksi chaqirish ilovasi (React Native / Expo)
//  Xarita: OpenStreetMap (Leaflet WebView)
//  Server: https://api.elga.uz
// ============================================================
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal, Linking, FlatList, Share,
  Animated, Easing, Image, Dimensions, AppState, Platform, PanResponder,
  KeyboardAvoidingView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
// expo-updates: Expo Go muhitida ishlatilmaydi (OTA faqat standalone APK uchun).
// isEnabled bilan himoyalanadi — Expo Go'da import xavfsiz (isEnabled=false).
import * as Updates from 'expo-updates';
import { WebView } from 'react-native-webview';
import { io } from 'socket.io-client';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Font from 'expo-font';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync, createAudioPlayer } from 'expo-audio';

// ─── Ajratilgan modullar ───
import { fmt, fmtPhone } from './src/utils';
import { mapHTML } from './src/mapHtml';
import { captureException } from './src/crash';

const BASE = 'https://api.elga.uz';

// C2: Manrope brend shrifti — yuklansa asosiy elementlarga qo'llanadi,
// yuklanmasa tizim shrifti qoladi (ilova hech qachon bloklanmaydi/buzilmaydi).
let FONTS_OK = false;
Font.loadAsync({
  'Manrope-SemiBold': require('./assets/fonts/Manrope_600SemiBold.ttf'),
  'Manrope-Bold': require('./assets/fonts/Manrope_700Bold.ttf'),
  'Manrope-ExtraBold': require('./assets/fonts/Manrope_800ExtraBold.ttf'),
}).then(() => { FONTS_OK = true; }).catch(() => {});
// Style yordamchisi: Manrope + fontWeight TO'QNASHMASIN — family qo'llanganda weight olib tashlanadi
function mfont(weight) { // '600' | '700' | '800'
  if (!FONTS_OK) return null;
  const fam = weight === '800' ? 'Manrope-ExtraBold' : weight === '700' ? 'Manrope-Bold' : 'Manrope-SemiBold';
  return { fontFamily: fam, fontWeight: undefined };
}

// UI-B1: yagona tugma tizimi — 5 tur. Bitta ekranda faqat bitta 'primary'.
// kind: 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon'
function Btn({ kind = 'primary', title, icon, onPress, loading, disabled, style, textStyle, children }) {
  const dis = disabled || loading;
  const base = {
    primary:   { backgroundColor: '#FFCC00', borderWidth: 0 },
    secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FFCC00' },
    danger:    { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#EF4444' },
    ghost:     { backgroundColor: 'transparent', borderWidth: 0 },
    icon:      { backgroundColor: '#FFCC00', borderWidth: 0, width: 48, height: 48, borderRadius: 24, paddingHorizontal: 0 },
  }[kind];
  const txtColor = kind === 'primary' || kind === 'icon' ? '#15171c' : kind === 'danger' ? '#EF4444' : kind === 'ghost' ? '#8A8F98' : '#FFCC00';
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={dis}
      onPress={onPress}
      style={[{
        minHeight: kind === 'icon' ? 48 : 52, borderRadius: kind === 'icon' ? 24 : 14,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
        paddingHorizontal: kind === 'icon' ? 0 : 18, opacity: dis && !loading ? 0.4 : 1,
      }, base, style]}>
      {loading ? <ActivityIndicator color={txtColor} /> : (
        <>
          {icon ? <Ionicons name={icon} size={kind === 'icon' ? 22 : 18} color={txtColor} style={title ? { marginRight: 8 } : null} /> : null}
          {title ? <Text style={[{ color: txtColor, fontSize: 15.5, fontWeight: '800', letterSpacing: 0.3 }, mfont('800'), textStyle]}>{title}</Text> : null}
          {children}
        </>
      )}
    </TouchableOpacity>
  );
}

// Faol (tugamagan) buyurtma holatlari — bularda buyurtma "tirik" hisoblanadi.
// completed/cancelled/paid — yakuniy holatlar (faol emas).
const ACTIVE_STATUSES = ['searching', 'assigned', 'accepted', 'arrived', 'in_progress'];

// Buyurtma holatining tartibi. Kechikkan/eskirgan order_update holatni ORQAGA
// qaytarib yubormasligi uchun (#status-regress).
const STATUS_RANK = {
  searching: 0, assigned: 1, accepted: 2, arrived: 3, in_progress: 4,
  completed: 5, cancelled: 5, paid: 6,
};
const TERMINAL_STATUSES = ['completed', 'cancelled', 'paid'];
function rankOf(st) { return Object.prototype.hasOwnProperty.call(STATUS_RANK, st) ? STATUS_RANK[st] : -1; }
// Kelgan yangilanish (next) joriy holatdan (cur) ORQAGA ketmasligini tekshiradi.
function isForwardUpdate(cur, next) {
  if (!cur) return true;
  if (!next || !next.status) return true;
  if (cur.id && next.id && cur.id !== next.id) return true;
  if (TERMINAL_STATUSES.includes(next.status)) return true;
  return rankOf(next.status) >= rankOf(cur.status);
}

// EAS projectId — push token uchun (app.json extra.eas.projectId bilan bir xil).
const EAS_PROJECT_ID = 'e5561b58-380f-45f6-9cc4-c6af58eaec84';

// Faol buyurtma lokal saqlanadigan kalit (crash/kill/OS-restart'da yo'qolmaydi).
const ACTIVE_ORDER_KEY = 'ACTIVE_ORDER';

// G2: oxirgi ma'lum joylashuv keshi — sovuq startda yangi GPS fix kelguncha
// xarita bo'sh ("GPS aniqlanmoqda...") qotib turmasin, kesh darrov ko'rsatiladi.
const LAST_LOC_KEY = 'last_loc';

// ============================================================
//  R1B: UZ/RU KO'P TILLILIK (haydovchi ilovasidagi qolip bilan bir xil)
//  LANG — modul o'zgaruvchisi; t() render ichida chaqiriladi. Til almashganda
//  setLang (AppInner) state'ni yangilab re-render qiladi (LANG sinxron yangi).
//  FAQAT ko'rinadigan UI matnlari tarjima qilinadi; server bilan almashinadigan
//  qiymatlar (statuslar, API pathlar, storage kalitlari) TEGILMAGAN.
// ============================================================
const L = {
  uz: {
    error: 'Xato',
    saved_ok: 'Saqlandi ✓',
    ready: 'Tushunarli',
    close: 'Yopish',
    cancel_btn: 'Bekor qilish',
    cancel_short: 'Bekor',
    back: 'Ortga',
    yes: 'Ha',
    no: "Yo'q",
    som: "so'm",
    min_short: 'daq',
    min_full: 'daqiqa',
    driver_def: 'Haydovchi',
    client_def: 'Mijoz',
    cash_lbl: 'Naqd',
    card_lbl: 'Karta',
    not_found: 'Topilmadi',
    unexpected_error: 'Kutilmagan xatolik',
    unexpected_error_sub: 'Ilova qayta ishga tushirilmoqda. Buyurtmalaringiz saqlanib qoladi.',
    retry: 'Qayta urinish',
    net_slow: 'Internet sekin — qayta urinilmoqda',
    net_none: "Ulanish yo'q — internetni tekshiring",
    net_error: 'Tarmoq xatosi',
    no_internet_banner: "Internet yo'q. Qayta ulanish kutilmoqda…",
    client_app: 'Mijoz ilovasi',
    get_sms_code: 'SMS KOD OLISH',
    sms_code_ph: 'SMS kod',
    confirm_up: 'TASDIQLASH',
    change_number: "← Raqamni o'zgartirish",
    your_name_ph: 'Ismingiz',
    ref_code_ph: 'Taklif kodi (ixtiyoriy)',
    continue_up: 'DAVOM ETISH',
    enter_valid_phone: "To'g'ri telefon raqam kiriting",
    sent: 'Yuborildi',
    sms_sent: 'SMS kod yuborildi',
    enter_code: 'Kodni kiriting',
    enter_name: 'Ismingizni kiriting',
    pin_set: "PIN o'rnating",
    pin_enter: 'PIN kiriting',
    pin_hint: "Keyingi kirishlarda SMS shart bo'lmaydi",
    pin_4digits: '4 ta raqam kiriting',
    pin_wrong: "PIN noto'g'ri",
    skip: "O'tkazib yuborish",
    login_sms: 'SMS orqali kirish',
    gps_detecting: 'GPS aniqlanmoqda...',
    hello: 'Salom',
    user_def: 'Foydalanuvchi',
    where_to_title: 'Qayerga boramiz?',
    where_to_q: 'Qayerga borasiz?',
    enter_or_pick: 'Manzilni kiriting yoki tanlang',
    home: 'Uy',
    work: 'Ish',
    voice_order: 'Ovozli buyurtma',
    speak_address: 'Manzilni gapiring 🎙',
    cars_available: 'ta mashina mavjud',
    approx_wait: 'Taxminiy kutish:',
    search_ph: "Maktab, bozor, ko'cha...",
    saved_sec: 'SAQLANGAN',
    search_results_sec: 'QIDIRUV NATIJALARI',
    recent_sec: "SO'NGGI MANZILLAR",
    popular_sec: 'MASHHUR JOYLAR',
    long_press_save: 'Uzun bosib saqlang',
    home_addr: 'Uy manzili',
    work_addr: 'Ish manzili',
    add_favorite_q: "Sevimliga qo'shish?",
    home_saved: 'Uy manzili saqlandi',
    work_saved: 'Ish manzili saqlandi',
    adjust_pickup: "Olib ketish nuqtasini xaritada to'g'rilang yoki tasdiqlang",
    confirm_arrow: 'TASDIQLASH →',
    seats: "o'rin",
    soon: 'tez kunda',
    now: 'Hozir',
    later: 'Keyinroq',
    promo_ph: 'Promo-kod (ixtiyoriy)',
    apply: "Qo'llash",
    promo_applied: "✓ Promo-kod qo'llandi — chegirma narxga kiritildi",
    promo_invalid: 'Promo-kod yaroqsiz yoki muddati tugagan',
    extra_ac_chip: '❄️ Konditsioner',
    extra_baggage_chip: '🧳 Bagaj',
    lets_go: 'Ketdik',
    sched_when: '⏰ Qachonga?',
    today_cap: 'Bugun',
    tomorrow: 'Ertaga',
    after_tomorrow: 'Indin',
    hour_lbl: 'Soat',
    minute_lbl: 'Daqiqa',
    confirm_btn: 'Tasdiqlash',
    time_too_close: 'Vaqt juda yaqin',
    time_too_close_msg: "Kamida 15 daqiqa keyinga tanlang. Undan yaqin bo'lsa — 'Hozir' bilan chaqiring.",
    status_searching: '🔍 Haydovchi qidirilmoqda...',
    status_accepted: "🚗 Haydovchi yo'lda",
    status_arrived: '✅ Haydovchi yetib keldi!',
    status_in_progress: '🛣️ Safar davom etmoqda',
    status_completed: '🏁 Safar yakunlandi',
    status_cancelled: '❌ Bekor qilindi',
    status_paid: "✅ To'landi",
    arrives_in: 'Yetib keladi:',
    to_dest_lbl: 'manzilgacha',
    driver_arrival: 'haydovchi yetib kelishi',
    scheduled_lbl: '⏰ Rejalashtirilgan',
    sched_auto_msg: 'Vaqti kelganda haydovchi qidiruvi avtomatik boshlanadi va sizga xabar keladi',
    away_lbl: 'uzoqlikda',
    to_dest_left: 'Manzilgacha',
    change_dest: "Manzilni o'zgartirish",
    meter_lbl: 'HISOBLAGICH',
    trip_price_lbl: 'SAFAR NARXI',
    wait_lbl: 'kutish',
    pay_lbl: "to'lov",
    share: 'Ulashish',
    cancel_order_btn: 'Buyurtmani bekor qilish',
    searching_title: 'Haydovchi qidirilmoqda',
    srch_msg1: 'Yaqin haydovchilar qidirilmoqda…',
    srch_msg2: 'Eng mos haydovchi tanlanmoqda…',
    srch_msg3: 'Deyarli tayyor…',
    driver_waiting: '⏱ Haydovchi kutmoqda',
    free_wait: 'Bepul kutish',
    left_lbl: 'qoldi',
    paid_wait: 'Pullik kutish',
    will_add: "qo'shiladi",
    driver_found: 'Haydovchi topildi! 🚗',
    on_way_sfx: "yo'lda",
    driver_arrived_t: 'Haydovchi yetib keldi ✅',
    car_waiting: 'Mashina sizni kutmoqda',
    trip_done_t: 'Safar yakunlandi 🏁',
    rate_driver_sub: 'Rahmat! Haydovchini baholang',
    order_cancelled_t: 'Buyurtma bekor qilindi',
    driver_near: 'Haydovchi yaqinlashmoqda 🚗',
    driver_near_sub: '~1 daqiqada yetib keladi',
    order_placed: 'Buyurtma berildi 🚖',
    searching_sub: 'Haydovchi qidirilmoqda...',
    active_order_t: 'Faol buyurtma',
    active_order_opened: 'Sizda faol buyurtma bor — ochildi',
    active_order_exists: 'Sizda faol buyurtma bor',
    voice_order_placed: 'Ovozli buyurtma berildi 🎙',
    finish_current_first: 'Avval joriy buyurtmani yakunlang yoki bekor qiling',
    driver_msg_t: '💬 Haydovchi xabar yubordi',
    chat_with_driver: 'Haydovchi bilan chat',
    message_ph: 'Xabar...',
    chat_empty: 'Suhbatni boshlang',
    chat_sub: 'Safar chati',
    qr_coming: 'Chiqyapman',
    qr_2min: '2 daqiqa kuting',
    qr_where: 'Qayerdasiz?',
    qr_thanks: 'Rahmat!',
    voice_order_title: '🎙 Ovozli buyurtma',
    voice_instr: 'Tugmani bosib ushlab turing va qayerga borishingizni tabiiy gapiring. Masalan: «Meni Muzrabot bozoriga olib boring».',
    analyzing: 'Tahlil qilinmoqda…',
    recording_lbl: '● Yozilmoqda…',
    hold_to_speak: 'Bosib ushlab turing',
    voice_retry_hint: "Tugmani bosib qayta gapiring yoki qo'lda qidiring.",
    manual_search: "🔍 Qo'lda qidirish",
    which_dest_q: 'Qaysi manzilga bormoqchisiz?',
    mic_lbl: 'Mikrofon',
    mic_perm: 'Ovozli buyurtma uchun mikrofon ruxsati kerak',
    too_short: 'Qisqa',
    speak_longer: 'Manzilni biroz uzunroq gapiring',
    rec_fail: "Ovoz yozib bo'lmadi: ",
    loc_lbl: 'Joylashuv',
    pickup_not_found: "Olib ketish joyi aniqlanmadi. GPS'ni yoqing yoki manzilni tanlang.",
    sos_title: '🆘 Favqulodda yordam',
    fire_lbl: "Yong'in",
    police_lbl: 'Militsiya',
    ambulance_lbl: 'Tez yordam',
    share_location: '📍 Joylashuvni ulashish',
    new_dest: 'Yangi manzil',
    new_dest_sub: "Manzil o'zgarsa, narx yangi masofa bo'yicha qayta hisoblanadi.",
    search_addr_ph: 'Manzilni qidiring...',
    dest_changed: "✅ Manzil o'zgartirildi",
    new_price: 'Yangi narx:',
    dest_updated: 'Manzil yangilandi',
    cancel_reason_title: 'Bekor qilish sababi',
    cancel_r1: 'Haydovchi uzoq kutdirdi',
    cancel_r2: 'Boshqa transport topdim',
    cancel_r3: 'Manzilni xato belgiladim',
    cancel_r4: "Rejam o'zgardi",
    cancel_r5: 'Haydovchi javob bermayapti',
    other_reason_ph: 'Boshqa sabab...',
    cancel_up: 'BEKOR QILISH',
    cancelled_t: 'Bekor qilindi',
    fine_lbl: 'Jarima:',
    driver_had_arrived: '(haydovchi yetib kelgan edi)',
    trip_finished: 'Safar yakunlandi',
    trip_fare_lbl: 'Safar narxi',
    wait_fee_lbl: 'Kutish haqi',
    total_pay: "Jami to'lov",
    cash_pay: "💵 Naqd to'lov",
    card_pay: '💳 Karta orqali',
    rate_driver: 'Haydovchini baholang',
    tip_lbl: 'Choychaqa (ixtiyoriy)',
    rate_up: 'BAHOLASH',
    rate_first_t: 'Baholang',
    rate_first_msg: 'Iltimos, avval yulduzlardan birini tanlang (1-5).',
    thanks_t: 'Rahmat! 😊',
    play_nudge: "KetdikGo yoqdimi? Play Market'da baholab, boshqalarga ham yordam bering!",
    later_btn: 'Keyinroq',
    rate_star_btn: 'Baholash ⭐',
    your_trips: 'Sayohatlaringiz',
    history: 'Tarix',
    no_trips_yet: "Hali safar yo'q",
    no_trips_sub: 'Birinchi buyurtmangizni bering — safarlaringiz shu yerda ko\'rinadi.',
    order_now: 'Buyurtma berish',
    no_fav_yet: "Sevimli manzillar yo'q",
    no_fav_sub: 'Tez-tez boradigan joylaringizni saqlang — keyin bir bosishda tanlaysiz.',
    completed_lbl: 'Yakunlangan',
    cancelled_lbl: 'Bekor qilingan',
    repeat: '↻ Takrorlash',
    today_up: 'BUGUN',
    yesterday_up: 'KECHA',
    help_sub: 'Sizga qanday yordam bera olamiz?',
    help_center: 'Yordam markazi',
    call_operator: "Operator bilan bog'lanish",
    support_247: "24/7 jonli qo'llab-quvvatlash",
    online_lbl: 'Onlayn',
    topics: 'MAVZULAR',
    faq_lbl: 'Tez-tez beriladigan savollar',
    faq_sub: "FAQ — eng ko'p so'raladi",
    pay_issues: "To'lov muammolari",
    pay_issues_sub: 'Karta, balans, cashback',
    trip_issues: 'Safar muammolari',
    trip_issues_sub: 'Buyurtma, kutish, manzil',
    driver_complaint: 'Haydovchi shikoyati',
    driver_complaint_sub: 'Xizmat sifati, xulq',
    ai_name: 'KetdikGo AI yordamchi',
    ai_empty: 'Savolingizni yozing — KetdikGo AI darrov javob beradi.\n(narx, bonus, buyurtma, haydovchi...)',
    your_question_ph: 'Savolingiz...',
    ai_fail: "Kechirasiz, javob berib bo'lmadi. Qayta urinib ko'ring 🙏",
    ticket_no: '📋 Murojaat raqami:',
    profile: 'Profil',
    balance_lbl: 'Balans',
    cashback_lbl: 'Cashback',
    claim_up: 'OLISH',
    invite_friend: "Do'stingni taklif qil — 10 000 so'm bonus",
    your_code: 'Kodingiz:',
    friend_discount: "do'stga birinchi safar -50%",
    fav_places: 'Sevimli joylar',
    pay_methods_lbl: "To'lov usullari",
    trips_history: 'Safarlar tarixi',
    safety_sos: 'Xavfsizlik va SOS',
    logout: 'Chiqish',
    logout_confirm: 'Hisobdan chiqishni tasdiqlaysizmi?',
    none_yet: "Hali yo'q",
    pay_methods_info: "💵 Naqd — haydovchiga to'laysiz\n\n💰 Bonus balans — har safardan keshbek, keyingi safarda ishlatiladi\n\n💳 Karta — tez kunda. Payme, Click, Uzcard qo'shiladi",
    // Y1: sevimli manzillar bottom-sheet
    fav_go: 'Ketdik',
    fav_add_new: "+ Yangi manzil qo'shish",
    fav_pick_recent: "So'nggi manzillardan tanlang",
    fav_name_ph: 'Manzil nomi (masalan: Uy)',
    fav_save: 'Saqlash',
    no_recent: "So'nggi manzillar hali yo'q — avval bitta safar qiling",
    // Y1: to'lov usuli sheet
    pay_choose_t: "To'lov usuli",
    pay_cash: 'Naqd pul',
    pay_cash_sub: "Safar oxirida haydovchiga to'laysiz",
    pay_card_sub: 'Payme · Click · Uzcard',
    pay_bonus: 'Bonus balans',
    use_next_trip: 'Keyingi safarga ishlatish',
    // Y1: safarlar statistikasi
    stats_trips: 'JAMI SAFAR',
    stats_spent: 'JAMI SARF',
    stats_dist: "YO'L",
    thousand_short: 'ming',
    language: 'TIL',
    cashback_t: 'Keshbek',
    added_to_balance: "balansga qo'shildi",
    ref_share_pre: "KetdikGo'da birinchi safaringga -50% chegirma! Ro'yxatdan o'tishda mening taklif kodimni kirit: ",
    ref_share_dl: 'Yuklab olish: https://ketdikgo.uz',
    share_fail_t: "Ulashib bo'lmadi",
    share_fail_sub: 'Token mavjud emas',
    share_trip_pre: 'Men KetdikGo taxi bilan sayohatdaman!\nKuzatish: ',
    link_lbl: 'Havola',
    copy_lbl: 'Nusxalash',
    payment_lbl: "To'lov",
    pay_link_fail: "To'lov havolasini ochib bo'lmadi, naqd to'lashingiz mumkin",
    tab_order: 'Buyurtma',
    tab_trips: 'Tarix',
    tab_help: 'Yordam',
    tab_profile: 'Profil',
  },
  ru: {
    error: 'Ошибка',
    saved_ok: 'Сохранено ✓',
    ready: 'Понятно',
    close: 'Закрыть',
    cancel_btn: 'Отмена',
    cancel_short: 'Отмена',
    back: 'Назад',
    yes: 'Да',
    no: 'Нет',
    som: 'сум',
    min_short: 'мин',
    min_full: 'мин',
    driver_def: 'Водитель',
    client_def: 'Клиент',
    cash_lbl: 'Наличные',
    card_lbl: 'Карта',
    not_found: 'Не найдено',
    unexpected_error: 'Непредвиденная ошибка',
    unexpected_error_sub: 'Приложение перезапускается. Ваши заказы сохранятся.',
    retry: 'Повторить',
    net_slow: 'Медленный интернет — повторяем попытку',
    net_none: 'Нет соединения — проверьте интернет',
    net_error: 'Ошибка сети',
    no_internet_banner: 'Нет интернета. Ожидание переподключения…',
    client_app: 'Приложение клиента',
    get_sms_code: 'ПОЛУЧИТЬ SMS-КОД',
    sms_code_ph: 'SMS-код',
    confirm_up: 'ПОДТВЕРДИТЬ',
    change_number: '← Изменить номер',
    your_name_ph: 'Ваше имя',
    ref_code_ph: 'Пригласительный код (необязательно)',
    continue_up: 'ПРОДОЛЖИТЬ',
    enter_valid_phone: 'Введите корректный номер телефона',
    sent: 'Отправлено',
    sms_sent: 'SMS-код отправлен',
    enter_code: 'Введите код',
    enter_name: 'Введите ваше имя',
    pin_set: 'Установите PIN',
    pin_enter: 'Введите PIN',
    pin_hint: 'При следующем входе SMS не понадобится',
    pin_4digits: 'Введите 4 цифры',
    pin_wrong: 'Неверный PIN',
    skip: 'Пропустить',
    login_sms: 'Войти через SMS',
    gps_detecting: 'Определение GPS...',
    hello: 'Привет',
    user_def: 'Пользователь',
    where_to_title: 'Куда едем?',
    where_to_q: 'Куда поедете?',
    enter_or_pick: 'Введите или выберите адрес',
    home: 'Дом',
    work: 'Работа',
    voice_order: 'Голосовой заказ',
    speak_address: 'Скажите адрес 🎙',
    cars_available: 'машин рядом',
    approx_wait: 'Ожидание:',
    search_ph: 'Школа, базар, улица...',
    saved_sec: 'СОХРАНЁННЫЕ',
    search_results_sec: 'РЕЗУЛЬТАТЫ ПОИСКА',
    recent_sec: 'НЕДАВНИЕ АДРЕСА',
    popular_sec: 'ПОПУЛЯРНЫЕ МЕСТА',
    long_press_save: 'Удерживайте, чтобы сохранить',
    home_addr: 'Адрес дома',
    work_addr: 'Адрес работы',
    add_favorite_q: 'Добавить в избранное?',
    home_saved: 'Адрес дома сохранён',
    work_saved: 'Адрес работы сохранён',
    adjust_pickup: 'Уточните точку подачи на карте или подтвердите',
    confirm_arrow: 'ПОДТВЕРДИТЬ →',
    seats: 'мест',
    soon: 'скоро',
    now: 'Сейчас',
    later: 'Позже',
    promo_ph: 'Промокод (необязательно)',
    apply: 'Применить',
    promo_applied: '✓ Промокод применён — скидка учтена в цене',
    promo_invalid: 'Промокод недействителен или истёк',
    extra_ac_chip: '❄️ Кондиционер',
    extra_baggage_chip: '🧳 Багаж',
    lets_go: 'Поехали',
    sched_when: '⏰ На когда?',
    today_cap: 'Сегодня',
    tomorrow: 'Завтра',
    after_tomorrow: 'Послезавтра',
    hour_lbl: 'Час',
    minute_lbl: 'Минуты',
    confirm_btn: 'Подтвердить',
    time_too_close: 'Слишком близкое время',
    time_too_close_msg: 'Выберите время минимум на 15 минут позже. Если нужно раньше — закажите через «Сейчас».',
    status_searching: '🔍 Поиск водителя...',
    status_accepted: '🚗 Водитель в пути',
    status_arrived: '✅ Водитель приехал!',
    status_in_progress: '🛣️ Поездка продолжается',
    status_completed: '🏁 Поездка завершена',
    status_cancelled: '❌ Отменён',
    status_paid: '✅ Оплачено',
    arrives_in: 'Прибудет через:',
    to_dest_lbl: 'до места назначения',
    driver_arrival: 'прибытие водителя',
    scheduled_lbl: '⏰ Запланировано',
    sched_auto_msg: 'Когда придёт время, поиск водителя начнётся автоматически, и вы получите уведомление',
    away_lbl: 'от вас',
    to_dest_left: 'До места',
    change_dest: 'Изменить адрес',
    meter_lbl: 'СЧЁТЧИК',
    trip_price_lbl: 'ЦЕНА ПОЕЗДКИ',
    wait_lbl: 'ожидание',
    pay_lbl: 'оплата',
    share: 'Поделиться',
    cancel_order_btn: 'Отменить заказ',
    searching_title: 'Поиск водителя',
    srch_msg1: 'Ищем ближайших водителей…',
    srch_msg2: 'Подбираем подходящего водителя…',
    srch_msg3: 'Почти готово…',
    driver_waiting: '⏱ Водитель ждёт',
    free_wait: 'Бесплатное ожидание',
    left_lbl: 'осталось',
    paid_wait: 'Платное ожидание',
    will_add: 'будет добавлено',
    driver_found: 'Водитель найден! 🚗',
    on_way_sfx: 'в пути',
    driver_arrived_t: 'Водитель приехал ✅',
    car_waiting: 'Машина ждёт вас',
    trip_done_t: 'Поездка завершена 🏁',
    rate_driver_sub: 'Спасибо! Оцените водителя',
    order_cancelled_t: 'Заказ отменён',
    driver_near: 'Водитель подъезжает 🚗',
    driver_near_sub: 'Прибудет примерно через 1 минуту',
    order_placed: 'Заказ создан 🚖',
    searching_sub: 'Идёт поиск водителя...',
    active_order_t: 'Активный заказ',
    active_order_opened: 'У вас есть активный заказ — открыт',
    active_order_exists: 'У вас есть активный заказ',
    voice_order_placed: 'Голосовой заказ создан 🎙',
    finish_current_first: 'Сначала завершите или отмените текущий заказ',
    driver_msg_t: '💬 Сообщение от водителя',
    chat_with_driver: 'Чат с водителем',
    message_ph: 'Сообщение...',
    chat_empty: 'Начните разговор',
    chat_sub: 'Чат поездки',
    qr_coming: 'Выхожу',
    qr_2min: 'Подождите 2 минуты',
    qr_where: 'Вы где?',
    qr_thanks: 'Спасибо!',
    voice_order_title: '🎙 Голосовой заказ',
    voice_instr: 'Нажмите и удерживайте кнопку и скажите, куда вам нужно. Например: «Отвезите меня на базар Музрабада».',
    analyzing: 'Анализируем…',
    recording_lbl: '● Запись…',
    hold_to_speak: 'Нажмите и удерживайте',
    voice_retry_hint: 'Нажмите кнопку и повторите или найдите адрес вручную.',
    manual_search: '🔍 Найти вручную',
    which_dest_q: 'Куда вы хотите поехать?',
    mic_lbl: 'Микрофон',
    mic_perm: 'Для голосового заказа нужен доступ к микрофону',
    too_short: 'Слишком коротко',
    speak_longer: 'Назовите адрес чуть подробнее',
    rec_fail: 'Не удалось записать: ',
    loc_lbl: 'Геолокация',
    pickup_not_found: 'Не удалось определить точку подачи. Включите GPS или выберите адрес.',
    sos_title: '🆘 Экстренная помощь',
    fire_lbl: 'Пожарная служба',
    police_lbl: 'Полиция',
    ambulance_lbl: 'Скорая помощь',
    share_location: '📍 Поделиться геолокацией',
    new_dest: 'Новый адрес',
    new_dest_sub: 'При смене адреса цена пересчитывается по новому расстоянию.',
    search_addr_ph: 'Поиск адреса...',
    dest_changed: '✅ Адрес изменён',
    new_price: 'Новая цена:',
    dest_updated: 'Адрес обновлён',
    cancel_reason_title: 'Причина отмены',
    cancel_r1: 'Водитель заставил долго ждать',
    cancel_r2: 'Нашёл другой транспорт',
    cancel_r3: 'Неверно указал адрес',
    cancel_r4: 'Планы изменились',
    cancel_r5: 'Водитель не отвечает',
    other_reason_ph: 'Другая причина...',
    cancel_up: 'ОТМЕНИТЬ',
    cancelled_t: 'Отменено',
    fine_lbl: 'Штраф:',
    driver_had_arrived: '(водитель уже приехал)',
    trip_finished: 'Поездка завершена',
    trip_fare_lbl: 'Стоимость поездки',
    wait_fee_lbl: 'Плата за ожидание',
    total_pay: 'Итого к оплате',
    cash_pay: '💵 Наличными',
    card_pay: '💳 Картой',
    rate_driver: 'Оцените водителя',
    tip_lbl: 'Чаевые (по желанию)',
    rate_up: 'ОЦЕНИТЬ',
    rate_first_t: 'Оцените',
    rate_first_msg: 'Пожалуйста, сначала выберите одну из звёзд (1-5).',
    thanks_t: 'Спасибо! 😊',
    play_nudge: 'Понравился KetdikGo? Оцените нас в Play Market — это поможет другим!',
    later_btn: 'Позже',
    rate_star_btn: 'Оценить ⭐',
    your_trips: 'Ваши поездки',
    history: 'История',
    no_trips_yet: 'Поездок пока нет',
    no_trips_sub: 'Сделайте первый заказ — поездки появятся здесь.',
    order_now: 'Заказать',
    no_fav_yet: 'Нет избранных адресов',
    no_fav_sub: 'Сохраните часто посещаемые места — потом выберете в одно нажатие.',
    completed_lbl: 'Завершена',
    cancelled_lbl: 'Отменена',
    repeat: '↻ Повторить',
    today_up: 'СЕГОДНЯ',
    yesterday_up: 'ВЧЕРА',
    help_sub: 'Чем мы можем помочь?',
    help_center: 'Центр помощи',
    call_operator: 'Связаться с оператором',
    support_247: 'Живая поддержка 24/7',
    online_lbl: 'Онлайн',
    topics: 'ТЕМЫ',
    faq_lbl: 'Частые вопросы',
    faq_sub: 'FAQ — самое частое',
    pay_issues: 'Проблемы с оплатой',
    pay_issues_sub: 'Карта, баланс, кэшбек',
    trip_issues: 'Проблемы с поездкой',
    trip_issues_sub: 'Заказ, ожидание, адрес',
    driver_complaint: 'Жалоба на водителя',
    driver_complaint_sub: 'Качество сервиса, поведение',
    ai_name: 'KetdikGo AI помощник',
    ai_empty: 'Напишите вопрос — KetdikGo AI сразу ответит.\n(цена, бонус, заказ, водитель...)',
    your_question_ph: 'Ваш вопрос...',
    ai_fail: 'Извините, не удалось ответить. Попробуйте ещё раз 🙏',
    ticket_no: '📋 Номер обращения:',
    profile: 'Профиль',
    balance_lbl: 'Баланс',
    cashback_lbl: 'Кэшбек',
    claim_up: 'ЗАБРАТЬ',
    invite_friend: 'Пригласи друга — бонус 10 000 сум',
    your_code: 'Ваш код:',
    friend_discount: 'другу -50% на первую поездку',
    fav_places: 'Избранные места',
    pay_methods_lbl: 'Способы оплаты',
    trips_history: 'История поездок',
    safety_sos: 'Безопасность и SOS',
    logout: 'Выйти',
    logout_confirm: 'Вы действительно хотите выйти из аккаунта?',
    none_yet: 'Пока нет',
    pay_methods_info: '💵 Наличные — платите водителю\n\n💰 Бонусный баланс — кэшбек с каждой поездки, используется в следующей\n\n💳 Карта — скоро. Добавим Payme, Click, Uzcard',
    // Y1: sevimli manzillar bottom-sheet
    fav_go: 'Поехали',
    fav_add_new: '+ Добавить адрес',
    fav_pick_recent: 'Выберите из недавних адресов',
    fav_name_ph: 'Название адреса (напр.: Дом)',
    fav_save: 'Сохранить',
    no_recent: 'Недавних адресов пока нет — сначала совершите поездку',
    // Y1: to'lov usuli sheet
    pay_choose_t: 'Способ оплаты',
    pay_cash: 'Наличные',
    pay_cash_sub: 'Платите водителю в конце поездки',
    pay_card_sub: 'Payme · Click · Uzcard',
    pay_bonus: 'Бонусный баланс',
    use_next_trip: 'Использовать в следующей поездке',
    // Y1: safarlar statistikasi
    stats_trips: 'ПОЕЗДОК',
    stats_spent: 'ПОТРАЧЕНО',
    stats_dist: 'ПУТЬ',
    thousand_short: 'тыс',
    language: 'ЯЗЫК',
    cashback_t: 'Кэшбек',
    added_to_balance: 'добавлено на баланс',
    ref_share_pre: 'Скидка -50% на первую поездку в KetdikGo! При регистрации введи мой пригласительный код: ',
    ref_share_dl: 'Скачать: https://ketdikgo.uz',
    share_fail_t: 'Не удалось поделиться',
    share_fail_sub: 'Токен недоступен',
    share_trip_pre: 'Я еду с такси KetdikGo!\nСледить: ',
    link_lbl: 'Ссылка',
    copy_lbl: 'Скопировать',
    payment_lbl: 'Оплата',
    pay_link_fail: 'Не удалось открыть ссылку на оплату, можно оплатить наличными',
    tab_order: 'Заказ',
    tab_trips: 'История',
    tab_help: 'Помощь',
    tab_profile: 'Профиль',
  },
};
let LANG = 'uz';
function t(k) { return (L[LANG] && L[LANG][k]) || L.uz[k] || k; }

// Y1: katta summani qisqartirish — 1 250 000 → '1.3 mln', 125 000 → '125 ming'
// (safarlar statistikasi kartalarida joy tejash uchun)
function fmtShortSum(v) {
  const n = Number(v) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + ' mln';
  if (n >= 1000) return Math.round(n / 1000) + ' ' + t('thousand_short');
  return String(n);
}

// G2: osilib qoladigan chaqiruvlar (GPS fix, geokod) UI oqimini bloklamasin —
// muddat o'tsa reject bo'ladi, chaqiruvchi .catch bilan davom etadi.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// T-19: Admin panelda yuklangan holat ovozlari MIJOZ ilovasida ham chalinsin
// (driver_arrived, trip_started, trip_completed, order_cancelled). Ilgari mijoz
// ilovasida bu ovozlar UMUMAN ijro etilmasdi. Bir martalik (loop emas), telefon
// "jim" rejimida ham eshitiladi.
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
let _statusPlayer = null;
function playAdminSoundUrl(url) {
  if (!url) return; // admin ovoz yuklamagan — jim (mijozda TTS zaxira yo'q)
  try {
    if (_statusPlayer) { try { _statusPlayer.remove(); } catch (_) {} _statusPlayer = null; }
    const p = createAudioPlayer({ uri: url });
    try { p.volume = 1.0; } catch (_) {}
    try {
      p.addListener('playbackStatusUpdate', (st) => {
        if (st && st.didJustFinish && _statusPlayer === p) { try { p.remove(); } catch (_) {} _statusPlayer = null; }
      });
    } catch (_) {}
    p.play();
    _statusPlayer = p;
  } catch (_) { _statusPlayer = null; }
}

// SURILADIGAN (draggable) AI tugma — foydalanuvchi barmoq bilan istagan joyga
// ko'chiradi, qo'yib yuborganda yaqin chetga "yopishadi" (snap). Joylashuv
// AsyncStorage'da saqlanadi. Tegish (surmasdan) — onPress. Buyurtma
// tugmalariga xalaqit bermaydi: kichik (44px), pastki panel zonasi chegaralangan.
function DraggableAiButton({ insets, onPress, storageKey, accent, iconColor }) {
  const BTN = 44, M = 12;
  const { width: SW, height: SH } = Dimensions.get('window');
  const yMin = insets.top + 60;
  const yMax = SH - insets.bottom - BTN - 190; // pastki buyurtma paneliga tegmasin
  const defPos = { x: SW - BTN - M, y: Math.max(yMin, Math.min(yMax, SH * 0.38)) };
  const pos = useRef(new Animated.ValueXY(defPos)).current;
  const startRef = useRef(defPos);
  const movedRef = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((v) => {
      if (!v) return;
      try {
        const p = JSON.parse(v);
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          pos.setValue({ x: Math.min(SW - BTN - M, Math.max(M, p.x)), y: Math.max(yMin, Math.min(yMax, p.y)) });
        }
      } catch (_) {}
    }).catch(() => {});
  }, []);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      movedRef.current = false;
      startRef.current = { x: pos.x.__getValue(), y: pos.y.__getValue() };
    },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) movedRef.current = true;
      pos.setValue({ x: startRef.current.x + g.dx, y: startRef.current.y + g.dy });
    },
    onPanResponderRelease: (_, g) => {
      if (!movedRef.current) { onPress && onPress(); return; } // surilmadi — bu TEGISH
      const x = startRef.current.x + g.dx, y = startRef.current.y + g.dy;
      const snapX = (x + BTN / 2) < SW / 2 ? M : SW - BTN - M;
      const clampY = Math.max(yMin, Math.min(yMax, y));
      Animated.spring(pos, { toValue: { x: snapX, y: clampY }, useNativeDriver: false, friction: 6 }).start();
      AsyncStorage.setItem(storageKey, JSON.stringify({ x: snapX, y: clampY })).catch(() => {});
    },
    onPanResponderTerminate: () => {},
  })).current;
  return (
    <Animated.View
      {...pan.panHandlers}
      style={[pos.getLayout(), {
        position: 'absolute', width: BTN, height: BTN, zIndex: 60,
        borderRadius: BTN / 2, backgroundColor: accent,
        alignItems: 'center', justifyContent: 'center',
        elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
      }]}>
      <Ionicons name="sparkles" size={20} color={iconColor} />
    </Animated.View>
  );
}

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

// M-05: Android bildirishnoma KANALI — backend push'lari channelId:'order-status'
// bilan keladi ("Haydovchi yo'lda", "Yetib keldi"...). Kanalsiz Android 8+ da push
// past muhimlikda (ovozsiz, kechikkan) yoki umuman ko'rinmay qolardi — real testdagi
// "push kelmayapti"ning ilova tomonidagi sababi. HIGH = ovoz + banner (heads-up).
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('order-status', {
    name: 'Buyurtma holati',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
  // MARKETING / SODIQLIK / aksiya push'lari channelId:'default' bilan keladi.
  // Bu kanal yaratilmasa, ilova YOPIQ/FONда Android push'ni tashlab yuborardi
  // (faqat ochiqда ko'rinardi). HIGH importance + ovoz bilan yaratamiz — endi
  // ilova ishlamay turganда ham heads-up bildirishnoma bo'lib ko'rinadi.
  Notifications.setNotificationChannelAsync('default', {
    name: 'Xabarlar va aksiyalar',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {});
}

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

// Expo push tokenini olib backendga yuboramiz. Ilova YOPIQ/fon holatida ham
// "Haydovchi topildi", "Haydovchi yetib keldi" kabi xabarlar kelishi uchun
// (socket faqat ochiq ilovada ishonchli). Backend (elga-backend) bu tokenga
// Expo push yuborishi kerak — POST /api/me/push-token { token, platform, deviceId }. (#push-missing)
async function registerPushToken(authToken) {
  try {
    if (!authToken) return null;
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return null;
    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const pushToken = tokenResp?.data;
    if (!pushToken) return null;
    const deviceId = await getDeviceId();
    await api('/api/me/push-token', 'POST',
      { token: pushToken, platform: Platform.OS, deviceId }, authToken, 10000, { retries: 1 })
      .catch(() => {});
    return pushToken;
  } catch (e) { return null; }
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
      lastErr = new Error(e.name === 'AbortError' ? t('net_slow') : t('net_none'));
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
  throw lastErr || new Error(t('net_error'));
}

// fmt, fmtPhone — ./src/utils dan import qilinadi

// To'lov usuli ikonkalari
const PAY_ICONS = { cash: '💵', click: '🔵', payme: '🟢', card: '💳' };

// Tab panelining tizim navigatsiyasidan tashqari balandligi (safe-area pastdan qo'shiladi)
// UI-B2: 56 -> 60 (ikonka 24 + 4 oraliq + matn 11 + indikator sig'ishi uchun)
const TABBAR_H = 60;
// Ekran balandligi — pastdan ko'tariladigan sheet'larni cheklash uchun
const SCREEN_H = Dimensions.get('window').height;

// Mijoz balansi 0 yoki manfiy bo'lsa "Balans" blokini umuman yashirish
const HIDE_BALANCE_IF_NONPOSITIVE = true;

// Mashina klasslari (backend config bilan mos).
// VIZUAL: Ekspress OLIB TASHLANDI (4 tarif). Brend aksenti — YAGONA sariq #FFCC00
// (ko'k/rangin ranglar olib tashlandi). Tarif narx/buyurtma mantig'i o'zgarmaydi —
// bu faqat ro'yxat va rang. car_class id'lari backend bilan o'sha-o'sha.
const CAR_CLASSES = [
  {
    id: 'ekonom', label: 'Tejamkor', seats: 4,
    color: '#FFCC00', badge: 'Mashhur',
    models: 'Cobalt · Spark · Gentra',
    features: ['A/C', 'Arzon narx'],
    icon: '🚗',
  },
  {
    id: 'komfort', label: 'Comfort', seats: 4,
    color: '#FFCC00', badge: null,
    models: 'Nexia 3 · Lacetti · Tracker',
    features: ['A/C', 'USB', 'Keng salon'],
    icon: '🚙',
  },
  {
    id: 'oila', label: 'Oila', seats: 6,
    color: '#FFCC00', badge: null,
    models: 'Damas · Orlando · Zafira',
    features: ['6 o\'rinli', 'Katta yuk'],
    icon: '🚐',
  },
  {
    id: 'yuk', label: 'Yuk tashish', seats: 2,
    color: '#FFCC00', badge: null,
    models: 'GAZelle · Porter · Sprinter',
    features: ['Katta yuk', 'Ko\'chirish'],
    icon: '🚚',
  },
];

// Bekor qilish sabablari — R1B: t() kalitlari (matnlar L lug'atida uz/ru)
const CANCEL_REASONS = ['cancel_r1', 'cancel_r2', 'cancel_r3', 'cancel_r4', 'cancel_r5'];

async function reverseGeocode(lat, lng) {
  try {
    // G2: sekin tarmoqda nominatim osilib qolmasin — 6s timeout (pickup manzili
    // shu chaqiruvni kutadi, timeout'da koordinata matni bilan davom etiladi)
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=uz`,
      { headers: { 'User-Agent': 'KetdikGo-Taxi/1.0' }, signal: ctrl.signal }
    ).finally(() => clearTimeout(tmr));
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
            {t('unexpected_error')}
          </Text>
          <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            {t('unexpected_error_sub')}
          </Text>
          <TouchableOpacity
            onPress={this.reset}
            style={{ backgroundColor: YELLOW, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}
            activeOpacity={0.85}>
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // W5: ochilish animatsiyasi — AppInner booting'ni tugatgach (onBootDone)
  // BrandSplash overlay ko'rinadi va ~1 soniyada o'zi yo'qoladi (unmount).
  // Overlay App darajasida — PIN/login/asosiy, qaysi ekran bo'lsa ham USTIDA.
  const [bootDone, setBootDone] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppInner onBootDone={() => setBootDone(true)} />
      </ErrorBoundary>
      {bootDone && !splashDone && <BrandSplash onDone={() => setSplashDone(true)} />}
      {/* UI-B3: brend xabar tizimi — butun ilova ustida, bir marta */}
      <BrandToast />
      <BrandModal />
    </SafeAreaProvider>
  );
}

// ===== KetdikGo brend wordmark (matn asosida — qo'shimcha paketsiz) =====
// Ket → sariq, dik → oq, Go → sariq (brend spetsifikatsiyasi)
const CAR_CLASS_ICONS = {
  ekonom: 'car-outline',
  komfort: 'car-sport-outline',
  oila: 'bus-outline',
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
  // T-05: KetdikGo brendi. Oldingi "ELGA TAXI" qoldig'i ("TAXI" so'zi) olib tashlandi —
  // brend endi faqat "KetdikGo" + slogan "Belgila. Tanla. Ketdik.".
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: size, fontWeight: '800', letterSpacing: -size * 0.02, lineHeight: size * 1.05 }}>
        <Text style={{ color: YELLOW }}>Ket</Text>
        <Text style={{ color: WHITE }}>dik</Text>
        <Text style={{ color: YELLOW }}>Go</Text>
      </Text>
      {tagline && (
        <Text style={{ color: GRAY1, fontSize: Math.max(10, size * 0.18), fontWeight: '600', letterSpacing: 1, marginTop: 8 }}>
          Belgila. Tanla. Ketdik.
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

// W5: OCHILISH (SPLASH) ANIMATSIYASI — booting tugagach BIR MARTA ko'rinadigan
// to'liq ekran overlay (haydovchi ilovasi bilan bir xil qolip). Ketma-ketlik:
// scale 0.92→1 (400ms) → 350ms pauza → opacity 1→0 (300ms) → onDone (ota
// komponent overlay'ni unmount qiladi). Faqat vizual — mantiqqa ta'sir qilmaydi.
function BrandSplash({ onDone }) {
  const op = useRef(new Animated.Value(1)).current;
  const sc = useRef(new Animated.Value(0.92)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(sc, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(op, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onDone && onDone());
  }, []);
  return (
    <Animated.View pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 24, opacity: op }}>
      <Animated.View style={{ alignItems: 'center', transform: [{ scale: sc }] }}>
        <Text style={[{ fontSize: 40, fontWeight: '800', letterSpacing: 0.5 }, mfont('800')]}>
          <Text style={{ color: WHITE }}>Ketdik</Text>
          <Text style={{ color: YELLOW }}>Go</Text>
        </Text>
        <Text style={{ color: GRAY1, fontSize: 13, marginTop: 8 }}>{t('client_app')}</Text>
      </Animated.View>
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

function AppInner({ onBootDone }) {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  // W5: booting tugadi — App darajasidagi ochilish splash'iga signal beramiz
  // (overlay shundan keyin ko'rinadi va o'z animatsiyasini boshlaydi)
  useEffect(() => { if (!booting && onBootDone) onBootDone(); }, [booting]);

  // Login
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [refCode, setRefCode] = useState(''); // Q4: taklif kodi (ixtiyoriy)
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

  // R1B: UI tili (uz/ru). LANG — modul o'zgaruvchisi (t() uchun), state — re-render uchun.
  const [lang, setLangState] = useState('uz');
  function setLang(l) {
    LANG = l;
    setLangState(l);
    AsyncStorage.setItem('app_lang', l).catch(() => {});
  }

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
  const [promoCode, setPromoCode] = useState(''); // Q3: promo-kod (ixtiyoriy)
  // W1: pullik qo'shimcha xizmatlar — A/C va bagaj (backend #134: need_ac/need_baggage,
  // narx estimate/buyurtmaga extras_fee sifatida kiritiladi)
  const [needAc, setNeedAc] = useState(false);
  const [needBaggage, setNeedBaggage] = useState(false);
  // Chip yorlig'idagi narxlar — /api/config/pricing (extra_ac/extra_baggage).
  // Server bermasa zaxira: 2000/3000 so'm.
  const [extrasCfg, setExtrasCfg] = useState({ ac: 2000, baggage: 3000 });
  // C1: rejalashtirilgan safar — tanlangan vaqt (Date) yoki null (hozir)
  const [schedAt, setSchedAt] = useState(null);
  const [schedModal, setSchedModal] = useState(false);
  const [schedDay, setSchedDay] = useState(0);   // 0=bugun 1=ertaga 2=indin
  const [schedHour, setSchedHour] = useState(8);
  const [schedMin, setSchedMin] = useState(0);
  const [order, setOrder] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  // M-05: socket driver_location oxirgi kelgan vaqti. Socket jim bo'lsa (o'lik/yo'q),
  // haydovchi joylashuvini order payload'idagi driver_lat/lng dan olamiz (poll/resume) —
  // marker va ETA REST orqali ham ishlaydi. Socket jonli bo'lsa unga xalaqit bermaymiz.
  const driverLocSockTsRef = useRef(0);
  const seedDriverLocFromOrder = (o) => {
    if (!o || o.driver_lat == null || o.driver_lng == null) return;
    if (Date.now() - driverLocSockTsRef.current < 12000) return; // socket jonli — tegmaymiz
    const lat = Number(o.driver_lat), lng = Number(o.driver_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setDriverLoc((prev) => (prev && prev.lat === lat && prev.lng === lng) ? prev : { lat, lng });
  };
  // W3: faol buyurtma pastki kartasi — ushlagichdan pastga surib YIG'ISH (Yandex Go
  // qolipi): karta translateY bilan pastga suriladi, ushlagich + holat + narx ko'rinib
  // qoladi, xarita to'liq ochiladi. Balandlik O'ZGARMAYDI — faqat transform
  // (useNativeDriver: true). Bosh ekran sheet'lariga TEGILMAGAN.
  const sheetY = useRef(new Animated.Value(0)).current; // 0 = ochiq, sheetDyRef = yig'ilgan
  const sheetOpenRef = useRef(true);        // pan handler stale closure'siz o'qishi uchun
  const [sheetOpen, setSheetOpen] = useState(true); // yig'ilganda kompakt narx qatorini chizish uchun
  const sheetDyRef = useRef(300);           // onLayout'da aniq: karta balandligi - 84
  const sheetScrollRef = useRef(0);         // X2: ichki ScrollView vertikal offset
  function snapSheet(open) {
    sheetOpenRef.current = open;
    setSheetOpen(open);
    Animated.spring(sheetY, { toValue: open ? 0 : sheetDyRef.current, useNativeDriver: true, bounciness: 4 }).start();
  }
  // X2: pan endi BUTUN kartada (ushlagich emas). Ichki ScrollView bilan muvofiqlashtirish:
  //   • yig'iq — istalgan vertikal surish ko'taradi/tushiradi;
  //   • ochiq — faqat ScrollView tepada (offset<=0) turib pastga tortilsa yig'iladi;
  //   • gorizontal yoki kichik tebranish — pan olinmaydi (scroll/tugma saqlanadi).
  const sheetPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      if (Math.abs(g.dy) < 8 || Math.abs(g.dy) <= Math.abs(g.dx)) return false;
      if (!sheetOpenRef.current) return true;
      return g.dy > 0 && sheetScrollRef.current <= 0;
    },
    onPanResponderMove: (_, g) => {
      const dyMax = sheetDyRef.current;
      const base = sheetOpenRef.current ? 0 : dyMax;
      sheetY.setValue(Math.min(dyMax, Math.max(0, base + g.dy)));
    },
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) { snapSheet(!sheetOpenRef.current); return; } // tegish — ochish/yig'ish
      if (Math.abs(g.vy) > 0.5) { snapSheet(g.vy < 0); return; } // flick — yo'nalish bo'yicha
      const base = sheetOpenRef.current ? 0 : sheetDyRef.current;
      snapSheet(base + g.dy < sheetDyRef.current / 2); // yarmidan yuqorida qolsa — ochiq
    },
    onPanResponderTerminate: () => snapSheet(sheetOpenRef.current),
  })).current;
  // Buyurtma holati o'zgarganda karta avtomatik to'liq ochiladi (muhim o'zgarish ko'rinsin);
  // buyurtma tugaganda keyingisi uchun ochiq holatga qaytariladi.
  useEffect(() => {
    if (order) snapSheet(true);
    else { sheetOpenRef.current = true; setSheetOpen(true); sheetY.setValue(0); }
  }, [order?.status]);
  // Yangi buyurtma paydo bo'lganda pastdan ko'tarilish effekti (avvalgi AnimatedSheet qolipi)
  useEffect(() => { if (order?.id) { sheetY.setValue(40); snapSheet(true); } }, [order?.id]);
  const [nearby, setNearby] = useState([]);
  const [carClass, setCarClass] = useState('ekonom');
  const [payMethod, setPayMethod] = useState('cash');
  const [payMethods, setPayMethods] = useState([{ id: 'cash', name: 'Naqd', active: true }]);
  // Admin paneldan boshqariladigan tarif rasmlari: { ekonom: 'data:image/...', ... }
  const [carImages, setCarImages] = useState({});

  // Modallar
  const [cancelModal, setCancelModal] = useState(false);
  const [customReason, setCustomReason] = useState('');
  // Y1: profil menyusidagi sheet'lar (avval Alert.alert edi — o'lik oynalar)
  const [favSheet, setFavSheet] = useState(false);       // sevimli manzillar bottom-sheet
  const [favAddMode, setFavAddMode] = useState(false);   // "+ Yangi manzil" — recentPlaces ro'yxati
  const [favPickPlace, setFavPickPlace] = useState(null); // tanlangan so'nggi manzil (nom kutilyapti)
  const [favNewName, setFavNewName] = useState('');      // yangi sevimli uchun nom
  const [paySheet, setPaySheet] = useState(false);       // to'lov usulini tanlash sheet'i
  const [useBonus, setUseBonus] = useState(false);       // keyingi buyurtmaga bonus ishlatish (use_bonus)
  const [rateModal, setRateModal] = useState(false);
  const [rateOrderId, setRateOrderId] = useState(null);
  const [completedOrder, setCompletedOrder] = useState(null); // yakunlangan safar tafsiloti
  const [stars, setStars] = useState(0); // D4: mijoz O'ZI tanlasin (avval 5 oldindan bosilgan turardi)
  const [tipAmount, setTipAmount] = useState(0);

  // In-trip chat
  const [tripChatModal, setTripChatModal] = useState(false);
  const [tripChat, setTripChat] = useState([]);
  const [tripChatInput, setTripChatInput] = useState('');
  // A2: chat yopiq holatda kelgan o'qilmagan xabarlar soni (chatCircle badge)
  const [tripChatUnread, setTripChatUnread] = useState(0);
  // A2: socket handler bir marta o'rnatiladi — tripChatModal'ni stale closure'siz
  // o'qish uchun ref (aks holda handler ichida tripChatModal DOIM false bo'lardi)
  const tripChatModalRef = useRef(false);
  tripChatModalRef.current = tripChatModal;
  const tripChatScrollRef = useRef(null); // A2: chat ro'yxati — oxirgi xabarga avto-scroll
  // X4: har xabarga birinchi render paytida vaqt tamg'asi (lokal, ko'rinish uchun)
  const tripChatTsRef = useRef({});

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

  // T-19: admin ovozlari manifesti { key: to'liq URL } + trip_started dedup
  const soundMapRef = useRef({});
  const tripStartedSoundRef = useRef(null); // shu buyurtma uchun chalindi (takror emas)
  useEffect(() => {
    (async () => {
      try {
        const r = await api('/api/config/sounds', 'GET', null, null, 15000);
        const m = {};
        for (const [k, v] of Object.entries((r && r.sounds) || {})) {
          if (v) m[k] = /^https?:\/\//i.test(v) ? v : BASE + v;
        }
        soundMapRef.current = m;
      } catch (_) { /* ovozsiz davom etadi — keyingi ochilishda qayta uriniladi */ }
    })();
  }, []);
  const adminSoundUrl = (key) => soundMapRef.current[key] || null;

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
    trips.forEach(tp => {
      const d = new Date(tp.created_at).toDateString();
      if (d !== lastDay) {
        lastDay = d;
        result.push({
          type: 'header',
          label: d === today ? t('today_up') : d === yesterday ? t('yesterday_up') : new Date(tp.created_at).toLocaleDateString(LANG === 'ru' ? 'ru-RU' : 'uz-UZ', { day: 'numeric', month: 'long' })
        });
      }
      result.push({ type: 'trip', item: tp });
    });
    return result;
  }, [trips, lang]);
  // Y1: tarix tepasidagi 3 mini karta — faqat yakunlangan (completed) safarlar bo'yicha.
  // Bitta ham completed bo'lmasa null qaytadi va kartalar umuman chizilmaydi.
  const tripStats = useMemo(() => {
    const done = trips.filter((tp) => tp.status === 'completed');
    if (!done.length) return null;
    return {
      count: done.length,
      spent: done.reduce((a, tp) => a + (Number(tp.price) || 0), 0),
      dist: done.reduce((a, tp) => a + (Number(tp.distance_km) || 0), 0),
    };
  }, [trips]);
  const [balance, setBalance] = useState(null);
  const [chat, setChat] = useState([]);
  const [aiModal, setAiModal] = useState(false); // AI chat modali (suzuvchi tugmadan 1 tegishда)
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
  const chatOutboxRef = useRef([]);      // socket uzilganda yuborilmagan chat xabarlar (#chat-loss)
  const pushRegisteredRef = useRef(false); // push token bir marta ro'yxatga olinadi
  const finishedOrderIdRef = useRef(null); // yakunlangan/bekor buyurtma id — kechikkan event uni tiriltirmasligi uchun (#order-resurrect)
  // T-16: markaziy holat mashinasi uchun himoya ref'lari.
  const orderTouchedAtRef = useRef(0); // buyurtma oxirgi o'rnatilgan vaqt — eski "bo'sh" javob YANGI buyurtmani o'chirmasin (race guard)
  const resumeBusyRef = useRef(false); // parallel resume so'rovlari dedup (mount/connect/reconnect/foreground bir vaqtda)
  const webviewRef = useRef(null);
  const creatingOrderRef = useRef(false);                 // ikki marta buyurtma yaratilmasin (double-tap)
  const healthTimerRef = useRef(null);                    // reachability heartbeat timeri
  const [netOnline, setNetOnline] = useState(true);       // internet bormi (banner uchun)
  // baseUrl — WebView hujjatiga BARQAROR origin beradi. Google Maps kaliti "HTTP referrer"
  // cheklovi bilan bo'lsa, bu domenni (ketdikgo.uz/*) ruxsat ro'yxatiga qo'shish kifoya.
  // baseUrl'siz origin 'about:blank'/'null' bo'lib, Google RefererNotAllowedMapError beradi.
  const mapSource = useRef({ html: mapHTML(), baseUrl: 'https://ketdikgo.uz/' }).current; // bir marta yaratiladi, qayta yuklanmaydi
  const mapDataRef = useRef({});                          // joriy xarita ma'lumoti (so'nggi)
  const orderStepRef = useRef(null);                      // onWebViewMessage barqaror bo'lishi uchun (orderStep ref orqali o'qiladi)
  const [mapReady, setMapReady] = useState(false);

  // Xarita tayyor bo'lgach va joylashuv/haydovchi/manzil o'zgarganda — markerlarni
  // qayta yuklamasdan inject orqali yangilaymiz (lag bo'lmaydi).
  useEffect(() => {
    if (mapReady) pushMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup, myLoc, dest, driverLoc, nearby, order, orderStep]);

  // F-02: ILOVA ICHIDA yo'nalish chizig'i (OSRM, bepul) — mijoz xaritasida ham.
  // accepted: HAYDOVCHIdan olib ketish nuqtasigacha; in_progress: manzilgacha (B).
  // Haydovchi ilovasidagi M-07 bilan bir xil rejim: 15s throttle (batareya/OSRM),
  // 8s timeout, 400 nuqta siyraklashtirish. OSRM xato bo'lsa — eski chiziq qoladi (jim).
  const [routeInfo, setRouteInfo] = useState(null); // { km, min } — chip uchun
  const routeFetchRef = useRef({ ts: 0, key: '' });
  useEffect(() => {
    let start = null, target = null;
    if (order && order.status === 'accepted') {
      // Haydovchi yo'lda: haydovchi joylashuvidan olib ketish nuqtasigacha
      start = driverLoc;
      target = pickup || (order.from_lat != null ? { lat: order.from_lat, lng: order.from_lng } : null);
    } else if (order && order.status === 'in_progress') {
      // Safar: joriy nuqtadan (haydovchi ≈ mijoz mashinada) manzilgacha
      start = driverLoc || pickup || (order.from_lat != null ? { lat: order.from_lat, lng: order.from_lng } : null);
      target = dest || (order.to_lat != null ? { lat: order.to_lat, lng: order.to_lng } : null);
    }
    if (!start || !target || !mapReady || !webviewRef.current) {
      // Faol yo'nalish bosqichi tugadi (arrived/completed/bekor) — chiziqni tozalaymiz
      if ((!order || !['accepted', 'in_progress'].includes(order.status)) && webviewRef.current && routeFetchRef.current.key) {
        routeFetchRef.current = { ts: 0, key: '' };
        webviewRef.current.injectJavaScript('window.clearRoute&&window.clearRoute();true;');
        setRouteInfo(null);
      }
      return;
    }
    const key = `${order.id}:${order.status === 'in_progress' ? 'dest' : 'pick'}`;
    const now = Date.now();
    // Throttle: nishon o'zgarmagan bo'lsa 15s dan tez-tez so'ramaymiz
    if (routeFetchRef.current.key === key && now - routeFetchRef.current.ts < 15000) return;
    routeFetchRef.current = { ts: now, key };
    (async () => {
      try {
        // X3: ommaviy OSRM (router.project-osrm.org) O'RNIGA backend /api/orders/route —
        // keshli, ishonchli, OSRM o'chsa to'g'ri chiziq zaxirasi bilan (chiziq hech
        // qachon "qotib" qolmaydi). Javob: {km,min,geometry:[[lat,lng]..]}.
        const r = await api('/api/orders/route', 'POST',
          { from: { lat: start.lat, lng: start.lng }, to: { lat: target.lat, lng: target.lng } },
          tokenRef.current || token, 9000, { retries: 1 });
        let pts = Array.isArray(r?.geometry) ? r.geometry : null;
        if (!pts || !pts.length) return;
        if (pts.length > 400) {
          const step = Math.ceil(pts.length / 400);
          pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
        }
        if (webviewRef.current) {
          webviewRef.current.injectJavaScript(`window.drawRoute&&window.drawRoute(${JSON.stringify(pts)});true;`);
        }
        if (r.km != null) setRouteInfo({ km: +Number(r.km).toFixed(1), min: Math.max(1, Math.round(Number(r.min) || 0)) });
      } catch (e) { /* marshrut vaqtincha xato — eski chiziq/chip qoladi */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, driverLoc, pickup, dest, order?.id, order?.status]);
  const tokenRef = useRef(null);
  const meIdRef = useRef(null); // chat echo guard — o'z sender_id'imni tanish uchun (stale closure)
  const nearbyTimer = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const lastOtaAtRef = useRef(0);       // OTA tekshiruvi debounce
  const otaActiveOrderRef = useRef(false); // faol buyurtma bormi (OTA reload'ni to'sish uchun)

  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { meIdRef.current = user?.id ?? null; }, [user]); // chat echo guard uchun sinxron

  // ---- Boot ----
  useEffect(() => {
    (async () => {
      // OTA yangilanish: faqat standalone APK da ishlaydi, Expo Go da o'tkazib yuboriladi

      // R1B: saqlangan UI tilini tiklaymiz — birinchi renderdan to'g'ri til ko'rinadi
      try {
        const lg = await AsyncStorage.getItem('app_lang');
        if (lg === 'ru' || lg === 'uz') { LANG = lg; setLangState(lg); }
      } catch (e) {}
      try {
        const t = await AsyncStorage.getItem('token');
        const u = await AsyncStorage.getItem('user');
        const p = await AsyncStorage.getItem('pin');
        const hp = await AsyncStorage.getItem('home_place');
        const wp = await AsyncStorage.getItem('work_place');
        if (t && u) {
          // T-06: parol/PIN so'ralmaydi — saqlangan token bilan AVTOMATIK kiramiz.
          // Token "rolling": har ochilganда jimgina yangilanadi (muddati uzayadi),
          // shuning uchun faol foydalanuvchi hech qachon qayta SMS/parol kiritmaydi.
          setToken(t); setUser(JSON.parse(u));
          refreshToken(t);
          // Crash recovery: oxirgi faol buyurtmani lokaldan DARHOL ko'rsatamiz
          // (internet kelguncha bo'sh ekran chiqmaydi). Keyin server bilan sinxron.
          try {
            const ao = await AsyncStorage.getItem(ACTIVE_ORDER_KEY);
            if (ao) { const o = JSON.parse(ao); if (o && ACTIVE_STATUSES.includes(o.status)) { setOrder(o); setOrderStep(null); } }
          } catch (e) {}
        }
        if (hp) setHomePlace(JSON.parse(hp));
        if (wp) setWorkPlace(JSON.parse(wp));
        // G2: keshdagi oxirgi joylashuv — xarita GPS fix kutmasdan darrov ochiladi
        // (haydovchi ilovasida bu allaqachon bor edi, mijozda yo'q edi)
        try {
          const ll = await AsyncStorage.getItem(LAST_LOC_KEY);
          if (ll) { const p = JSON.parse(ll); if (p && p.lat && p.lng) setMyLoc((cur) => cur || p); }
        } catch (e) {}
      } catch (e) {}
      setBooting(false);
    })();
  }, []);

  // ---- Kirgandan so'ng ----
  useEffect(() => {
    if (!token || pinStep) return;
    (async () => {
      // G1: AVVAL server sinxron — socket va faol buyurtma GPS'ni KUTMAYDI.
      // Ilgari connectSocket/resumeActiveOrder quyida, getCurrentPositionAsync'dan
      // KEYIN turardi: sovuq GPS (bino ichi, zaif signal) daqiqalab osilganda
      // ilova qayta ochilgan mijoz faol buyurtmasini ko'rmay qolardi (#order-invisible).
      connectSocket();
      resumeActiveOrder();
      loadPayMethods();
      loadCarImages();
      loadExtrasPricing(); // W1: A/C va bagaj chip narxlari
      loadRecentPlaces();
      loadFavorites();
      loadPopularPlaces();
      startPinHalo();
      // Push token — ilova yopiq/fon holatida ham "Haydovchi topildi/yetib keldi" kelishi uchun (#push-missing).
      // M-05: muvaffaqiyatni kuzatamiz — token olinmasa (permission keyin berildi /
      // tarmoq xatosi) foreground'da QAYTA uriniladi (quyidagi onAppState'da).
      if (!pushRegisteredRef.current) {
        registerPushToken(token).then((t) => { pushRegisteredRef.current = !!t; });
      }
      try { await Notifications.requestPermissionsAsync(); } catch (e) {}
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // G2: tez joylashuv — Yandex/Uber qolipida ikki bosqich:
        //   1) keshdagi oxirgi ma'lum joylashuv (bir zumda, xarita darrov ochiladi)
        //   2) yangi aniq fix — timeout bilan (GPS osilsa ham ilova qotmaydi)
        try {
          const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
          if (last) setMyLoc((cur) => cur || { lat: last.coords.latitude, lng: last.coords.longitude });
        } catch (e) {}
        let pos = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          10000
        ).catch(() => null);
        // Yangi/qishloq hududda GPS "sovuq" bo'lsa (kesh yo'q), Balanced 10s'da fix
        // bermasligi mumkin → "joylashuv aniqlanmadi". Aniqroq (High) rejim + uzunroq
        // timeout bilan qayta urinamiz — Termiz/Denov/Qumqo'rg'on kabi yangi hududlarda
        // ham joylashuv aniqlanadi.
        if (!pos) {
          pos = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            20000
          ).catch(() => null);
        }
        if (pos) {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setMyLoc({ lat, lng });
          AsyncStorage.setItem(LAST_LOC_KEY, JSON.stringify({ lat, lng })).catch(() => {});
          // Pickup DARHOL o'rnatiladi (koordinata matni bilan) — manzil nomi
          // reverse geocode'dan kelganda jimgina almashtiriladi, oqim bloklanmaydi.
          setPickup({ lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
          reverseGeocode(lat, lng).then((addr) => {
            setPickup((p) => (p && p.lat === lat && p.lng === lng) ? { ...p, address: addr } : p);
          });
        }
      }
    })();
    // Push bosilib ilova ochilganda holatni serverdan tiklaymiz.
    const respSub = Notifications.addNotificationResponseReceivedListener(() => {
      try { ensureSocketConnected(); resumeActiveOrder(); } catch (e) {}
    });
    return () => {
      try { respSub.remove(); } catch (e) {}
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

  // Faol buyurtma holatini ref'ga sinxronlaymiz (OTA reload'ni safar o'rtasida to'sish uchun).
  useEffect(() => {
    const st = order?.status;
    otaActiveOrderRef.current = !!st && ['searching', 'assigned', 'accepted', 'arrived', 'in_progress'].includes(st);
  }, [order?.status]);

  // ---- OTA: fon'dan qaytganda yangilanishni tekshirib DARROV qo'llaymiz ----
  // ON_LOAD tekshiruvi faqat sovuq startда ishlaydi; sekin internetда 3s'da ulgurmasa
  // yangilanish keyingi ochilishga qolib "OTA ishlamayapti" taassuroti berardi. Endi
  // har fon-qaytishда (debounce 60s) tekshiramiz; yangilanish bo'lsa yuklab, FAOL
  // BUYURTMA bo'lmaganда reload qilamiz (safar/qidiruv o'rtasida buzmaydi).
  async function maybeApplyOTA() {
    if (__DEV__ || !Updates.isEnabled) return;
    const now = Date.now();
    if (now - lastOtaAtRef.current < 60000) return;
    lastOtaAtRef.current = now;
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res && res.isAvailable) {
        await Updates.fetchUpdateAsync();
        if (!otaActiveOrderRef.current) await Updates.reloadAsync();
      }
    } catch (e) { /* Expo Go yoki tarmoq — jim */ }
  }

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
        maybeApplyOTA(); // OTA: fon'dan qaytganda yangilanishni tekshir/qo'lla (faol buyurtmasiz)
        // M-05: push token hali ro'yxatdan o'tmagan bo'lsa (permission endi berilgan
        // bo'lishi mumkin) — qayta urinamiz. Muvaffaqiyatda bayroq o'rnatiladi.
        if (!pushRegisteredRef.current && tokenRef.current) {
          registerPushToken(tokenRef.current).then((t) => { pushRegisteredRef.current = !!t; });
        }
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
  // F-03: in_progress ham ro'yxatda — avval safar boshlangach poll to'xtar edi,
  // socket uzilsa taksometr/haydovchi markeri safar oxirigacha qotib qolardi.
  useEffect(() => {
    const st = order?.status;
    const oid = order?.id;
    if (!oid || !['searching', 'assigned', 'accepted', 'arrived', 'in_progress'].includes(st)) return;
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
          const nm = fresh.driver_name || t('driver_def');
          const car = fresh.driver_car ? ` · ${fresh.driver_car}${fresh.driver_plate ? ' ' + fresh.driver_plate : ''}` : '';
          notify(t('driver_found'), `${nm}${car} ${t('on_way_sfx')}`);
        }
        // T-16: markaziy mashina orqali — eskirgan poll javobi holatni ORQAGA qaytarmasin
        applyServerOrder(fresh);
        seedDriverLocFromOrder(fresh); // M-05: socket jim bo'lsa marker/ETA poll'dan
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

  // W1: qo'shimcha xizmat narxlari — chip yorlig'ida "+X so'm" ko'rsatish uchun
  // (backend /api/config/pricing: extra_ac, extra_baggage). Xato bo'lsa zaxira qoladi.
  async function loadExtrasPricing() {
    try {
      const r = await api('/api/config/pricing', 'GET');
      if (r && (r.extra_ac != null || r.extra_baggage != null)) {
        setExtrasCfg({ ac: Number(r.extra_ac) || 2000, baggage: Number(r.extra_baggage) || 3000 });
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
    try {
      const r = await api('/api/me/favorites', 'GET', null, tokenRef.current || token);
      const favs = r.favorites || [];
      setFavorites(favs);
      // Q2: YANGI QURILMADA Uy/Ish tiklanadi — serverdagi 'Uy'/'Ish' nomli
      // sevimlilardan (avval faqat AsyncStorage edi: telefon almashsa yo'qolardi).
      const hydrate = (nm, cur, setter, key) => {
        if (cur) return;
        const f = favs.find((x) => x.name === nm);
        if (f && f.lat != null) {
          const place = { lat: f.lat, lng: f.lng, address: f.address || nm };
          setter(place);
          AsyncStorage.setItem(key, JSON.stringify(place)).catch(() => {});
        }
      };
      hydrate('Uy', homePlace, setHomePlace, 'home_place');
      hydrate('Ish', workPlace, setWorkPlace, 'work_place');
    } catch (e) {}
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
        <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '600' }}>~{fmt(e.price)} {t('som')}</Text>
        <Text style={{ color: GRAY1, fontSize: 11, marginTop: 2 }}>{e.duration_min} {t('min_short')}</Text>
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
    try { await api('/api/me/favorites', 'POST', { name: place.address, address: place.address, lat: place.lat, lng: place.lng }, token); loadFavorites(); toast(t('saved_ok'), 'success'); } catch (e) { toast(e.message || t('error'), 'error'); }
  }

  async function removeFavorite(id) {
    try { await api(`/api/me/favorites/${id}`, 'DELETE', null, token); loadFavorites(); } catch (e) {}
  }

  // Y1: sevimlilar sheet'idan yangi manzil — so'nggi manzillardan tanlanadi va
  // foydalanuvchi bergan nom bilan serverga (POST /api/me/favorites) saqlanadi.
  async function saveFavoriteNamed() {
    const p = favPickPlace; const nm = favNewName.trim();
    if (!p || !nm) return;
    try {
      await api('/api/me/favorites', 'POST', { name: nm, address: p.address, lat: p.lat, lng: p.lng }, token);
      setFavAddMode(false); setFavPickPlace(null); setFavNewName('');
      loadFavorites();
    } catch (e) { toast(e.message || t('error'), 'error'); }
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
    s.on('reconnect', () => { NetMonitor.set(true); resumeActiveOrder(); flushChatOutbox(); });
    s.on('connect', () => { NetMonitor.set(true); resumeActiveOrder(); flushChatOutbox(); });
    s.on('order_update', (o) => {
      // Yakunlangan/bekor bo'lgan buyurtma id'siga kechikib kelgan event uni
      // qayta tiriltirmasin (#order-resurrect): reset'dan keyin order=null bo'ladi,
      // shu id uchun kechikkan 'completed' kelsa rate modal takror ochilardi.
      if (o && o.id && finishedOrderIdRef.current === o.id) return;
      // T-16: holat MARKAZIY mashinadan o'tadi (regress/resurrect/race himoyasi bir joyda)
      applyServerOrder(o);
      seedDriverLocFromOrder(o); // M-05: haydovchi markeri/ETA payload'dan ham tiklanadi
      if (o.status === 'accepted') {
        arrivedNotified.current = false;
        const nm = o.driver_name || t('driver_def');
        const car = o.driver_car ? ` · ${o.driver_car}${o.driver_plate ? ' ' + o.driver_plate : ''}` : '';
        notify(t('driver_found'), `${nm}${car} ${t('on_way_sfx')}`);
      }
      if (o.status === 'arrived' && !arrivedNotified.current) {
        arrivedNotified.current = true;
        notify(t('driver_arrived_t'), t('car_waiting'));
        playAdminSoundUrl(adminSoundUrl('driver_arrived')); // T-19: admin ovozi (mijoz)
      }
      // T-19: safar boshlandi — admin ovozi (bir buyurtma uchun bir marta)
      if (o.status === 'in_progress' && tripStartedSoundRef.current !== o.id) {
        tripStartedSoundRef.current = o.id;
        playAdminSoundUrl(adminSoundUrl('trip_started'));
      }
      if (o.status === 'completed') {
        finishedOrderIdRef.current = o.id; // kechikkan event uni tiriltirmasin (#order-resurrect)
        notify(t('trip_done_t'), t('rate_driver_sub'));
        playAdminSoundUrl(adminSoundUrl('trip_completed')); // T-19: admin ovozi (mijoz)
        setCompletedOrder(o);          // hisob-kitob ko'rsatish uchun saqlayмиз
        setRateOrderId(o.id); setStars(0); setTipAmount(0); setRateModal(true); // D4: tanlanmagan holatdan
        resetOrder();
      }
      if (o.status === 'cancelled') {
        finishedOrderIdRef.current = o.id; // kechikkan event uni tiriltirmasin (#order-resurrect)
        notify(t('order_cancelled_t'), '');
        playAdminSoundUrl(adminSoundUrl('order_cancelled')); // T-19: admin ovozi (mijoz)
        resetOrder();
      }
    });
    s.on('driver_location', (loc) => {
      driverLocSockTsRef.current = Date.now(); // M-05: socket jonli — poll seed'i chetlanadi
      // Bir xil koordinata kelsa re-render qilmaymiz (xarita ham o'zgarmaydi)
      setDriverLoc((prev) => (prev && loc && prev.lat === loc.lat && prev.lng === loc.lng) ? prev : loc);
      setOrder((prev) => {
        if (prev && prev.status === 'accepted' && !arrivedNotified.current && loc.lat && loc.lng && prev.from_lat) {
          const d = distKm(loc.lat, loc.lng, prev.from_lat, prev.from_lng);
          if (d < 0.15) {
            arrivedNotified.current = true;
            notify(t('driver_near'), t('driver_near_sub'));
          }
        }
        return prev;
      });
    });
    s.on('chat_message', (msg) => {
      // A2/echo-fix: server xabarni IKKALA xonaga (customer:{id}+driver:{id}) yuboradi.
      // O'z xabarim qaytib takrorlanmasin. Ilgari faqat sender_role bo'yicha
      // tekshirilardi — lekin bitta akkaunt (masalan roli 'driver') mijoz ilovasida
      // ishlatilsa rol ilovaga mos kelmay, o'z xabari qaytib ko'rinardi. Endi ASOSIY
      // mezon — sender_id: o'zimning ID'im bo'lsa e'tiborsiz qoldiramiz (rol — zaxira).
      if (meIdRef.current != null && msg?.sender_id === meIdRef.current) return;
      if (msg?.sender_role === 'customer') return;
      // Server sender_role beradi, ilova role ishlatadi — moslaymiz
      setTripChat((prev) => [...prev, { role: msg.sender_role || 'driver', text: msg.text }]);
      // A2: tripChatModal o'rniga tripChatModalRef — handler stale closure'da
      // tripChatModal doim false edi (modal ochiq bo'lsa ham notify chiqardi)
      if (!tripChatModalRef.current) {
        setTripChatUnread((c) => c + 1); // badge: sariq doira ichida son
        notify(t('driver_msg_t'), msg.text || '');
      }
    });
    // Jonli kutish haqi (arrived) — backend har 5 sekunda yuboradi.
    // P3 (K-1): freeSec/perMin ham serverdan olinadi — admin tarifni o'zgartirsa
    // ekran darhol mos bo'ladi (lokal 120/500 endi faqat zaxira).
    s.on('wait_update', (d) => {
      setLiveWait({
        sec: d.waitSec || 0, fee: d.waitFee || 0, freeLeft: d.freeLeft || 0,
        freeSec: d.freeSec || 0, perMin: d.perMin || 0,
      });
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

  // Haydovchiga socket orqali chat xabari yuborish. Socket uzilgan bo'lsa xabar
  // yo'qolmasin — outbox'ga saqlaymiz va qayta ulanganda yuboramiz (#chat-loss).
  // X4: preset — tez javob chipidan kelgan matn (string). onPress event obyekti
  // yuboradi — u string emas, shuning uchun tripChatInput ishlatiladi.
  // Emit/outbox/pending mantig'i o'zgarmagan.
  function sendTripChat(preset) {
    const text = ((typeof preset === 'string' ? preset : tripChatInput) || '').trim();
    if (!text || !order) return;
    const payload = { orderId: order.id, text };
    // A2: holat belgisi — darhol ketdi (✓) yoki outbox'da kutyapti (⏳)
    let sentNow = false;
    if (socketRef.current?.connected) {
      try { socketRef.current.emit('chat', payload); sentNow = true; } catch (e) { chatOutboxRef.current.push(payload); }
    } else {
      chatOutboxRef.current.push(payload);
    }
    setTripChat((prev) => [...prev, { role: 'customer', text, pending: !sentNow }]);
    // Chip yuborilganda foydalanuvchi yozayotgan matnni o'chirmaymiz.
    if (typeof preset !== 'string') setTripChatInput('');
  }

  // A2: buyurtma chat tarixi (GET /api/orders/:id/messages) — chat ochilganda
  // yuklanadi, shunda ilova qayta ochilsa ham eski xabarlar ko'rinadi.
  // Server sender_role qaytaradi, ilova role ishlatadi — moslab olamiz.
  async function loadTripChatHistory(orderId) {
    try {
      const r = await api(`/api/orders/${orderId}/messages`, 'GET', null, tokenRef.current || token);
      if (r?.messages) setTripChat(r.messages.map((m) => ({ role: m.sender_role, text: m.text })));
    } catch (e) { /* tarmoq xatosi — mavjud lokal ro'yxat qoladi */ }
  }

  // Qayta ulanganda yuborilmagan chat xabarlarni jo'natamiz.
  function flushChatOutbox() {
    const s = socketRef.current;
    if (!s?.connected || chatOutboxRef.current.length === 0) return;
    const pending = chatOutboxRef.current;
    chatOutboxRef.current = [];
    for (const p of pending) {
      try { s.emit('chat', p); } catch (e) { chatOutboxRef.current.push(p); }
    }
  }

  // Sayohatni ulashish
  async function shareTrip() {
    if (!order?.share_token) { toast(t('share_fail_sub'), 'error'); return; }
    // D2: endi inson o'qiydigan jonli sahifa (backend /share/:token, PR #130) —
    // avval xom JSON API havolasi ketardi, qabul qiluvchi matn ko'rardi.
    const url = `${BASE}/share/${order.share_token}`;
    const msg = `${t('share_trip_pre')}${url}`;
    try {
      await Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(msg)}`);
    } catch (_) {
      showConfirm({ title: t('link_lbl'), message: url, confirmText: t('copy_lbl'), onConfirm: () => Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(url)}`) });
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

  // T-16: MARKAZIY HOLAT MASHINASI — serverdan kelgan buyurtmani XAVFSIZ qo'llash.
  // Barcha manbalar (socket order_update, resume/poll REST, 409 fallback) SHU yerdan
  // o'tadi, shunda qoidalar bitta joyda:
  //   1) Yakunlangan buyurtma qayta tirilmaydi (#order-resurrect, finishedOrderIdRef).
  //   2) Holat ORQAGA sakramaydi (#status-regress, isForwardUpdate: rank + terminal).
  //      Eskirgan javob kelsa — faqat status'siz maydonlar (haydovchi ma'lumoti,
  //      narx) yangilanadi, holat joyida qoladi.
  //   3) Har qo'llash vaqti belgilanadi (orderTouchedAtRef) — eski "bo'sh" javob
  //      yangi yaratilgan buyurtmani o'chirib yubormasin (race guard).
  function applyServerOrder(o) {
    if (!o || !o.id) return;
    if (finishedOrderIdRef.current === o.id) return; // yakunlangan — qayta tirilmaydi
    orderTouchedAtRef.current = Date.now();
    setOrder((prev) => {
      if (!prev || prev.id !== o.id) return o;
      if (!isForwardUpdate(prev, o)) { const { status, ...rest } = o; return { ...prev, ...rest }; }
      return { ...prev, ...o };
    });
  }

  // Faol buyurtmani serverdan tiklash — server YAGONA haqiqat manbai.
  // Ilova ochilganda, socket connect/reconnect, internet/foreground qaytganda chaqiriladi.
  // Tarmoq xatosida lokal holat saqlanadi (tozalanmaydi).
  // T-16: parallel chaqiruvlar dedup (resumeBusyRef) + "bo'sh" javob faqat so'rov
  // boshlanganidan beri buyurtma O'ZGARMAGAN bo'lsagina tozalaydi (race guard) +
  // natija markaziy holat mashinasidan o'tadi (regress/resurrect himoyasi).
  async function resumeActiveOrder() {
    if (resumeBusyRef.current) return; // mount/connect/foreground bir vaqtda — bitta so'rov yetadi
    resumeBusyRef.current = true;
    const startedAt = Date.now();
    try {
      const r = await api('/api/me/active-order', 'GET', null, tokenRef.current || token);
      if (r?.order) {
        applyServerOrder(r.order);
        seedDriverLocFromOrder(r.order); // M-05: resume'da ham marker/ETA darrov
        setOrderStep(null);
      } else if (r && orderTouchedAtRef.current <= startedAt) {
        // Server: faol buyurtma yo'q → lokaldagi eskirgan buyurtmani tozalaymiz.
        // LEKIN so'rov ketayotganda yangi buyurtma yaratilgan bo'lsa (touched > startedAt)
        // — bu javob ESKI, yangi buyurtmaga TEGMAYMIZ (#order-disappear race).
        setOrder((prev) => (prev && ACTIVE_STATUSES.includes(prev.status)) ? null : prev);
        setOrderStep((s) => (s === null ? 'dest' : s));
      }
    } catch (e) {
      // Tarmoq xatosi — lokal (saqlangan) holatni saqlab qolamiz
    } finally {
      resumeBusyRef.current = false;
    }
  }

  // Faol buyurtma ekranini ochish. Avval 409 javobidagi active_order'dan,
  // bo'lmasa GET /api/orders/active dan olamiz. Ochilsa true qaytaradi.
  async function openActiveOrder(errOr409) {
    // T-16: barcha yo'llar markaziy mashinadan (regress/resurrect himoyasi)
    const fromErr = errOr409?.data?.active_order;
    if (fromErr) { applyServerOrder(fromErr); setOrderStep(null); return true; }
    try {
      const r = await api('/api/orders/active', 'GET', null, tokenRef.current || token);
      if (r?.order) { applyServerOrder(r.order); setOrderStep(null); return true; }
    } catch (_) {}
    // Eski endpoint — zaxira
    try {
      const r2 = await api('/api/me/active-order', 'GET', null, tokenRef.current || token);
      if (r2?.order) { applyServerOrder(r2.order); setOrderStep(null); return true; }
    } catch (_) {}
    return false;
  }

  async function notify(title, body) {
    // F-03: Android'da 'order-status' kanali (HIGH + ovoz + tebranish) — kanalsiz
    // lokal bildirishnoma default (past) kanalga tushib, jim/kechikib ko'rinardi.
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: 'default' },
        trigger: Platform.OS === 'android' ? { channelId: 'order-status' } : null,
      });
    } catch (e) {}
  }

  function resetOrder() {
    setOrder(null); setDest(null); setEstimates({}); estCacheKey.current = null;
    setNeedAc(false); setNeedBaggage(false); // W1: keyingi buyurtma toza boshlansin
    setDriverLoc(null); setOrderStep('dest'); setSearchQ(''); setSearchResults([]); setSearchOpen(false);
    // A2: eski safar chati keyingi buyurtmaga o'tib qolmasin — chat va badge tozalanadi
    setTripChat([]); setTripChatUnread(0); setTripChatModal(false);
  }

  // ---- Xarita hodisalari ----
  // Xaritaga joriy ma'lumotni yuborish (qayta yuklamasdan).
  // FREEZE tuzatish: har poll/socket'da (5s) bir XIL ma'lumat qayta yuborilib,
  // injectJavaScript "floodi" JS-thread'ni bezovta qilardi. Endi oxirgi yuborilgan
  // JSON bilan solishtiramiz — o'zgarmagan bo'lsa qayta yubormaymiz (hech qanday
  // real yangilanish yo'qolmaydi, faqat ortiqcha bir xil push'lar to'xtaydi).
  const lastMapJsonRef = useRef('');
  function pushMap() {
    if (!webviewRef.current) return;
    const json = JSON.stringify(mapDataRef.current);
    if (json === lastMapJsonRef.current) return;
    lastMapJsonRef.current = json;
    webviewRef.current.injectJavaScript(`window.updateMap(${json});true;`);
  }

  // Google Maps'ni yoqish: kalitni backenddan olamiz (/api/loc/mapkey → google) va
  // WebView'ga bir marta uzatamiz. Kalit bo'lsa Google'ga o'tadi; bo'lmasa/xato bo'lsa
  // OpenStreetMap zaxirasida qoladi. Kalit KODDA yozilmaydi (ENV → backend).
  const googleMapReqRef = useRef(false);
  async function enableGoogleMap() {
    if (googleMapReqRef.current || !webviewRef.current) return;
    googleMapReqRef.current = true;
    try {
      const r = await api('/api/loc/mapkey', 'GET', null, tokenRef.current || token, 8000, { retries: 1 });
      const gk = r && r.google ? String(r.google) : '';
      if (gk && webviewRef.current) {
        webviewRef.current.injectJavaScript(`window.__useGoogle(${JSON.stringify(gk)});true;`);
      } else if (webviewRef.current) {
        // Kalit BO'SH keldi — sababni xaritada ko'rsatamiz (backend/ENV muammosi)
        const d = 'KALIT KELMADI — backend /api/loc/mapkey google maydoni bosh (Render ENV GOOGLE_MAPS_API_KEY tekshiring yoki backend redeploy qiling)';
        webviewRef.current.injectJavaScript(`window.__setDbg&&window.__setDbg(${JSON.stringify(d)});true;`);
        console.warn('[GoogleMaps] mapkey google bo\'sh:', JSON.stringify(r));
        try { captureException(new Error('GoogleMaps: mapkey google empty'), { kind: 'gmap' }); } catch (_) {}
      }
    } catch (e) {
      try { webviewRef.current && webviewRef.current.injectJavaScript(`window.__setDbg&&window.__setDbg(${JSON.stringify('mapkey so\'rovi xato: ' + String((e && e.message) || e).slice(0, 80))});true;`); } catch (_) {}
    }
  }

  // Barqaror handler (useCallback []) — ClientMap memoizatsiyasi buzilmasligi uchun.
  // Joriy orderStep ni orderStepRef orqali o'qiymiz; pushMap faqat ref'lardan
  // foydalanadi, shuning uchun birinchi render closure'i ham har doim to'g'ri ishlaydi.
  const onWebViewMessage = useCallback(async (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'mapReady') { setMapReady(true); pushMap(); enableGoogleMap(); return; }
      if (msg.type === 'gmapError') { console.warn('[GoogleMaps]', msg.msg); try { captureException(new Error('GoogleMaps: ' + msg.msg), { kind: 'gmap' }); } catch (_) {} return; }
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
      // P1: yangi manzil narxi ham yo'l masofasi bo'yicha (boshlanish — buyurtmadagi from)
      const fromPt = order.from_lat != null ? { lat: order.from_lat, lng: order.from_lng } : (pickup || myLoc);
      const roadKm = fromPt ? await fetchRoadKm(fromPt, { lat: place.lat, lng: place.lng }) : null;
      const r = await api(`/api/orders/${order.id}/destination`, 'POST', {
        to_lat: place.lat, to_lng: place.lng,
        to_address: place.address || place.name,
        ...(roadKm ? { road_km: roadKm } : {}),
      }, token);
      if (r.order) {
        setOrder(r.order);
        setDest({ lat: place.lat, lng: place.lng, address: place.address || place.name });
      }
      setChangeDestModal(false); setCdQ(''); setCdResults([]);
      toast(r.recalculated
        ? `${t('new_price')} ${fmt(r.order?.price || 0)} ${t('som')}`
        : t('dest_updated'), 'success');
    } catch (e) { toast(e.message || t('error'), 'error'); }
    setLoading(false);
  }

  // ---- Uy/Ish saqlash ----
  async function saveHomeWork(type, place) {
    const key = type === 'home' ? 'home_place' : 'work_place';
    await AsyncStorage.setItem(key, JSON.stringify(place));
    if (type === 'home') setHomePlace(place);
    else setWorkPlace(place);
    // Q2: serverga ham (favorites, nomi 'Uy'/'Ish') — telefon almashsa/qayta
    // o'rnatilsa yo'qolmasin. Eski yozuv o'chirilib yangisi qo'yiladi.
    // Server xatosi lokal saqlashga xalaqit bermaydi (jim).
    const nm = type === 'home' ? 'Uy' : 'Ish';
    try {
      const old = favorites.find((f) => f.name === nm);
      if (old) await api(`/api/me/favorites/${old.id}`, 'DELETE', null, token);
      await api('/api/me/favorites', 'POST', { name: nm, address: place.address || nm, lat: place.lat, lng: place.lng }, token);
      loadFavorites();
    } catch (_) {}
    toast(type === 'home' ? t('home_saved') : t('work_saved'), 'success');
  }

  // ---- P1 (A-1): HAQIQIY YO'L masofasi — narx to'g'ri chiziq bo'yicha emas ----
  // Kanal/daryo ortidagi manzilga to'g'ri chiziq 3 km, real yo'l 8 km bo'lishi mumkin.
  // OSRM'dan (F-02 dagi kabi, bepul) from→dest yo'l km olamiz va estimate/buyurtmaga
  // road_km sifatida yuboramiz — backend allaqachon qabul qiladi va 0.95x..3x oraliqda
  // himoyalaydi (pricing.js). OSRM javob bermasa — null: server o'zi to'g'ri chiziqqa
  // tushadi, hech narsa buzilmaydi. Natija keshlanadi (bitta from→dest = bitta so'rov).
  const roadKmCacheRef = useRef({ key: '', km: null });
  async function fetchRoadKm(from, to) {
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    if (roadKmCacheRef.current.key === key) return roadKmCacheRef.current.km;
    let km = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      const j = await res.json();
      const d = j?.routes?.[0]?.distance;
      if (typeof d === 'number' && d > 0) km = +(d / 1000).toFixed(2);
    } catch (_) { /* OSRM vaqtincha yo'q — to'g'ri chiziq zaxirasi ishlaydi */ }
    roadKmCacheRef.current = { key, km };
    return km;
  }

  // ---- Narx: har bir tarif uchun parallel + kesh ----
  async function fetchAllEstimates() {
    const from = pickup || myLoc;
    if (!from || !dest) return;
    const promoUse = promoCode.trim().toUpperCase();
    // W1: needAc/needBaggage ham kalitga kiradi — chip almashtirilganda eski
    // (extras'siz) narx keshdan ko'rinib qolmasin (promo bilan bir xil qolip).
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}>${promoUse}>${needAc ? 1 : 0}${needBaggage ? 1 : 0}`;
    if (estCacheKey.current === key && Object.keys(estimates).length) return;
    estCacheKey.current = key;
    setEstLoading(true);
    try {
      // P1: avval yo'l masofasi (keshdan bo'lsa bir zumda), keyin 4 tarif paralel
      const roadKm = await fetchRoadKm(from, dest);
      const results = await Promise.all(
        CAR_CLASSES.map((c) =>
          api('/api/orders/estimate', 'POST', { from, to: dest, car_class: c.id, need_ac: needAc, need_baggage: needBaggage, ...(roadKm ? { road_km: roadKm } : {}), ...(promoUse ? { promo_code: promoUse } : {}) }, token)
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
  }, [orderStep, dest, pickup, myLoc, needAc, needBaggage]); // W1: extras chip almashsa narx qayta yuklanadi

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
      // P1: buyurtma narxi ham estimate bilan BIR XIL yo'l masofasida hisoblansin
      // (tarif ekranida keshlangan — bu yerda odatda bir zumda qaytadi)
      const roadKm = await fetchRoadKm(from, dest);
      const r = await api('/api/orders', 'POST', {
        from, to: dest, car_class: carClass, payment_method: payMethod,
        need_ac: needAc, need_baggage: needBaggage, // W1: pullik xizmatlar (backend #134)
        ...(roadKm ? { road_km: roadKm } : {}),
        ...(promoCode.trim() ? { promo_code: promoCode.trim().toUpperCase() } : {}), // Q3
        ...(schedAt ? { scheduled_at: schedAt.toISOString() } : {}), // C1
        ...(useBonus ? { use_bonus: true } : {}), // Y1: bonus balansdan (narxning 50% gacha, backend hisoblaydi)
      }, token, 15000, { idempotencyKey: uuid(), retries: 2 });
      setSchedAt(null); // C1: keyingi buyurtma yana 'hozir' bo'lib boshlansin
      if (useBonus) { setUseBonus(false); loadBalance(); } // Y1: bonus BIR safarga ishlatiladi — keyin o'chadi
      const o = r.order || r;
      // T-16: yaratish vaqtini belgilaymiz — parallel ketayotgan eski "faol buyurtma
      // yo'q" javobi bu YANGI buyurtmani o'chirib yubormasin (#order-disappear race)
      orderTouchedAtRef.current = Date.now();
      finishedOrderIdRef.current = null; // yangi buyurtma — eski yakun belgisi tozalanadi
      setOrder(o);
      setOrderStep(null);
      notify(t('order_placed'), t('searching_sub'));
      if (payMethod !== 'cash') openPayment(o.id, payMethod);
    } catch (e) {
      // "Sizda faol buyurtma bor" (409) -> yangi buyurtma o'rniga faolini ochamiz
      if (e?.status === 409) {
        const opened = await openActiveOrder(e);
        if (opened) notify(t('active_order_t'), t('active_order_opened'));
        else toast(e.message || t('active_order_exists'), 'error');
      } else {
        toast(e.message || t('error'), 'error');
      }
    }
    creatingOrderRef.current = false;
    setLoading(false);
  }

  // ---- 🎙 Ovozli buyurtma ----
  // Mijoz manzilni ovozda aytadi → hisoblagich (manzilsiz) buyurtma yaratiladi,
  // haydovchi ovozni eshitadi. Narx safar oxirida km+vaqt bo'yicha.
  function openVoiceOrder() {
    if (order) { toast(t('finish_current_first'), 'info'); return; }
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
      if (!perm.granted) { toast(t('mic_perm'), 'error'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordingRef.current = true;
      setRecording(true); setVoiceSec(0);
      voiceTimer.current = setInterval(() => setVoiceSec(v => {
        if (v >= 60) { stopVoiceRecording(); return v; } // 60s cheklov
        return v + 1;
      }), 1000);
    } catch (e) { toast(t('rec_fail') + e.message, 'error'); }
  }
  async function stopVoiceRecording() {
    if (voiceTimer.current) { clearInterval(voiceTimer.current); voiceTimer.current = null; }
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri || voiceSec < 1) { toast(t('speak_longer'), 'error'); return; }
      // Avval AI tahlil (nutq -> manzil avto-to'ldirish). Endpoint yo'q/xato bo'lsa
      // eski oqimga qaytamiz (haydovchi ovozni eshitadi) — nol regressiya.
      const handled = await parseVoiceAndFill(uri);
      if (!handled) await sendVoiceOrder(uri);
    } catch (e) { toast(e.message || t('error'), 'error'); }
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
    if (!from) { toast(t('pickup_not_found'), 'error'); return; }
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
      orderTouchedAtRef.current = Date.now(); // T-16: race guard (#order-disappear)
      finishedOrderIdRef.current = null;
      setOrder(o); setOrderStep(null); setVoiceModal(false); setVoiceSec(0);
      notify(t('voice_order_placed'), t('searching_sub'));
    } catch (e) {
      if (e?.status === 409) {
        setVoiceModal(false);
        const opened = await openActiveOrder(e);
        if (opened) notify(t('active_order_t'), t('active_order_opened'));
        else toast(e.message || t('active_order_exists'), 'error');
      } else {
        toast(e.message || t('error'), 'error');
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
        setVoiceClarify(p.clarification_question || t('which_dest_q'));
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
    } catch (e) { toast(t('pay_link_fail'), 'error'); }
  }

  // ---- Bekor qilish ----
  async function confirmCancel(reason) {
    setCancelModal(false);
    setLoading(true);
    try {
      const r = await api(`/api/orders/${order.id}/cancel`, 'POST', { reason }, token);
      if (r.cancel_fee > 0) showConfirm({ title: t('cancelled_t'), message: `${t('fine_lbl')} ${fmt(r.cancel_fee)} ${t('som')} ${t('driver_had_arrived')}`, confirmText: t('ready') });
      resetOrder();
    } catch (e) { toast(e.message || t('error'), 'error'); }
    setCustomReason('');
    setLoading(false);
  }

  // ---- Baholash + tip ----
  async function submitRating() {
    // D4: baho ONGLI tanlangan bo'lsin — yulduz bosilmagan bo'lsa yubormaymiz
    if (!stars) { toast(t('rate_first_msg'), 'error'); return; }
    setLoading(true);
    try {
      await api(`/api/me/rate/${rateOrderId}`, 'POST', { stars }, token);
      if (tipAmount > 0)
        await api(`/api/orders/${rateOrderId}/tip`, 'POST', { amount: tipAmount }, token).catch(() => {});
    } catch (e) {}
    setRateModal(false); setCompletedOrder(null); setLoading(false);
    // D3: mamnun mijoz (5 yulduz) — Play Market bahosini so'raymiz, BIR MARTA
    // (asos: har 5-yulduzda so'rayverish bezovta qiladi va Play qoidalariga zid).
    if (stars === 5) {
      try {
        const asked = await AsyncStorage.getItem('rate_nudge_done');
        if (!asked) {
          await AsyncStorage.setItem('rate_nudge_done', '1');
          showConfirm({
            title: t('thanks_t'),
            message: t('play_nudge'),
            confirmText: t('rate_star_btn'),
            cancelText: t('later_btn'),
            onConfirm: () => Linking.openURL('market://details?id=uz.ketdik.mijoz').catch(() => Linking.openURL('https://play.google.com/store/apps/details?id=uz.ketdik.mijoz')),
          });
        }
      } catch (_) {}
    }
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
    showConfirm({
      title: t('logout'),
      message: t('logout_confirm'),
      confirmText: t('logout'),
      cancelText: t('cancel_btn'),
      danger: true,
      onConfirm: doLogout,
    });
  }

  // T-06: token "rolling" yangilash. Ilova ochilganда saqlangan token bilan chaqiriladi;
  // yangi (muddati uzaytirilgan) token qaytadi va saqlanadi — faol foydalanuvchi hech
  // qachon qayta SMS kiritmaydi. Faqat token HAQIQATAN yaroqsiz/muddati o'tган bo'lsa
  // (401) chiqamiz (qayta SMS). Tarmoq xatosida — saqlangan tokenni saqlab qolamiz (oflayn).
  async function refreshToken(existing) {
    try {
      const r = await api('/api/auth/refresh', 'POST', null, existing);
      if (r?.token) {
        await AsyncStorage.setItem('token', r.token);
        if (r.user) await AsyncStorage.setItem('user', JSON.stringify(r.user));
        setToken(r.token); if (r.user) setUser(r.user);
      }
    } catch (e) {
      if (e?.status === 401) { try { await doLogout(); } catch (_) {} }
    }
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
      toast(`${fmt(r.claimed)} ${t('som')} ${t('added_to_balance')}`, 'success');
      loadBalance();
    } catch (e) { toast(e.message || t('error'), 'error'); }
  }
  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return; // T-20: parallel yuborish holatni buzmasin
    const next = [...chat, { role: 'user', text }];
    setChat(next); setChatInput(''); setChatLoading(true);
    try {
      // Tejamkorlik: faqat OXIRGI 4 xabar yuboriladi (server ham 6 bilan cheklaydi)
      const r = await api('/api/ai/chat', 'POST', { messages: next.slice(-4), order_id: order?.id, context_role: 'customer' }, token, 25000, { retries: 1 });
      const reply = r.reply + (r.ticket ? `\n\n${t('ticket_no')} ${r.ticket}` : '');
      setChat([...next, { role: 'assistant', text: reply }]);
    } catch (e) {
      // T-20: jim to'xtamaydi — xato chatda aniq ko'rinadi, qayta yuborsa bo'ladi
      setChat([...next, { role: 'assistant', text: t('ai_fail') }]);
    } finally {
      setChatLoading(false); // har qanday holatda tugma qayta ochiladi
    }
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
      <KeyboardAvoidingView style={s.loginWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="light" />
        <FadeInView delay={0} from={20}>
        <View style={{ alignItems: 'center' }}><ElgaLogo size={56} /></View>
        <Text style={{ color: WHITE, fontSize: 24, fontWeight: '600', textAlign: 'center', marginTop: 8 }}>
          {isSetup ? t('pin_set') : t('pin_enter')}
        </Text>
        {isSetup && (
          <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginTop: 6 }}>
            {t('pin_hint')}
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
                if (pinInput.length !== 4) { toast(t('pin_4digits'), 'error'); return; }
                await AsyncStorage.setItem('pin', pinInput);
                setStoredPin(pinInput); setPinInput(''); setPinStep(null);
              }
            : () => {
                if (pinInput === storedPin) { setPinStep(null); setPinInput(''); }
                else { toast(t('pin_wrong'), 'error'); setPinInput(''); }
              }
          }
        >
          <Text style={s.ctaBtnTxt}>{t('continue_up')}</Text>
        </PressableScale>
        {isSetup
          ? <TouchableOpacity onPress={() => setPinStep(null)} activeOpacity={0.7}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>{t('skip')}</Text>
            </TouchableOpacity>
          : <TouchableOpacity activeOpacity={0.7} onPress={async () => {
              await AsyncStorage.multiRemove(['token', 'user', 'pin', ACTIVE_ORDER_KEY]);
              setToken(null); setUser(null); setStoredPin(null);
              setPinStep(null); setPinInput(''); setStep('phone');
            }}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>{t('login_sms')}</Text>
            </TouchableOpacity>
        }
        </FadeInView>
      </KeyboardAvoidingView>
    );
  }

  // LOGIN SCREEN
  if (!token) {
    return (
      <KeyboardAvoidingView style={s.loginWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="light" />
        <FadeInView delay={0} from={24} duration={500}>
          <View style={{ alignItems: 'center' }}><ElgaLogo size={56} /></View>
          <Text style={{ color: GRAY1, fontSize: 15, textAlign: 'center', marginTop: 6 }}>{t('client_app')}</Text>
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
              if (phone.replace(/\D/g, '').length < 9) { toast(t('enter_valid_phone'), 'error'); return; }
              setLoading(true);
              try { await api('/api/auth/send-code', 'POST', { phone }); setStep('code'); toast(t('sms_sent'), 'success'); }
              catch (e) { toast(e.message || t('error'), 'error'); }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>{t('get_sms_code')}</Text>}
            </PressableScale>
          </FadeInView>
        )}

        {step === 'code' && (
          <FadeInView key="code" delay={60} from={20}>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder={t('sms_code_ph')}
              placeholderTextColor={GRAY2}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
            />
            <PressableScale style={s.ctaBtn} onPress={async () => {
              if (code.length < 4) { toast(t('enter_code'), 'error'); return; }
              setLoading(true);
              try {
                const r = await api('/api/auth/verify', 'POST', { phone, code });
                await AsyncStorage.setItem('token', r.token);
                await AsyncStorage.setItem('user', JSON.stringify(r.user));
                setToken(r.token); setUser(r.user);
                // T-06: PIN/parol so'ralmaydi — bir marta SMS bilan kirish yetarli.
                // Token saqlandi; keyingi ochilishlarda avtomatik kiriladi.
              } catch (e) {
                if (e.data?.new_user && e.data?.reg_token) { setRegToken(e.data.reg_token); setStep('name'); }
                else { toast(e.message || t('error'), 'error'); }
              }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>{t('confirm_up')}</Text>}
            </PressableScale>
            <TouchableOpacity onPress={() => setStep('phone')} activeOpacity={0.7}>
              <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 12 }}>{t('change_number')}</Text>
            </TouchableOpacity>
          </FadeInView>
        )}

        {step === 'name' && (
          <FadeInView key="name" delay={60} from={20}>
            <TextInput
              style={[s.input, { marginTop: 32 }]}
              placeholder={t('your_name_ph')}
              placeholderTextColor={GRAY2}
              value={name}
              onChangeText={setName}
            />
            {/* Q4: taklif kodi (ixtiyoriy) — do'st kodi bilan kelganга birinchi
                safar -50% (backend auth.js referral_code ni qabul qiladi) */}
            <TextInput
              style={s.input}
              placeholder={t('ref_code_ph')}
              placeholderTextColor={GRAY2}
              autoCapitalize="characters"
              autoCorrect={false}
              value={refCode}
              onChangeText={setRefCode}
            />
            <PressableScale style={s.ctaBtn} onPress={async () => {
              if (name.trim().length < 2) { toast(t('enter_name'), 'error'); return; }
              setLoading(true);
              try {
                const r = await api('/api/auth/verify', 'POST', { phone, code, name: name.trim(), role: 'customer', reg_token: regToken, ...(refCode.trim() ? { referral_code: refCode.trim().toUpperCase() } : {}) });
                await AsyncStorage.setItem('token', r.token);
                await AsyncStorage.setItem('user', JSON.stringify(r.user));
                setToken(r.token); setUser(r.user);
                // T-06: PIN/parol so'ralmaydi — bir marta SMS bilan kirish yetarli.
                // Token saqlandi; keyingi ochilishlarda avtomatik kiriladi.
              } catch (e) { toast(e.message || t('error'), 'error'); }
              setLoading(false);
            }} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={s.ctaBtnTxt}>{t('continue_up')}</Text>}
            </PressableScale>
          </FadeInView>
        )}
      </KeyboardAvoidingView>
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
  // M-06: FAOL buyurtmada pickup/manzil zaxirasi — ORDER PAYLOAD'idan.
  // Ilova qayta ochilganda (resume) `pickup`/`dest`/`myLoc` state'lari BO'SH bo'ladi —
  // ilgari lat:0,lng:0 (okean!) ga tushib, mijoz xaritada NA olib ketish nuqtasini,
  // NA haydovchini ko'rardi ("bir-birini ko'rmaydi"ning resume'dagi sababi).
  // order.from_lat/to_lat serverdan HAR DOIM keladi — zaxira sifatida ishlatamiz.
  mapDataRef.current = order ? {
    lat: mapBase?.lat ?? order.from_lat ?? null, lng: mapBase?.lng ?? order.from_lng ?? null,
    destLat: dest?.lat ?? order.to_lat ?? null, destLng: dest?.lng ?? order.to_lng ?? null,
    driverLat: driverLoc?.lat ?? null, driverLng: driverLoc?.lng ?? null,
    nearby: [], pickupMode: false,
    // T-04: qidiruv paytida xaritada kengayuvchi radius doirasi (radar effekti)
    searching: ['searching', 'assigned'].includes(order.status),
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
            {t('no_internet_banner')}
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

            {/* F-02: yo'nalish chipi — masofa + taxminiy vaqt (OSRM'dan).
                P4 (K-4): oflayn banner ko'ringanda chip uning OSTIDAN joy oladi
                (avval ustma-ust tushardi — banner top:insets.top, chip +10). */}
            {routeInfo && ['accepted', 'in_progress'].includes(order.status) && (
              <View style={{
                position: 'absolute', top: insets.top + (netOnline ? 10 : 42), left: 12,
                backgroundColor: 'rgba(21,23,28,0.85)', borderRadius: 12,
                paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#262A31',
              }}>
                <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '700' }}>
                  🧭 {routeInfo.km} km · ~{routeInfo.min} {t('min_short')}
                </Text>
                <Text style={{ color: '#ccc', fontSize: 11 }}>
                  {order.status === 'in_progress' ? t('to_dest_lbl') : t('driver_arrival')}
                </Text>
              </View>
            )}

            {/* P4 (T-2): safar davomida MANZIL NOMI xaritada pill — mijoz qayoqqa
                ketayotganini doim biladi (chip ostidan joy oladi). */}
            {order.status === 'in_progress' && (order.to_address || dest?.address) && (
              <View style={{
                position: 'absolute', left: 12, maxWidth: '62%',
                top: insets.top + (netOnline ? 10 : 42) + (routeInfo ? 52 : 0),
                backgroundColor: 'rgba(21,23,28,0.85)', borderRadius: 10,
                paddingVertical: 5, paddingHorizontal: 9, borderWidth: 1, borderColor: '#262A31',
              }}>
                <Text numberOfLines={1} style={{ color: WHITE, fontSize: 11.5 }}>
                  🏁 {order.to_address || dest?.address}
                </Text>
              </View>
            )}

            {/* P4 (T-2): SOS — XARITAGA qotirilgan (Yandex qolipi): varaq qancha
                aylantirilsa ham doim ko'rinadi va bir bosishda ochiladi. */}
            {['accepted', 'arrived', 'in_progress'].includes(order.status) && (
              <TouchableOpacity
                onPress={() => setSosModal(true)}
                activeOpacity={0.8}
                style={{
                  position: 'absolute', top: insets.top + (netOnline ? 10 : 42), right: 12,
                  width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'rgba(21,23,28,0.9)', borderWidth: 1.5, borderColor: RED,
                }}>
                <Text style={{ color: RED, fontSize: 13, fontWeight: '800' }}>SOS</Text>
              </TouchableOpacity>
            )}

            <Animated.View
              {...sheetPan.panHandlers}
              style={[s.activeSheet, { bottom: TABBAR_H + insets.bottom, transform: [{ translateY: sheetY }] }]}
              onLayout={(e) => {
                // W3: yig'ilganda ushlagich + holat + narx (~84px) ko'rinib qoladi
                const dy = Math.max(0, Math.round(e.nativeEvent.layout.height) - 84);
                sheetDyRef.current = dy;
                if (!sheetOpenRef.current) sheetY.setValue(dy); // yig'iq holatda balandlik o'zgarsa moslash
              }}>
            {/* X2: ushlagich — pan endi butun kartada (Animated.View'da), bu vizual belgi */}
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER }} />
              {/* P2 (T-1): sarlavha — accepted'da umumiy holat o'rniga ANIQ javob:
                  "Yetib keladi: ~X daqiqa" (Yandex qolipi). Boshqa holatlarda statusText. */}
              <Text style={s.activeStatusTxt}>
                {(() => {
                  if (order.status === 'accepted' && driverLoc) {
                    const p = pickup || myLoc || (order.from_lat != null ? { lat: order.from_lat, lng: order.from_lng } : null);
                    if (p) {
                      const etaMin = Math.max(1, Math.round((distKm(driverLoc.lat, driverLoc.lng, p.lat, p.lng) / 25) * 60));
                      return <>{t('arrives_in')} <Text style={{ color: YELLOW }}>~{etaMin} {t('min_short')}</Text></>;
                    }
                  }
                  return statusText(order.status);
                })()}
              </Text>
              {!sheetOpen && order.price > 0 && (
                <Text numberOfLines={1} style={{ color: GRAY1, fontSize: 14, marginTop: -4, marginBottom: 10 }}>
                  {fmt(order.price)} {t('som')} · {order.payment_method === 'cash' ? t('cash_lbl') : order.payment_method}
                </Text>
              )}
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }}
              scrollEnabled={sheetOpen} scrollEventThrottle={16}
              onScroll={(e) => { sheetScrollRef.current = e.nativeEvent.contentOffset.y; }}>

              {order.driver_name && !['searching', 'assigned'].includes(order.status) && (
                <View style={s.driverCard}>
                  <View style={s.driverAvatar}>
                    <Text style={{ fontSize: 26, color: GRAY1 }}>{(order.driver_name?.[0] || 'H').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    {/* P2 (T-1): mijoz mashinani RAQAMDAN topadi — raqam eng katta element,
                        oq davlat-raqam plastinkasi ko'rinishida (Yandex/Uber qolipi). */}
                    {order.driver_plate ? (
                      <View style={{ alignSelf: 'flex-start', backgroundColor: WHITE, borderWidth: 2, borderColor: '#15171c', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 3 }}>
                        <Text style={{ color: '#15171c', fontSize: 17, fontWeight: '800', letterSpacing: 1.5 }}>{order.driver_plate}</Text>
                      </View>
                    ) : null}
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 5 }}>
                      {[order.driver_color, order.driver_car].filter(Boolean).join(' ')}
                    </Text>
                    <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '700', marginTop: 2 }}>
                      {order.driver_name}
                      {order.driver_rating ? <Text style={{ color: GRAY1, fontWeight: '400' }}> · ⭐ {order.driver_rating}</Text> : null}
                    </Text>
{/* M-04: xizmat belgilari (A/C, bagaj) — haydovchi profilidan, narxga ta'sir yo'q */}
                    {(order.driver_ac || order.driver_baggage) && (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        {!!order.driver_ac && (
                          <View style={{ backgroundColor: CARD2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: WHITE, fontSize: 11 }}>❄️ A/C</Text>
                          </View>
                        )}
                        {!!order.driver_baggage && (
                          <View style={{ backgroundColor: CARD2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: WHITE, fontSize: 11 }}>🧳 Bagaj</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {/* W1: mijoz TANLAGAN pullik xizmatlar (need_ac/need_baggage) — sariq
                        belgi. M-04 dagi kulrang belgilar haydovchi PROFILidan (bepul),
                        bulari esa buyurtmaga buyurilgan va narxga kiritilgan. */}
                    {!!(order.need_ac || order.need_baggage) && (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        {!!order.need_ac && (
                          <View style={{ backgroundColor: '#1A1400', borderWidth: 1, borderColor: YELLOW, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: YELLOW, fontSize: 11, fontWeight: '600' }}>{t('extra_ac_chip')}</Text>
                          </View>
                        )}
                        {!!order.need_baggage && (
                          <View style={{ backgroundColor: '#1A1400', borderWidth: 1, borderColor: YELLOW, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: YELLOW, fontSize: 11, fontWeight: '600' }}>{t('extra_baggage_chip')}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {(() => {
                      // M-05: masofa qatori (ETA endi sarlavhada — P2). Pickup: state → order.from_lat.
                      if (!driverLoc || order.status !== 'accepted') return null;
                      const p = pickup || myLoc || (order.from_lat != null ? { lat: order.from_lat, lng: order.from_lng } : null);
                      if (!p) return null;
                      const dKm = distKm(driverLoc.lat, driverLoc.lng, p.lat, p.lng);
                      return (
                        <Text style={{ color: GREEN, fontSize: 12, marginTop: 2 }}>
                          🚗 {dKm < 1 ? `${(dKm * 1000).toFixed(0)} m` : `${dKm.toFixed(1)} km`} {t('away_lbl')}
                        </Text>
                      );
                    })()}
                    {/* P2 (K-8): safar davomida manzilgacha qancha qolgani — F-02 dagi
                        OSRM natijasidan (routeInfo), yangi so'rovsiz. */}
                    {order.status === 'in_progress' && routeInfo && (
                      <Text style={{ color: GREEN, fontSize: 12, marginTop: 4 }}>
                        🏁 {t('to_dest_left')} ~{routeInfo.min} {t('min_short')} · {routeInfo.km} km
                      </Text>
                    )}
                  </View>
                  <View style={{ gap: 8 }}>
                    {order.driver_phone && (
                      <TouchableOpacity style={s.callCircle} onPress={callDriver}>
                        <Ionicons name="call" size={20} color={GREEN} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.chatCircle} onPress={() => { if (order?.id) loadTripChatHistory(order.id); setTripChatUnread(0); setTripChatModal(true); }}>
                      <Ionicons name="chatbubble" size={18} color={YELLOW} />
                      {/* A2: o'qilmagan xabarlar soni — sariq doira badge */}
                      {tripChatUnread > 0 ? (
                        <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: YELLOW, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                          <Text style={{ color: '#000', fontSize: 11, fontWeight: '800' }}>{tripChatUnread > 9 ? '9+' : tripChatUnread}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {['searching', 'assigned'].includes(order.status) && (
                schedFutureMs(order) ? (
                  /* C1: vaqti hali kelmagan rejalashtirilgan buyurtma — radar emas,
                     tinch kutish kartasi (haydovchi qidiruvi vaqtida o'zi boshlanadi) */
                  <View style={{ backgroundColor: CARD2, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, marginHorizontal: 16, marginTop: 8, alignItems: 'center' }}>
                    <Text style={{ color: YELLOW, fontSize: 17, fontWeight: '800' }}>{t('scheduled_lbl')}</Text>
                    <Text style={{ color: WHITE, fontSize: 14, marginTop: 4 }}>{fmtSched(new Date(schedFutureMs(order)))}</Text>
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                      {t('sched_auto_msg')}
                    </Text>
                  </View>
                ) : <SearchingPulse />
              )}

              {order.status === 'arrived' && <CustomerWaitTimer arrivedAt={order.arrived_at} cfg={liveWait} />}

              {order.price > 0 && (
                <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginTop: 8 }}>
                  {fmt(order.price)} {t('som')} · {order.payment_method === 'cash' ? t('cash_lbl') : order.payment_method}
                </Text>
              )}

              {['accepted', 'arrived', 'in_progress'].includes(order.status) && (
                <TouchableOpacity
                  style={[s.outlineBtn, { marginTop: 12, marginHorizontal: 16, justifyContent: 'center' }]}
                  onPress={() => { setChangeDestModal(true); setCdQ(''); setCdResults([]); }}>
                  <Ionicons name="location" size={16} color={YELLOW} style={{ marginRight: 6 }} />
                  <Text style={{ color: YELLOW, fontSize: 14, fontWeight: '600' }}>{t('change_dest')}</Text>
                </TouchableOpacity>
              )}

              {/* ====== JONLI TAXIMETR (in_progress) ====== */}
              {order.status === 'in_progress' && (
                <View style={s.taxiMeterBox}>
                  {/* Asosiy narx */}
                  <View style={{ alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 1 }}>
                      {order.metered ? t('meter_lbl') : t('trip_price_lbl')}
                    </Text>
                    <Text style={[{ color: YELLOW, fontSize: 44, fontWeight: '800', lineHeight: 52, marginTop: 4 }, mfont('800')]}>
                      {fmt(order.metered ? (liveFare || order.price || 0) : (order.price || 0))}
                    </Text>
                    <Text style={{ color: GRAY1, fontSize: 14 }}>{t('som')}</Text>
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
                        <Text style={{ color: GRAY1, fontSize: 11 }}>{t('min_full')}</Text>
                      </View>
                    )}
                    {(order.wait_fee > 0 || liveWait.fee > 0) && (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: RED, fontSize: 18, fontWeight: '700' }}>
                          +{fmt(Math.max(order.wait_fee || 0, liveWait.fee))}
                        </Text>
                        <Text style={{ color: GRAY1, fontSize: 11 }}>{t('wait_lbl')}</Text>
                      </View>
                    )}
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: GRAY1, fontSize: 13, fontWeight: '600' }}>
                        {order.payment_method === 'cash' ? `💵 ${t('cash_lbl')}` : `💳 ${t('card_lbl')}`}
                      </Text>
                      <Text style={{ color: GRAY2, fontSize: 11 }}>{t('pay_lbl')}</Text>
                    </View>
                  </View>
                </View>
              )}

              {order.status === 'in_progress' && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingHorizontal: 16 }}>
                  <TouchableOpacity style={s.outlineBtn} onPress={shareTrip}>
                    <Ionicons name="share-social" size={16} color={WHITE} style={{ marginRight: 6 }} />
                    <Text style={{ color: WHITE, fontSize: 14 }}>{t('share')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.outlineBtn, { borderColor: RED }]} onPress={() => setSosModal(true)}>
                    <Text style={{ color: RED, fontSize: 14, fontWeight: '700' }}>🆘 SOS</Text>
                  </TouchableOpacity>
                </View>
              )}

              {['searching', 'assigned', 'accepted', 'arrived'].includes(order.status) && (
                /* UI-B1: yagona Btn tizimi — danger */
                <Btn kind="danger" title={t('cancel_order_btn')}
                  onPress={() => setCancelModal(true)} disabled={loading}
                  style={{ marginTop: 12, marginHorizontal: 16 }} />
              )}
            </ScrollView>
            </Animated.View>
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
                <Text style={{ color: GRAY1, marginTop: 12 }}>{t('gps_detecting')}</Text>
              </View>
            )}

            {/* Greeting pill */}
            <View style={[s.greetPill, { top: insets.top + 12, left: 16 }]}>
              <Text style={s.greetPillTxt}>👋 {user?.name?.split(' ')[0] || t('hello')}</Text>
            </View>

            {/* Avatar circle */}
            {/* AI yordamchi — SURILADIGAN suzuvchi tugma (istagan joyga ko'chiriladi) */}
            <DraggableAiButton
              insets={insets} onPress={() => setAiModal(true)}
              storageKey="AI_FAB_POS" accent={YELLOW} iconColor="#000" />
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
                // G2: kesh darrov (xarita sakraydi), aniq fix timeout bilan — tugma qotmaydi
                try {
                  const last = await Location.getLastKnownPositionAsync({ maxAge: 60 * 1000 });
                  if (last) setMyLoc({ lat: last.coords.latitude, lng: last.coords.longitude });
                } catch (e) {}
                // Kesh joylashuvi bo'lsa — xaritani DARHOL o'sha yerga markazlashtiramiz
                // (tugma bosilishi bilan javob bersin), keyin aniq fix bilan yangilaymiz.
                try {
                  const c = myLoc;
                  if (c) webviewRef.current?.injectJavaScript(`window.recenter&&window.recenter(${c.lat},${c.lng});true;`);
                } catch (e) {}
                let pos = await withTimeout(
                  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
                  8000
                ).catch(() => null);
                // Yangi/qishloq hududda sovuq GPS — aniqroq rejim + uzunroq timeout bilan qayta urinamiz.
                if (!pos) {
                  pos = await withTimeout(
                    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
                    15000
                  ).catch(() => null);
                }
                if (!pos) return;
                const lat = pos.coords.latitude, lng = pos.coords.longitude;
                setMyLoc({ lat, lng });
                AsyncStorage.setItem(LAST_LOC_KEY, JSON.stringify({ lat, lng })).catch(() => {});
                setPickup({ lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
                // Xaritani joriy joylashuvga MAJBURAN markazlashtiramiz (centeredOnce'ga bog'liq emas).
                try { webviewRef.current?.injectJavaScript(`window.recenter&&window.recenter(${lat},${lng});true;`); } catch (e) {}
                reverseGeocode(lat, lng).then((addr) => {
                  setPickup((p) => (p && p.lat === lat && p.lng === lng) ? { ...p, address: addr } : p);
                });
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
                      {t('hello')}, {user?.name?.split(' ')[0] || t('user_def')} 👋
                    </Text>
                    <Text style={[{ color: WHITE, fontSize: 24, fontWeight: '800', marginTop: 1, letterSpacing: -0.5 }, mfont('800')]}>
                      {t('where_to_title')}
                    </Text>
                  </View>
                  {Number(balance?.balance) > 0 && (
                    <View style={{ backgroundColor: YELLOW + '20', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: YELLOW + '50' }}>
                      <Text style={{ color: YELLOW, fontSize: 12, fontWeight: '700' }}>💰 {fmt(balance.balance)}</Text>
                    </View>
                  )}
                </View>
              </View>

              {nearby.length > 0 && (
                <View style={s.nearbyCard}>
                  <View style={s.nearbyDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }}>🚕 {nearby.length} {t('cars_available')}</Text>
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>⏱ {t('approx_wait')} ~{nearby.length > 3 ? 2 : 4} {t('min_full')}</Text>
                  </View>
                </View>
              )}

              <TouchableOpacity style={s.qayergaBtn} onPress={() => setSearchOpen(true)} activeOpacity={0.85}>
                <View style={s.qayergaIconWrap}>
                  <Ionicons name="search" size={20} color="#1A1A1A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>{t('where_to_q')}</Text>
                  <Text style={{ color: GRAY1, fontSize: 12, marginTop: 1 }}>{t('enter_or_pick')}</Text>
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
                    <Text style={{ color: WHITE, fontSize: 13, fontWeight: '600', marginTop: 4 }}>{t('home')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.shortBtnSm} activeOpacity={0.75}
                    onPress={() => workPlace ? pickDest(workPlace) : setSearchOpen(true)}
                    onLongPress={() => pickup && saveHomeWork('work', pickup)}>
                    <View style={s.shortBtnIconWrap}><Ionicons name="briefcase" size={18} color={YELLOW} /></View>
                    <Text style={{ color: WHITE, fontSize: 13, fontWeight: '600', marginTop: 4 }}>{t('work')}</Text>
                  </TouchableOpacity>
                </View>
                {/* O'ng tomon: 🎙 Ovozli buyurtma (eski "Ish" tugmasi o'rnida) */}
                <TouchableOpacity style={s.voiceBtn} activeOpacity={0.85} onPress={openVoiceOrder}>
                  <View style={s.voiceBtnIconWrap}><Ionicons name="mic" size={20} color="#1A1A1A" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#1A1A1A', fontSize: 14, fontWeight: '700' }}>{t('voice_order')}</Text>
                    <Text style={{ color: '#1A1A1A', fontSize: 11, marginTop: 1, opacity: 0.7 }}>{t('speak_address')}</Text>
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
                    placeholder={t('search_ph')}
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
                      <Text style={s.listSectionTitle}>{t('saved_sec')}</Text>
                      <TouchableOpacity style={s.placeRow}
                        onPress={() => homePlace ? pickDest(homePlace) : toast(t('long_press_save'), 'info')}
                        onLongPress={() => pickup ? saveHomeWork('home', pickup) : null}>
                        <View style={s.placeIconCircle}><Ionicons name="home" size={18} color={YELLOW} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.placeName}>{t('home')}</Text>
                          <Text style={s.placeSub} numberOfLines={1}>{homePlace?.address || t('long_press_save')}</Text>
                        </View>
                      </TouchableOpacity>
                      <View style={s.placeSep} />
                      <TouchableOpacity style={s.placeRow}
                        onPress={() => workPlace ? pickDest(workPlace) : toast(t('long_press_save'), 'info')}
                        onLongPress={() => pickup ? saveHomeWork('work', pickup) : null}>
                        <View style={s.placeIconCircle}><Ionicons name="briefcase" size={18} color={YELLOW} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.placeName}>{t('work')}</Text>
                          <Text style={s.placeSub} numberOfLines={1}>{workPlace?.address || t('long_press_save')}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  {searchResults.length > 0 && (
                    <View style={s.listSection}>
                      <Text style={s.listSectionTitle}>{t('search_results_sec')}</Text>
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
                      <Text style={s.listSectionTitle}>{t('recent_sec')}</Text>
                      {recentPlaces.map((p, i) => (
                        <View key={i}>
                          <TouchableOpacity style={s.placeRow} activeOpacity={0.7}
                            onPress={() => pickDest(p)}
                            onLongPress={() => showConfirm({ title: t('add_favorite_q'), message: p.address, confirmText: t('yes'), cancelText: t('no'), onConfirm: () => addFavorite(p) })}>
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
                      <Text style={s.listSectionTitle}>{t('popular_sec')}</Text>
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
                {t('adjust_pickup')}
              </Text>
              <TouchableOpacity style={s.ctaBtn} onPress={() => { setEstimates({}); estCacheKey.current = null; setOrderStep('tariff'); }}>
                <Text style={s.ctaBtnTxt}>{t('confirm_arrow')}</Text>
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
            {/* Tariflar — ixcham kartalar (hammasi sig'adi; sig'masa scroll).
                Narx/buyurtma mantig'i o'zgarmadi — faqat layout/rang. */}
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingTop: 14, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
              {estLoading && Object.keys(estimates).length === 0 ? (
                CAR_CLASSES.map((c) => (
                  <View key={c.id} style={s.tariffCard}>
                    <Skeleton width={48} height={48} radius={24} />
                    <View style={{ flex: 1, marginLeft: 12, gap: 7 }}>
                      <Skeleton width={100} height={14} />
                      <Skeleton width={150} height={10} />
                    </View>
                    <Skeleton width={70} height={18} />
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
                    <CarClassIcon c={c} size={48} active={active} image={carImages[c.id]} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <Text style={{ color: active ? c.color : WHITE, fontSize: 15, fontWeight: '700' }}>{c.label}</Text>
                        {c.badge && (
                          <View style={{ backgroundColor: c.color, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                            <Text style={{ color: '#15171c', fontSize: 9, fontWeight: '800' }}>{c.badge}</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <Text style={{ color: GRAY1, fontSize: 11 }}>👤 {c.seats} {t('seats')}</Text>
                        <Text style={{ color: GRAY2, fontSize: 11 }}>·</Text>
                        <Text style={{ color: GRAY1, fontSize: 11 }} numberOfLines={1}>{c.features.join(' · ')}</Text>
                        {est?.duration_min ? (
                          <>
                            <Text style={{ color: GRAY2, fontSize: 11 }}>·</Text>
                            <Text style={{ color: GRAY1, fontSize: 11 }}>~{est.duration_min} {t('min_short')}</Text>
                          </>
                        ) : null}
                        {est?.surge > 1 && <Text style={{ color: '#FF6B00', fontSize: 11 }}>⚡</Text>}
                        {est?.is_night && <Text style={{ color: GRAY1, fontSize: 11 }}>🌙</Text>}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', minWidth: 78 }}>
                      {est ? (
                        <>
                          {est.discount_percent > 0 && <Text style={{ color: GRAY2, fontSize: 10, textDecorationLine: 'line-through' }}>{fmt(est.base_price)}</Text>}
                          <Text style={{ color: active ? c.color : WHITE, fontSize: active ? 18 : 16, fontWeight: '800' }}>
                            {fmt(est.price)}
                          </Text>
                          <Text style={{ color: GRAY2, fontSize: 10 }}>{t('som')}</Text>
                        </>
                      ) : estLoading ? <ActivityIndicator color={c.color} size="small" /> : <Text style={{ color: GRAY2, fontSize: 12 }}>—</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* FIXED pastki panel — TO'LOV USULI + katta tugma DOIM ko'rinadi (kesilmaydi) */}
            <View style={s.tariffFooter}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 42, marginBottom: 12 }} contentContainerStyle={{ alignItems: 'center' }}>
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
                        {PAY_ICONS[m.id] || '💳'} {m.name}{disabled ? ` (${t('soon')})` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* C1: qachon ketamiz — Hozir yoki rejalashtirilgan vaqt.
                  Backend #129: scheduled_at kelajakda bo'lsa dispatcher vaqti
                  kelguncha (10 daq oldin) haydovchi qidirmaydi. */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, borderRadius: 12, borderWidth: 1.5, paddingVertical: 9, alignItems: 'center',
                    borderColor: !schedAt ? YELLOW : BORDER, backgroundColor: !schedAt ? '#1a1707' : CARD2 }}
                  onPress={() => setSchedAt(null)}>
                  <Text style={{ color: !schedAt ? YELLOW : GRAY1, fontSize: 13, fontWeight: '700' }}>⚡ {t('now')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1.4, borderRadius: 12, borderWidth: 1.5, paddingVertical: 9, alignItems: 'center',
                    borderColor: schedAt ? YELLOW : BORDER, backgroundColor: schedAt ? '#1a1707' : CARD2 }}
                  onPress={() => setSchedModal(true)}>
                  <Text style={{ color: schedAt ? YELLOW : GRAY1, fontSize: 13, fontWeight: '700' }}>
                    ⏰ {schedAt ? fmtSched(schedAt) : t('later')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Q3: promo-kod (ixtiyoriy) — backend estimate/buyurtmada qo'llaydi,
                  chegirma narxga darhol kiritiladi (promo_applied/promo_invalid). */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TextInput
                  style={{ flex: 1, backgroundColor: CARD2, color: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 }}
                  placeholder={t('promo_ph')} placeholderTextColor={GRAY2}
                  autoCapitalize="characters" autoCorrect={false}
                  value={promoCode} onChangeText={setPromoCode}
                />
                <TouchableOpacity
                  style={{ backgroundColor: CARD2, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, justifyContent: 'center' }}
                  onPress={() => { estCacheKey.current = null; fetchAllEstimates(); }}>
                  <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '700' }}>{t('apply')}</Text>
                </TouchableOpacity>
              </View>
              {estimates[carClass]?.promo_applied && (
                <Text style={{ color: GREEN, fontSize: 12, marginBottom: 8 }}>{t('promo_applied')}</Text>
              )}
              {estimates[carClass]?.promo_invalid && (
                <Text style={{ color: RED, fontSize: 12, marginBottom: 8 }}>{t('promo_invalid')}</Text>
              )}
              {/* W1: pullik qo'shimcha xizmatlar — A/C va bagaj chiplari. Tanlansa
                  backend estimate narxga extras_fee qo'shib qaytaradi (useEffect deps
                  orqali narxlar avtomatik qayta yuklanadi). */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 9, alignItems: 'center',
                    backgroundColor: needAc ? YELLOW : CARD2, borderColor: needAc ? YELLOW : BORDER }}
                  activeOpacity={0.8}
                  onPress={() => setNeedAc((v) => !v)}>
                  <Text style={{ color: needAc ? '#15171c' : GRAY1, fontSize: 13, fontWeight: '700' }}>
                    {t('extra_ac_chip')} (+{fmt(extrasCfg.ac)} {t('som')})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 9, alignItems: 'center',
                    backgroundColor: needBaggage ? YELLOW : CARD2, borderColor: needBaggage ? YELLOW : BORDER }}
                  activeOpacity={0.8}
                  onPress={() => setNeedBaggage((v) => !v)}>
                  <Text style={{ color: needBaggage ? '#15171c' : GRAY1, fontSize: 13, fontWeight: '700' }}>
                    {t('extra_baggage_chip')} (+{fmt(extrasCfg.baggage)} {t('som')})
                  </Text>
                </TouchableOpacity>
              </View>
              {/* UI-B1: yagona Btn tizimi — primary. Matn: "Ketdik · [narx] so'm" (avvalgidek) */}
              <Btn kind="primary"
                title={`${t('lets_go')}${estimates[carClass] ? ` · ${fmt(estimates[carClass].price)} ${t('som')}` : ''}`}
                onPress={createOrder}
                loading={loading}
                disabled={!estimates[carClass]}
                style={{ minHeight: 56, borderRadius: 16, marginTop: 4 }} />
            </View>
            </AnimatedSheet>
          </View>
        ) : null
      )}

      {/* ===== TRIPS TAB ===== */}
      {tab === 'trips' && (
        <View style={[s.tabBody, { paddingTop: insets.top }]}>
          <View style={s.tabHeaderArea}>
            <Text style={s.tabHeaderSub}>{t('your_trips')}</Text>
            <Text style={[s.tabHeaderTitle, mfont('800')]}>{t('history')}</Text>
          </View>

          <FlatList
            data={groupedTrips}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            keyExtractor={(item, i) => item.type === 'header' ? 'h' + i : String(item.item.id)}
            // Y1: tepada 3 mini karta — JAMI SAFAR / JAMI SARF / YO'L (faqat completed'lardan,
            // tripStats null bo'lsa umuman chizilmaydi)
            ListHeaderComponent={tripStats ? (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <View style={[s.statCard, { flex: 1, alignItems: 'center', paddingVertical: 12 }]}>
                  <Text style={{ color: YELLOW, fontSize: 18, fontWeight: '800' }}>{tripStats.count}</Text>
                  <Text style={{ color: GRAY1, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 3 }}>{t('stats_trips')}</Text>
                </View>
                <View style={[s.statCard, { flex: 1, alignItems: 'center', paddingVertical: 12 }]}>
                  <Text style={{ color: WHITE, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{fmtShortSum(tripStats.spent)}</Text>
                  <Text style={{ color: GRAY1, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 3 }}>{t('stats_spent')}</Text>
                </View>
                <View style={[s.statCard, { flex: 1, alignItems: 'center', paddingVertical: 12 }]}>
                  <Text style={{ color: WHITE, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{tripStats.dist >= 100 ? Math.round(tripStats.dist) : tripStats.dist.toFixed(1)} km</Text>
                  <Text style={{ color: GRAY1, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 3 }}>{t('stats_dist')}</Text>
                </View>
              </View>
            ) : null}
            ListEmptyComponent={
              <View style={s.emptyState}>
                <Text style={{ fontSize: 48 }}>🚕</Text>
                <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700', marginTop: 12 }}>{t('no_trips_yet')}</Text>
                <Text style={{ color: GRAY1, fontSize: 14, marginTop: 6, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 }}>{t('no_trips_sub')}</Text>
                <Btn kind="primary" title={t('order_now')} icon="car" onPress={() => setTab('order')} style={{ marginTop: 20, paddingHorizontal: 28 }} />
              </View>
            }
            renderItem={({ item: row }) => {
              if (row.type === 'header') return (
                <Text style={s.dayLabel}>{row.label}</Text>
              );
              const tr = row.item; // R1B: 't' tarjima funksiyasi bilan to'qnashmasligi uchun 'tr'
              const isCompleted = tr.status === 'completed';
              const isCancelled = tr.status === 'cancelled';
              const timeStr = tr.created_at ? new Date(tr.created_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <TouchableOpacity style={s.tripCard} activeOpacity={0.85}
                  onLongPress={() => { setTab('order'); pickDest({ lat: Number(tr.to_lat), lng: Number(tr.to_lng), address: tr.to_address }); }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    {/* Y1: vaqt yonida tarif nomi ham (tr.car_class bo'lsa) */}
                    <Text style={{ color: GRAY1, fontSize: 13 }}>
                      {timeStr}{tr.car_class ? ` · ${CAR_CLASSES.find((c) => c.id === tr.car_class)?.label || tr.car_class}` : ''}
                    </Text>
                    <View style={[s.statusBadge, isCompleted && s.statusBadgeGreen, isCancelled && s.statusBadgeGray]}>
                      <Text style={[s.statusBadgeTxt, isCompleted && { color: '#000' }, isCancelled && { color: GRAY1 }]}>
                        {isCompleted ? t('completed_lbl') : isCancelled ? t('cancelled_lbl') : statusText(tr.status)}
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
                      <Text style={{ color: GRAY1, fontSize: 13 }} numberOfLines={1}>{tr.from_address || '—'}</Text>
                      <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{tr.to_address || '—'}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Text style={{ color: WHITE, fontSize: 15, fontWeight: '700' }}>{fmt(tr.price)} {t('som')}</Text>
                      {tr.distance_km && <Text style={{ color: GRAY1, fontSize: 13 }}>{tr.distance_km} km</Text>}
                    </View>
                    {tr.to_lat && tr.to_lng && (
                      /* Y1: oddiy havola o'rniga sariq to'ldirilgan kichik tugma */
                      <TouchableOpacity activeOpacity={0.85}
                        style={{ backgroundColor: YELLOW, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}
                        onPress={() => { setTab('order'); pickDest({ lat: Number(tr.to_lat), lng: Number(tr.to_lng), address: tr.to_address }); }}>
                        <Text style={{ color: '#000', fontSize: 12, fontWeight: '800' }}>{t('repeat')}</Text>
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
            <Text style={s.tabHeaderSub}>{t('help_sub')}</Text>
            <Text style={[s.tabHeaderTitle, mfont('800')]}>{t('help_center')}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TABBAR_H + insets.bottom + 16 }}>
            <TouchableOpacity style={s.operatorHeroCard} onPress={() => Linking.openURL('tel:+998770641226')} activeOpacity={0.85}>
              <View style={s.operatorIconWrap}>
                <Ionicons name="call" size={28} color={YELLOW} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: WHITE, fontSize: 16, fontWeight: '700' }}>{t('call_operator')}</Text>
                <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>{t('support_247')}</Text>
              </View>
              <View style={s.onlineBadge}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN, marginRight: 5 }} />
                <Text style={{ color: GREEN, fontSize: 12, fontWeight: '600' }}>{t('online_lbl')}</Text>
              </View>
            </TouchableOpacity>

            <Text style={[s.listSectionTitle, { paddingHorizontal: 0, marginTop: 20 }]}>{t('topics')}</Text>
            <View style={s.helpTopicsCard}>
              {[
                { icon: 'document-text', label: t('faq_lbl'), sub: t('faq_sub'),
                  answer: "❓ Tez-tez beriladigan savollar\n\n🔹 Haydovchi qancha kutadi?\n3 daqiqa bepul, keyin har daqiqaga qo'shimcha haq.\n\n🔹 Bekor qilsam jarima bo'ladimi?\nHaydovchi yetib kelgandan so'ng bekor qilsangiz — ha, kichik jarima.\n\n🔹 Bonus qanday ishlaydi?\nHar safardan % keshbek hisoblanadi, keyingi safarda ishlatiladi.\n\n🔹 Ovozli buyurtma nima?\nManzilni ovozda ayting — haydovchi eshitib keladi. Narx km+vaqt bo'yicha." },
                { icon: 'card', label: t('pay_issues'), sub: t('pay_issues_sub'),
                  answer: "💳 To'lov bo'yicha yordam\n\n🔹 Naqd to'lov: haydovchiga safar oxirida berasiz.\n\n🔹 Bonus balans: profil bo'limida ko'rinadi. Safar buyurtmasida 'Bonus ishlatish' ni yoqing.\n\n🔹 Karta to'lovi: tez kunda faollashtiriladi.\n\n🔹 Muammo bo'lsa — operator bilan bog'laning (yuqoridagi chat tugmasi)." },
                { icon: 'person', label: t('trip_issues'), sub: t('trip_issues_sub'),
                  answer: "🚕 Safar muammolari\n\n🔹 Haydovchi kelmayapti — /holat tugmasini bosing, haydovchi bilan bog'laning.\n\n🔹 Manzilni o'zgartirish — safar davomida 'Manzilni o'zgartirish' tugmasini bosing.\n\n🔹 Narx kutilgandan ko'p — narx km+kutish asosida hisoblanadi, app'dagi taxmin yo'l qisqaligiga bog'liq.\n\n🔹 Muammo davom etsa — operatorga murojaat qiling." },
                { icon: 'flag', label: t('driver_complaint'), sub: t('driver_complaint_sub'),
                  answer: "🚩 Haydovchi haqida shikoyat\n\nSafar yakunlangach yulduz bering va izoh qoldiring — bu bizga muhim.\n\nJiddiy muammo bo'lsa:\n• Operatorga chat orqali yozing\n• Yoki +998 77 064-12-26 ga qo'ng'iroq qiling\n\nBarcha shikoyatlar 24 soat ichida ko'rib chiqiladi." },
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

            <TouchableOpacity style={s.aiEntryCard} activeOpacity={0.8} onPress={() => setAiModal(true)}>
              <Ionicons name="sparkles" size={18} color={YELLOW} style={{ marginRight: 10 }} />
              <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>{t('ai_name')}</Text>
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
                placeholder={t('your_question_ph')}
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
            <Text style={[s.tabHeaderTitle, mfont('800')]}>{t('profile')}</Text>
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            <View style={s.profileCard}>
              <View style={s.profileAvatarRing}>
                <View style={s.profileAvatarInner}>
                  <Text style={{ fontSize: 28, color: YELLOW, fontWeight: '700' }}>{(user?.name?.[0] || 'U').toUpperCase()}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: WHITE, fontSize: 20, fontWeight: '700' }}>{user?.name || t('client_def')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  {!!user?.rating && <Text style={{ color: GRAY1, fontSize: 14 }}>⭐ {user.rating}</Text>}
                  <Text style={{ color: GRAY1, fontSize: 14 }}>{fmtPhone(user?.phone)}</Text>
                </View>
              </View>
            </View>

            {balance && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                {!(HIDE_BALANCE_IF_NONPOSITIVE && Number(balance.balance) <= 0) && (
                  <View style={[s.statCard, { flex: 1 }]}>
                    <Ionicons name="wallet" size={16} color={GRAY1} style={{ marginBottom: 6 }} />
                    <Text style={{ color: GRAY1, fontSize: 11, fontWeight: '600' }}>{t('balance_lbl')}</Text>
                    <Text style={{ color: YELLOW, fontSize: 20, fontWeight: '700', marginTop: 2 }}>{fmt(balance.balance)}</Text>
                    <Text style={{ color: GRAY1, fontSize: 11 }}>{t('som')}</Text>
                  </View>
                )}
                <View style={[s.statCard, { flex: 1 }]}>
                  <Ionicons name="gift" size={16} color={GRAY1} style={{ marginBottom: 6 }} />
                  <Text style={{ color: GRAY1, fontSize: 11, fontWeight: '600' }}>{t('cashback_lbl')}</Text>
                  <Text style={{ color: WHITE, fontSize: 20, fontWeight: '700', marginTop: 2 }}>{fmt(balance.pending_cashback)}</Text>
                  <Text style={{ color: GRAY1, fontSize: 11 }}>{t('som')}</Text>
                  {balance.pending_cashback > 0 && (
                    <TouchableOpacity style={[s.ctaBtn, { marginTop: 8, paddingVertical: 8 }]} onPress={claimCashback}>
                      <Text style={[s.ctaBtnTxt, { fontSize: 12 }]}>{t('claim_up')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {balance?.referral_code && (
              /* Q4: karta endi ISHLAYDI — bosilganda tizim ulashish oynasi ochiladi
                 (avval onPress yo'q, o'lik tugma edi). Matnda kod + shartlar. */
              <TouchableOpacity style={s.referralCard} activeOpacity={0.85}
                onPress={() => {
                  Share.share({
                    message: `${t('ref_share_pre')}${balance.referral_code}\n${t('ref_share_dl')}`,
                  }).catch(() => {});
                }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Ionicons name="gift" size={22} color={YELLOW} style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: WHITE, fontSize: 14, fontWeight: '600' }}>{t('invite_friend')}</Text>
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>
                      {t('your_code')} <Text style={{ color: YELLOW, fontWeight: '700' }}>{balance.referral_code}</Text> · {t('friend_discount')}
                    </Text>
                  </View>
                </View>
                <Ionicons name="share-social" size={16} color={YELLOW} />
              </TouchableOpacity>
            )}

            <View style={[s.menuCard, { marginTop: 12 }]}>
              {[
                // Y1: avval Alert.alert (o'lik ro'yxat) edi — endi haqiqiy bottom-sheet ochiladi
                { icon: 'heart', label: t('fav_places'), value: favorites.length > 0 ? `${favorites.length}` : null, onPress: () => { setFavAddMode(false); setFavPickPlace(null); setFavNewName(''); setFavSheet(true); } },
                // Y1: joriy tanlov qator o'zida ko'rinadi (masalan "Naqd") — sheet'da almashtiriladi
                { icon: 'card', label: t('pay_methods_lbl'), value: payMethod === 'cash' ? t('pay_cash') : (payMethods.find((m) => m.id === payMethod)?.name || payMethod), onPress: () => setPaySheet(true) },
                { icon: 'time', label: t('trips_history'), value: null, onPress: () => { setTab('trips'); loadTrips(); } },
                { icon: 'shield-checkmark', label: t('safety_sos'), value: null, onPress: () => setSosModal(true) },
                { icon: 'headset', label: t('help_center'), value: null, onPress: () => setTab('help') },
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

            {/* R1B: UI tili — UZ/RU chiplar (haydovchi ilovasidagi bilan bir xil uslub) */}
            <Text style={{ color: GRAY1, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginTop: 16, marginBottom: 10, marginLeft: 4 }}>{t('language')}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[{ id: 'uz', label: "O'zbekcha" }, { id: 'ru', label: 'Русский' }].map((ln) => {
                const on = lang === ln.id;
                return (
                  <TouchableOpacity key={ln.id} activeOpacity={0.8}
                    onPress={() => setLang(ln.id)}
                    style={{ flex: 1, backgroundColor: on ? YELLOW : CARD2, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: on ? YELLOW : BORDER }}>
                    <Text style={{ color: on ? '#15171c' : GRAY1, fontSize: 14, fontWeight: '700' }}>{ln.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* UI-B1: yagona Btn tizimi — danger */}
            <Btn kind="danger" icon="log-out" title={t('logout')} onPress={confirmLogout} style={{ marginTop: 16 }} />
          </View>
        </ScrollView>
      )}

      {/* ===== TAB BAR ===== */}
      <View style={[s.tabBar, { height: TABBAR_H + insets.bottom, paddingBottom: insets.bottom }]}>
        {[
          { id: 'order', icon: 'car', label: t('tab_order') },
          { id: 'trips', icon: 'time', label: t('tab_trips'), onLoad: loadTrips },
          { id: 'help', icon: 'headset', label: t('tab_help') },
          { id: 'profile', icon: 'person', label: t('tab_profile'), onLoad: loadBalance },
        ].map(tb => {
          const active = tab === tb.id;
          // UI-B2: faol buyurtma bo'lsa — "Buyurtma" tabida kichik sariq nuqta (badge)
          const showDot = tb.id === 'order' && !!(order && ACTIVE_STATUSES.includes(order.status));
          return (
            <TouchableOpacity key={tb.id} style={s.tabItem} activeOpacity={0.7}
              onPress={() => { setTab(tb.id); tb.onLoad?.(); }}>
              {/* UI-B2: ikonka 24px, nofaol #8A8F98; badge uchun o'ram */}
              <View>
                <Ionicons name={active ? tb.icon : tb.icon + '-outline'} size={24} color={active ? YELLOW : '#8A8F98'} />
                {showDot && <View style={s.tabDot} />}
              </View>
              {/* Y1/UI-B2: faol label sariq va qalin (Manrope), 11px, ikonkadan 4px pastda */}
              <Text style={[s.tabTxt, active && s.tabActive, mfont(active ? '700' : '600')]}>{tb.label}</Text>
              {/* Y1: faol tab ostida kichik sariq indikator chiziq (nofaolda joy saqlanadi — sakramaydi) */}
              <View style={[s.tabDash, active && { backgroundColor: YELLOW }]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ===== MODALS ===== */}

      {/* Trip Chat Modal */}
      <Modal visible={tripChatModal} transparent animationType="slide" onRequestClose={() => setTripChatModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[s.modalSheet, { height: '72%', paddingBottom: insets.bottom + 8 }]}>
            {/* X4: sarlavha — avatar (bosh harf) + haydovchi ismi + mashina */}
            <View style={s.tcHeader}>
              <View style={s.tcAvatar}>
                <Text style={s.tcAvatarTxt}>{(order?.driver_name?.[0] || 'H').toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.tcTitle} numberOfLines={1}>{order?.driver_name || t('driver_def')}</Text>
                <Text style={s.tcSub} numberOfLines={1}>
                  {[order?.driver_car, order?.driver_plate].filter(Boolean).join(' ') || t('chat_sub')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setTripChatModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={GRAY1} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              ref={tripChatScrollRef}
              contentContainerStyle={{ flexGrow: 1, paddingVertical: 8 }}
              keyboardShouldPersistTaps="handled"
              // A2: ochilganda va yangi xabar kelganda oxirgi xabarga avto-scroll
              onContentSizeChange={() => { try { tripChatScrollRef.current?.scrollToEnd({ animated: true }); } catch (e) {} }}>
              {tripChat.length === 0 ? (
                // X4: bo'sh holat — markazda kulrang ishora
                <View style={s.tcEmpty}>
                  <Ionicons name="chatbubbles-outline" size={54} color={GRAY2} />
                  <Text style={s.tcEmptyTxt}>{t('chat_empty')}</Text>
                </View>
              ) : tripChat.map((m, i) => {
                const mine = m.role === 'customer';
                // X4: ketma-ket bir kishidan kelgan xabarlar zich
                const prev = tripChat[i - 1];
                const grouped = prev && prev.role === m.role;
                // X4: vaqt tamg'asi — birinchi render'da lokal belgilanadi (ts ixtiyoriy)
                const key = i + '|' + m.role + '|' + m.text;
                if (tripChatTsRef.current[key] == null) tripChatTsRef.current[key] = m.ts || Date.now();
                const clock = fmtClock(tripChatTsRef.current[key]);
                return (
                  <View key={i} style={[s.tcRow, mine ? s.tcRowMine : s.tcRowTheirs, { marginTop: grouped ? 2 : 10 }]}>
                    <View style={[s.tcBubble, mine ? s.tcMine : s.tcTheirs]}>
                      <Text style={[s.tcBubbleTxt, { color: mine ? '#000' : WHITE }]}>{m.text}</Text>
                      <View style={s.tcMetaRow}>
                        <Text style={[s.tcTime, { color: mine ? 'rgba(0,0,0,0.5)' : GRAY1 }]}>{clock}</Text>
                        {/* A2: yuborilgan xabar holati — ⏳ outbox'da (socket uzik), ✓ yuborildi */}
                        {mine ? (
                          <Text style={[s.tcTime, { color: 'rgba(0,0,0,0.5)', marginLeft: 4 }]}>
                            {m.pending ? '⏳' : '✓'}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            {/* X4: tez javoblar — gorizontal chiplar, bosilsa darrov yuboriladi */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.tcQrRow}
              contentContainerStyle={s.tcQrContent}
              keyboardShouldPersistTaps="handled">
              {CUSTOMER_QUICK.map((k) => (
                <TouchableOpacity key={k} style={s.tcChip} activeOpacity={0.7} onPress={() => sendTripChat(t(k))}>
                  <Text style={s.tcChipTxt}>{t(k)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={s.tcInputRow}>
              <TextInput
                style={s.tcInput}
                placeholder={t('message_ph')}
                placeholderTextColor={GRAY2}
                value={tripChatInput}
                onChangeText={setTripChatInput}
                onSubmitEditing={sendTripChat}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[s.tcSendBtn, !tripChatInput.trim() && { opacity: 0.4 }]}
                onPress={sendTripChat}
                disabled={!tripChatInput.trim()}>
                <Ionicons name="send" size={18} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SOS Modal */}
      {/* 🎙 Ovozli buyurtma modali */}
      <Modal visible={voiceModal} transparent animationType="slide" onRequestClose={closeVoiceOrder}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16, alignItems: 'center' }]}>
            <Text style={[s.modalTitle, { color: WHITE }]}>{t('voice_order_title')}</Text>
            <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginBottom: 20, paddingHorizontal: 10 }}>
              {t('voice_instr')}
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
                <Text style={{ color: GRAY1, fontSize: 15, fontWeight: '600' }}>{t('analyzing')}</Text>
              </View>
            ) : (
              <Text style={{ color: recording ? RED : GRAY1, fontSize: 15, fontWeight: '600', marginTop: 18 }}>
                {recording ? `${t('recording_lbl')} ${voiceSec}s` : t('hold_to_speak')}
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
                  {t('voice_retry_hint')}
                </Text>
                <TouchableOpacity
                  onPress={() => { setVoiceModal(false); setVoiceClarify(''); setSearchOpen(true); }}
                  style={{ marginTop: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: YELLOW, borderRadius: 10 }} activeOpacity={0.85}>
                  <Text style={{ color: '#1A1A1A', fontSize: 14, fontWeight: '700' }}>{t('manual_search')}</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity onPress={closeVoiceOrder} style={{ marginTop: 20, alignItems: 'center' }}>
              <Text style={{ color: GRAY1, fontSize: 15 }}>{t('close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={sosModal} transparent animationType="slide" onRequestClose={() => setSosModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={[s.modalTitle, { color: RED }]}>{t('sos_title')}</Text>
            {[{ num: '101', label: t('fire_lbl') }, { num: '102', label: t('police_lbl') }, { num: '103', label: t('ambulance_lbl') }].map(s_ => (
              <TouchableOpacity key={s_.num} style={[s.ctaBtn, { backgroundColor: RED, marginBottom: 10 }]}
                onPress={() => Linking.openURL(`tel:${s_.num}`)}>
                <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>{s_.num} — {s_.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.ctaBtn} onPress={shareTrip}>
              <Text style={s.ctaBtnTxt}>{t('share_location')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSosModal(false)} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: GRAY1, fontSize: 15 }}>{t('cancel_btn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manzilni o'zgartirish modali */}
      <Modal visible={changeDestModal} transparent animationType="slide" onRequestClose={() => setChangeDestModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16, maxHeight: '75%' }]}>
            <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>{t('new_dest')}</Text>
            <Text style={{ color: GRAY1, fontSize: 12, marginBottom: 12 }}>
              {t('new_dest_sub')}
            </Text>
            <TextInput
              style={s.searchBigInput}
              placeholder={t('search_addr_ph')}
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
                <Text style={{ color: GRAY1, textAlign: 'center', marginTop: 16 }}>{t('not_found')}</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[s.outlineBtn, { justifyContent: 'center', marginTop: 12 }]}
              onPress={() => setChangeDestModal(false)}
            >
              <Text style={{ color: GRAY1, fontSize: 14 }}>{t('cancel_short')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Cancel Modal */}
      {/* C1: vaqt tanlash bottom-sheet — SOF JS chiplar (native picker YO'Q, OTA buzilmaydi) */}
      <Modal visible={schedModal} transparent animationType="slide" onRequestClose={() => setSchedModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: insets.bottom + 18 }}>
            <Text style={{ color: WHITE, fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 12 }}>{t('sched_when')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {[t('today_cap'), t('tomorrow'), t('after_tomorrow')].map((nm, i) => (
                <TouchableOpacity key={nm} onPress={() => setSchedDay(i)}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', borderWidth: 1.5,
                    borderColor: schedDay === i ? YELLOW : BORDER, backgroundColor: schedDay === i ? '#1a1707' : CARD2 }}>
                  <Text style={{ color: schedDay === i ? YELLOW : WHITE, fontSize: 13, fontWeight: '700' }}>{nm}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: GRAY1, fontSize: 12, marginBottom: 6 }}>{t('hour_lbl')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => (
                <TouchableOpacity key={h} onPress={() => setSchedHour(h)}
                  style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, marginRight: 8, borderWidth: 1.5,
                    borderColor: schedHour === h ? YELLOW : BORDER, backgroundColor: schedHour === h ? '#1a1707' : CARD2 }}>
                  <Text style={{ color: schedHour === h ? YELLOW : WHITE, fontSize: 14, fontWeight: '700' }}>{String(h).padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={{ color: GRAY1, fontSize: 12, marginBottom: 6 }}>{t('minute_lbl')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {[0, 15, 30, 45].map((m) => (
                <TouchableOpacity key={m} onPress={() => setSchedMin(m)}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', borderWidth: 1.5,
                    borderColor: schedMin === m ? YELLOW : BORDER, backgroundColor: schedMin === m ? '#1a1707' : CARD2 }}>
                  <Text style={{ color: schedMin === m ? YELLOW : WHITE, fontSize: 14, fontWeight: '700' }}>:{String(m).padStart(2, '0')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* UI-B1: yagona Btn tizimi — tasdiq primary, bekor ghost */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn kind="ghost" title={t('cancel_short')} onPress={() => setSchedModal(false)} style={{ flex: 1 }} />
              <Btn kind="primary" title={t('confirm_btn')} style={{ flex: 1.5 }}
                onPress={() => {
                  const now = new Date();
                  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + schedDay, schedHour, schedMin, 0);
                  // Backend talabi (config SCHEDULE_MIN_MIN=15): kamida 15 daqiqa keyinga
                  if (d.getTime() - now.getTime() < 15 * 60000) {
                    toast(t('time_too_close_msg'), 'error');
                    return;
                  }
                  setSchedAt(d);
                  setSchedModal(false);
                }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelModal} transparent animationType="slide" onRequestClose={() => setCancelModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.modalTitle}>{t('cancel_reason_title')}</Text>
            <View style={s.helpTopicsCard}>
              {CANCEL_REASONS.map((r, i, arr) => (
                <View key={i}>
                  <TouchableOpacity style={s.helpTopicRow} onPress={() => confirmCancel(t(r))}>
                    <Text style={{ color: WHITE, fontSize: 15, flex: 1 }}>{t(r)}</Text>
                    <Ionicons name="chevron-forward" size={15} color={GRAY2} />
                  </TouchableOpacity>
                  {i < arr.length - 1 && <View style={s.placeSep} />}
                </View>
              ))}
            </View>
            <TextInput
              style={[s.chatInput, { marginTop: 12 }]}
              placeholder={t('other_reason_ph')}
              placeholderTextColor={GRAY2}
              value={customReason}
              onChangeText={setCustomReason}
            />
            {customReason.trim().length > 2 && (
              <TouchableOpacity style={[s.ctaBtn, { backgroundColor: RED, marginTop: 10 }]} onPress={() => confirmCancel(customReason)}>
                <Text style={{ color: WHITE, fontWeight: '700', fontSize: 15 }}>{t('cancel_up')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setCancelModal(false)} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: GRAY1 }}>{t('back')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Y1: SEVIMLI MANZILLAR bottom-sheet — profil menyusidan ochiladi
          (avval Alert.alert bilan o'lik ro'yxat edi). "Ketdik" bosilsa sheet yopilib,
          buyurtma tabida pickDest orqali oqim darrov boshlanadi. */}
      <Modal visible={favSheet} transparent animationType="slide" onRequestClose={() => setFavSheet(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: insets.bottom + 18, maxHeight: '80%' }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: WHITE, fontSize: 17, fontWeight: '800', flex: 1 }}>{t('fav_places')}</Text>
              <TouchableOpacity onPress={() => setFavSheet(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={GRAY1} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {!favAddMode ? (
                <>
                  {favorites.length === 0 && (
                    <View style={{ alignItems: 'center', marginVertical: 22, paddingHorizontal: 20 }}>
                      <Ionicons name="heart-outline" size={40} color={GRAY2} />
                      <Text style={{ color: WHITE, fontSize: 15, fontWeight: '700', marginTop: 10 }}>{t('no_fav_yet')}</Text>
                      <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>{t('no_fav_sub')}</Text>
                    </View>
                  )}
                  {favorites.map((f, i) => (
                    <View key={f.id ?? i}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                        <Text style={{ fontSize: 20, marginRight: 12 }}>{f.name === 'Uy' ? '🏠' : f.name === 'Ish' ? '💼' : '📍'}</Text>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{f.name}</Text>
                          {!!f.address && f.address !== f.name && (
                            <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{f.address}</Text>
                          )}
                        </View>
                        {f.lat != null && f.lng != null && (
                          /* UI-B1: primary kichik variant */
                          <Btn kind="primary" title={`${t('fav_go')} →`}
                            onPress={() => { setFavSheet(false); setTab('order'); pickDest({ lat: Number(f.lat), lng: Number(f.lng), address: f.address || f.name }); }}
                            style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 10 }}
                            textStyle={{ fontSize: 12 }} />
                        )}
                        <TouchableOpacity onPress={() => removeFavorite(f.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 10 }}>
                          <Ionicons name="close-circle" size={20} color={GRAY2} />
                        </TouchableOpacity>
                      </View>
                      {i < favorites.length - 1 && <View style={{ height: 0.5, backgroundColor: BORDER }} />}
                    </View>
                  ))}
                  <TouchableOpacity activeOpacity={0.8}
                    style={{ borderWidth: 1.5, borderColor: BORDER, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14 }}
                    onPress={() => { setFavPickPlace(null); setFavNewName(''); setFavAddMode(true); loadRecentPlaces(); }}>
                    <Text style={{ color: YELLOW, fontSize: 14, fontWeight: '700' }}>{t('fav_add_new')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 10 }}>{t('fav_pick_recent')}</Text>
                  {recentPlaces.length === 0 && (
                    <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginVertical: 16 }}>{t('no_recent')}</Text>
                  )}
                  {recentPlaces.map((p, i) => {
                    const sel = favPickPlace && favPickPlace.address === p.address;
                    return (
                      <TouchableOpacity key={i} activeOpacity={0.8}
                        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: sel ? YELLOW : BORDER, backgroundColor: sel ? '#1a1707' : CARD2, borderRadius: 12, padding: 12, marginBottom: 8 }}
                        onPress={() => setFavPickPlace(p)}>
                        <Ionicons name="location" size={16} color={sel ? YELLOW : GRAY1} style={{ marginRight: 10 }} />
                        <Text style={{ color: sel ? YELLOW : WHITE, fontSize: 14, flex: 1 }} numberOfLines={1}>{p.address}</Text>
                        {sel && <Ionicons name="checkmark-circle" size={18} color={YELLOW} />}
                      </TouchableOpacity>
                    );
                  })}
                  {favPickPlace && (
                    <>
                      <TextInput
                        style={[s.chatInput, { marginTop: 8 }]}
                        placeholder={t('fav_name_ph')} placeholderTextColor={GRAY2}
                        value={favNewName} onChangeText={setFavNewName}
                      />
                      <TouchableOpacity
                        style={[s.ctaBtn, { height: 48, marginTop: 12 }, !favNewName.trim() && { opacity: 0.5 }]}
                        disabled={!favNewName.trim()} onPress={saveFavoriteNamed}>
                        <Text style={[s.ctaBtnTxt, { fontSize: 15 }]}>{t('fav_save')}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity onPress={() => setFavAddMode(false)} style={{ marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: GRAY1 }}>{t('back')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Y1: TO'LOV USULI sheet — profil menyusidan ochiladi (avval Alert.alert edi).
          Tanlov mavjud payMethod state'iga bog'lanadi (createOrder shu state'ni yuboradi),
          bonus balans esa use_bonus flag'i bilan keyingi buyurtmaga ulanadi. */}
      <Modal visible={paySheet} transparent animationType="slide" onRequestClose={() => setPaySheet(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: insets.bottom + 18 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: GRAY2, alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: WHITE, fontSize: 17, fontWeight: '800', flex: 1 }}>{t('pay_choose_t')}</Text>
              <TouchableOpacity onPress={() => setPaySheet(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={GRAY1} />
              </TouchableOpacity>
            </View>
            {payMethods.map((m) => {
              const selected = payMethod === m.id;
              const disabled = m.active === false;
              return (
                <TouchableOpacity key={m.id} activeOpacity={0.8} disabled={disabled}
                  style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: selected ? YELLOW : BORDER, backgroundColor: selected ? '#1a1707' : CARD2, borderRadius: 12, padding: 14, marginBottom: 8, opacity: disabled ? 0.45 : 1 }}
                  onPress={() => setPayMethod(m.id)}>
                  <Text style={{ fontSize: 20, marginRight: 12 }}>{PAY_ICONS[m.id] || '💳'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: selected ? YELLOW : WHITE, fontSize: 15, fontWeight: '700' }}>
                      {m.id === 'cash' ? t('pay_cash') : m.name}{disabled ? ` (${t('soon')})` : ''}
                    </Text>
                    <Text style={{ color: GRAY1, fontSize: 12, marginTop: 2 }}>
                      {m.id === 'cash' ? t('pay_cash_sub') : t('pay_card_sub')}
                    </Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={20} color={YELLOW} />}
                </TouchableOpacity>
              );
            })}
            {/* Bonus balans — keyingi safarga ishlatish (createOrder → use_bonus, narxning 50% gacha) */}
            <View style={{ borderWidth: 1.5, borderColor: useBonus ? YELLOW : BORDER, backgroundColor: useBonus ? '#1a1707' : CARD2, borderRadius: 12, padding: 14, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 20, marginRight: 12 }}>🎁</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: WHITE, fontSize: 15, fontWeight: '700' }}>{t('pay_bonus')}</Text>
                  <Text style={{ color: YELLOW, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{fmt(balance?.balance || 0)} {t('som')}</Text>
                </View>
              </View>
              <TouchableOpacity activeOpacity={0.8} disabled={!(Number(balance?.balance) > 0)}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, opacity: Number(balance?.balance) > 0 ? 1 : 0.45 }}
                onPress={() => setUseBonus((v) => !v)}>
                <Ionicons name={useBonus ? 'checkbox' : 'square-outline'} size={22} color={useBonus ? YELLOW : GRAY1} style={{ marginRight: 10 }} />
                <Text style={{ color: useBonus ? YELLOW : GRAY1, fontSize: 14, fontWeight: '600', flex: 1 }}>{t('use_next_trip')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* KetdikGo AI yordamchi Modal — suzuvchi tugma / Yordam kartasidan ochiladi */}
      <Modal visible={aiModal} animationType="slide" onRequestClose={() => setAiModal(false)}>
        {/* KLAVIATURA: Modal ichida adjustResize ishlamaydi — behavior='height' bilan
            chat input klaviatura ochilganda tepaga suriladi (Android). */}
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setAiModal(false)} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={24} color={WHITE} />
            </TouchableOpacity>
            <Ionicons name="sparkles" size={18} color={YELLOW} style={{ marginRight: 8 }} />
            <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>{t('ai_name')}</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 8 }}>
            {chat.length === 0 && (
              <Text style={{ color: GRAY1, fontSize: 14, textAlign: 'center', marginTop: 24 }}>
                {t('ai_empty')}
              </Text>
            )}
            {chat.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAI]}>
                <Text style={m.role === 'user' ? s.bubbleUserTxt : s.bubbleAITxt}>{m.text}</Text>
              </View>
            ))}
            {chatLoading && <ActivityIndicator color={YELLOW} style={{ marginTop: 8 }} />}
          </ScrollView>
          <View style={[s.chatRow, { paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 8 }]}>
            <TextInput
              style={s.chatInput}
              placeholder={t('your_question_ph')} placeholderTextColor={GRAY2}
              value={chatInput} onChangeText={setChatInput}
              onSubmitEditing={sendChat} returnKeyType="send"
            />
            <TouchableOpacity style={s.chatSendBtn} onPress={sendChat} disabled={chatLoading}>
              <Ionicons name="send" size={18} color="#000" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
              <Text style={[s.modalTitle, mfont('800')]}>{t('trip_finished')}</Text>
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
                        <Text style={{ color: GRAY1, fontSize: 13 }}>{t('trip_fare_lbl')}</Text>
                        <Text style={{ color: WHITE, fontSize: 13, fontWeight: '500' }}>{fmt(base)} {t('som')}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Ionicons name="time" size={13} color={RED} />
                          <Text style={{ color: RED, fontSize: 13 }}>{t('wait_fee_lbl')}</Text>
                        </View>
                        <Text style={{ color: RED, fontSize: 13, fontWeight: '600' }}>+{fmt(waitFee)} {t('som')}</Text>
                      </View>
                      <View style={{ height: 1, backgroundColor: BORDER, marginBottom: 10 }} />
                    </>
                  )}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>{t('total_pay')}</Text>
                    <Text style={{ color: YELLOW, fontSize: 22, fontWeight: '800' }}>{fmt(total)} {t('som')}</Text>
                  </View>
                  <Text style={{ color: GRAY1, fontSize: 12, marginTop: 4 }}>
                    {completedOrder.payment_method === 'cash' ? t('cash_pay') : t('card_pay')}
                    {completedOrder.distance_km ? ` · ${completedOrder.distance_km} km` : ''}
                  </Text>
                </View>
              );
            })()}

            {/* Yulduzli baho */}
            <Text style={{ color: GRAY1, fontSize: 13, textAlign: 'center', marginBottom: 10 }}>{t('rate_driver')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setStars(n)}>
                  <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={38} color={YELLOW} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Choychaqa */}
            <Text style={{ color: GRAY1, fontSize: 13, marginBottom: 8 }}>{t('tip_lbl')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
              {[0, 2000, 5000, 10000].map(a => (
                <TouchableOpacity key={a} style={[s.payChip, tipAmount === a && s.payChipActive]}
                  onPress={() => setTipAmount(a)}>
                  <Text style={[s.payChipTxt, tipAmount === a && { color: '#000', fontWeight: '700' }]}>
                    {a === 0 ? t('no') : `${fmt(a)}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* UI-B1: primary + baho tanlanmaguncha vizual disabled (submitRating'dagi
                stars guard saqlanadi — bu faqat qo'shimcha vizual holat) */}
            <Btn kind="primary" title={t('rate_up')} onPress={submitRating}
              loading={loading} disabled={stars === 0}
              style={{ minHeight: 56, borderRadius: 16, marginTop: 16 }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// C1: buyurtma rejalashtirilgan va vaqti hali kelmaganmi? Kelajak bo'lsa ms qaytaradi.
function schedFutureMs(order) {
  if (!order || !order.scheduled_at || !['searching', 'assigned'].includes(order.status)) return 0;
  const ms = Date.parse(String(order.scheduled_at).replace(' ', 'T') + (String(order.scheduled_at).includes('Z') || String(order.scheduled_at).includes('+') ? '' : 'Z'));
  return Number.isFinite(ms) && ms > Date.now() ? ms : 0;
}
// C1: 'Bugun 08:15' / 'Ertaga 08:15' ko'rinishi
function fmtSched(d) {
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - day0) / 86400000);
  const nm = dd === 0 ? t('today_cap') : dd === 1 ? t('tomorrow') : dd === 2 ? t('after_tomorrow') : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${nm} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusText(status) {
  const m = {
    searching:   t('status_searching'),
    assigned:    t('status_searching'),
    accepted:    t('status_accepted'),
    arrived:     t('status_arrived'),
    in_progress: t('status_in_progress'),
    completed:   t('status_completed'),
    cancelled:   t('status_cancelled'),
    paid:        t('status_paid'),
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
function CustomerWaitTimer({ arrivedAt, cfg }) {
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
  // P3 (K-1): bepul oyna/daqiqa narxi SERVERDAN (wait_update.freeSec/perMin) —
  // admin o'zgartirsa darhol mos; kelmagan bo'lsa lokal konstanta zaxira.
  const freeSec = (cfg && cfg.freeSec > 0) ? cfg.freeSec : FREE_WAIT_SEC;
  const perMin = (cfg && cfg.perMin > 0) ? cfg.perMin : WAIT_PER_MIN;
  const free = sec < freeSec;
  const remain = Math.max(0, freeSec - sec);
  const mm = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  // Haqiqiy haq — server hisobi ustun (cfg.fee), lokal hisob faqat zaxira
  const localFee = Math.min(WAIT_FEE_MAX, Math.ceil(Math.max(0, sec - freeSec) / 60) * perMin);
  const fee = (cfg && cfg.fee > 0) ? cfg.fee : localFee;
  return (
    <View style={{
      backgroundColor: CARD2, borderRadius: 14, padding: 14, marginTop: 12, marginHorizontal: 16,
      alignItems: 'center', borderWidth: 1, borderColor: free ? GREEN + '40' : RED + '40',
    }}>
      <Text style={{ color: WHITE, fontSize: 15, fontWeight: '600' }}>{t('driver_waiting')} · {mm(sec)}</Text>
      {free ? (
        <Text style={{ color: GREEN, fontSize: 13, marginTop: 4 }}>{t('free_wait')}: {mm(remain)} {t('left_lbl')}</Text>
      ) : (
        <Text style={{ color: RED, fontSize: 13, fontWeight: '600', marginTop: 4 }}>
          {t('paid_wait')} · {fmt(fee)} {t('som')} {t('will_add')}
        </Text>
      )}
    </View>
  );
}

// T-04: Professional qidiruv indikatori — radar pulse (Yandex Go / Bolt uslubi).
// Uch halqa markazdan kengayib, xira bo'lib yo'qoladi (radar). Markazда KetdikGo
// sariq doirasidagi mashina belgisi. Holat matni bosqichma-bosqich yangilanadi.
function SearchingPulse() {
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  const r3 = useRef(new Animated.Value(0)).current;
  const [msgIdx, setMsgIdx] = useState(0);
  const MSGS = [t('srch_msg1'), t('srch_msg2'), t('srch_msg3')];
  useEffect(() => {
    const rings = [r1, r2, r3];
    const anims = rings.map((v, i) => Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 2200, delay: i * 730, easing: Easing.out(Easing.ease), useNativeDriver: true })
    ));
    anims.forEach((a) => a.start());
    const t = setInterval(() => setMsgIdx((m) => Math.min(m + 1, MSGS.length - 1)), 3500);
    return () => { anims.forEach((a) => a.stop()); clearInterval(t); };
  }, []);
  const ring = (v, key) => (
    <Animated.View key={key} style={{
      position: 'absolute', width: 150, height: 150, borderRadius: 75,
      borderWidth: 2, borderColor: YELLOW,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
    }} />
  );
  return (
    <View style={{ alignItems: 'center', paddingVertical: 22, gap: 14 }}>
      <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
        {ring(r1, 'a')}{ring(r2, 'b')}{ring(r3, 'c')}
        <View style={{
          width: 76, height: 76, borderRadius: 38, backgroundColor: YELLOW,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: YELLOW, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8,
        }}>
          <Ionicons name="car-sport" size={38} color="#15171C" />
        </View>
      </View>
      <Text style={{ color: WHITE, fontSize: 17, fontWeight: '700' }}>{t('searching_title')}</Text>
      <Text style={{ color: GRAY1, fontSize: 13.5, textAlign: 'center', paddingHorizontal: 24 }}>{MSGS[msgIdx]}</Text>
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
const BORDER = '#262A31';
const YELLOW = '#FFCC00'; // KetdikGo brend sarig'i (butun ilova — ko'k olib tashlandi)
const GREEN = '#22C55E';
const RED = '#FF453A';
const WHITE = '#FFFFFF';
const GRAY1 = '#8E8E93';
const GRAY2 = '#48484A';

// ============================================================
//  UI-B3: BREND XABAR TIZIMI — TOAST + CONFIRM/INFO MODAL
//  Tizim Alert.alert'lari o'rniga yagona brend ko'rinishi. Modul darajasidagi
//  bus'lar — ilovaning istalgan joyidan (komponent ichi yoki tashqarisi) chaqirsa
//  bo'ladi. <BrandToast/> va <BrandModal/> App root'da bir marta ulanadi.
//  Matnlar L lug'atida (uz/ru) — alohida strings.js YO'Q.
// ============================================================
const ToastBus = { fn: null, show(msg, kind) { this.fn && this.fn(msg, kind); } };
function toast(msg, kind = 'info') { ToastBus.show(msg, kind); } // kind: 'info'|'success'|'error'
const ModalBus = { fn: null, show(opts) { this.fn && this.fn(opts); } };
// opts: { title, message, confirmText, cancelText, onConfirm, onCancel, danger }
function showConfirm(opts) { ModalBus.show(opts); }

// Qisqa bildirishnoma (2.5s) — pastdan suzib chiqadi, o'zi yo'qoladi.
function BrandToast() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState(null); // { msg, kind }
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef(null);
  useEffect(() => {
    ToastBus.fn = (msg, kind = 'info') => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setState({ msg: String(msg == null ? '' : msg), kind });
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true })
          .start(() => setState(null));
      }, 2500);
    };
    return () => { ToastBus.fn = null; if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);
  if (!state) return null;
  const edge = state.kind === 'success' ? GREEN : state.kind === 'error' ? RED : YELLOW;
  const ic = state.kind === 'success' ? 'checkmark-circle' : state.kind === 'error' ? 'alert-circle' : 'information-circle';
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 84, zIndex: 99999,
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
    }}>
      <View style={{
        backgroundColor: '#1E1E1E', borderRadius: 14, borderLeftWidth: 4, borderLeftColor: edge,
        paddingVertical: 13, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center',
        shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
      }}>
        <Ionicons name={ic} size={20} color={edge} style={{ marginRight: 10 }} />
        <Text style={[{ color: '#FFFFFF', fontSize: 14.5, fontWeight: '700', flex: 1 }, mfont('700')]}>{state.msg}</Text>
      </View>
    </Animated.View>
  );
}

// Tasdiq / ma'lumot modali — Btn tugmalar, orqafon bosilsa yopiladi.
function BrandModal() {
  const [modal, setModal] = useState(null);
  useEffect(() => { ModalBus.fn = setModal; return () => { ModalBus.fn = null; }; }, []);
  const cur = modal;
  const doCancel = () => { setModal(null); cur && cur.onCancel && cur.onCancel(); };
  const doConfirm = () => { setModal(null); cur && cur.onConfirm && cur.onConfirm(); };
  return (
    <Modal visible={!!modal} transparent animationType="fade" onRequestClose={doCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <TouchableOpacity activeOpacity={1} onPress={doCancel}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        {cur ? (
          <View style={{ width: '100%', maxWidth: 420, backgroundColor: '#15171c', borderRadius: 16, borderWidth: 1, borderColor: '#262A31', padding: 22 }}>
            {cur.title ? <Text style={[{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginBottom: cur.message ? 8 : 18 }, mfont('800')]}>{cur.title}</Text> : null}
            {cur.message ? <Text style={[{ color: '#8A8F98', fontSize: 15, lineHeight: 21, marginBottom: 20 }, mfont('600')]}>{cur.message}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {cur.cancelText ? (
                <Btn kind="ghost" title={cur.cancelText} onPress={doCancel} style={{ flex: 1, borderWidth: 1.5, borderColor: '#262A31' }} />
              ) : null}
              <Btn kind={cur.danger ? 'danger' : 'primary'} title={cur.confirmText || t('ready')} onPress={doConfirm} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// X4: safar chati — soat (HH:MM) formatlash. ts ixtiyoriy; bo'lmasa kelgan vaqt.
function fmtClock(ms) {
  const d = new Date(ms || Date.now());
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
// X4: mijoz tez javob chiplari (i18n kalitlar — sendTripChat orqali darrov yuboriladi)
const CUSTOMER_QUICK = ['qr_coming', 'qr_2min', 'qr_where', 'qr_thanks'];

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
    // Ixcham kartalar scroll qiladi, TO'LOV+tugma pastda FIXED turadi (column layout)
    flexDirection: 'column',
  },
  tariffCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD2,
    borderRadius: 14,
    padding: 10,
    paddingLeft: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  tariffCardActive: { backgroundColor: '#111' },
  // Pastki FIXED panel: to'lov usuli + katta tugma (scroll qilinmaydi, kesilmaydi)
  tariffFooter: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: CARD,
  },
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

  // Tab bar — UI-B2: fon #15171c, yuqorida 1px chegara #262A31 (haydovchi ilovasi bilan bir xil)
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 6,
    flexDirection: 'row',
    backgroundColor: '#15171c',
    borderTopWidth: 1,
    borderTopColor: '#262A31',
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // UI-B2: tab matni 11px, nofaol #8A8F98; faolda sariq
  tabTxt: { fontSize: 11, color: '#8A8F98', marginTop: 4, fontWeight: '600' },
  tabActive: { color: YELLOW, fontWeight: '700' },
  // UI-B2: faol buyurtma badge'i — ikonka yuqori-o'ngida 6px sariq nuqta
  tabDot: { position: 'absolute', top: -1, right: -4, width: 6, height: 6, borderRadius: 3, backgroundColor: YELLOW },
  // Y1/UI-B2: faol tab indikator chizig'i (nofaolda shaffof — joy sakramaydi)
  tabDash: { width: 18, height: 3, borderRadius: 2, marginTop: 3, backgroundColor: 'transparent' },

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

  // X4: safar chati (trip chat) — professional ko'rinish. AI chat stillari (bubble*,
  // chatRow, chatInput) o'zgarmagan; bular alohida tc* kalitlar.
  tcHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: BORDER },
  tcAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: CARD2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  tcAvatarTxt: { color: YELLOW, fontSize: 18, fontWeight: '800' },
  tcTitle: { color: WHITE, fontSize: 17, fontWeight: '700' },
  tcSub: { color: GRAY1, fontSize: 12, marginTop: 2 },
  tcRow: { width: '100%' },
  tcRowMine: { alignItems: 'flex-end' },
  tcRowTheirs: { alignItems: 'flex-start' },
  tcBubble: { maxWidth: '78%', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18 },
  tcMine: { backgroundColor: YELLOW, borderBottomRightRadius: 4 },
  tcTheirs: { backgroundColor: CARD2, borderBottomLeftRadius: 4 },
  tcBubbleTxt: { fontSize: 15, lineHeight: 20 },
  tcMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  tcTime: { fontSize: 10 },
  tcEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  tcEmptyTxt: { color: GRAY1, fontSize: 14, marginTop: 10 },
  tcQrRow: { maxHeight: 46, borderTopWidth: 1, borderTopColor: BORDER },
  tcQrContent: { paddingVertical: 8, gap: 8, alignItems: 'center' },
  tcChip: { backgroundColor: CARD2, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  tcChipTxt: { color: WHITE, fontSize: 13, fontWeight: '600' },
  tcInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10 },
  tcInput: { flex: 1, backgroundColor: CARD2, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, color: WHITE, fontSize: 15, borderWidth: 1, borderColor: BORDER },
  tcSendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: YELLOW, alignItems: 'center', justifyContent: 'center' },
});
