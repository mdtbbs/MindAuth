require('dotenv').config();
const { start } = require('./bootstrap');

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
