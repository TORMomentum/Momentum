import { AccountView } from "../../../src/views/AccountActionViews";
import { fetchOwnAccount } from "../../../src/shared/api/profile.api";

/**
 * The consent record is read here, on the server, so the privacy screen states
 * what was agreed to in its first paint. Fetching it from the browser meant the
 * whole consent section was absent from the rendered page.
 */
export default async function AccountPage() {
  const account = await fetchOwnAccount();
  return <AccountView consent={account?.consent ?? null} />;
}
