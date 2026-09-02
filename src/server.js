require('dotenv').config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });
const { start } = require('./bootstrap');

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
