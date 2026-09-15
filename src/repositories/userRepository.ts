import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import { hashPassword } from '../util/password.js';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  display_name: string;
  pricing_mode: string;
  settings_json: string;
  created_at: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
}

/**
 * Data access for the users table. This is the foundational repository; all
 * other (user-owned) repositories added by later features MUST scope their
 * queries by user_id, mirroring the isolation established across the schema.
 */
export const userRepository = {
  findByEmail(email: string): User | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.toLowerCase()) as User | undefined;
  },

  findById(id: string): User | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  },

  create(input: CreateUserInput): User {
    const db = getDb();
    const id = newId();
    const email = input.email.toLowerCase();
    const { hash, salt } = hashPassword(input.password);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, display_name)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, email, hash, salt, input.displayName);
    return this.findById(id)!;
  },
};
