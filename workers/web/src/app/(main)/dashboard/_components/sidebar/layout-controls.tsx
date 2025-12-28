"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { updateContentLayout } from "@/lib/layout-utils";
import { updateThemeMode, updateThemePreset } from "@/lib/theme-utils";
import { setValueToCookie } from "@/server/server-actions";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import type { SidebarVariant, SidebarCollapsible, ContentLayout } from "@/types/preferences/layout";
import { LOCALE_OPTIONS, type Locale } from "@/types/preferences/locale";
import { THEME_PRESET_OPTIONS, type ThemePreset, type ThemeMode } from "@/types/preferences/theme";

type LayoutControlsProps = {
  readonly variant: SidebarVariant;
  readonly collapsible: SidebarCollapsible;
  readonly contentLayout: ContentLayout;
};

export function LayoutControls(props: LayoutControlsProps) {
  const { variant, collapsible, contentLayout } = props;
  const t = useTranslations("LayoutControls");
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const themePreset = usePreferencesStore((s) => s.themePreset);
  const setThemePreset = usePreferencesStore((s) => s.setThemePreset);
  const locale = usePreferencesStore((s) => s.locale);
  const setLocale = usePreferencesStore((s) => s.setLocale);

  const handleValueChange = async (key: string, value: any) => {
    if (key === "theme_mode") {
      updateThemeMode(value);
      setThemeMode(value as ThemeMode);
    }

    if (key === "theme_preset") {
      updateThemePreset(value);
      setThemePreset(value as ThemePreset);
    }

    if (key === "content_layout") {
      updateContentLayout(value);
    }

    if (key === "locale") {
      setLocale(value as Locale);
    }

    await setValueToCookie(key, value);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon">
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <h4 className="text-sm leading-none font-medium">{t("title")}</h4>
            <p className="text-muted-foreground text-xs">{t("description")}</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">{t("language")}</Label>
              <Select value={locale} onValueChange={(value) => handleValueChange("locale", value)}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder={t("language_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {LOCALE_OPTIONS.map((lang) => (
                    <SelectItem key={lang.value} className="text-xs" value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">{t("preset")}</Label>
              <Select value={themePreset} onValueChange={(value) => handleValueChange("theme_preset", value)}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder={t("preset_placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {THEME_PRESET_OPTIONS.map((preset) => (
                    <SelectItem key={preset.value} className="text-xs" value={preset.value}>
                      <span
                        className="size-2.5 rounded-full"
                        style={{
                          backgroundColor: themeMode === "dark" ? preset.primary.dark : preset.primary.light,
                        }}
                      />
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">{t("mode")}</Label>
              <ToggleGroup
                className="w-full"
                size="sm"
                variant="outline"
                type="single"
                value={themeMode}
                onValueChange={(value) => handleValueChange("theme_mode", value)}
              >
                <ToggleGroupItem className="text-xs" value="light" aria-label="Toggle light">
                  {t("light")}
                </ToggleGroupItem>
                <ToggleGroupItem className="text-xs" value="dark" aria-label="Toggle dark">
                  {t("dark")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">{t("sidebar_variant")}</Label>
              <ToggleGroup
                className="w-full"
                size="sm"
                variant="outline"
                type="single"
                value={variant}
                onValueChange={(value) => handleValueChange("sidebar_variant", value)}
              >
                <ToggleGroupItem className="text-xs" value="inset" aria-label="Toggle inset">
                  {t("inset")}
                </ToggleGroupItem>
                <ToggleGroupItem className="text-xs" value="sidebar" aria-label="Toggle sidebar">
                  {t("sidebar")}
                </ToggleGroupItem>
                <ToggleGroupItem className="text-xs" value="floating" aria-label="Toggle floating">
                  {t("floating")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">{t("sidebar_collapsible")}</Label>
              <ToggleGroup
                className="w-full"
                size="sm"
                variant="outline"
                type="single"
                value={collapsible}
                onValueChange={(value) => handleValueChange("sidebar_collapsible", value)}
              >
                <ToggleGroupItem className="text-xs" value="icon" aria-label="Toggle icon">
                  {t("icon")}
                </ToggleGroupItem>
                <ToggleGroupItem className="text-xs" value="offcanvas" aria-label="Toggle offcanvas">
                  {t("offcanvas")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">{t("content_layout")}</Label>
              <ToggleGroup
                className="w-full"
                size="sm"
                variant="outline"
                type="single"
                value={contentLayout}
                onValueChange={(value) => handleValueChange("content_layout", value)}
              >
                <ToggleGroupItem className="text-xs" value="centered" aria-label="Toggle centered">
                  {t("centered")}
                </ToggleGroupItem>
                <ToggleGroupItem className="text-xs" value="full-width" aria-label="Toggle full-width">
                  {t("full_width")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
