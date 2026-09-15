"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import en from "../i18n/en.json";
import ar from "../i18n/ar.json";

type Locale = "en" | "ar";

interface I18nContextType {
  locale: Locale;
  dir: "ltr" | "rtl";
  toggleLocale: () => void;
  setLocale: (locale: Locale) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

type TranslationValue = string | { [key: string]: TranslationValue };
type TranslationRecord = Record<string, TranslationValue>;

const translations: Record<Locale, TranslationRecord> = { en, ar };

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function interpolateTranslation(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return Object.entries(params).reduce<string>((acc, [k, v]) => {
    return acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }, template);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("waffarha_demo_locale") as Locale;
    if (saved === "en" || saved === "ar") {
      queueMicrotask(() => {
        setLocaleState(saved);
      });
    }
  }, []);

  useEffect(() => {
    const dir = locale === "ar" ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
    localStorage.setItem("waffarha_demo_locale", locale);
  }, [locale]);

  const toggleLocale = () => {
    setLocaleState((prev) => (prev === "en" ? "ar" : "en"));
  };

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
  };

  const t = (path: string, params?: Record<string, string | number>): string => {
    const keys = path.split(".");
    let current: TranslationValue = translations[locale];
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        // Fallback to English
        let fallback: TranslationValue = translations.en;
        for (const fbKey of keys) {
          if (fallback && typeof fallback === "object" && fbKey in fallback) {
            fallback = fallback[fbKey];
          } else {
            return path;
          }
        }
        current = fallback;
        break;
      }
    }

    if (typeof current !== "string") {
      return path;
    }

    return interpolateTranslation(current, params);
  };

  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <I18nContext.Provider value={{ locale, dir, toggleLocale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
