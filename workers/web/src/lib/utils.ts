import jwt from "@tsndr/cloudflare-worker-jwt";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type JwtPayload = {
  sub: string;
  identifier: string;
  exp: number;
  iat: number;
  type: string;
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getInitials = (str: string): string => {
  if (typeof str !== "string" || !str.trim()) return "?";

  return (
    str
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?"
  );
};

export function formatCurrency(
  amount: number,
  opts?: {
    currency?: string;
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    noDecimals?: boolean;
  },
) {
  const { currency = "USD", locale = "en-US", minimumFractionDigits, maximumFractionDigits, noDecimals } = opts ?? {};

  const formatOptions: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    minimumFractionDigits: noDecimals ? 0 : minimumFractionDigits,
    maximumFractionDigits: noDecimals ? 0 : maximumFractionDigits,
  };

  return new Intl.NumberFormat(locale, formatOptions).format(amount);
}

export async function verifyJWT(token: string, secret: string): Promise<{
  ok: boolean;
  payload?: JwtPayload;
  error?: string;
}> {
  try {
    const isValid = await jwt.verify(token, secret);
    if (!isValid) {
      return { ok: false, error: 'Invalid token' };
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.payload) {
      return { ok: false, error: 'Invalid token payload' };
    }

    const isExpired = isTokenExpired(decoded.payload as JwtPayload);
    if (isExpired) {
      return { ok: false, error: 'Token is expired' };
    }

    return { ok: true, payload: decoded.payload as JwtPayload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Token verification failed'
    };
  }
}

function isTokenExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  return payload.exp < Math.floor(Date.now() / 1000);
}