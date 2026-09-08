/** Supported locales and their display metadata (native names + ISO flag codes). */

export const LOCALES = [
  { code: "en", label: "English", flag: "us" },
  { code: "id", label: "Bahasa Indonesia", flag: "id" },
  { code: "zh", label: "中文（简体）", flag: "cn" },
  { code: "es", label: "Español", flag: "es" },
  { code: "pt", label: "Português (BR)", flag: "br" },
  { code: "ja", label: "日本語", flag: "jp" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_CODES: Locale[] = LOCALES.map((l) => l.code);

export function isLocale(x: unknown): x is Locale {
  return typeof x === "string" && (LOCALE_CODES as string[]).includes(x);
}

/** Native label for a locale (never translated). */
export function localeLabel(code: Locale): string {
  return LOCALES.find((l) => l.code === code)?.label ?? code;
}

/** ISO 3166-1 alpha-2 country code for the flag icon. */
export function localeFlag(code: Locale): string {
  return LOCALES.find((l) => l.code === code)?.flag ?? code;
}
