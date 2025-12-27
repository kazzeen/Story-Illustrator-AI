
import { describe, expect, it } from "vitest";
import { extractDetailedError } from "./error-reporting";

describe("extractDetailedError", () => {
  it("identifies content violation", () => {
    const result = extractDetailedError({
      headers: { "x-venice-is-content-violation": "true" },
    });
    expect(result.code).toBe("CONTENT_VIOLATION");
    expect(result.category).toBe("validation");
  });

  it("identifies minor content violation", () => {
    const result = extractDetailedError({
      headers: { "x-venice-contains-minor": "true" },
    });
    expect(result.code).toBe("CONTENT_VIOLATION");
    expect(result.technicalDetails?.includes("x-venice-contains-minor: true") ?? false).toBe(true);
  });

  it("identifies blurred content", () => {
    const result = extractDetailedError({
      headers: { "x-venice-is-blurred": "true" },
    });
    expect(result.code).toBe("CONTENT_VIOLATION");
    expect(result.technicalDetails?.includes("x-venice-is-blurred: true") ?? false).toBe(true);
  });

  it("extracts failure reason", () => {
    const result = extractDetailedError({
      headers: { "x-failure-reason": "Custom reason" },
    });
    expect(result.failureReason).toBe("Custom reason");
    expect(result.code).toBe("PROVIDER_ERROR");
  });

  it("handles rate limit", () => {
    const result = extractDetailedError({ status: 429 });
    expect(result.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(result.category).toBe("resource");
  });

  it("handles server error", () => {
    const result = extractDetailedError({ status: 500 });
    expect(result.code).toBe("SERVER_ERROR");
    expect(result.category).toBe("server");
  });

  it("handles authentication error", () => {
    const result = extractDetailedError({ status: 401 });
    expect(result.code).toBe("AUTHENTICATION_FAILED");
    expect(result.category).toBe("authentication");
  });

  it("extracts error body fields", () => {
    const result = extractDetailedError({
      status: 400,
      errorBody: { error: "Bad Request", message: "Invalid prompt" },
    });
    expect(result.description).toBe("Bad Request");
    expect(result.technicalDetails).toBe("Invalid prompt");
  });
});
