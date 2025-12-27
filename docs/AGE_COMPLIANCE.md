# Age Compliance Policy

## Overview
To comply with legal requirements and platform content policies, all characters represented in the system must be verified as 18 years of age or older.

## Rules

1.  **Minimum Age**: 18 years old.
2.  **Automatic Adjustment**: Any character identified as under 18 will automatically have their age adjusted to 18.
3.  **Missing Age**: If a character's age cannot be determined, it defaults to 18.
4.  **Strict Mode**: Optional configuration to reject non-compliant characters instead of adjusting them.

## Implementation

The core logic is implemented in `src/lib/character-compliance.ts`.

### Function: `enforceCharacterAgeCompliance`

```typescript
function enforceCharacterAgeCompliance(
  character: CharacterData,
  config: AgeComplianceConfig = DEFAULT_AGE_CONFIG
): ComplianceResult
```

### Inputs
- `character`: Object containing character attributes, specifically `age`.
- `config`: Configuration object (optional).
  - `minAge`: Default 18.
  - `defaultAgeIfMissing`: Default 18.
  - `strictMode`: Default false.

### Outputs
Returns a `ComplianceResult` object:
- `isCompliant`: Boolean status.
- `wasModified`: Boolean indicating if data was changed.
- `character`: The validated/modified character data.
- `auditLog`: Array of strings detailing actions taken.
- `errors`: Array of error messages if compliance failed (in strict mode).

## Integration

Use this function before saving character data to the database or before sending character prompts to image generation services.

### Example

```typescript
import { enforceCharacterAgeCompliance } from "@/lib/character-compliance";

const inputChar = { name: "Alice", age: 17 };
const result = enforceCharacterAgeCompliance(inputChar);

if (result.isCompliant) {
  console.log("Saving character:", result.character); // Age will be 18
  console.log("Audit:", result.auditLog);
} else {
  console.error("Compliance failed:", result.errors);
}
```

## Content Moderation

Characters with names or descriptions implying they are children (e.g., "child", "minor") may still be flagged by external moderation tools even if age is set to 18. The compliance function includes basic keyword warnings in the audit log.
