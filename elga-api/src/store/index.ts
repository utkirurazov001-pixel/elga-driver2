/**
 * In-memory data store — DATABASE_URL bo'sh bo'lganda ishlatiladi (demo/skelet).
 * Production'da bu qatlam Prisma repozitoriylari bilan almashtiriladi
 * (jadval shakllari prisma/schema.prisma da bir xil).
 *
 * Maqsad: admin panel (app.elga.uz) darhol real API'ga ulanib ishlashi.
 */
import bcrypt from 'bcryptjs';
import { CITIES, TARIFFS, DEFAULT_COMMISSION, type Role } from '../config/constants';
import { env } from '../config/env';

// ---------- Tiplar ----------
export interface AdminUser {
  id: string; login: string; password_hash: string; full_name: string;
  phone: string; role: Role; is_active: boolean; last_login_at: string | null;
}
export interface Driver {
  id: string; park_number: number; full_name: string; phone: string;
  status: 'free' | 'busy' | 'offline' | 'blocked';
  car_make: string; car_model: string; car_plate: string; car_color: string;
  tariff: string; rating: number; orders_count: number; balance: number;
  kyc_status: 'pending' | 'approved' | 'rejected'; city: string;
  lat: number; lng: number;
}
export interface Client {
  id: string; full_name: string; phone: string; is_blocked: boolean;
  orders_count: number; total_spent: number; tier: 'bronze' | 'silver' | 'gold';
  points: number; registered_at: string;
}
export interface Order {
  id: string; client: string; client_id: string; client_phone: string;
  driver: string | null; driver_id: string | null; park: number | null;
  from_city: string; from_place: string; to_city: string; to_place: string;
  route_type: 'intra' | 'inter'; tariff: string; distance: number; duration: number;
  price: number; commission: number; payment: string; payment_status: string;
  status: string; cancel_reason: string | null; created_at: string;
}
export interface Place { id: string; city: string; name: string; count: number; source: string; added_at: string; }
export interface Withdrawal { id: string; driver: string; driver_id: string; driver_phone: string; park: number; amount: number; provider: string; status: string; requested_at: string; }
export interface Txn { id: string; type: string; order: string | null; who: string; amount: number; provider: string; status: string; created_at: string; }
export interface Complaint { id: string; order: string; category: string; source: string; who: string; city: string; description: string; status: string; created_at: string; }
export interface Reward { id: string; title: string; description: string; cost_points: number; type: string; stock: number; is_active: boolean; }
export interface Promo { id: string; code: string; type: string; value: number; min_order: number; usage_limit: number; used_count: number; valid_to: string; is_active: boolean; }
export interface AuditLog { id: string; user_id: string; user: string; role: string; action: string; entity: string; entity_id: string; detail: string; ip: string; created_at: string; }

// ---------- Seed yordamchilari ----------
const FIRST = ['Dilshod', 'Madina', 'Aziz', 'Nilufar', 'Bobur', 'Sardor', 'Gulnora', 'Jasur', 'Kamola', 'Zarina', 'Otabek', 'Malika', 'Rustam', 'Dilnoza', 'Akmal', 'Sevara', 'Bekzod', 'Nodira'];
const LAST = ['Tursunov', 'Rahimova', 'Karimov', 'Saidova', 'Toshev', 'Yusupov', 'Qodirov', 'Nazarov', 'Murodov', 'Hakimova', 'Sobirov', 'Aliyev', 'Sultonov', 'Xolmatov'];
const CARS: Array<[string, string]> = [['Chevrolet', 'Cobalt'], ['Chevrolet', 'Nexia 3'], ['Chevrolet', 'Lacetti'], ['Chevrolet', 'Gentra'], ['Chevrolet', 'Spark'], ['Daewoo', 'Matiz']];
const COLORS = ['Oq', 'Kulrang', 'Qora', 'Kumush', 'Bej'];
const PLACES: Record<string, string[]> = {
  Angor: ['Markaz', 'Elektroset', '15 bayroq', 'Yangi bozor', "Temir yo'l vokzali", 'Sanoat zonasi', "Do'stlik MFY", 'Paxtakor'],
  Muzrabot: ['Markaz', 'Pariqishloq', 'Xalqabod', 'Navbahor', 'Oqoltin', "Bandixon yo'li"],
  "Jarqo'rg'on": ['Markaz', 'Sharq', 'Markaziy bozor', 'Yangiobod', 'Vokzal'],
  Sherobod: ['Markaz', "Qiziriq yo'li", 'Bozor', 'Vokzal'],
  Termiz: ['Markaz', 'Vokzal', 'Aeroport', 'Alpomish maydoni', 'Markaziy bozor', 'Universitet'],
  Denov: ['Markaz', 'Markaziy bozor', "Sariosiyo yo'li", 'Yangiariq'],
};
const CITY_COORDS: Record<string, [number, number]> = {
  Angor: [37.4775, 67.1419], Muzrabot: [37.5806, 67.2933], "Jarqo'rg'on": [37.5072, 67.4131],
  Sherobod: [37.6736, 67.0019], Termiz: [37.2242, 67.2783], Denov: [38.2675, 67.8953],
};

function seeded(n: number): number { const x = Math.sin(n) * 10000; return x - Math.floor(x); }
function pick<T>(a: readonly T[], i: number): T { return a[((i % a.length) + a.length) % a.length] as T; }
function rawPhone(seed: number): string {
  const ops = ['90', '91', '93', '94', '97', '99', '88', '33'];
  const op = pick(ops, seed);
  const a = 100 + Math.floor(seeded(seed) * 899);
  const b = 10 + Math.floor(seeded(seed + 1) * 89);
  const c = 10 + Math.floor(seeded(seed + 2) * 89);
  return `998${op}${a}${b}${c}`.slice(0, 12);
}
function placeOf(city: string, seed: number): string { const arr = PLACES[city] ?? ['Markaz']; return arr[Math.floor(seeded(seed) * arr.length)] as string; }

// ---------- Store ----------
class MemoryStore {
  adminUsers: AdminUser[] = [];
  drivers: Driver[] = [];
  clients: Client[] = [];
  orders: Order[] = [];
  places: Place[] = [];
  withdrawals: Withdrawal[] = [];
  transactions: Txn[] = [];
  complaints: Complaint[] = [];
  rewards: Reward[] = [];
  promos: Promo[] = [];
  audit: AuditLog[] = [];
  tariffs = [
    { id: 'TF1', name: 'ekonom', base_fare: 8000, per_km: 1500, per_min: 300, min_fare: 12000, surge_multiplier: 1.0, commission_percent: 15, is_active: true },
    { id: 'TF2', name: 'komfort', base_fare: 12000, per_km: 2200, per_min: 450, min_fare: 18000, surge_multiplier: 1.0, commission_percent: 15, is_active: true },
    { id: 'TF3', name: 'biznes', base_fare: 20000, per_km: 3500, per_min: 700, min_fare: 30000, surge_multiplier: 1.2, commission_percent: 18, is_active: true },
  ];

  private placeIndex: Record<string, Place> = {};
  private seq = 10621;

  async init(): Promise<void> {
    // Admin foydalanuvchilar (parol bcrypt — AUTH-01)
    const hash = await bcrypt.hash(env.seed.adminPassword, 12);
    const roles: Role[] = ['super_admin', 'operator', 'finance_admin', 'dispatcher', 'moderator'];
    const names = ['Utkir Urazov', "Sardor To'shev", 'Gulnora Ergasheva', 'Jasur Qodirov', 'Rustam Murodov'];
    const logins = [env.seed.adminLogin, 'operator1', 'finance1', 'disp1', 'mod1'];
    roles.forEach((r, i) => {
      this.adminUsers.push({
        id: `AU${i + 1}`, login: logins[i] as string, password_hash: hash, full_name: names[i] as string,
        phone: rawPhone(i + 2), role: r, is_active: true, last_login_at: null,
      });
    });

    // Haydovchilar
    for (let i = 0; i < 48; i++) {
      const nm = `${pick(FIRST, i)} ${pick(LAST, i + 3)}`;
      const car = pick(CARS, i);
      const city = pick(CITIES, i);
      const c = CITY_COORDS[city] ?? [37.55, 67.3];
      const status = i < 6 ? 'blocked' : i % 4 === 0 ? 'offline' : i % 3 === 0 ? 'busy' : 'free';
      this.drivers.push({
        id: `DR${101 + i}`, park_number: 326 + ((i * 7) % 180), full_name: nm, phone: rawPhone(i + 20),
        status: status as Driver['status'], car_make: car[0], car_model: car[1],
        car_plate: `01 ${100 + i} ${pick(['AAB', 'BCA', 'CCB', 'DEF', 'GHK'], i)}`, car_color: pick(COLORS, i),
        tariff: pick(TARIFFS, i % 3), rating: +(4.2 + seeded(i) * 0.79).toFixed(2),
        orders_count: 120 + Math.floor(seeded(i + 5) * 1800), balance: Math.floor(seeded(i + 2) * 1500) * 1000,
        kyc_status: i < 6 ? 'approved' : pick(['approved', 'approved', 'pending', 'rejected'] as const, i),
        city, lat: c[0] + (seeded(i) - 0.5) * 0.14, lng: c[1] + (seeded(i + 1) - 0.5) * 0.18,
      });
    }

    // Mijozlar
    for (let i = 0; i < 60; i++) {
      const nm = `${pick(FIRST, i + 5)} ${pick(LAST, i + 1)}`;
      this.clients.push({
        id: `CL${2001 + i}`, full_name: nm, phone: rawPhone(i + 40), is_blocked: i % 23 === 0,
        orders_count: 3 + Math.floor(seeded(i) * 240), total_spent: (50 + Math.floor(seeded(i + 1) * 900)) * 1000,
        tier: i % 9 === 0 ? 'gold' : i % 4 === 0 ? 'silver' : 'bronze', points: Math.floor(seeded(i + 3) * 1800),
        registered_at: this.dateAgo(i * 5 + 2),
      });
    }

    // Buyurtmalar (to'liq manzil modeli)
    const oStatus = ['completed', 'in_progress', 'searching', 'assigned', 'cancelled', 'new'];
    for (let i = 0; i < 140; i++) {
      const cl = pick(this.clients, i);
      const dr = pick(this.drivers, i + 2);
      const st = i < 3 ? pick(['new', 'searching'], i) : pick(oStatus, i % 6);
      const fromCity = pick(CITIES, i);
      const inter = seeded(i + 50) < 0.3;
      let toCity = fromCity;
      if (inter) { toCity = pick(CITIES, i + 3); if (toCity === fromCity) toCity = pick(CITIES, i + 1); }
      const fromPlace = placeOf(fromCity, i + 1);
      let toPlace = placeOf(toCity, i + 7);
      if (toPlace === fromPlace && !inter) toPlace = placeOf(toCity, i + 13);
      const assigned = st !== 'new' && st !== 'searching';
      const price = inter ? (35 + Math.floor(seeded(i) * 70)) * 1000 : (12 + Math.floor(seeded(i) * 26)) * 1000;
      this.orders.push({
        id: `#${10620 - i}`, client: cl.full_name, client_id: cl.id, client_phone: cl.phone,
        driver: assigned ? dr.full_name : null, driver_id: assigned ? dr.id : null, park: assigned ? dr.park_number : null,
        from_city: fromCity, from_place: fromPlace, to_city: toCity, to_place: toPlace, route_type: inter ? 'inter' : 'intra',
        tariff: pick(TARIFFS, i % 3), distance: +(inter ? 20 + seeded(i) * 70 : 1.5 + seeded(i) * 8).toFixed(1),
        duration: inter ? 30 + Math.floor(seeded(i + 1) * 60) : 5 + Math.floor(seeded(i + 1) * 22),
        price, commission: Math.round(price * (DEFAULT_COMMISSION / 100)), payment: pick(['cash', 'payme', 'click', 'balance'], i),
        payment_status: st === 'completed' ? 'paid' : 'pending', status: st,
        cancel_reason: st === 'cancelled' ? pick(['Mijoz topilmadi', 'Haydovchi rad etdi', 'Narx kelishmadi'], i) : null,
        created_at: this.minsAgo(i * 7 + 3),
      });
    }

    // Mo'ljallar lug'ati (seed + buyurtmalardan to'plangan)
    CITIES.forEach((c) => (PLACES[c] ?? []).forEach((n) => this.regPlace(c, n, 'seed')));
    this.orders.forEach((o) => { this.regPlace(o.from_city, o.from_place, 'seed'); this.regPlace(o.to_city, o.to_place, 'seed'); });

    // Pul yechish
    for (let i = 0; i < 14; i++) {
      const d = pick(this.drivers, i + 1);
      this.withdrawals.push({
        id: `WD${501 + i}`, driver: d.full_name, driver_id: d.id, driver_phone: d.phone, park: d.park_number,
        amount: (3 + Math.floor(seeded(i) * 22)) * 100000, provider: i % 2 ? 'payme' : 'click',
        status: i < 5 ? 'pending' : i % 3 === 0 ? 'paid' : i % 5 === 0 ? 'rejected' : 'approved', requested_at: this.minsAgo(i * 40 + 12),
      });
    }

    // Tranzaksiyalar
    const ttype = ['ride_payment', 'commission', 'topup', 'withdrawal', 'refund'];
    for (let i = 0; i < 80; i++) {
      this.transactions.push({
        id: `TX${90001 + i}`, type: pick(ttype, i % 5), order: i % 3 ? `#${10620 - i}` : null,
        who: pick(this.drivers, i).full_name, amount: (10 + Math.floor(seeded(i) * 140)) * 1000,
        provider: pick(['payme', 'click', 'cash', 'balance'], i % 4), status: i % 11 === 0 ? 'failed' : i % 7 === 0 ? 'pending' : 'success',
        created_at: this.minsAgo(i * 11 + 5),
      });
    }

    // Shikoyatlar
    const ccat = ['Haydovchi kechikdi', "Noto'g'ri narx", 'Avtomobil holati', 'Bekor qilish to\'lovi', "Qo'pol muomala"];
    for (let i = 0; i < 13; i++) {
      const cl = pick(this.clients, i + 7);
      this.complaints.push({
        id: `CM${401 + i}`, order: `#${10402 - i * 3}`, category: pick(ccat, i), source: i % 4 === 0 ? 'driver' : 'client',
        who: cl.full_name, city: pick(CITIES, i), description: 'Mijoz shikoyati — operator tekshirishi kerak.',
        status: i < 5 ? 'new' : i % 2 ? 'in_review' : 'resolved', created_at: this.minsAgo(i * 55 + 5),
      });
    }

    // Sovg'alar va promo-kodlar
    this.rewards = [
      { id: 'RW1', title: "5 000 so'm chegirma", description: 'Keyingi safarga chegirma', cost_points: 200, type: 'discount', stock: 9999, is_active: true },
      { id: 'RW2', title: 'Bepul safar (Ekonom)', description: 'Shahar ichi 1 ta bepul safar', cost_points: 850, type: 'free_ride', stock: 120, is_active: true },
      { id: 'RW3', title: '10% chegirma kuponi', description: '30 kun amal qiladi', cost_points: 400, type: 'discount', stock: 500, is_active: true },
      { id: 'RW4', title: 'ELGA termo-stakan', description: 'Brendlangan sovg\'a', cost_points: 1500, type: 'gift', stock: 40, is_active: true },
    ];
    this.promos = [
      { id: 'PR1', code: 'YANGI2026', type: 'percent', value: 20, min_order: 20000, usage_limit: 1000, used_count: 412, valid_to: '2026-12-31', is_active: true },
      { id: 'PR2', code: 'TERMIZ50', type: 'fixed', value: 5000, min_order: 30000, usage_limit: 500, used_count: 288, valid_to: '2026-08-01', is_active: true },
      { id: 'PR3', code: 'BONUS100', type: 'points', value: 100, min_order: 0, usage_limit: 2000, used_count: 1340, valid_to: '2026-07-15', is_active: true },
    ];
  }

  // ---- helperlar ----
  regPlace(city: string, name: string, source: string): Place {
    const key = `${city}|${name}`;
    const ex = this.placeIndex[key];
    if (ex) { ex.count++; return ex; }
    const p: Place = { id: `PL${this.places.length + 1}`, city, name, count: 1, source, added_at: source === 'seed' ? this.dateAgo(Math.floor(seeded(this.places.length) * 40)) : 'hozir' };
    this.places.push(p); this.placeIndex[key] = p; return p;
  }
  nextOrderId(): string { return `#${this.seq++}`; }
  findDriver(id: string) { return this.drivers.find((d) => d.id === id); }
  findOrder(id: string) { return this.orders.find((o) => o.id === id); }
  findClient(id: string) { return this.clients.find((c) => c.id === id); }
  addAudit(a: Omit<AuditLog, 'id' | 'created_at'>): AuditLog {
    const log: AuditLog = { ...a, id: `LG${8000 + this.audit.length + 1}`, created_at: 'hozir' };
    this.audit.unshift(log);
    return log;
  }
  minsAgo(m: number): string {
    if (m < 60) return `${m} daq oldin`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} soat oldin`;
    return `${Math.floor(h / 24)} kun oldin`;
  }
  dateAgo(d: number): string {
    const dt = new Date(2026, 5, 21); dt.setDate(dt.getDate() - d);
    const mm = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
    return `${dt.getDate()}-${mm[dt.getMonth()]} ${dt.getFullYear()}`;
  }
}

export const store = new MemoryStore();
