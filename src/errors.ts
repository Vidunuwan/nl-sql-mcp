export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnsafeQueryError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "UnsafeQueryError";
  }
}

export class UnsafeDatabaseRequestError extends AppError {
  constructor(reason: string) {
    super(422, "UNSAFE_QUERY", reason);
    this.name = "UnsafeDatabaseRequestError";
  }
}

export class DependencyError extends AppError {
  constructor(message = "A required upstream service failed.") {
    super(502, "UPSTREAM_FAILURE", message);
    this.name = "DependencyError";
  }
}
