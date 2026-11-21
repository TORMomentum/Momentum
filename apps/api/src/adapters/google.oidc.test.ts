import { createSign, generateKeyPairSync } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { describe, expect, it } from "vitest";
import { GoogleOidcAdapter } from "./google.oidc.js";

const CLIENT_ID = "client-1.apps.googleusercontent.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key";

function b64(value: object | Buffer): string {
  return (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString("base64url");
}

/** A real RS256 JWT signed with a local key; the adapter validates it exactly as it would one from Google. */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "sub-1", iat: now, exp: now + 300, email: "v@example.test", email_verified: true, nonce: "n-1", ...claims };
  const signingInput = `${b64({ alg: "RS256", typ: "JWT", kid: KID })}.${b64(body)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${b64(signature)}`;
}

/** The OAuth client with Google's network calls replaced: the code exchange returns our token, the key set is ours. */
function adapterReturning(token: string) {
  const client = new OAuth2Client({ clientId: CLIENT_ID, clientSecret: "secret", redirectUri: "https://app.example.test/api/auth/google/callback" });
  client.getToken = (async () => ({ tokens: { id_token: token }, res: null })) as unknown as typeof client.getToken;
  client.getFederatedSignonCertsAsync = (async () => ({ certs: { [KID]: publicKey.export({ type: "spki", format: "pem" }) as string }, format: "PEM" })) as unknown as typeof client.getFederatedSignonCertsAsync;
  return new GoogleOidcAdapter({ clientId: CLIENT_ID, clientSecret: "secret", redirectUri: "https://app.example.test/api/auth/google/callback", client });
}

describe("GoogleOidcAdapter", () => {
  it("builds an authorization-code URL with PKCE S256, state and nonce", () => {
    const url = new URL(adapterReturning("x").authorizationUrl({ state: "s-1", nonce: "n-1", codeChallenge: "c-1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: "https://app.example.test/api/auth/google/callback",
      state: "s-1", nonce: "n-1", code_challenge: "c-1", code_challenge_method: "S256", scope: "openid email profile",
    });
  });

  it("returns the claims of a valid token", async () => {
    await expect(adapterReturning(idToken({ name: "Vendor", hd: "example.test", azp: CLIENT_ID })).exchange({ code: "c", codeVerifier: "v" })).resolves.toEqual({
      sub: "sub-1", email: "v@example.test", emailVerified: true, hostedDomain: "example.test", name: "Vendor", nonce: "n-1",
    });
  });

  it("rejects a token issued for another audience", async () => {
    await expect(adapterReturning(idToken({ aud: "someone-else" })).exchange({ code: "c", codeVerifier: "v" })).rejects.toThrow();
  });

  it("rejects a token from another issuer", async () => {
    await expect(adapterReturning(idToken({ iss: "https://evil.example.test" })).exchange({ code: "c", codeVerifier: "v" })).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(adapterReturning(idToken({ iat: past - 300, exp: past })).exchange({ code: "c", codeVerifier: "v" })).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    const forged = idToken({}).split(".").slice(0, 2).join(".") + "." + b64(Buffer.from("not-the-signature"));
    await expect(adapterReturning(forged).exchange({ code: "c", codeVerifier: "v" })).rejects.toThrow();
  });

  it("rejects a token whose authorised party is another client", async () => {
    await expect(adapterReturning(idToken({ azp: "other-client" })).exchange({ code: "c", codeVerifier: "v" })).rejects.toThrow("azp");
  });

  it("reports an address Google does not vouch for as unverified", async () => {
    const identity = await adapterReturning(idToken({ email_verified: false })).exchange({ code: "c", codeVerifier: "v" });
    expect(identity.emailVerified).toBe(false);
  });
});
