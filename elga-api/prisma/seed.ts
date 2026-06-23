/**
 * Prisma seed (production DB) — `npm run seed`.
 * Demo: admin/elga1226 + 5 rol, shaharlar, tariflar, mo'ljal seed.
 * Eslatma: DATABASE_URL berilgan va `prisma generate` qilingan bo'lishi kerak.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CITIES = ['Angor', 'Muzrabot', "Jarqo'rg'on", 'Sherobod', 'Termiz', 'Denov'];
const PLACES: Record<string, string[]> = {
  Angor: ['Markaz', 'Elektroset', '15 bayroq', 'Yangi bozor'],
  Muzrabot: ['Markaz', 'Pariqishloq', 'Xalqabod'],
  "Jarqo'rg'on": ['Markaz', 'Markaziy bozor'],
  Sherobod: ['Markaz', 'Bozor'],
  Termiz: ['Markaz', 'Vokzal', 'Aeroport'],
  Denov: ['Markaz', 'Markaziy bozor'],
};

async function main() {
  // Production'da admin paroli muhit o'zgaruvchisidan majburiy olinadi (fail-closed).
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error("Xavfsizlik: production'da SEED_ADMIN_PASSWORD muhit o'zgaruvchisi majburiy.");
  }
  const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? 'elga1226', 12);
  const roles = ['super_admin', 'operator', 'finance_admin', 'dispatcher', 'moderator'] as const;
  const logins = [process.env.SEED_ADMIN_LOGIN ?? 'admin', 'operator1', 'finance1', 'disp1', 'mod1'];
  const names = ['Utkir Urazov', "Sardor To'shev", 'Gulnora Ergasheva', 'Jasur Qodirov', 'Rustam Murodov'];

  for (let i = 0; i < roles.length; i++) {
    await prisma.adminUser.upsert({
      where: { login: logins[i]! },
      update: {},
      create: { login: logins[i]!, password_hash: hash, full_name: names[i]!, phone: `99890000000${i}`, role: roles[i] },
    });
  }

  await prisma.tariff.createMany({
    data: [
      { name: 'ekonom', base_fare: 8000, per_km: 1500, per_min: 300, min_fare: 12000, commission_percent: 15 },
      { name: 'komfort', base_fare: 12000, per_km: 2200, per_min: 450, min_fare: 18000, commission_percent: 15 },
      { name: 'biznes', base_fare: 20000, per_km: 3500, per_min: 700, min_fare: 30000, surge_multiplier: 1.2, commission_percent: 18 },
    ],
    skipDuplicates: true,
  });

  for (const name of CITIES) {
    await prisma.cityZone.upsert({ where: { name }, update: {}, create: { name } });
    for (const place of PLACES[name] ?? []) {
      await prisma.place.upsert({ where: { city_name: { city: name, name: place } }, update: {}, create: { city: name, name: place, source: 'seed' } });
    }
  }

  console.log('Seed tugadi: 5 rol, 6 shahar, mo\'ljallar, 3 tarif.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
