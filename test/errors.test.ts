import { describe, expect, it } from "bun:test";
import { BlueplateError, ParseError, FXError, LunchMoneyError, StorageError, AuthError } from "../src/errors.js";

describe("errors", () => {
  it("BlueplateError has correct properties", () => {
    const err = new BlueplateError("test", "TEST_CODE", true);
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST_CODE");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("BlueplateError");
    expect(err instanceof Error).toBe(true);
  });

  it("ParseError defaults to non-retryable", () => {
    const err = new ParseError("bad input");
    expect(err.code).toBe("PARSE_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("ParseError");
    expect(err.candidates).toBeUndefined();
  });

  it("ParseError stores candidates", () => {
    const err = new ParseError("ambiguous", ["a", "b"]);
    expect(err.candidates).toEqual(["a", "b"]);
  });

  it("FXError defaults to retryable", () => {
    const err = new FXError("rate fetch failed");
    expect(err.code).toBe("FX_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("FXError");
  });

  it("FXError can be non-retryable", () => {
    const err = new FXError("unsupported pair", false);
    expect(err.retryable).toBe(false);
  });

  it("LunchMoneyError stores status code", () => {
    const err = new LunchMoneyError("not found", 404);
    expect(err.code).toBe("LUNCHMONEY_ERROR");
    expect(err.statusCode).toBe(404);
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("LunchMoneyError");
  });

  it("LunchMoneyError is retryable for 5xx", () => {
    const err = new LunchMoneyError("server error", 500);
    expect(err.retryable).toBe(true);
  });

  it("LunchMoneyError without status code", () => {
    const err = new LunchMoneyError("generic error");
    expect(err.statusCode).toBeUndefined();
    expect(err.retryable).toBe(false);
  });

  it("StorageError is non-retryable", () => {
    const err = new StorageError("disk full");
    expect(err.code).toBe("STORAGE_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("StorageError");
  });

  it("AuthError is non-retryable", () => {
    const err = new AuthError("forbidden");
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("AuthError");
  });
});
