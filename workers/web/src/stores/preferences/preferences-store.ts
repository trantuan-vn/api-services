import { createStore } from "zustand/vanilla";

import { Locale } from "@/types/preferences/locale";
import type { ThemeMode, ThemePreset } from "@/types/preferences/theme";

export type PreferencesState = {
  themeMode: ThemeMode;
  themePreset: ThemePreset;
  locale: Locale;
  setThemeMode: (mode: ThemeMode) => void;
  setThemePreset: (preset: ThemePreset) => void;
  setLocale: (locale: Locale) => void;
};

export const createPreferencesStore = (init?: Partial<PreferencesState>) =>
  createStore<PreferencesState>()((set) => ({
    themeMode: init?.themeMode ?? "light",
    themePreset: init?.themePreset ?? "default",
    locale: init?.locale ?? "en-US",
    setThemeMode: (mode) => set({ themeMode: mode }),
    setThemePreset: (preset) => set({ themePreset: preset }),
    setLocale: (locale) => set({ locale: locale }),
  }));
