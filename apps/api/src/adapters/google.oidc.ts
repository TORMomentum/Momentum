import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { GoogleIdentity, GoogleOidc } from "../ports/google-oidc.port.js";

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injected by tests; production builds its own. */
  client?: OAuth2Client;
}

/**
 * google-auth-library does the cryptography: `verifyIdToken` checks the signature against Google's published
 * keys, the issuer (accounts.google.com), the audience and the expiry. `azp` is checked here because the library
 * leaves it to the caller. Tokens are read once for the claims and dropped; nothing is stored or logged.
 */
export class GoogleOidcAdapter implements GoogleOidc {
  private readonly client: OAuth2Client;

  constructor(private readonly options: GoogleOidcOptions) {
    this.client = options.client ?? new OAuth2Client({ clientId: options.clientId, clientSecret: options.clientSecret, redirectUri: options.redirectUri });
  }

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string {
    return this.client.generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      // The account chooser is always shown: a shared machine must not sign in silently as whoever Google remembers.
      prompt: "select_account",
    });
  }

  async exchange(input: { code: string; codeVerifier: string }): Promise<GoogleIdentity> {
    const { tokens } = await this.client.getToken({ code: input.code, codeVerifier: input.codeVerifier });
    if (!tokens.id_token) throw new Error("Google returned no id_token");
    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.options.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error("id_token lacks sub or email");
    if (payload.azp && payload.azp !== this.options.clientId) throw new Error("id_token azp is not this client");
    return {
      sub: payload.sub,
      email: payload.email,
      ...(payload.hd ? { hostedDomain: payload.hd } : {}),
      emailVerified: payload.email_verified === true,
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.nonce ? { nonce: payload.nonce } : {}),
    };
  }
}
