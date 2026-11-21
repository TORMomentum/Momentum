import { GoogleConsentView } from "../../../src/views/GoogleConsentView";

export default async function GoogleConsentPage({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const { check } = await searchParams;
  return <GoogleConsentView checkMailbox={check === "mail"} />;
}
