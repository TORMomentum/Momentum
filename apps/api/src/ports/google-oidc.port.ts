/**
 * Google as an OpenID Connect provider (TOR-315). The port stops where Google's own claims stop: whether the
 * token is genuine (signature, issuer, audience, expiry) is the adapter's job; whether it answers THIS sign-in
 * (nonce) and whether the address may be trusted (email_verified) is the service's, so both are testable with a
 * stub that needs no Google.
 */
export interface GoogleIdentity {
  /** Google's stable subject. The only thing an account is matched on once linked. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /** The nonce the token echoes; the caller compares it with the one it stored. */
  nonce?: string;
}

export interface GoogleOidc {
  /** The Google URL the browser is sent to (authorization code flow, PKCE S256). */
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string;
  /** Exchanges the code (with the PKCE verifier) and returns the validated ID token's claims. Throws if invalid. */
  exchange(input: { code: string; codeVerifier: string }): Promise<GoogleIdentity>;
}
