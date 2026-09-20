import { parsePhoneNumberWithError, ParseError } from "libphonenumber-js/max";

/**
 * Maps Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to standard ASCII (0-9).
 */
const DIGIT_TRANSLATION_MAP: Record<string, string> = {
  // Arabic-Indic digits (\u0660-\u0669)
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9",
  // Eastern Arabic-Indic digits (\u06F0-\u06F9)
  "\u06F0": "0",
  "\u06F1": "1",
  "\u06F2": "2",
  "\u06F3": "3",
  "\u06F4": "4",
  "\u06F5": "5",
  "\u06F6": "6",
  "\u06F7": "7",
  "\u06F8": "8",
  "\u06F9": "9",
};

const ARABIC_DIGITS_REGEX = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Translates any Arabic-Indic or Eastern Arabic-Indic numerals in a string to standard ASCII digits.
 */
export function normalizeDigits(input: string): string {
  return input.replace(ARABIC_DIGITS_REGEX, (match) => DIGIT_TRANSLATION_MAP[match] ?? match);
}

/**
 * Result of Egyptian mobile number normalization.
 */
export type PhoneNormalizationResult =
  | { success: true; canonicalE164: string; nationalNumber: string }
  | { success: false; errorCode: "INVALID_FORMAT" | "NOT_MOBILE" | "NOT_EGYPTIAN" | "MALFORMED" };

/**
 * Strict Egyptian mobile number normalization and validation.
 *
 * Requirements:
 * - Default country EG (Egypt).
 * - `extract: false` to reject numbers embedded in surrounding text.
 * - Accept national formats: 010..., 011..., 012..., 015...
 * - Accept international formats: +20..., 0020...
 * - Rejects landlines (e.g. 02, 03), VoIP, extensions, non-Egyptian codes.
 * - Enforces standard Egyptian mobile length (national significant number = 10 digits starting with 1).
 * - NEVER infers cellular carrier from prefix (Egypt enforces Mobile Number Portability MNP).
 * - Output format: Canonical E.164 (+201[0125]XXXXXXXX).
 */
export function normalizeEgyptianPhone(rawInput: string): PhoneNormalizationResult {
  if (!rawInput || typeof rawInput !== "string") {
    return { success: false, errorCode: "MALFORMED" };
  }

  // 1. Translate Arabic-Indic / Eastern Arabic numerals to standard ASCII
  let cleaned = normalizeDigits(rawInput.trim());

  // 2. Normalize leading international dialing prefix '0020' to '+20'
  if (cleaned.startsWith("0020")) {
    cleaned = "+20" + cleaned.slice(4);
  }

  // 3. Strict parsing with libphonenumber-js/max (extract: false prevents finding numbers in noise)
  try {
    const parsed = parsePhoneNumberWithError(cleaned, {
      defaultCountry: "EG",
      extract: false,
    });

    // Enforce country code must be Egypt (+20)
    if (parsed.country !== "EG" || parsed.countryCallingCode !== "20") {
      return { success: false, errorCode: "NOT_EGYPTIAN" };
    }

    // Enforce type must be MOBILE
    const numberType = parsed.getType();
    if (numberType !== "MOBILE") {
      return { success: false, errorCode: "NOT_MOBILE" };
    }

    const national = parsed.nationalNumber;
    // Egyptian mobile national numbers MUST have exactly 10 digits and start with 1[0125]
    if (!/^1[0125]\d{8}$/.test(national)) {
      return { success: false, errorCode: "NOT_MOBILE" };
    }

    // Must be completely valid according to metadata
    if (!parsed.isValid()) {
      return { success: false, errorCode: "INVALID_FORMAT" };
    }

    return {
      success: true,
      canonicalE164: parsed.format("E.164"),
      nationalNumber: national,
    };
  } catch (err) {
    if (err instanceof ParseError) {
      return { success: false, errorCode: "INVALID_FORMAT" };
    }
    return { success: false, errorCode: "MALFORMED" };
  }
}

/**
 * Formats a canonical E.164 Egyptian phone number for masked display in user interfaces.
 * Example: `+20 10 **** 1234`
 * Data minimization under Egyptian Law 151/2020: never prints full mobile numbers in UI/logs.
 */
export function formatMaskedPhone(canonicalE164: string): string {
  // Expected canonical E.164: +201012345678 (13 chars)
  if (!canonicalE164.startsWith("+20") || canonicalE164.length < 13) {
    return "+20 ** **** ****";
  }

  const country = canonicalE164.slice(0, 3); // +20
  const mobilePrefix = canonicalE164.slice(3, 5); // 10, 11, 12, 15
  const suffix = canonicalE164.slice(-4); // last 4 digits

  return `${country} ${mobilePrefix} **** ${suffix}`;
}
