import { randomBytes, scrypt } from 'node:crypto';
import { validPassword } from '../app/lib/password-policy.mjs';
// Read from stdin; no password in command arguments, source files or logs.
let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');
if (!validPassword(password)) throw new Error('Use a password of exactly 4 characters');
const salt = randomBytes(16);
scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
  password = '';
  if (error) throw error;
  console.log(`scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`);
});
