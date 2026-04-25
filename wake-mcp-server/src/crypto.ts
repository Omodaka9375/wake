import { randomBytes, createHash, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';

/** Number of bytes for generated tokens. */
const TOKEN_BYTES = 32;

/** PBKDF2 iterations for key derivation. */
const PBKDF2_ITERATIONS = 100_000;

/** AES key length in bytes. */
const AES_KEY_BYTES = 32;

/** AES-GCM IV length in bytes. */
const IV_BYTES = 16;

/** PBKDF2 salt length in bytes. */
const SALT_BYTES = 32;

/** AES-GCM auth tag length in bytes. */
const AUTH_TAG_BYTES = 16;

/** Generate a random token as a hex string. */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/** SHA-256 hash a string, returning hex. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Derive an AES-256 key from a token and salt using PBKDF2. */
function deriveKey(token: string, salt: Buffer): Buffer {
  return pbkdf2Sync(token, salt, PBKDF2_ITERATIONS, AES_KEY_BYTES, 'sha512');
}

/** Encrypt plaintext using AES-256-GCM. Returns { salt, iv, authTag, ciphertext } as hex. */
function encrypt(plaintext: string, token: string): { salt: string; iv: string; authTag: string; ciphertext: string } {
  const salt = randomBytes(SALT_BYTES);
  const key = deriveKey(token, salt);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

/** Decrypt ciphertext using AES-256-GCM. */
function decrypt(data: { salt: string; iv: string; authTag: string; ciphertext: string }, token: string): string {
  const salt = Buffer.from(data.salt, 'hex');
  const iv = Buffer.from(data.iv, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');
  const ciphertext = Buffer.from(data.ciphertext, 'hex');

  const key = deriveKey(token, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf-8');
}

export { generateToken, hashToken, deriveKey, encrypt, decrypt };
