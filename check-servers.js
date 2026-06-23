const path = require('path');
require('dotenv').config();

async function checkServers() {
  const { query } = require('./src/db/mysql');

  console.log('Checking servers in database...');

  const servers = await query.all('SELECT id, name, owner_id, status FROM servers WHERE deleted_at IS NULL');
  console.log('Servers:', servers);

  const quotas = await query.all('SELECT user_id, role, max_servers FROM user_quotas');
  console.log('User quotas:', quotas);

  process.exit(0);
}

checkServers().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});