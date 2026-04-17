// fitness-backend/index.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'replace_this_secret';
const OPEN_FOOD_FACTS_USER_AGENT =
  process.env.OPEN_FOOD_FACTS_USER_AGENT ||
  'FitnessTracker/1.0 (local-development; contact: local@example.com)';
const OPEN_FOOD_FACTS_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'serving_size',
  'image_front_url',
  'nutriments'
].join(',');
const PRODUCT_LOOKUP_LIMIT = {
  maxRequests: Number(process.env.OPEN_FOOD_FACTS_MAX_REQUESTS_PER_MINUTE) || 95,
  windowMs: 60 * 1000,
  timestamps: []
};
const PRODUCT_NOT_FOUND_CACHE = new Map();
const PRODUCT_NOT_FOUND_TTL_MS = 10 * 60 * 1000;

const app = express();
// CORS and JSON parsing allow the React frontend to call this local API directly.
app.use(cors());
app.use(bodyParser.json());

// In-memory server log buffer and logger helper
const LOG_BUFFER = [];
function addLog(level, message, meta) {
  try {
    const entry = { ts: new Date().toISOString(), level: level || 'info', message: String(message || ''), meta: meta || null };
    LOG_BUFFER.push(entry);
    // keep buffer sane
    if (LOG_BUFFER.length > 500) LOG_BUFFER.shift();
    // also echo to console for terminal visibility
    if (level === 'error') console.error('[log]', entry.ts, entry.level, entry.message, entry.meta || '');
    else console.log('[log]', entry.ts, entry.level, entry.message, entry.meta || '');
  } catch (e) {
    console.error('addLog failed', e && e.message);
  }
}

function cleanBarcode(code) {
  // Keep only digits before querying Open Food Facts or matching local barcode rows.
  return String(code || '').replace(/\D/g, '');
}

function checkProductLookupLimit() {
  // Enforce a local product-query ceiling below Open Food Facts' documented 100/min limit.
  const now = Date.now();
  PRODUCT_LOOKUP_LIMIT.timestamps = PRODUCT_LOOKUP_LIMIT.timestamps.filter(
    (ts) => now - ts < PRODUCT_LOOKUP_LIMIT.windowMs
  );
  if (PRODUCT_LOOKUP_LIMIT.timestamps.length >= PRODUCT_LOOKUP_LIMIT.maxRequests) {
    return false;
  }
  PRODUCT_LOOKUP_LIMIT.timestamps.push(now);
  return true;
}

function getNutriment(nutriments, names) {
  // Open Food Facts can expose serving, generic, and per-100g keys; return the first populated one.
  for (const name of names) {
    const value = nutriments[name];
    if (value !== undefined && value !== null && value !== '') return Number(value);
  }
  return null;
}

function numberOrNull(value) {
  // Preserve zero nutrition values while converting blank form fields to database nulls.
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasNutrition(row) {
  // Cached products with no nutrition should be refreshed from Open Food Facts on the next lookup.
  return ['calories', 'proteins', 'fats', 'carbs'].some((field) => row[field] !== null && row[field] !== undefined);
}

function mapOpenFoodFactsProduct(code, product) {
  // Convert the Open Food Facts product shape into the compact food row used by this app.
  const nutriments = product.nutriments || {};
  let caloriesVal = getNutriment(nutriments, [
    'energy-kcal_serving',
    'energy-kcal',
    'energy-kcal_100g'
  ]);
  if (caloriesVal === null) {
    const kjVal = getNutriment(nutriments, ['energy-kj_serving', 'energy-kj', 'energy-kj_100g']);
    caloriesVal = kjVal === null ? null : kjVal / 4.184;
  }

  return {
    barcode: cleanBarcode(product.code || code),
    name: product.product_name || product.generic_name || product.brands || `Product ${code}`,
    calories: caloriesVal === null ? null : Math.round(caloriesVal),
    proteins: getNutriment(nutriments, ['proteins_serving', 'proteins', 'proteins_100g']),
    fats: getNutriment(nutriments, ['fat_serving', 'fat', 'fat_100g']),
    carbs: getNutriment(nutriments, ['carbohydrates_serving', 'carbohydrates', 'carbohydrates_100g']),
    raw: {
      source: 'openfoodfacts',
      code: product.code || code,
      brands: product.brands || null,
      quantity: product.quantity || null,
      serving_size: product.serving_size || null,
      image_front_url: product.image_front_url || null,
      nutriments
    }
  };
}

// Simple request logger to help debug client API calls
app.use((req, res, next) => {
  try {
    const userPart = req.user ? `(user ${req.user.id})` : '';
    const msg = `${req.method} ${req.url} ${userPart}`.trim();
    addLog('info', msg, { method: req.method, url: req.url });
  } catch (e) {}
  next();
});

// Expose recent server logs (limited, for debugging local dev)
app.get('/logs', (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const start = Math.max(0, LOG_BUFFER.length - limit);
  res.json(LOG_BUFFER.slice(start));
});

// Simple health
app.get('/', (req, res) => res.json({ ok: true }));

// Auth: register / login
app.post('/auth/register', async (req, res) => {
  // Create a password-backed user and return a short-lived JWT for frontend API calls.
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name || null, email, hash], function (err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
        return res.status(500).json({ error: err.message });
      }
      const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: '7d' });
      addLog('info', 'user registered', { id: this.lastID, email });
      res.json({ token, user: { id: this.lastID, email } });
    });
  } catch (ex) {
    res.status(500).json({ error: ex.message });
  }
});

app.post('/auth/login', (req, res) => {
  // Validate credentials against the stored password hash and issue a JWT on success.
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    addLog('info', 'user login', { id: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email } });
  });
});

// Auth middleware
function authMiddleware(req, res, next) {
  // Attach req.user when a Bearer token is present; anonymous local-user flows still work.
  const h = req.headers.authorization;
  if (!h) return next();
  const parts = h.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid Authorization header' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (ex) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use(authMiddleware);

// Users
app.post('/users', (req, res) => {
  // Ensure a local profile exists for meal tracking without a password-backed account.
  const { name, email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const stmt = db.prepare('INSERT OR IGNORE INTO users (name, email) VALUES (?, ?)');
  stmt.run(name || null, email, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM users WHERE email = ?', [email], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      addLog('info', 'user ensure', { id: row && row.id, email });
      res.json(row);
    });
  });
});

app.get('/users/:id', (req, res) => {
  // Return profile data used by settings and local profile restoration.
  db.get('SELECT * FROM users WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || null);
  });
});

// Update user (name/email)
app.put('/users/:id', (req, res) => {
  // Update editable profile fields while enforcing ownership for authenticated users.
  const id = req.params.id;
  const { name, email } = req.body;
  // if authenticated, require ownership
  if (req.user && req.user.id && Number(req.user.id) !== Number(id)) return res.status(403).json({ error: 'Forbidden' });
  db.run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name || null, email || null, id], function (err) {
    if (err) {
      if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
      return res.status(500).json({ error: err.message });
    }
    db.get('SELECT * FROM users WHERE id = ?', [id], (e2, row) => {
      if (e2) return res.status(500).json({ error: e2.message });
      addLog('info', 'user updated', { id: row && row.id, email: row && row.email });
      res.json(row);
    });
  });
});

// Foods
app.post('/foods', (req, res) => {
  // Save manually entered foods and return an existing barcode match when one is already cached.
  const { barcode, name, calories, proteins, fats, carbs, raw } = req.body;
  const stmt = db.prepare('INSERT OR IGNORE INTO foods (barcode, name, calories, proteins, fats, carbs, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  stmt.run(barcode || null, name || null, numberOrNull(calories), numberOrNull(proteins), numberOrNull(fats), numberOrNull(carbs), raw ? JSON.stringify(raw) : null, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0 && barcode) {
      // already exists; return existing
      db.get('SELECT * FROM foods WHERE barcode = ?', [barcode], (e2, row) => {
        if (e2) return res.status(500).json({ error: e2.message });
        addLog('info', 'foods returned existing', { barcode, id: row && row.id });
        res.json(row);
      });
    } else {
      db.get('SELECT * FROM foods WHERE id = ?', [this.lastID], (e2, row) => {
        if (e2) return res.status(500).json({ error: e2.message });
        addLog('info', 'foods inserted', { barcode, id: row && row.id, name: row && row.name });
        res.json(row);
      });
    }
  });
});

app.get('/foods', (req, res) => {
  // Provide a small local food search for future reuse and debugging.
  const q = req.query.q;
  if (!q) {
    db.all('SELECT * FROM foods ORDER BY name LIMIT 200', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
    return;
  }
  const like = `%${q}%`;
  db.all('SELECT * FROM foods WHERE name LIKE ? OR barcode LIKE ? LIMIT 100', [like, like], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Barcode lookup: check local first then Open Food Facts
app.get('/foods/barcode/:code', async (req, res) => {
  // Resolve a barcode from the local cache first, then refresh/fetch from Open Food Facts as needed.
  const code = cleanBarcode(req.params.code);
  if (!code || code.length < 6 || code.length > 14) {
    return res.status(400).json({ error: 'Invalid barcode' });
  }

  db.get('SELECT * FROM foods WHERE barcode = ?', [code], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      if (hasNutrition(row)) {
        addLog('info', 'foods barcode hit local', { barcode: code, id: row.id });
        return res.json(row);
      }
      addLog('info', 'foods barcode local row missing nutrition; refreshing from Open Food Facts', { barcode: code, id: row.id });
    }

    const notFoundAt = PRODUCT_NOT_FOUND_CACHE.get(code);
    if (notFoundAt && Date.now() - notFoundAt < PRODUCT_NOT_FOUND_TTL_MS) {
      return res.status(404).json({ error: 'Product not found in Open Food Facts' });
    }

    if (!checkProductLookupLimit()) {
      return res.status(429).json({ error: 'Open Food Facts lookup rate limit reached. Try again in a minute.' });
    }

    try {
      const params = new URLSearchParams({ fields: OPEN_FOOD_FACTS_FIELDS });
      const offUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?${params}`;
      const r = await fetch(offUrl, {
        headers: {
          'User-Agent': OPEN_FOOD_FACTS_USER_AGENT,
          Accept: 'application/json'
        }
      });
      if (r.status === 404) {
        PRODUCT_NOT_FOUND_CACHE.set(code, Date.now());
        return res.status(404).json({ error: 'Product not found in Open Food Facts' });
      }
      if (r.status === 429) {
        return res.status(429).json({ error: 'Open Food Facts rate limit reached. Try again later.' });
      }
      if (!r.ok) return res.status(502).json({ error: 'Open Food Facts lookup failed' });

      const data = await r.json();
      if (data.status === 1 && data.product) {
        const newFood = mapOpenFoodFactsProduct(code, data.product);
        const stmt = db.prepare(`
          INSERT INTO foods (barcode, name, calories, proteins, fats, carbs, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(barcode) DO UPDATE SET
            name = excluded.name,
            calories = excluded.calories,
            proteins = excluded.proteins,
            fats = excluded.fats,
            carbs = excluded.carbs,
            raw_json = excluded.raw_json
        `);
        stmt.run(newFood.barcode, newFood.name, newFood.calories, newFood.proteins, newFood.fats, newFood.carbs, JSON.stringify(newFood.raw), function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          db.get('SELECT * FROM foods WHERE barcode = ?', [newFood.barcode], (e3, inserted) => {
            if (e3) return res.status(500).json({ error: e3.message });
            addLog('info', 'foods inserted from Open Food Facts', { barcode: code, id: inserted && inserted.id, name: inserted && inserted.name });
            res.json(inserted);
          });
        });
        return;
      }
      PRODUCT_NOT_FOUND_CACHE.set(code, Date.now());
      res.status(404).json({ error: 'Product not found in Open Food Facts' });
    } catch (ex) {
      addLog('error', 'Open Food Facts lookup failed', { barcode: code, error: ex.message });
      res.status(502).json({ error: 'Open Food Facts lookup failed' });
    }
  });
});

// Meals (food entries consumed by users)
app.post('/meals', (req, res) => {
  // Create a dated food log entry; authenticated users override any posted user_id.
  let { user_id, food_id, date, calories, proteins, fats, carbs, note } = req.body;
  if (req.user && req.user.id) user_id = req.user.id;
  if (!user_id || !date) return res.status(400).json({ error: 'user_id and date required' });
  const stmt = db.prepare('INSERT INTO meals (user_id, food_id, date, calories, proteins, fats, carbs, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  stmt.run(user_id, food_id || null, date, numberOrNull(calories), numberOrNull(proteins), numberOrNull(fats), numberOrNull(carbs), note || null, function (err) {
    if (err) {
      console.error('POST /meals error', err, { body: req.body });
      addLog('error', 'POST /meals error', { err: err.message, body: req.body });
      return res.status(500).json({ error: err.message });
    }
    db.get('SELECT * FROM meals WHERE id = ?', [this.lastID], (e2, row) => {
      if (e2) return res.status(500).json({ error: e2.message });
      addLog('info', 'meal created', { id: row && row.id, user_id: row && row.user_id, date: row && row.date });
      res.json(row);
    });
  });
});

// Update a meal
app.put('/meals/:id', (req, res) => {
  // Update a meal row after checking that authenticated users own the original entry.
  const id = req.params.id;
  const { food_id, date, calories, proteins, fats, carbs, note } = req.body;
  db.get('SELECT * FROM meals WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Meal not found' });
    if (req.user && req.user.id && Number(req.user.id) !== Number(row.user_id)) return res.status(403).json({ error: 'Forbidden' });
    const stmt = db.prepare('UPDATE meals SET food_id = ?, date = ?, calories = ?, proteins = ?, fats = ?, carbs = ?, note = ? WHERE id = ?');
    stmt.run(food_id || null, date, numberOrNull(calories), numberOrNull(proteins), numberOrNull(fats), numberOrNull(carbs), note || null, id, function (e) {
      if (e) return res.status(500).json({ error: e.message });
      db.get('SELECT * FROM meals WHERE id = ?', [id], (e2, updated) => {
        if (e2) return res.status(500).json({ error: e2.message });
        addLog('info', 'meal updated', { id: updated && updated.id, user_id: updated && updated.user_id });
        res.json(updated);
      });
    });
  });
});

// Delete a meal
app.delete('/meals/:id', (req, res) => {
  // Delete a meal row after the same ownership check used for updates.
  const id = req.params.id;
  db.get('SELECT * FROM meals WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Meal not found' });
    if (req.user && req.user.id && Number(req.user.id) !== Number(row.user_id)) return res.status(403).json({ error: 'Forbidden' });
    db.run('DELETE FROM meals WHERE id = ?', [id], function (e) {
      if (e) return res.status(500).json({ error: e.message });
      addLog('info', 'meal deleted', { id, user_id: row.user_id });
      res.json({ success: true });
    });
  });
});

app.get('/meals', (req, res) => {
  // Fetch one user's meals for one date and include cached food names/barcodes.
  const date = req.query.date;
  const userId = (req.user && req.user.id) ? req.user.id : (req.query.user_id || null);
  if (!userId || !date) return res.status(400).json({ error: 'user_id and date required as query params or auth' });
  db.all(`SELECT m.*, f.name as food_name, f.barcode as food_barcode FROM meals m LEFT JOIN foods f ON m.food_id = f.id WHERE m.user_id = ? AND m.date = ? ORDER BY m.id DESC`, [userId, date], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    addLog('info', 'meals fetched', { user_id: userId, date, count: rows && rows.length });
    res.json(rows);
  });
});

// Exercises
app.get('/exercises', (req, res) => {
  // List exercises, including shared local exercises when a user-specific profile is active.
  const userId = (req.user && req.user.id) ? req.user.id : (req.query.user_id || null);
  const sql = userId
    ? 'SELECT * FROM exercises WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC'
    : 'SELECT * FROM exercises ORDER BY id DESC';
  const params = userId ? [userId] : [];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/exercises', (req, res) => {
  // Persist a simple workout movement with reps and sets.
  const { name, reps, sets } = req.body;
  const userId = (req.user && req.user.id) ? req.user.id : (req.body.user_id || null);
  if (!name) return res.status(400).json({ error: 'name required' });

  const stmt = db.prepare('INSERT INTO exercises (user_id, name, reps, sets) VALUES (?, ?, ?, ?)');
  stmt.run(userId, name, Number(reps) || null, Number(sets) || null, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT * FROM exercises WHERE id = ?', [this.lastID], (e2, row) => {
      if (e2) return res.status(500).json({ error: e2.message });
      addLog('info', 'exercise created', { id: row && row.id, user_id: row && row.user_id });
      res.json(row);
    });
  });
});

app.delete('/exercises/:id', (req, res) => {
  // Remove an exercise while preventing authenticated users from deleting another user's rows.
  const id = req.params.id;
  db.get('SELECT * FROM exercises WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Exercise not found' });
    if (req.user && req.user.id && row.user_id && Number(req.user.id) !== Number(row.user_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    db.run('DELETE FROM exercises WHERE id = ?', [id], function (e) {
      if (e) return res.status(500).json({ error: e.message });
      addLog('info', 'exercise deleted', { id, user_id: row.user_id });
      res.json({ success: true });
    });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
