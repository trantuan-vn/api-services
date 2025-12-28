// src/types/preferences/locale.ts
export const LOCALE_OPTIONS = [
  {
    label: "English (US)",
    value: "en-US",
  },
  {
    label: "Tiếng Việt",
    value: "vi-VN",
  },
  // Thêm các locale khác tại đây nếu cần
] as const;

export const LOCALE_VALUES = LOCALE_OPTIONS.map((l) => l.value);

export type Locale = (typeof LOCALE_VALUES)[number];
