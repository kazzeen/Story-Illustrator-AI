import { describe, expect, it } from "vitest";
import {
  isRecord,
  asString,
  parseJsonIfString,
  isAbortedError,
  UUID_REGEX,
} from "./type-guards";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});

describe("asString", () => {
  it("returns the string when given a string", () => {
    expect(asString("hello")).toBe("hello");
    expect(asString("")).toBe("");
  });

  it("returns null for non-string values", () => {
    expect(asString(42)).toBe(null);
    expect(asString(null)).toBe(null);
    expect(asString(undefined)).toBe(null);
    expect(asString({})).toBe(null);
    expect(asString(true)).toBe(null);
  });
});

describe("parseJsonIfString", () => {
  it("parses valid JSON strings", () => {
    expect(parseJsonIfString('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonIfString("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseJsonIfString('"hello"')).toBe("hello");
    expect(parseJsonIfString("42")).toBe(42);
    expect(parseJsonIfString("true")).toBe(true);
    expect(parseJsonIfString("null")).toBe(null);
  });

  it("returns the original string for invalid JSON", () => {
    expect(parseJsonIfString("not json")).toBe("not json");
    expect(parseJsonIfString("{broken")).toBe("{broken");
  });

  it("returns non-string values unchanged", () => {
    const obj = { a: 1 };
    expect(parseJsonIfString(obj)).toBe(obj);
    expect(parseJsonIfString(42)).toBe(42);
    expect(parseJsonIfString(null)).toBe(null);
    expect(parseJsonIfString(undefined)).toBe(undefined);
  });
});

describe("isAbortedError", () => {
  it("returns false for falsy values", () => {
    expect(isAbortedError(null)).toBe(false);
    expect(isAbortedError(undefined)).toBe(false);
    expect(isAbortedError(0)).toBe(false);
    expect(isAbortedError("")).toBe(false);
  });

  it("detects AbortError instances", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(isAbortedError(err)).toBe(true);
  });

  it("detects errors with aborted in message", () => {
    const err = new Error("Request aborted by client");
    expect(isAbortedError(err)).toBe(true);
  });

  it("detects errors with err_aborted in message", () => {
    const err = new Error("ERR_ABORTED");
    expect(isAbortedError(err)).toBe(true);
  });

  it("returns false for regular errors", () => {
    expect(isAbortedError(new Error("Network timeout"))).toBe(false);
    expect(isAbortedError(new Error("Something went wrong"))).toBe(false);
  });

  it("detects abort-like plain objects", () => {
    expect(isAbortedError({ name: "AbortError" })).toBe(true);
    expect(isAbortedError({ code: "ABORTED" })).toBe(true);
    expect(isAbortedError({ status: 499 })).toBe(true);
    expect(isAbortedError({ message: "request aborted" })).toBe(true);
  });

  it("returns false for non-abort plain objects", () => {
    expect(isAbortedError({ name: "TypeError" })).toBe(false);
    expect(isAbortedError({ status: 500 })).toBe(false);
  });
});

describe("UUID_REGEX", () => {
  it("matches valid UUIDs", () => {
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(UUID_REGEX.test("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
    expect(UUID_REGEX.test("F47AC10B-58CC-4372-A567-0E02B2C3D479")).toBe(true);
  });

  it("rejects invalid UUIDs", () => {
    expect(UUID_REGEX.test("not-a-uuid")).toBe(false);
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716")).toBe(false);
    expect(UUID_REGEX.test("")).toBe(false);
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716-44665544000g")).toBe(false);
  });
});
