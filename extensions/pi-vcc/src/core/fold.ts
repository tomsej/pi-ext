/**
 * Diacritics-folded lowercase form, so Czech patterns match both "udělej" and
 * "udelej". Users type either, often in the same session.
 */
export const fold = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
