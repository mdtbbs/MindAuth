const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../users.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    session_token TEXT DEFAULT NULL,
    email_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS email_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 587,
    user TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    "from" TEXT NOT NULL DEFAULT '',
    secure INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Login logs table
db.exec(`
  CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ip TEXT NOT NULL,
    device TEXT DEFAULT '',
    login_type TEXT DEFAULT 'web',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// Refresh tokens table
db.exec(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// Authorizations table - tracks user's granted authorizations to clients
db.exec(`
  CREATE TABLE IF NOT EXISTS authorizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    scope TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, client_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// Ensure one row exists in email_config
db.prepare(`INSERT OR IGNORE INTO email_config (id) VALUES (1)`).run();

// Add role column to users table if not exists (for admin accounts)
try {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasRole = columns.some(col => col.name === 'role');
  if (!hasRole) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
  }
} catch (err) {
  console.error('Error adding role column:', err);
}

// Create indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup ON auth_codes(code, client_id, used)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_credentials ON clients(client_id, client_secret)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(session_token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification_tokens(token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email_verified)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_client ON refresh_tokens(user_id, client_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_authorizations_user ON authorizations(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs(created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_authorizations_client ON authorizations(client_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_authorizations_last_used ON authorizations(last_used_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)`);

// System configuration table
db.exec(`
  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Insert default system configurations
const defaultConfigs = [
  ['session_lifetime_days', '30', 'Session有效期（天）'],
  ['password_min_length', '6', '密码最小长度'],
  ['password_require_complexity', '0', '是否要求密码复杂度（0/1）'],
  ['registration_enabled', '1', '是否允许新用户注册（0/1）']
];

const insertConfig = db.prepare('INSERT OR IGNORE INTO system_config (key, value, description) VALUES (?, ?, ?)');
for (const [key, value, desc] of defaultConfigs) {
  insertConfig.run(key, value, desc);
}

module.exports = db;