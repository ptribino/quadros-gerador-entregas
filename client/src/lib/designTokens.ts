import type { CSSProperties } from "react";

/**
 * Tokens do redesign "Curadoria de Catálogo" (handoff 2026-07-10), extraídos
 * pra cá pra serem reaproveitados em outras telas (Home.tsx) sem duplicar as
 * constantes. Não mexe no tema global (index.css) — continua opt-in por tela.
 */

export const FONT_SANS: CSSProperties = { fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" };
export const FONT_MONO: CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" };

export const FIELD_LABEL_CLASS =
  "mb-[7px] block text-[11.5px] font-bold uppercase tracking-[0.02em] text-[#8A8680]";
export const FIELD_INPUT_CLASS =
  "h-auto w-full rounded-[7px] border-[#E2E0DB] bg-white px-[11px] py-[9px] text-[13.5px] text-[#1C1B1A] shadow-none focus-visible:border-[#4338CA] focus-visible:ring-[#4338CA]/30";
export const GHOST_BTN_CLASS =
  "rounded-[7px] border border-[#E2E0DB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#57534E] hover:bg-[#F7F6F4] disabled:bg-[#F1F0EE] disabled:text-[#B4B0A8] disabled:opacity-100 disabled:border-[#E2E0DB]";
export const PRIMARY_BTN_CLASS =
  "rounded-[7px] bg-[#4338CA] text-white hover:bg-[#3730A3] disabled:bg-[#F1F0EE] disabled:text-[#B4B0A8] disabled:opacity-100";
