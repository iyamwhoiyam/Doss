export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' | 'accent';

export interface Option {
  value: string;
  label: string;
  tone?: Tone;
  blurb?: string;
  gate?: boolean;
  wipLimit?: number;
}

export interface RoleDef { label: string; rank: number; blurb: string }
export const ROLES: Record<string, RoleDef>;
export const ROLE_KEYS: string[];
export const PERMISSIONS: Record<string, string[]>;
export function can(role: string | undefined, permission: string): boolean;

export const TONES: Tone[];
export const CUSTOMER_STATUS: Option[];
export const CUSTOMER_TIERS: Option[];
export const VENDOR_STATUS: Option[];
export const VENDOR_CATEGORIES: Option[];
export const ITEM_TYPES: Option[];
export const UOMS: string[];
export const LOT_STATUS: Option[];
export const LOCATION_TYPES: Option[];
export const TXN_TYPES: Option[];
export const PO_STATUS: Option[];
export const SO_STATUS: Option[];
export const PRIORITIES: Option[];
export const HEALTH: Option[];
export const PRODUCT_LOCK_STATES: Option[];
export const SAMPLE_TYPES: Option[];
export const SAMPLE_STATUS: Option[];
export const RFQ_STATUS: Option[];
export const RFQ_SOURCE: Option[];
export const PROJECT_STAGES: Option[];
export const PROJECT_TERMINAL: Option[];
export const PROJECT_TYPES: Option[];
export const WORK_ORDER_STAGES: Option[];
export const WORK_ORDER_TERMINAL: Option[];
export const TASK_STATUS: Option[];

export interface FormatDef {
  value: string;
  label: string;
  defaultWeightMg: number;
  laborPer1000: [number, number];
  service: string;
}
export const FORMULA_FORMATS: FormatDef[];
export const FORMULA_STATUS: Option[];
export const QUOTE_STATUS: Option[];
export const CAPSULE_SHELLS: Record<string, { min: number; max: number }>;
export const BULK_FORMATS: string[];
export const QUOTE_DEFAULTS: {
  overagePct: number;
  coaFee: number;
  leadTimeWeeks: number;
  paymentTerms: string;
  validDays: number;
  qcPctOfProduction: number;
};
export const OVERHEAD_BANDS: { upTo: number; rate: number; label: string }[];
export function overheadRateForQty(qty: number): number;

export const DOCUMENT_CATEGORIES: Option[];
export const DOCUMENT_STATUS: Option[];
export const DOCUMENT_OWNER_TYPES: string[];
export const LABEL_REVIEW_STATUS: Option[];
export const CHECKLIST_STATES: Option[];
export const FINDING_TYPES: Option[];
export const FINDING_DECISIONS: Option[];

export interface NavItem { to: string; label: string; icon: string; perm?: string }
export const NAV: { group: string; items: NavItem[] }[];

export function optionsFrom(list: Option[]): { value: string; label: string }[];
export function findOption(list: Option[], value: string | undefined | null): Option;
export function toneOf(list: Option[], value: string | undefined | null): Tone;
export function labelOf(list: Option[], value: string | undefined | null): string;
export function enumValues(list: Option[]): string[];
