/* eslint-disable no-console */
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'bclogin_system',
    user: process.env.DB_USER || 'lt',
    password: process.env.DB_PASSWORD || '',
    max: 10,
  });

  const client = await pool.connect();
  try {
    const username = 'admin';
    const email = 'admin@zhitou.com';
    const plain = '123456';
    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
    const hash = await bcrypt.hash(plain, rounds);

    await client.query('BEGIN');
    const existing = await client.query('SELECT id, role FROM users WHERE username=$1 OR email=$2', [username, email]);
    if (existing.rows.length === 0) {
      const ins = await client.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, role',
        [username, email, hash, 'admin']
      );
      await client.query('COMMIT');
      console.log(`✅ 已创建管理员: ${username} (id=${ins.rows[0].id}) 密码: ${plain}`);
    } else {
      const id = existing.rows[0].id;
      await client.query('UPDATE users SET password_hash=$1, role=$2, updated_at=NOW() WHERE id=$3', [hash, 'admin', id]);
      await client.query('COMMIT');
      console.log(`✅ 已确保管理员存在并更新角色/密码: ${username} 密码: ${plain}`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ensure-admin 失败:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

