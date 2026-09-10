/**
 * The staff area's chrome boundary.
 *
 * It holds no gate. It used to show a "please sign in" card driven by the
 * prototype viewer in browser storage, which was decoration standing where
 * access control belonged — and once a real staff session existed, it became
 * worse than decoration: a reviewer holding a valid staff cookie was shown
 * that card whenever the unrelated prototype viewer happened to be signed out,
 * and the card masked the server's own redirect.
 *
 * The gate is the server. Each page checks the signed staff session and
 * redirects to /admin/login, and every Server Action checks it again because
 * an action is a separate entry point. If this component renders, the request
 * was already allowed.
 *
 * The staff sections themselves live in the app header, which swaps to them
 * inside /admin — one navigation bar rather than a second band under the first.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
