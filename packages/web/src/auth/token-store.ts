// SECURITY: the access token is stored in localStorage — readable by any script in this
// origin (XSS-exposed). This is an accepted trade-off for a single-user self-hosted tool
// (spec §9). Do not store anything more sensitive here.
const KEY = "remote-coder.token";

export function loadToken(): string | undefined {
  const v = localStorage.getItem(KEY);
  return v === null ? undefined : v;
}

export function saveToken(token: string): void {
  localStorage.setItem(KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
}
