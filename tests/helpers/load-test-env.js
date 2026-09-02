const path = require('path');
const dotenv = require('dotenv');

process.env.NODE_ENV = 'test';
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
