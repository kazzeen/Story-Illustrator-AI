import { z } from "zod";

/**
 * Configuration for age compliance rules.
 * Supports international age of majority variations.
 */
export interface AgeComplianceConfig {
  minAge: number;
  defaultAgeIfMissing?: number;
  strictMode: boolean; // If true, rejects invalid ages instead of adjusting
}

export const DEFAULT_AGE_CONFIG: AgeComplianceConfig = {
  minAge: 18,
  defaultAgeIfMissing: 18,
  strictMode: false,
};

/**
 * Input character data structure.
 * Flexible enough to handle partial updates or full character records.
 */
export interface CharacterData {
  name?: string;
  age?: number | string | null;
  description?: string | null;
  physical_attributes?: string | null;
  [key: string]: unknown;
}

/**
 * Result of the age compliance check.
 */
export interface ComplianceResult {
  character: CharacterData;
  isCompliant: boolean;
  wasModified: boolean;
  auditLog: string[];
  errors: string[];
}

/**
 * Parses age from various input formats (number, string).
 * Returns number or null if unparseable.
 */
function parseAge(ageInput: number | string | null | undefined): number | null {
  if (ageInput === null || ageInput === undefined) return null;
  
  if (typeof ageInput === "number") {
    return isNaN(ageInput) ? null : ageInput;
  }
  
  if (typeof ageInput === "string") {
    // Attempt to extract the first number from the string
    const match = ageInput.match(/(\d+)/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      return isNaN(parsed) ? null : parsed;
    }
  }
  
  return null;
}

/**
 * Enforces age compliance on character data.
 * Ensures character is at least 18 years old (or configured minAge).
 * 
 * @param character - The character data to validate/modify
 * @param config - Optional configuration for age rules
 * @returns ComplianceResult containing validated character and audit logs
 */
export function enforceCharacterAgeCompliance(
  character: CharacterData,
  config: AgeComplianceConfig = DEFAULT_AGE_CONFIG
): ComplianceResult {
  const result: ComplianceResult = {
    character: { ...character },
    isCompliant: true,
    wasModified: false,
    auditLog: [],
    errors: [],
  };

  const log = (message: string) => {
    result.auditLog.push(`[${new Date().toISOString()}] ${message}`);
  };

  try {
    // 1. Parse Age
    let currentAge = parseAge(character.age);

    // 2. Handle Missing Age
    if (currentAge === null) {
      if (config.defaultAgeIfMissing !== undefined) {
        log(`Age missing or invalid ('${character.age}'). Defaulting to ${config.defaultAgeIfMissing}.`);
        currentAge = config.defaultAgeIfMissing;
        result.character.age = currentAge;
        result.wasModified = true;
      } else {
        result.errors.push("Age is required and could not be determined.");
        result.isCompliant = false;
        return result;
      }
    }

    // 3. Validate Age against MinAge
    if (currentAge < config.minAge) {
      if (config.strictMode) {
        result.errors.push(`Character age (${currentAge}) is below the minimum required age of ${config.minAge}.`);
        result.isCompliant = false;
      } else {
        log(`Character age (${currentAge}) is below ${config.minAge}. Adjusting to ${config.minAge}.`);
        result.character.age = config.minAge;
        result.wasModified = true;
        
        // Also verify description/attributes don't contain conflicting info if possible
        // (This is a naive check, sophisticated checks would use NLP)
        if (result.character.description) {
           // We don't auto-edit text blindly, but we log a warning
           log("Note: Description may still contain references to younger age. Please review.");
        }
      }
    } else {
      log(`Character age (${currentAge}) complies with minimum age requirement (${config.minAge}+).`);
    }

    // 4. Content Moderation Check (Simulation)
    // In a real system, this would call an external moderation service
    if (result.character.name && result.character.name.toLowerCase().includes("child")) {
       log("Warning: Name contains 'child', which may flag content moderation filters.");
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Internal error during compliance check: ${msg}`);
    result.isCompliant = false;
  }

  return result;
}
