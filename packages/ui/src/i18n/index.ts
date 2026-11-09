/** R9 locales. English is the source; other catalogues fall back to it key by key until translated. */
export const LOCALES = ["en", "ml", "hi", "ta", "kn", "te"] as const;
export type Locale = (typeof LOCALES)[number];

const en = {
  "shell.skip": "Skip to main content",
  "shell.nav": "Main navigation",
  "empty.default.title": "Nothing here yet",
  "error.default.title": "Something went wrong"
} as const;
export type MessageKey = keyof typeof en;

const catalogues: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en,
  ml: { "shell.skip": "പ്രധാന ഉള്ളടക്കത്തിലേക്ക് പോകുക" },
  hi: { "shell.skip": "मुख्य सामग्री पर जाएं" },
  ta: { "shell.skip": "முதன்மை உள்ளடக்கத்திற்குச் செல்" },
  kn: { "shell.skip": "ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ಹೋಗಿ" },
  te: { "shell.skip": "ప్రధాన కంటెంట్‌కు వెళ్ళండి" }
};

export const t = (locale: Locale, key: MessageKey): string => catalogues[locale][key] ?? en[key];
