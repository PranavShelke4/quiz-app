/**
 * Application error codes. Every API error response carries one of these.
 * Messages are safe to show to end users; internal details never are.
 */
export const ERROR_DEFINITIONS = {
  // Generic
  VALIDATION_ERROR: { status: 400, message: "Some of the submitted data is invalid." },
  UNAUTHORIZED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You don't have permission to do that." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "The request conflicts with the current state." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request is too large." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please wait a moment and try again." },
  CSRF_FAILED: { status: 403, message: "Request origin could not be verified." },
  MAINTENANCE_MODE: { status: 503, message: "The platform is under maintenance. Please check back soon." },
  SERVICE_UNAVAILABLE: { status: 503, message: "We can't reach our database right now. Please try again in a moment." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong. Please try again." },

  // Auth
  INVALID_CREDENTIALS: { status: 401, message: "Incorrect email or password." },
  ACCOUNT_LOCKED: { status: 423, message: "Too many failed sign-in attempts. Try again later or reset your password." },
  USER_DISABLED: { status: 403, message: "This account has been disabled. Contact support if you think this is a mistake." },
  EMAIL_NOT_VERIFIED: { status: 403, message: "Please verify your email address first." },
  EMAIL_IN_USE: { status: 409, message: "An account with this email already exists." },
  INVALID_TOKEN: { status: 400, message: "This link is invalid or has expired." },
  REGISTRATION_DISABLED: { status: 403, message: "New registrations are currently closed." },
  SETUP_ALREADY_COMPLETED: { status: 409, message: "Initial setup has already been completed." },

  // Competition
  COMPETITION_NOT_FOUND: { status: 404, message: "No competition was found." },
  COMPETITION_NOT_STARTED: { status: 409, message: "The competition hasn't started yet." },
  COMPETITION_ENDED: { status: 409, message: "The competition has ended." },
  COMPETITION_LOCKED: { status: 409, message: "This change isn't allowed once the competition has started." },
  COMPETITION_OVERLAP: { status: 409, message: "The dates overlap with another published competition." },
  COMPETITION_NOT_READY: { status: 409, message: "The competition isn't ready to publish." },
  REGISTRATION_CLOSED: { status: 409, message: "Registration for this competition is closed." },
  NOT_PARTICIPANT: { status: 403, message: "You haven't joined this competition." },

  // Questions / answers
  QUESTION_NOT_FOUND: { status: 404, message: "Question not found." },
  QUESTION_NOT_AVAILABLE: { status: 403, message: "This question isn't available yet." },
  QUESTION_EXPIRED: { status: 410, message: "This question has closed and can no longer be answered." },
  ANSWER_ALREADY_SUBMITTED: { status: 409, message: "You have already submitted today's answer." },
  INVALID_OPTION: { status: 400, message: "Please choose one of the four options." },
  QUESTION_LOCKED: { status: 409, message: "This question can no longer be changed. Use a correction instead." },
  IMPORT_INVALID: { status: 422, message: "The import file contains errors. Nothing was imported." },

  // Leaderboard
  LEADERBOARD_LOCKED: { status: 403, message: "The leaderboard is locked until the competition ends." },
  LEADERBOARD_NOT_AVAILABLE: { status: 409, message: "The leaderboard can't be revealed yet." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_DEFINITIONS[code].message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_DEFINITIONS[code].status;
    this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** MongoDB duplicate-key error (E11000). */
export function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === 11000;
}

/** Database unreachable (network/IP allowlist/outage) — surfaced as 503, not a generic 500. */
export function isDatabaseUnavailableError(e: unknown): boolean {
  const name = typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined;
  return name === "MongooseServerSelectionError" || name === "MongoServerSelectionError" || name === "MongoNetworkError";
}
