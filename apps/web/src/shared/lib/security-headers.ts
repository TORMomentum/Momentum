/**
 * The web app's security response headers (TOR-321, ASVS V3.4), built in one place so the
 * proxy (`proxy.ts`, Next 16's name for middleware) stays a thin shell and the rules are testable.
 *
 * The CSP is nonce-based: every request gets a fresh nonce, Next stamps it on its own inline
 * scripts, and `'strict-dynamic'` lets those scripts load the chunks they need. A nonce is only
 * available to dynamically rendered pages, so the app renders per request (it already does:
 * the root layout reads the session cookie).
 */

/** The in-app original viewer: the document bytes the web app's own pages frame in an iframe. */
const VIEWER_PATH = /^\/(?:admin\/)?tors\/[^/]+\/(?:document|pages\/[^/]+)\/?$/;

export function isViewerPath(pathname: string): boolean {
  return VIEWER_PATH.test(pathname);
}

/** A fresh, unguessable value per request (a v4 UUID carries 122 random bits). */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Extra sources an environment may need (a CDN for images, an analytics endpoint); space-separated, default none. */
function extra(name: string, env: NodeJS.ProcessEnv): string[] {
  return (env[name] ?? "").split(/\s+/).filter(Boolean);
}

export function buildCsp(nonce: string, pathname: string, env: NodeJS.ProcessEnv = process.env): string {
  const dev = env.NODE_ENV !== "production";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in development: React's dev tooling needs it, production does not.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Next's dev server injects <style> without a nonce.
    "style-src": ["'self'", dev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    // React `style={{…}}` renders style="" attributes (chart positions, progress bars). A nonce cannot cover an
    // attribute; this allows inline style ATTRIBUTES only — <style> elements and scripts stay nonce-gated.
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", ...extra("CSP_EXTRA_IMG_SRC", env)],
    "font-src": ["'self'"],
    // The browser talks only to this Next server (it proxies the API); dev adds the HMR websocket via 'self'.
    "connect-src": ["'self'", ...extra("CSP_EXTRA_CONNECT_SRC", env)],
    // The original viewer iframes our own document route.
    "frame-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": [isViewerPath(pathname) ? "'self'" : "'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** Every security header for one response. `nonce` is the same value the request carries as `x-nonce`. */
export function securityHeaders(
  nonce: string,
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(nonce, pathname, env),
    // Legacy twin of frame-ancestors for browsers that ignore CSP3.
    "X-Frame-Options": isViewerPath(pathname) ? "SAMEORIGIN" : "DENY",
  };
}
