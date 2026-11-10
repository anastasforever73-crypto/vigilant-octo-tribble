// Count Unicode code points consistently in the browser, server and setup CLI.
export const PASSWORD_LENGTH = 4;
/** @param {string} password */
export function validPassword(password) { return [...password].length === PASSWORD_LENGTH; }
