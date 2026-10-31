// Admin recovery tool. Usage (with DATABASE_URL set):
//   node server/cli.js set-password someone@example.com "NewPassw0rd"
import { pool } from './db.js';
import { hashPassword } from './auth.js';
import { passwordProblem } from '../src/lib/password.js';

const [cmd, email, password] = process.argv.slice(2);
try {
  if (cmd !== 'set-password' || !email || !password) {
    console.log('Usage: node server/cli.js set-password <email> <new-password>');
    process.exitCode = 1;
  } else if (passwordProblem(password)) {
    console.error(passwordProblem(password));
    process.exitCode = 1;
  } else {
    const { salt, hash } = await hashPassword(password);
    const r = await pool.query(`UPDATE users SET pw_salt=$2, pw_hash=$3, must_change=true, active=true WHERE lower(email)=lower($1) RETURNING id`, [email, salt, hash]);
    if (!r.rows.length) { console.error('No user with that email.'); process.exitCode = 1; }
    else {
      await pool.query('DELETE FROM sessions WHERE user_id=$1', [r.rows[0].id]);
      await pool.query('DELETE FROM login_throttle WHERE email=lower($1)', [email]);
      console.log('Password set. The user must change it at next sign-in.');
    }
  }
} finally { await pool.end(); }
