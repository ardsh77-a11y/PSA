/**
 * Seed script: creates the database + schema and a demo user so the app is
 * immediately usable offline. Idempotent - re-running it will not create
 * duplicate demo accounts. Later features extend this with demo inventory,
 * listings, price snapshots, etc.
 */
import { getDb, closeDb } from '../db/connection.js';
import { userRepository } from '../repositories/userRepository.js';

const DEMO_EMAIL = 'demo@pokeops.local';
const DEMO_PASSWORD = 'pokeops-demo';
const DEMO_NAME = 'Demo Seller';

function seed(): void {
  // getDb() runs migrations, ensuring all tables exist.
  getDb();

  const existing = userRepository.findByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`Demo user already present: ${DEMO_EMAIL}`);
  } else {
    userRepository.create({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: DEMO_NAME });
    console.log(`Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  console.log('Seed complete.');
  closeDb();
}

seed();
