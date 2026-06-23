export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"] as const;

export interface SessionDefaults {
  effort: string;
  model?: string;
  permissionMode: string;
  dangerouslySkip: boolean;
}

const KEY = "remote-coder.defaults";
const FALLBACK: SessionDefaults = { effort: "medium", permissionMode: "default", dangerouslySkip: false };

export function loadDefaults(): SessionDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...FALLBACK };
    const parsed = JSON.parse(raw) as Partial<SessionDefaults>;
    return {
      effort: typeof parsed.effort === "string" ? parsed.effort : FALLBACK.effort,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      permissionMode: typeof parsed.permissionMode === "string" ? parsed.permissionMode : FALLBACK.permissionMode,
      dangerouslySkip: parsed.dangerouslySkip === true,
    };
  } catch {
    return { ...FALLBACK };
  }
}

export function saveDefaults(d: SessionDefaults): void {
  localStorage.setItem(KEY, JSON.stringify(d));
}
