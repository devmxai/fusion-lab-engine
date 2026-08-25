import { ProviderTreasuryError } from "./types.js";

function powerOfTenExponent(value: bigint): number {
  if (value < 1n) throw new ProviderTreasuryError("INVALID_DECIMAL", "Atomic scale must be a positive power of ten.");
  let remaining = value;
  let exponent = 0;
  while (remaining > 1n && remaining % 10n === 0n) {
    remaining /= 10n;
    exponent += 1;
  }
  if (remaining !== 1n) throw new ProviderTreasuryError("INVALID_DECIMAL", "Atomic scale must be a power of ten.");
  return exponent;
}

export function decimalToAtomic(
  raw: string | number,
  scale: bigint,
  rounding: "exact" | "ceil" = "exact",
): bigint {
  const value = typeof raw === "number" ? String(raw) : raw.trim();
  if (typeof raw === "number" && (!Number.isFinite(raw) || raw < 0)) {
    throw new ProviderTreasuryError("INVALID_DECIMAL", "Decimal value must be finite and non-negative.");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new ProviderTreasuryError("INVALID_DECIMAL", "Decimal value has an unsupported representation.");
  const whole = match[1];
  const fraction = match[2] ?? "";
  const scientificExponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(scientificExponent) || Math.abs(scientificExponent) > 100) {
    throw new ProviderTreasuryError("INVALID_DECIMAL", "Decimal exponent is outside the supported range.");
  }
  const scaleExponent = powerOfTenExponent(scale);
  const digits = BigInt(`${whole}${fraction}`);
  const effectivePower = scaleExponent + scientificExponent - fraction.length;
  if (effectivePower >= 0) return digits * (10n ** BigInt(effectivePower));
  const denominator = 10n ** BigInt(-effectivePower);
  const quotient = digits / denominator;
  const remainder = digits % denominator;
  if (remainder === 0n) return quotient;
  if (rounding === "ceil") return quotient + 1n;
  throw new ProviderTreasuryError("INVALID_DECIMAL", "Decimal cannot be represented exactly at the configured atomic scale.");
}
