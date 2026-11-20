/**
 * HTTP security headers for every response the web server sends (TOR-321,
 * ASVS V3.4, spec §5.6 revision 2026-11-20). Read by next.config.ts's
 * `headers()`; kept here so the policy is one testable value, not prose in a
 * config file.
 *
 * Plain module, no "server-only": next.config.ts imports it at build time.
 */

export interface WebSecurityHeaderOptions {
  /** `next dev` needs eval for React's debugging and a websocket for hot reload. */
  dev: boolean;
  /** Strict-Transport-Security lifetime; 0 sends none. Browsers ignore it over plain HTTP. */
  hstsMaxAgeSeconds: number;
}

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

/**
 * The Content-Security-Policy for pages.
 *
 * - The browser talks only to this origin: the API sits behind the Next server,
 *   fonts are self-hosted by next/font, and there are no third-party scripts or
 *   trackers. So every fetch directive is 'self'.
 * - script-src keeps 'unsafe-inline' because Next's App Router injects inline
 *   bootstrapping scripts. Removing it needs a per-request nonce, which would
 *   make every page dynamic, including the prerendered landing and methodology
 *   pages. React escapes all rendered text, and there is no
 *   dangerouslySetInnerHTML, so the residual XSS risk this leaves is small.
 *   Recorded as an accepted gap (T05).
 * - img-src and worker-src allow blob: and data: for the dashboard's 3-D scene
 *   and for downloads built in the browser (draft text, account export).
 * - frame-src 'self': the original-document viewer frames our own document
 *   route. Nothing else is framed.
 */
export function contentSecurityPolicy({ dev }: Pick<WebSecurityHeaderOptions, "dev">): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "media-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Routes that stream an original document. Our own viewer frames them, so they
 * may be framed by this origin, never by any other, and they get no page CSP:
 * a PDF is not a page, and Chrome's PDF viewer does not render under a strict
 * document policy. They already carry nosniff and no-store from the proxy
 * (document-proxy.ts), and download as attachments unless the viewer asks
 * for inline.
 */
export const FRAMEABLE_DOCUMENT_ROUTES = [
  "/tors/:id/document",
  "/admin/tors/:id/document",
  "/admin/tors/:id/pages/:page",
] as const;

export function securityHeaderRules(options: WebSecurityHeaderOptions): HeaderRule[] {
  const common: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    ...(options.hstsMaxAgeSeconds > 0
      ? [{ key: "Strict-Transport-Security", value: `max-age=${options.hstsMaxAgeSeconds}; includeSubDomains` }]
      : []),
  ];

  // Next applies every matching rule in order, and a later rule's value for the
  // same key wins. So pages get the strict set first, and the document routes
  // override only the framing headers.
  return [
    {
      source: "/:path*",
      headers: [
        ...common,
        { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
    ...FRAMEABLE_DOCUMENT_ROUTES.map((source) => ({
      source,
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
      ],
    })),
  ];
}
