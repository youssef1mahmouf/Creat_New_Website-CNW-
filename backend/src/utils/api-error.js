/** Centralized API error type. Never leaks internals to clients. */
class ApiError extends Error {
  constructor(statusCode, message, code = 'ERROR', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }

  static badRequest(msg = 'Bad request', details) {
    return new ApiError(400, msg, 'BAD_REQUEST', details);
  }
  static unauthorized(msg = 'Authentication required') {
    return new ApiError(401, msg, 'UNAUTHORIZED');
  }
  static forbidden(msg = 'Not allowed') {
    return new ApiError(403, msg, 'FORBIDDEN');
  }
  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg, 'NOT_FOUND');
  }
  static conflict(msg = 'Conflict') {
    return new ApiError(409, msg, 'CONFLICT');
  }
  static tooMany(msg = 'Too many requests') {
    return new ApiError(429, msg, 'RATE_LIMITED');
  }
  static internal(msg = 'Internal server error') {
    return new ApiError(500, msg, 'INTERNAL');
  }
}

module.exports = ApiError;
