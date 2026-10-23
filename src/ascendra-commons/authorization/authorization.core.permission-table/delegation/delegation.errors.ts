/** Thrown when a granter tries to delegate actions they don't hold from their own roles (or an empty action list). */
export class CannotDelegateError extends Error {
  constructor(public readonly missingActions: string[]) {
    super(
      missingActions.length === 0
        ? 'Cannot delegate an empty action list.'
        : `Cannot delegate action(s) the granter does not hold from their roles: ${missingActions.join(', ')}`,
    );
    this.name = 'CannotDelegateError';
  }
}

/** Thrown when `expiresAt` is missing, invalid, in the past, or beyond `maxDelegationDays`. */
export class InvalidDelegationExpiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDelegationExpiryError';
  }
}
