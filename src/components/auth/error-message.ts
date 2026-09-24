interface AuthError {
  status?: number;
  code?: string;
}

export function authErrorMessage(error: AuthError, fallback: string): string {
  if (error.status === 429) return "Too many attempts. Please try again later.";
  return fallback;
}

export function signInErrorMessage(error: AuthError): string {
  const fallback =
    error.status === 403
      ? error.code === "EMAIL_NOT_VERIFIED"
        ? "Verify your email before signing in."
        : "Sign-in is unavailable. Try again later or contact support."
      : "Invalid email or password.";
  return authErrorMessage(error, fallback);
}
