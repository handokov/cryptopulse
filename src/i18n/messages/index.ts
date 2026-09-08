/** Aggregated message catalogs keyed by locale. */

import en, { type Messages } from "./en";
import id from "./id";
import zh from "./zh";
import es from "./es";
import pt from "./pt";
import ja from "./ja";
import type { Locale } from "../config";

export const ALL_MESSAGES: Record<Locale, Messages> = { en, id, zh, es, pt, ja };

export type { Messages };
export { default as enMessages } from "./en";
