export function requirePositiveWholeCredits(value: bigint, field = "credits"): bigint {
  if (value <= 0n) throw new LedgerValidationError(`${field} must be a positive whole-credit bigint.`);
  return value;
}

export function requireNonNegativeMicrousd(value: bigint, field = "microusd"): bigint {
  if (value < 0n) throw new LedgerValidationError(`${field} must be a non-negative bigint.`);
  return value;
}

export function parseWholeCredits(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw new LedgerValidationError("Credits must be an unsigned whole-number string.");
  return BigInt(value);
}

export function parseMicrousd(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw new LedgerValidationError("Microusd must be an unsigned integer string.");
  return BigInt(value);
}

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}
