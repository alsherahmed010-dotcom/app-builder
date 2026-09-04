const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_INTERNAL || process.env.DATABASE_PUBLIC_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function fixDB() {
  try {
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS apk_url TEXT`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'`);
    console.log('✅ تم إصلاح قاعدة البيانات!');
  } catch (error) {
    console.error('❌ خطأ:', error.message);
  } finally {
    await pool.end();
  }
}

fixDB();
