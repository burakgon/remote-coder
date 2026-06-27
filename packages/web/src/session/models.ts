import type { ModelOption, SessionMeta } from "../types/server";

/**
 * A curated fallback model list shown BEFORE a live session reports the account's real models (a brand-new
 * session has no init yet). Mirrors the CLI's standard offering; the real list (captured from the init
 * handshake and carried on SessionMeta.availableModels) overrides this whenever it's available. The empty
 * `value:""` entry maps to "let the server decide" (the spawn default) — rendered as "Default".
 */
export const FALLBACK_MODELS: ModelOption[] = [
  { value: "", displayName: "Default (recommended)", description: "The account's default model" },
  { value: "opus", displayName: "Opus", description: "Most capable — best for complex tasks" },
  { value: "sonnet", displayName: "Sonnet", description: "Efficient for routine tasks" },
  { value: "haiku", displayName: "Haiku", description: "Fastest for quick answers" },
];

/**
 * The model list to offer in a picker: the account's REAL models (from any session that has reported them —
 * it's account-wide, identical across sessions) when available, else the curated fallback. The real list
 * already includes its own "default" entry, so it's returned as-is.
 */
export function modelOptions(metas: SessionMeta[]): ModelOption[] {
  const real = metas.find((m) => m.availableModels && m.availableModels.length > 0)?.availableModels;
  return real && real.length > 0 ? real : FALLBACK_MODELS;
}
