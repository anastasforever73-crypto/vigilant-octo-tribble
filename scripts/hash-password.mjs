import { emitKeypressEvents } from 'node:readline';
import { askPassword, hashPassword } from './setup-auth.mjs';
import { validPassword } from '../app/lib/password-policy.mjs';
// Only the salted hash is printed. Never put the PIN in command arguments.
let password = '';
try {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    emitKeypressEvents(process.stdin);
    password = await askPassword('PIN (4 цифры, ввод скрыт): ');
  } else {
    for await (const chunk of process.stdin) password += chunk;
    password = password.replace(/\r?\n$/, '');
  }
  if (!validPassword(password)) throw new Error('INVALID_PIN');
  const hash = await hashPassword(password);
  password = '';
  console.log(hash);
} catch {
  password = '';
  console.error('Не удалось создать хеш. Нужен PIN из ровно 4 цифр.');
  process.exitCode = 1;
}
