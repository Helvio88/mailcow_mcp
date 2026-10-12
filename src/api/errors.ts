export class APIError extends Error {
  statusCode: number;
  response?: any;
  constructor(message: string, statusCode: number, response?: any) {
    super(message);
    this.statusCode = statusCode;
    this.response = response;
    this.name = 'APIError';
  }
}

export class AuthenticationError extends APIError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends APIError {
  constructor(message: string) {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends APIError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class NetworkError extends APIError {
  constructor(message: string) {
    super(message, 0);
    this.name = 'NetworkError';
  }
}

export class ValidationError extends APIError {
  constructor(message: string) {
    super(message, 422);
    this.name = 'ValidationError';
  }
}

export class ServerError extends APIError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode);
    this.name = 'ServerError';
  }
}

export function handleAPIError(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  if (error instanceof Error) {
    // Check if it's an axios error with response
    if ('response' in error && error.response) {
      const response = error.response as any;
      const status = response.status;
      const message = response.data?.message || response.data?.error || error.message;

      switch (status) {
        case 401:
          return new AuthenticationError(message);
        case 403:
          return new AuthorizationError(message);
        case 404:
          return new NotFoundError(message);
        case 422:
          return new ValidationError(message);
        case 500:
        case 502:
        case 503:
        case 504:
          return new ServerError(message, status);
        default:
          return new APIError(message, status, response.data);
      }
    }

    // Check if it's a network error
    if ('code' in error && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT')) {
      return new NetworkError(`Network error: ${error.message}`);
    }

    // Generic error
    return new APIError(error.message, 0);
  }

  // Unknown error type
  return new APIError('Unknown error occurred', 0);
} 
/**
 * Mailcow answers write calls with HTTP 200 and a list of status objects such as
 * [{ type: 'success' | 'danger' | 'error', msg: [...] }]. Throw when any of them failed.
 */
export function assertMailcowSuccess(response: unknown): void {
  const items = Array.isArray(response) ? response : [response];
  for (const item of items) {
    if (item && typeof item === 'object') {
      const { type, msg } = item as { type?: string; msg?: unknown };
      if (type === 'danger' || type === 'error') {
        const detail = Array.isArray(msg) ? msg.join(' ') : String(msg ?? 'unknown error');
        throw new APIError(`Mailcow API error: ${detail}`, 400, response);
      }
    }
  }
}
