// ========================================
// PASSWORD HASHING & GENERATION
// ========================================
// Uses Argon2id (memory-hard, side-channel resistant) via @node-rs/argon2,
// which ships prebuilt binaries for macOS/Linux (works locally and on Vercel).
// Passwords are hashed, never encrypted or stored in plaintext.

const argon2 = require('@node-rs/argon2');
const crypto = require('crypto');

// Argon2id parameters. Tuned to be reasonably strong while staying well under
// the serverless function time budget. @node-rs/argon2 defaults to Argon2id.
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1
};

// A precomputed hash of a random value, used to equalize timing when verifying
// a password for an account that does not exist (prevents user enumeration).
const DUMMY_HASH = argon2.hashSync(crypto.randomBytes(32).toString('hex'), ARGON2_OPTIONS);

/**
 * Hash a plaintext password with Argon2id.
 * @param {string} plain
 * @returns {Promise<string>} encoded hash string
 */
async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2 hash.
 * Constant-time comparison is handled inside argon2.verify.
 * @param {string|null|undefined} hash - stored hash (may be null for OAuth-only users)
 * @param {string} plain
 * @returns {Promise<boolean>}
 */
async function verifyPassword(hash, plain) {
  if (typeof plain !== 'string') return false;
  // If there is no stored hash, still spend the time verifying a dummy hash so
  // that response timing does not reveal whether the account has a password.
  if (!hash) {
    try {
      await argon2.verify(DUMMY_HASH, plain, ARGON2_OPTIONS);
    } catch {
      /* ignore */
    }
    return false;
  }
  try {
    return await argon2.verify(hash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

// Unambiguous alphabet: no 0/O/1/l/I to make generated passwords easy to read
// and transcribe when an admin shares them with a user.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Generate a cryptographically random, human-readable password.
 * @param {number} length
 * @returns {string}
 */
function generatePassword(length = 16) {
  const len = Math.max(12, length);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generatePassword,
  ARGON2_OPTIONS
};
