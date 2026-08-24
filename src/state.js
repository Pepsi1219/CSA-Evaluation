// ============================================================
// STATE — shared cross-module runtime state + helpers.
// Multiple modules read the current language / GA config / metadata
// dictionaries; putting them here (instead of in app.js) avoids
// hard-to-untangle circular imports.
// ============================================================
import { translations } from './translations.js';

// GA4 config (feature-flagged — leave `_ENABLED = false` to disable).
export const GA4_MEASUREMENT_ID = 'G-9M9C6NZJ6Y';
export const GA4_ENABLED        = true;

// i18n metadata (unit label per language, used by chart + history rows).
export const pcsPerHr = { th: 'ชิ้น/ชม.', en: 'pcs/hr', vn: 'SP/giờ', la: 'ຊິ້ນ/ຊມ' };

// Currently selected language. Mutable via setCurrentLang(); consumers
// import the live binding and see updates. Default is Thai (also the
// fallback in t()).
export let currentLang = 'th';
export function setCurrentLang(lang) { currentLang = lang; }

// Translation lookup. Falls back through: chosen lang → Thai → raw key.
// A raw key coming back means the string is missing from the dictionary
// (translations.test.js fails the build when that happens for th/en/vn/la).
export const t = key => translations[currentLang]?.[key] ?? translations.th[key] ?? key;

// GA4 event fire. Silent no-op if GA is disabled or gtag hasn't loaded
// yet (e.g. offline / blocked). Consumers don't need to null-check.
export function gaTrack(eventName, params = {}) {
    if (!GA4_ENABLED || typeof gtag === 'undefined') return;
    gtag('event', eventName, params);
}
