import { CommercialEngineError, type BillingFormula, type CommercialQuoteInput, type Rational } from "./types.ts";

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new CommercialEngineError("INVALID_RATIONAL", "Rational values require a non-negative numerator and positive denominator.");
  }
  return (numerator + denominator - 1n) / denominator;
}

function units(value: Rational): bigint {
  return ceilDiv(value.numerator, value.denominator);
}

function multiplied(value: Rational, multiplier: bigint): bigint {
  return ceilDiv(value.numerator * multiplier, value.denominator);
}

export function evaluateBillingFormula(formula: BillingFormula, input: CommercialQuoteInput): bigint {
  const quantity = BigInt(input.quantity);
  let result: bigint;
  switch (formula.kind) {
    case "per_generation":
      result = multiplied(formula.units, quantity);
      break;
    case "per_image":
      result = multiplied(formula.unitsPerImage, quantity);
      break;
    case "per_output_second": {
      if (input.durationSeconds === undefined) {
        throw new CommercialEngineError("CAPABILITY_MISMATCH", "Duration is required by the route billing formula.");
      }
      const resolution = formula.resolutionMultipliers[input.resolution];
      if (!resolution) {
        throw new CommercialEngineError("CAPABILITY_MISMATCH", "Resolution has no certified billing multiplier.");
      }
      const baseNumerator = formula.unitsPerSecond.numerator
        * BigInt(input.durationSeconds)
        * resolution.numerator;
      const baseDenominator = formula.unitsPerSecond.denominator * resolution.denominator;
      const base = ceilDiv(baseNumerator, baseDenominator);
      const audio = input.audio ? units(formula.audioAddonPerGeneration) : 0n;
      result = (base + audio) * quantity;
      break;
    }
    case "per_character_block":
      if (input.characterCount === undefined || formula.blockSize <= 0n) {
        throw new CommercialEngineError("CAPABILITY_MISMATCH", "Character count and a positive block size are required.");
      }
      result = multiplied(
        formula.unitsPerBlock,
        ceilDiv(BigInt(input.characterCount), formula.blockSize) * quantity,
      );
      break;
    default:
      throw new CommercialEngineError("UNKNOWN_BILLING_FORMULA", "Unknown billing formulas disable the route.");
  }
  if (result <= 0n) {
    throw new CommercialEngineError("INVALID_RATIONAL", "Provider billing must resolve to positive atomic units.");
  }
  return result;
}
