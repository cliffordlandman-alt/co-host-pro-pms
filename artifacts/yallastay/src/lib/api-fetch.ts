/** Shared authentication for existing handwritten API callers. Never send tokens off-origin. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (url.origin === window.location.origin && /\/api\//.test(url.pathname)) {
    const owner = window.location.pathname.endsWith('/owner-portal');
    let token: string | null = null;
    try { token = owner ? sessionStorage.getItem('ownerPortalToken') : JSON.parse(localStorage.getItem('ys_auth') || 'null')?.token; } catch {}
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  }
  const response=await fetch(input, { ...init, headers });
  const method=(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if(response.ok && url.origin===window.location.origin && /\/api\//.test(url.pathname) && !["GET","HEAD"].includes(method)) window.dispatchEvent(new Event("pms-data-changed"));
  return response;
}
