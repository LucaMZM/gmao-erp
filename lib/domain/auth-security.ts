export type LoginThrottlePolicy = {
  maxFailedAttempts: number;
  lockoutMinutes: number;
};

export const SESSION_ROTATION_GRACE_MS = 10_000;

export function sessionRotationWindow(
  now: Date,
  session: { expiresAt: string; absoluteExpiresAt: string },
  idleMinutes: number,
): { previousTokenExpiresAt: string; idleExpiresAt: string } {
  const hardExpiry = Math.min(
    new Date(session.expiresAt).getTime(),
    new Date(session.absoluteExpiresAt).getTime(),
  );
  return {
    previousTokenExpiresAt: new Date(
      Math.min(now.getTime() + SESSION_ROTATION_GRACE_MS, hardExpiry),
    ).toISOString(),
    idleExpiresAt: new Date(
      Math.min(now.getTime() + idleMinutes * 60_000, hardExpiry),
    ).toISOString(),
  };
}

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
