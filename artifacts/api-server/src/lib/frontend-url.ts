// Where OAuth callbacks (and other "back to the app" redirects) send the browser. Per instance via FRONTEND_URL.
export const DEFAULT_FRONTEND_URL = "https://gareth.launchriot.online";
export function frontendUrl(path = ""): string {
  const base = (process.env.FRONTEND_URL?.trim() || DEFAULT_FRONTEND_URL).replace(/\/+$/, "");
  return base + (path && !path.startsWith("/") ? "/" + path : path);
}
// Allowed browser origins: APP_ORIGIN and CORS_ORIGINS (comma-separated). Empty = same-origin only (unchanged default).
export function corsOrigins(): string[] {
  return [process.env.APP_ORIGIN, process.env.CORS_ORIGINS].flatMap(v => String(v ?? "").split(",")).map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
}
