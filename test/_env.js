/* Shared env bootstrap for test scripts.
   Owner passwords come ONLY from .env / environment — never from source code. */
require('dotenv').config();

const PRIMARY_OWNER_PASSWORD = process.env.PRIMARY_OWNER_PASSWORD;
const TEMPORARY_OWNER_PASSWORD = process.env.TEMPORARY_OWNER_PASSWORD;

if (!PRIMARY_OWNER_PASSWORD || !TEMPORARY_OWNER_PASSWORD) {
  console.error('MISSING OWNER PASSWORDS: set PRIMARY_OWNER_PASSWORD and TEMPORARY_OWNER_PASSWORD in .env (see .env.example)');
  process.exit(1);
}

module.exports = { PRIMARY_OWNER_PASSWORD, TEMPORARY_OWNER_PASSWORD };
