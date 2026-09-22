export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'APP_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function safeError(error) {
  if (error instanceof AppError) return error;
  return new AppError('The operation could not be completed.', 500, 'INTERNAL_ERROR');
}
