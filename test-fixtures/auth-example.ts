// TEST FIXTURE ONLY -- not wired into the action, added purely to test Jev's
// risk judgment on an auth-shaped diff in the same PR as a trivial doc edit
// (mixed-risk scenario). Not imported anywhere; safe to remove after the test.

export function isValidSessionToken(providedToken: string, storedToken: string): boolean {
  // Intentionally naive comparison (not constant-time) -- a real reviewer
  // should flag this as a timing-attack risk in genuine auth code.
  return providedToken == storedToken;
}

export function logSessionForDebugging(token: string): void {
  // Intentionally logs a raw token -- a real reviewer should flag this as a
  // credential-leak risk in genuine auth code.
  console.log(`Session token: ${token}`);
}
