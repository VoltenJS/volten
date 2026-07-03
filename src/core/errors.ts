export class VoltenError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    options?: ErrorOptions,
  ) {
    // Pass the original error as 'cause' to preserve native nested error tracking
    super(message, options);

    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Converts any unknown error into a VoltenError while preserving the original stack trace.
   */
  public static from(error: unknown): VoltenError {
    // If it's already a VoltenError, just return it as-is
    if (VoltenError.isVoltenError(error)) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);

    const voltenErr = new VoltenError(
      "ERR_INTERNAL_SERVER_ERROR",
      message,
      500,
      { cause: error instanceof Error ? error : undefined },
    );

    if (error instanceof Error && error.stack) {
      const stackLines = error.stack.split("\n");
      stackLines[0] = `VoltenError: ${message}`;
      voltenErr.stack = stackLines.join("\n");
    }

    return voltenErr;
  }

  public static isVoltenError(error: unknown): error is VoltenError {
    return error instanceof VoltenError;
  }

  public toJSON(includeStack = false) {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        ...(includeStack && { stack: this.stack }),
      },
    };
  }
}

export class HeadersSentError extends VoltenError {
  constructor() {
    super(
      "ERR_HEADERS_SENT",
      "Cannot modify headers after they have been sent to the client",
      500,
    );
  }
}

export class ResponseSentError extends VoltenError {
  constructor() {
    super(
      "ERR_RESPONSE_SENT",
      "Cannot send response after it has already been sent to the client",
      500,
    );
  }
}

export class InvalidNextCallError extends VoltenError {
  constructor() {
    super(
      "ERR_INVALID_NEXT_CALL",
      "Invalid next() call detected in middleware chain",
      500,
    );
  }
}

export class BodyReadOnInvalidMethodError extends VoltenError {
  constructor(method: "GET" | "DELETE") {
    super(
      "ERR_BODY_READ_ON_INVALID_METHOD",
      `Attempted to read request body on a ${method} request, which is not allowed`,
      400,
    );
  }
}

export class NotFoundError extends VoltenError {
  constructor(message: string = "Resource not found") {
    super("ERR_NOT_FOUND", message, 404);
  }
}

export class MethodNotAllowedError extends VoltenError {
  constructor(method: string, allowedMethods: string[]) {
    super(
      "ERR_METHOD_NOT_ALLOWED",
      `Method ${method} not allowed. Available methods: ${allowedMethods.join(", ")}`,
      405,
    );
  }
}

export class ServiceUnavailableError extends VoltenError {
  constructor(message: string = "Service is currently unavailable") {
    super("ERR_SERVICE_UNAVAILABLE", message, 503);
  }
}

export class PayloadTooLargeError extends VoltenError {
  constructor(limit: string) {
    super(
      "ERR_PAYLOAD_TOO_LARGE",
      `Request payload exceeds the limit of ${limit}`,
      413,
    );
  }
}

export class BadRequest extends VoltenError {
  constructor(message: string = "Bad Request") {
    super("ERR_BAD_REQUEST", message, 400);
  }
}
