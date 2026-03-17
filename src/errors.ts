export class BlueplateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "BlueplateError";
  }
}

export class ParseError extends BlueplateError {
  constructor(
    message: string,
    public readonly candidates?: string[]
  ) {
    super(message, "PARSE_ERROR", false);
    this.name = "ParseError";
  }
}

export class FXError extends BlueplateError {
  constructor(message: string, retryable = true) {
    super(message, "FX_ERROR", retryable);
    this.name = "FXError";
  }
}

export class LunchMoneyError extends BlueplateError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    retryable = false
  ) {
    super(message, "LUNCHMONEY_ERROR", retryable);
    this.name = "LunchMoneyError";
    if (statusCode && statusCode >= 500) (this as { retryable: boolean }).retryable = true;
  }
}

export class StorageError extends BlueplateError {
  constructor(message: string) {
    super(message, "STORAGE_ERROR", false);
    this.name = "StorageError";
  }
}

export class AuthError extends BlueplateError {
  constructor(message: string) {
    super(message, "AUTH_ERROR", false);
    this.name = "AuthError";
  }
}
