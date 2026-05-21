const Database = require('better-sqlite3');
const db = new Database('./users.db');
console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all());
const clients = db.prepare('SELECT * FROM clients').all();
console.log('Clients:', JSON.stringify(clients, null, 2));
const authCodes = db.prepare('SELECT * FROM auth_codes').all();
console.log('Auth codes:', JSON.stringify(authCodes, null, 2));
db.close();
