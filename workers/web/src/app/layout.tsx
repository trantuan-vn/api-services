import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";

import { NextIntlClientProvider } from "next-intl";
import { cookieToInitialState } from "wagmi";

import { Toaster } from "@/components/ui/sonner";
import { APP_CONFIG } from "@/config/app-config";
import { getPreference } from "@/server/server-actions";
import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";
import { AuthProvider } from "@/stores/wagmi/auth-provider";
import { LOCALE_VALUES, type Locale } from "@/types/preferences/locale";
import { THEME_MODE_VALUES, THEME_PRESET_VALUES, type ThemePreset, type ThemeMode } from "@/types/preferences/theme";

import "./globals.css";

import { config } from "../config/wagmi-config";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP_CONFIG.meta.title,
  description: APP_CONFIG.meta.description,
};
export default async function RootLayout({ children }: LayoutProps<"/">) {

  const themeMode = await getPreference<ThemeMode>("theme_mode", THEME_MODE_VALUES, "light");
  const themePreset = await getPreference<ThemePreset>("theme_preset", THEME_PRESET_VALUES, "default");
  const locale = await getPreference<Locale>("locale", LOCALE_VALUES, "en-US");
  const cookieHeader = (await headers()).get("cookie");
  const initialState = cookieToInitialState(config, cookieHeader);

  return (
    <html
      lang={locale}
      className={themeMode === "dark" ? "dark" : ""}
      data-theme-preset={themePreset}
      suppressHydrationWarning
    >
      <head>
        {/* Safari iOS cần apple-touch-icon*/}
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180x180.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icons/icon-120x120.png" />
        <link rel="apple-touch-icon" sizes="76x76" href="/icons/icon-76x76.png" />
        {/* Android/Chrome progressive web app icons */}
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className={`${inter.className} min-h-screen antialiased`}>
        <PreferencesStoreProvider themeMode={themeMode} themePreset={themePreset} locale={locale}>
          <NextIntlClientProvider>
            <AuthProvider initialState={initialState}>
              {children}
              <Toaster />
            </AuthProvider>
          </NextIntlClientProvider>
        </PreferencesStoreProvider>
      </body>
    </html>
  );
}
