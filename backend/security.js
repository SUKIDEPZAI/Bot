import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const algorithm = 'aes-256-gcm';
function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY || '';
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes. Generate one using crypto.randomBytes(32).');
  }
  return key;
}

export function encryptSecret(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const [ivB64, tagB64, bodyB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error('Invalid encrypted secret format');
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d', issuer: 'ai-room-api' });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'ai-room-api' });
    const result = await query('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = $1', [decoded.sub]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.' });
    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
    }
    next(error);
  }
}
