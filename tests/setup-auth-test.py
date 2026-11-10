"""PTY integration checks. Random credentials exist only in a temporary Git repository."""
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import secrets
import select
import shutil
import subprocess
import tempfile
import time

PROJECT = Path(__file__).resolve().parents[1]

def run_dialog(root, answers, args=()):
    master, slave = pty.openpty()
    child = subprocess.Popen(['npm', 'run', 'setup-auth', '--', *args], cwd=root,
                             stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    os.close(slave)
    output = b''
    cursor = 0
    try:
        for prompt, answer in answers:
            deadline = time.monotonic() + 15
            while prompt.encode() not in output[cursor:]:
                if time.monotonic() > deadline:
                    raise AssertionError('Interactive prompt timed out')
                if select.select([master], [], [], .1)[0]:
                    try:
                        block = os.read(master, 4096)
                    except OSError:
                        block = b''
                    if not block:
                        raise AssertionError('Interactive setup exited before expected prompt')
                    output += block
            cursor = len(output)
            os.write(master, answer.encode())
        deadline = time.monotonic() + 20
        while child.poll() is None:
            if time.monotonic() > deadline:
                raise AssertionError('Interactive setup timed out')
            if select.select([master], [], [], .1)[0]:
                try:
                    output += os.read(master, 4096)
                except OSError:
                    break
        child.wait(timeout=5)
        while select.select([master], [], [], .1)[0]:
            try:
                block = os.read(master, 4096)
            except OSError:
                break
            if not block:
                break
            output += block
        return child.returncode, output.decode(errors='replace')
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        os.close(master)

def temporary_project():
    directory = tempfile.TemporaryDirectory(prefix='mart-auth-check-')
    root = Path(directory.name)
    (root / 'scripts').mkdir()
    shutil.copy(PROJECT / 'scripts/setup-auth.mjs', root / 'scripts/setup-auth.mjs')
    (root / 'app/lib').mkdir(parents=True)
    shutil.copy(PROJECT / 'app/lib/password-policy.mjs', root / 'app/lib/password-policy.mjs')
    (root / 'package.json').write_text(json.dumps({'scripts': {'setup-auth': 'node scripts/setup-auth.mjs'}}))
    subprocess.run(['git', 'init', '-q', str(root)], check=True, capture_output=True)
    (root / '.gitignore').write_text('.env*\n!.env.local\n')
    return directory, root

def main():
    directory, root = temporary_project()
    try:
        existing = secrets.token_hex(16)
        (root / '.env.local').write_text(f'EXISTING_SERVICE_TOKEN={existing}\nUSER_LOGIN=\nADMIN_LOGIN=\n')
        user, admin = (str(secrets.randbelow(10000)).zfill(4) for _ in range(2))
        answers = [('USER_LOGIN: ', 'user_' + secrets.token_hex(4) + '\n'),
                   ('ADMIN_LOGIN: ', 'admin_' + secrets.token_hex(4) + '\n'),
                   ('Пароль пользователя (ввод скрыт): ', user + '\n'),
                   ('Повторите пароль: ', user + '\n'),
                   ('Пароль администратора (ввод скрыт): ', admin + '\n'),
                   ('Повторите пароль: ', admin + '\n')]
        status, output = run_dialog(root, answers)
        assert status == 0, 'Setup failed'
        raw = (root / '.env.local').read_text()
        env = dict(line.split('=', 1) for line in raw.splitlines() if line and not line.startswith('#'))
        assert env['EXISTING_SERVICE_TOKEN'] == existing, 'Unrelated settings changed'
        assert user not in output and admin not in output and env['AUTH_SECRET'] not in output, 'Secret appeared in terminal'
        assert user not in raw and admin not in raw, 'Plain password appeared in file'
        assert len(bytes.fromhex(env['AUTH_SECRET'])) >= 32, 'Insufficient entropy length'
        for role, password in [('USER', user), ('ADMIN', admin)]:
            value = env[f'{role}_PASSWORD_HASH'].replace('\\$', '$')
            assert re.fullmatch(r'scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}', value), 'Invalid hash format'
            parts = value.split('$')
            digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(parts[4]), n=32768, r=8, p=3, dklen=64, maxmem=64 * 1024 * 1024)
            assert digest.hex() == parts[5], 'Hash verification failed'
        assert (root / '.env.local').stat().st_mode & 0o777 == 0o600, 'Insecure file permissions'
        subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', '.env.local'], check=True)
        assert not subprocess.check_output(['git', '-C', str(root), 'ls-files', '--', '.env.local']).strip()
        assert not list(root.glob('.env.local.setup-*')), 'Temporary secret file left behind'
        # Verify decoding with the actual Next.js dotenv loader, in a clean subprocess.
        verify = "const fs=require('fs');const e=require('@next/env');const r=e.processEnv([{path:'.env.local',contents:fs.readFileSync(process.argv[1],'utf8'),env:{}}],process.cwd(),{error:()=>{}},true)[0];console.log(JSON.stringify({user:/^scrypt\\$32768\\$8\\$3\\$/.test(r.USER_PASSWORD_HASH),admin:/^scrypt\\$32768\\$8\\$3\\$/.test(r.ADMIN_PASSWORD_HASH)}));"
        checked = subprocess.check_output(['node', '-e', verify, str(root / '.env.local')], cwd=PROJECT, text=True)
        assert json.loads(checked) == {'user': True, 'admin': True}, 'Next.js altered hashes'
        status, output = run_dialog(root, [])
        assert status != 0 and (root / '.env.local').read_text() == raw, 'Existing auth overwritten'
        assert user not in output and admin not in output and env['AUTH_SECRET'] not in output
        print('PASS: hidden terminal input, four-digit scrypt PINs, Next.js decoding, permissions, preservation, overwrite refusal')
        # Reset must preserve every source byte, including quoted multiline values and auth-like text inside them.
        sources = 'GOOGLE_SHEET_ID=sheet-id\r\nFINTABLO_API_TOKEN=' + existing + '\r\nGOOGLE_PRIVATE_KEY="line1\r\nUSER_LOGIN=inside-source\r\nline3"\r\n# source comment\r\n'
        (root / '.env.local').write_bytes(sources.encode() + raw.encode())
        before_reset = (root / '.env.local').read_bytes()
        status, _ = run_dialog(root, [('Пароль пользователя (ввод скрыт): ', '\x03')], ('--reset',))
        assert status != 0 and (root / '.env.local').read_bytes() == before_reset, 'Cancelled reset changed settings'
        new_user, new_admin = (str(secrets.randbelow(10000)).zfill(4) for _ in range(2))
        status, output = run_dialog(root, [
            ('Пароль пользователя (ввод скрыт): ', 'abc\n'),
            ('Пароль пользователя (ввод скрыт): ', 'abcde\n'),
            ('Пароль пользователя (ввод скрыт): ', new_user + '\n'),
            ('Повторите пароль: ', 'bad!\n'),
            ('Пароль пользователя (ввод скрыт): ', new_user + '\n'),
            ('Повторите пароль: ', new_user + '\n'),
            ('Пароль администратора (ввод скрыт): ', 'abcde\n'),
            ('Пароль администратора (ввод скрыт): ', new_admin + '\n'),
            ('Повторите пароль: ', new_admin + '\n'),
        ], ('--reset',))
        assert status == 0, 'Reset failed'
        after = (root / '.env.local').read_bytes()
        assert after.startswith(sources.encode()), 'Source bytes changed on reset'
        updated = dict(line.split('=', 1) for line in after[len(sources.encode()):].decode().splitlines() if '=' in line and not line.startswith('#'))
        assert updated['USER_LOGIN'] == env['USER_LOGIN'] and updated['ADMIN_LOGIN'] == env['ADMIN_LOGIN'], 'Reset changed logins'
        assert updated['AUTH_SECRET'] != env['AUTH_SECRET'], 'Reset did not revoke old sessions'
        assert updated['EXISTING_SERVICE_TOKEN'] == existing, 'Reset changed source token'
        for role, value in [('USER', new_user), ('ADMIN', new_admin)]:
            assert value not in output and value.encode() not in after, 'Reset exposed password'
            assert updated[f'{role}_PASSWORD_HASH'] != env[f'{role}_PASSWORD_HASH'], 'Reset reused hash'
            parts = updated[f'{role}_PASSWORD_HASH'].replace('\\$', '$').split('$')
            digest = hashlib.scrypt(value.encode(), salt=bytes.fromhex(parts[4]), n=32768, r=8, p=3, dklen=64, maxmem=64 * 1024 * 1024)
            assert digest.hex() == parts[5], 'Reset hash verification failed'
        assert (root / '.env.local').stat().st_mode & 0o777 == 0o600
        assert not list(root.glob('.env.local.setup-*'))
        print('PASS: npm reset, exact length validation, confirmation, cancellation, source bytes, logins preserved, hashes and session key rotated')
    finally:
        directory.cleanup()
    directory, root = temporary_project()
    try:
        status, _ = run_dialog(root, [('USER_LOGIN: ', '\x03')])
        assert status != 0 and not (root / '.env.local').exists(), 'Cancel created secret file'
        noninteractive = subprocess.run(['node', str(root / 'scripts/setup-auth.mjs')], input='', text=True, capture_output=True)
        assert noninteractive.returncode != 0 and not (root / '.env.local').exists(), 'Non-TTY accepted'
        (root / '.env.local').write_text('')
        subprocess.run(['git', '-C', str(root), 'add', '-f', '.env.local'], check=True, capture_output=True)
        status, _ = run_dialog(root, [])
        assert status != 0 and (root / '.env.local').read_text() == '', 'Tracked secret file accepted'
        print('PASS: cancellation, noninteractive refusal, tracked file refusal')
    finally:
        directory.cleanup()

if __name__ == '__main__':
    main()
