import { ModeToggle } from "./ModeToggle";
import { isStaff } from "../../shared/lib/staff-session";

/**
 * The way back into the staff area, resolved on the server.
 *
 * It is its own component so the LAYOUT does not have to await the session.
 * When the layout awaited it, reading the cookie made every route under the app
 * shell dynamic and started the response early — so a page calling `notFound()`
 * produced the right screen with an HTTP 200, because the stream had already
 * begun. A crawler was told a missing TOR exists.
 *
 * Rendered inside a `<Suspense>` boundary, this resolves on its own and the
 * pages above it keep their status codes. It is the arrangement the rendering
 * spec §7 asks for: the public shell stays static, the session-dependent piece
 * streams into its own hole.
 *
 * The same switch the staff area shows, from the other side.
 */
export async function StaffModeSwitch() {
  if (!(await isStaff())) return null;

  return <ModeToggle mode="site" />;
}
