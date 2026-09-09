export type AuthenticationProviderKind = "LOCAL" | "OIDC" | "SAML";

export type AuthenticationIdentity = {
  provider: AuthenticationProviderKind;
  subject: string;
  email: string;
};

export interface AuthenticationProvider {
  readonly kind: AuthenticationProviderKind;
  authenticate(
    email: string,
    secret: string,
  ): Promise<AuthenticationIdentity | null>;
}

/**
 * V2B keeps LOCAL as the only enabled provider. OIDC/SAML adapters can implement
 * this boundary later without changing session, membership or scope semantics.
 */
export const enabledAuthenticationProviders: readonly AuthenticationProviderKind[] =
  ["LOCAL"];
