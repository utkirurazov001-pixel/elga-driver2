/** Markaziy API xatosi — errorHandler aniq HTTP kod + error.code qaytaradi. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(message = 'Topilmadi') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static badRequest(message = "Noto'g'ri so'rov") {
    return new ApiError(422, 'VALIDATION_ERROR', message);
  }
  static unauthorized(message = 'Avtorizatsiya talab qilinadi') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'Ruxsat yo\'q') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static conflict(message = 'Konflikt') {
    return new ApiError(409, 'CONFLICT', message);
  }
}
