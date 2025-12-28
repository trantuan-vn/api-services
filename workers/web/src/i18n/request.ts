import { getRequestConfig } from "next-intl/server";

import { getPreference } from "@/server/server-actions";
import { LOCALE_VALUES, type Locale } from "@/types/preferences/locale";

export default getRequestConfig(async () => {
  // Fallback to 'en-US' if locale is undefined
  const locale = await getPreference<Locale>("locale", LOCALE_VALUES, "en-US");
  return {
    locale: locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
