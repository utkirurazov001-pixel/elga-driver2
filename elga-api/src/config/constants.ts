/**
 * ELGA TAXI 1226 — o'zgarmas konstantalar (brand.config.json bilan mos).
 * RULE-03/04/05/07 — bu qiymatlar hech qachon o'zgartirilmaydi.
 */

// RULE-03 — ishonch langari, doimiy faol
export const DISPATCHER = '1226' as const;

// RULE-04 — faqat shu shaharlar (Surxondaryo)
export const CITIES = ['Angor', 'Muzrabot', "Jarqo'rg'on", 'Sherobod', 'Termiz', 'Denov'] as const;
export type City = (typeof CITIES)[number];

export const REGION = 'Surxondaryo';
export const COUNTRY = "O'zbekiston";

export const TARIFFS = ['ekonom', 'komfort', 'biznes'] as const;

// RULE-05/07 — brend
export const BRAND = {
  name: 'ELGA TAXI',
  dispatcher: DISPATCHER,
  tagline: 'HAR DOIM YONINGIZDA!',
  pillars: ['TEZ', 'XAVFSIZ', 'ISHONCHLI'] as const,
  colors: { gold: '#FFCC00', goldDark: '#C9A24B', dark: '#15171C', white: '#FFFFFF' },
  font: 'Manrope',
} as const;

// RBAC rollar (TZ §4.2)
export const ROLES = ['super_admin', 'operator', 'finance_admin', 'dispatcher', 'moderator'] as const;
export type Role = (typeof ROLES)[number];

// Buyurtma holat mashinasi (BE-FR-001)
export const ORDER_FLOW: Record<string, string | null> = {
  new: 'searching',
  searching: 'assigned',
  assigned: 'arriving',
  arriving: 'in_progress',
  in_progress: 'completed',
  completed: null,
  cancelled: null,
};

export const DEFAULT_COMMISSION = 15; // %
export const POINTS_PER_SUM = 1000; // har 1000 so'm = 1 ball (BE-FR-050)
