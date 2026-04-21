type DateLike = string | Date | null | undefined;

interface JoinedAtInput {
  emailVerified?: DateLike;
  firstLoginAt?: DateLike;
  firstActiveAt?: DateLike;
  lastActiveAt?: DateLike;
  createdAt?: DateLike;
}

/**
 * Shared lifecycle derivation for admin surfaces.
 *
 * "Joined" / "signed up" should reflect first real user completion/activity,
 * not merely account-row creation. createdAt is only used as a last-resort
 * fallback when there is evidence of later activity but no better timestamp.
 */
export function deriveJoinedAt({
  emailVerified,
  firstLoginAt,
  firstActiveAt,
  lastActiveAt,
  createdAt,
}: JoinedAtInput): string | Date | null {
  return (
    emailVerified ??
    firstLoginAt ??
    firstActiveAt ??
    (lastActiveAt && createdAt ? createdAt : null)
  );
}

export function hasSignedUp(input: JoinedAtInput): boolean {
  return deriveJoinedAt(input) !== null;
}
