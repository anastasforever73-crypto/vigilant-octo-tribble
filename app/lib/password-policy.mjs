// Shared by the browser, server and setup CLI. Keep PINs as strings (leading zeros count).
export const PASSWORD_LENGTH = 4;
/** @param {string} password */
export function validPassword(password) { return /^[0-9]{4}$/.test(password); }

/** Existing four-digit PINs remain valid; new accounts may use a full password. */
export function validAccountPassword(password) {
  return typeof password === 'string' && (validPassword(password) || (password.length >= 8 && password.length <= 128 && !/[\x00-\x1f\x7f]/.test(password)));
}

/** Login compatibility only; new accounts keep validAccountPassword's policy. */
export function validLoginPassword(password) {
  return validAccountPassword(password) || (typeof password === 'string' && [...password].length === PASSWORD_LENGTH);
}
