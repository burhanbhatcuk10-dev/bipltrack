// Password rules shared by the browser (for instant feedback) and the server (which enforces them).
export const MIN_PASSWORD = 8;
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 128) return 'Password is too long (128 characters at most).';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  if (/\s/.test(pw)) return 'Password cannot contain spaces.';
  return '';
}
