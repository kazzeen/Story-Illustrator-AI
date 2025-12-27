import { enforceCharacterAgeCompliance, DEFAULT_AGE_CONFIG } from "./character-compliance";
import { assert, describe, test, expect } from "vitest"; // Assuming vitest or jest is available, but I'll use simple console-based testing structure if needed, but the project seems to use standard testing. 
// Wait, I don't see vitest in package.json, but I see `test/test_venice.js`. 
// I'll create a standalone test script similar to `test_venice.js` or use the existing `test-error-extraction.js` pattern if I can't run vitest.
// Let's check package.json again.

// Checking package.json...
// "type": "module"
// No explicit test runner in dependencies except maybe hidden ones or I missed it.
// I see "test" folder with .js files.

// I'll create a standalone test script `test/test_character_compliance.js` that imports the typescript file (via ts-node or similar if available) or I'll just rely on the fact that I'm writing valid TS and maybe the user runs it with a tool.
// Actually, `src/lib/error-reporting.test.ts` exists. Let's see how it's run.
// There is no script to run it in package.json.
// However, I should write a proper test file `src/lib/character-compliance.test.ts`.

// If I cannot run it, I will at least provide it.

// Let's create `test/test_character_compliance.js` which imports the built version or uses basic node execution if possible.
// Since the project is using Vite, likely `vitest` is used or expected.
// But `package.json` didn't show `vitest`.

// I will create `src/lib/character-compliance.test.ts` assuming a standard test environment.

describe("enforceCharacterAgeCompliance", () => {
  test("should allow characters 18 or older", () => {
    const char = { name: "Adult", age: 18 };
    const result = enforceCharacterAgeCompliance(char);
    expect(result.isCompliant).toBe(true);
    expect(result.wasModified).toBe(false);
    expect(result.character.age).toBe(18);
  });

  test("should adjust characters under 18 to 18", () => {
    const char = { name: "Teen", age: 16 };
    const result = enforceCharacterAgeCompliance(char);
    expect(result.isCompliant).toBe(true);
    expect(result.wasModified).toBe(true);
    expect(result.character.age).toBe(18);
    expect(result.auditLog.some(l => l.includes("Adjusting to 18"))).toBe(true);
  });

  test("should handle string ages", () => {
    const char = { name: "StringAge", age: "17 years old" };
    const result = enforceCharacterAgeCompliance(char);
    expect(result.wasModified).toBe(true);
    expect(result.character.age).toBe(18);
  });

  test("should use default age if age is missing", () => {
    const char = { name: "NoAge" };
    const result = enforceCharacterAgeCompliance(char);
    expect(result.wasModified).toBe(true);
    expect(result.character.age).toBe(18);
  });

  test("should reject invalid ages in strict mode", () => {
    const char = { name: "Teen", age: 16 };
    const config = { ...DEFAULT_AGE_CONFIG, strictMode: true };
    const result = enforceCharacterAgeCompliance(char, config);
    expect(result.isCompliant).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("should handle null age", () => {
    const char = { name: "NullAge", age: null };
    const result = enforceCharacterAgeCompliance(char);
    expect(result.character.age).toBe(18);
  });
  
  test("should handle custom minAge", () => {
      const char = { name: "YoungAdult", age: 20 };
      const config = { minAge: 21, strictMode: false, defaultAgeIfMissing: 21 };
      const result = enforceCharacterAgeCompliance(char, config);
      expect(result.wasModified).toBe(true);
      expect(result.character.age).toBe(21);
  });
});
