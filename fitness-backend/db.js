const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'data', 'fitness.db');

function ensureDataDir() {
  // SQLite stores local app data in fitness-backend/data, which may not exist on first run.
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

ensureDataDir();

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Users support both password-backed accounts and generated local profiles.
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE
    )
  `);

  // Ensure password column exists for databases created before auth was added.
  db.all("PRAGMA table_info('users')", [], (err, cols) => {
    if (err) return;
    const hasPassword = cols && cols.some(c => c.name === 'password');
    if (!hasPassword) {
      db.run('ALTER TABLE users ADD COLUMN password TEXT');
    }
  });

  // Foods cache Open Food Facts lookups and manually entered nutrition data by barcode.
  db.run(`
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT,
      calories REAL,
      proteins REAL,
      fats REAL,
      carbs REAL,
      raw_json TEXT
    )
  `);

  // Meals are dated food entries used by the calorie tracker and daily macro totals.
  db.run(`
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      food_id INTEGER,
      date TEXT,
      calories REAL,
      proteins REAL,
      fats REAL,
      carbs REAL,
      note TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(food_id) REFERENCES foods(id)
    )
  `);

  // Exercises store simple workout movements for the training tab.
  db.run(`
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      reps INTEGER,
      sets INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

module.exports = db;
