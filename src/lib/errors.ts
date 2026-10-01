/**
 * Errors whose `message` is safe to show to the founder. Anything that is not
 * an AppError is logged server-side and replaced with a generic message, so
 * stack traces and provider error bodies never reach the browser.
 */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toPublicError(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  console.error("[unexpected error]", err);
  return {
    code: "INTERNAL",
    message: "Something went wrong on our side. Please try again.",
    status: 500,
  };
}
