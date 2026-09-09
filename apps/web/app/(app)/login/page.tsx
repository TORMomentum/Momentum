import { Suspense } from "react";
import { LoginView } from "../../../src/views/LoginView";

// useSearchParams needs a suspense boundary for static prerendering.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginView />
    </Suspense>
  );
}
