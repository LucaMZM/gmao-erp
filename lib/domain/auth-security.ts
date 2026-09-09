export type LoginThrottlePolicy = {
  maxFailedAttempts: number;
  lockoutMinutes: number;
};

export function nextLoginFailureState(
  failedAttempts: number,
  now: Date,
  policy: LoginThrottlePolicy,
): { failedAttempts: number; lockedUntil: string | null } {
  const next = Math.max(0, failedAttempts) + 1;
  return {
    failedAttempts: next,
    lockedUntil:
      next >= policy.maxFailedAttempts
        ? new Date(now.getTime() + policy.lockoutMinutes * 60_000).toISOString()
        : null,
  };
}

export function sessionIsValid(
  now: Date,
  session: {
    expiresAt: string;
    absoluteExpiresAt: string;
    idleExpiresAt: string;
    revokedAt: string | null;
  },
): boolean {
  const instant = now.getTime();
  return (
    !session.revokedAt &&
    new Date(session.expiresAt).getTime() > instant &&
    new Date(session.absoluteExpiresAt).getTime() > instant &&
    new Date(session.idleExpiresAt).getTime() > instant
  );
}
