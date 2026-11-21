import { Suspense } from "react";
import { LoginView } from "../../../src/views/LoginView";

// The button depends on a runtime variable, so this page cannot be prerendered at build time.
export const dynamic = "force-dynamic";

// useSearchParams needs a suspense boundary for static prerendering.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginView googleEnabled={process.env.GOOGLE_OAUTH_ENABLED === "true"} />
    </Suspense>
  );
}
