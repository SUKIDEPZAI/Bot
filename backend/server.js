import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { isIP } from 'node:net';
import { OAuth2Client } from 'google-auth-library';
import { query, initDb, newId, getClient } from './db.js';
import { encryptSecret, requireAuth, signToken } from './security.js';
import { generateReply, publicAgent } from './providers.js';

for (const variable of ['JWT_SECRET', 'ENCRYPTION_KEY']) {
  if (!process.env[variable]) throw new Error(`${variable} is required. Copy backend/.env.example and configure it.`);
}
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173')
  .split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean);

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
    return callback(new Error('Origin này chưa được phép gọi API. Hãy kiểm tra FRONTEND_ORIGINS trên Render.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '5mb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const cleanUser = (row) => ({ id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url || '' });

app.get('/health', asyncRoute(async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, service: 'ai-room-api', database: 'connected' });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim().slice(0, 80) || 'Người dùng';
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Email không hợp lệ.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Mật khẩu phải có từ 8 đến 200 ký tự.' });
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const id = newId();
    const result = await query('INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,email,display_name,avatar_url', [id, email, displayName, passwordHash]);
    const user = cleanUser(result.rows[0]);
    res.status(201).json({ token: signToken({ id, email }), user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email này đã được đăng ký.' });
    throw error;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const found = await query('SELECT * FROM users WHERE email=$1', [email]);
  const user = found.rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
  }
  res.json({ token: signToken(user), user: cleanUser(user) });
}));

app.post('/api/auth/google', asyncRoute(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Đăng nhập Google chưa được cấu hình trên máy chủ.' });
  const credential = String(req.body.credential || '');
  if (!credential) return res.status(400).json({ error: 'Thiếu Google credential.' });
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified) return res.status(401).json({ error: 'Không xác minh được tài khoản Google.' });
  const email = payload.email.toLowerCase();
  const existing = await query('SELECT * FROM users WHERE google_sub=$1 OR email=$2 LIMIT 1', [payload.sub, email]);
  let user;
  if (existing.rows[0]) {
    const result = await query(`UPDATE users SET google_sub=$1, display_name=$2, avatar_url=$3 WHERE id=$4 RETURNING id,email,display_name,avatar_url`,
      [payload.sub, String(payload.name || payload.given_name || 'Người dùng').slice(0, 80), String(payload.picture || '').slice(0, 2000), existing.rows[0].id]);
    user = result.rows[0];
  } else {
    const result = await query(`INSERT INTO users (id,email,display_name,google_sub,avatar_url) VALUES ($1,$2,$3,$4,$5) RETURNING id,email,display_name,avatar_url`,
      [newId(), email, String(payload.name || payload.given_name || 'Người dùng').slice(0, 80), payload.sub, String(payload.picture || '').slice(0, 2000)]);
    user = result.rows[0];
  }
  res.json({ token: signToken(user), user: cleanUser(user) });
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: cleanUser(req.user) }));

function validateAgent(body) {
  const providers = ['openai', 'gemini', 'anthropic', 'openai-compatible'];
  const provider = String(body.provider || 'openai');
  const name = String(body.name || '').trim().slice(0, 80);
  const model = String(body.model || '').trim().slice(0, 160);
  const avatar = String(body.avatar || '').trim();
  const avatarAllowed = !avatar || avatar.length <= 1_500_000 && (/^https:\/\//i.test(avatar) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(avatar));
  const temperature = Number(body.temperature ?? 0.7);
  if (!name) throw Object.assign(new Error('Hãy đặt tên cho AI.'), { status: 400 });
  if (!providers.includes(provider)) throw Object.assign(new Error('Nhà cung cấp AI không hợp lệ.'), { status: 400 });
  if (!model) throw Object.assign(new Error('Hãy nhập model API.'), { status: 400 });
  if (!avatarAllowed) throw Object.assign(new Error('Ảnh cần là URL HTTPS hoặc ảnh PNG/JPG/WEBP/GIF dưới giới hạn cho phép.'), { status: 400 });
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw Object.assign(new Error('Temperature phải từ 0 đến 2.'), { status: 400 });
  const baseUrl = String(body.baseUrl || '').trim().slice(0, 500);
  if (provider === 'openai-compatible') {
    let url;
    try { url = new URL(baseUrl); } catch { throw Object.assign(new Error('Base URL không hợp lệ.'), { status: 400 }); }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const localHostname = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === 'metadata.google.internal';
    const privateIpLiteral = Boolean(isIP(hostname));
    if (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || localHostname || privateIpLiteral)) {
      throw Object.assign(new Error('Base URL khi chạy production phải là domain HTTPS công khai (không dùng localhost hoặc IP trực tiếp).'), { status: 400 });
    }
    if (url.username || url.password) throw Object.assign(new Error('Không nhúng thông tin đăng nhập trong Base URL.'), { status: 400 });
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(hostname))) {
      throw Object.assign(new Error('Base URL phải dùng HTTPS.'), { status: 400 });
    }
  }
  return {
    name, provider, model, avatar,
    description: String(body.description || '').trim().slice(0, 500),
    instructions: String(body.instructions || '').trim().slice(0, 8000) || 'Bạn là một trợ lý AI hữu ích. Trả lời bằng ngôn ngữ người dùng đang sử dụng.',
    temperature, baseUrl,
    apiKey: String(body.apiKey || '').trim().slice(0, 5000)
  };
}

app.get('/api/agents', requireAuth, asyncRoute(async (req, res) => {
  const result = await query('SELECT * FROM agents WHERE owner_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ agents: result.rows.map(publicAgent) });
}));

app.post('/api/agents', requireAuth, asyncRoute(async (req, res) => {
  const data = validateAgent(req.body);
  const result = await query(`INSERT INTO agents (id,owner_id,name,description,avatar,provider,model,base_url,instructions,temperature,encrypted_api_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [newId(), req.user.id, data.name, data.description, data.avatar, data.provider, data.model, data.baseUrl, data.instructions, data.temperature, encryptSecret(data.apiKey)]);
  res.status(201).json({ agent: publicAgent(result.rows[0]) });
}));

app.put('/api/agents/:id', requireAuth, asyncRoute(async (req, res) => {
  const owned = await query('SELECT * FROM agents WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'Không tìm thấy AI.' });
  const data = validateAgent(req.body);
  const encryptedKey = data.apiKey ? encryptSecret(data.apiKey) : (data.provider === owned.rows[0].provider ? owned.rows[0].encrypted_api_key : null);
  const result = await query(`UPDATE agents SET name=$1,description=$2,avatar=$3,provider=$4,model=$5,base_url=$6,instructions=$7,temperature=$8,encrypted_api_key=$9,updated_at=NOW()
    WHERE id=$10 AND owner_id=$11 RETURNING *`,
    [data.name, data.description, data.avatar, data.provider, data.model, data.baseUrl, data.instructions, data.temperature, encryptedKey, req.params.id, req.user.id]);
  res.json({ agent: publicAgent(result.rows[0]) });
}));

app.delete('/api/agents/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await query('DELETE FROM agents WHERE id=$1 AND owner_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Không tìm thấy AI.' });
  res.json({ ok: true });
}));

app.get('/api/conversations', requireAuth, asyncRoute(async (req, res) => {
  const result = await query(`SELECT c.id,c.title,c.created_at,c.updated_at,
    COALESCE(json_agg(json_build_object('id',a.id,'name',a.name,'avatar',a.avatar,'provider',a.provider) ORDER BY ca.position)
      FILTER (WHERE a.id IS NOT NULL),'[]'::json) AS agents,
    (SELECT content FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM conversations c LEFT JOIN conversation_agents ca ON ca.conversation_id=c.id LEFT JOIN agents a ON a.id=ca.agent_id
    WHERE c.owner_id=$1 GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100`, [req.user.id]);
  res.json({ conversations: result.rows });
}));

app.post('/api/conversations', requireAuth, asyncRoute(async (req, res) => {
  const requested = Array.isArray(req.body.agentIds) ? [...new Set(req.body.agentIds.map(String))].slice(0, 4) : [];
  if (requested.length < 1) return res.status(400).json({ error: 'Chọn ít nhất một AI cho cuộc trò chuyện.' });
  const owned = await query('SELECT id FROM agents WHERE owner_id=$1 AND id=ANY($2::text[])', [req.user.id, requested]);
  if (owned.rows.length !== requested.length) return res.status(403).json({ error: 'Một hoặc nhiều AI không thuộc tài khoản này.' });
  const title = String(req.body.title || 'Cuộc trò chuyện mới').trim().slice(0, 100) || 'Cuộc trò chuyện mới';
  const id = newId();
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO conversations (id,owner_id,title) VALUES ($1,$2,$3)', [id, req.user.id, title]);
    for (let i = 0; i < requested.length; i += 1) {
      await client.query('INSERT INTO conversation_agents (conversation_id,agent_id,position) VALUES ($1,$2,$3)', [id, requested[i], i]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json({ id, title });
}));

async function ownedConversation(conversationId, userId) {
  const result = await query(`SELECT c.*,
    COALESCE(json_agg(json_build_object('id',a.id,'name',a.name,'avatar',a.avatar,'provider',a.provider,'model',a.model) ORDER BY ca.position)
      FILTER (WHERE a.id IS NOT NULL),'[]'::json) AS agents,
    COALESCE(array_agg(a.id ORDER BY ca.position) FILTER (WHERE a.id IS NOT NULL),'{}') AS agent_ids
    FROM conversations c LEFT JOIN conversation_agents ca ON ca.conversation_id=c.id LEFT JOIN agents a ON a.id=ca.agent_id
    WHERE c.id=$1 AND c.owner_id=$2 GROUP BY c.id`, [conversationId, userId]);
  return result.rows[0];
}

app.get('/api/conversations/:id', requireAuth, asyncRoute(async (req, res) => {
  const conversation = await ownedConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
  const messages = await query(`SELECT m.id,m.role,m.content,m.created_at,m.agent_id,a.name AS agent_name,a.avatar AS agent_avatar
    FROM messages m LEFT JOIN agents a ON a.id=m.agent_id WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 500`, [conversation.id]);
  res.json({ conversation: { id: conversation.id, title: conversation.title, agents: conversation.agents }, messages: messages.rows });
}));

app.delete('/api/conversations/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await query('DELETE FROM conversations WHERE id=$1 AND owner_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
  res.json({ ok: true });
}));

app.post('/api/conversations/:id/messages', rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }), requireAuth, asyncRoute(async (req, res) => {
  const content = String(req.body.content || '').trim();
  const webSearch = Boolean(req.body.webSearch);
  if (!content || content.length > 30_000) return res.status(400).json({ error: 'Tin nhắn không được trống và tối đa 30.000 ký tự (kể cả nội dung tệp đính kèm).' });
  const conversation = await ownedConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
  if (!conversation.agent_ids?.length) return res.status(400).json({ error: 'Cuộc trò chuyện chưa có AI. Hãy tạo cuộc trò chuyện mới.' });

  const userMessage = { id: newId(), role: 'user', content, created_at: new Date().toISOString() };
  await query('INSERT INTO messages (id,conversation_id,user_id,role,content) VALUES ($1,$2,$3,$4,$5)', [userMessage.id, conversation.id, req.user.id, 'user', content]);
  await query('UPDATE conversations SET updated_at=NOW(), title=CASE WHEN title=$1 THEN $2 ELSE title END WHERE id=$3', ['Cuộc trò chuyện mới', content.slice(0, 56), conversation.id]);

  const agentRows = await query('SELECT * FROM agents WHERE owner_id=$1 AND id=ANY($2::text[]) ORDER BY array_position($2::text[],id)', [req.user.id, conversation.agent_ids]);
  const replies = [];
  const failures = [];
  const maxAgentsInGroup = 4;

  for (const agent of agentRows.rows.slice(0, maxAgentsInGroup)) {
    try {
      const prior = await query(`SELECT role,content,agent_id FROM (
        SELECT role,content,agent_id,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 24
      ) recent ORDER BY created_at`, [conversation.id]);
      const history = prior.rows.map((m) => ({
        role: m.role,
        content: m.role === 'assistant' && m.agent_id ? `[${agentRows.rows.find((a) => a.id === m.agent_id)?.name || 'AI khác'}]: ${m.content}` : m.content
      }));
      const reply = await generateReply(agent, history, { webSearch });
      const saved = { id: newId(), role: 'assistant', content: reply, agent_id: agent.id, agent_name: agent.name, agent_avatar: agent.avatar, created_at: new Date().toISOString() };
      await query('INSERT INTO messages (id,conversation_id,user_id,agent_id,role,content) VALUES ($1,$2,$3,$4,$5,$6)', [saved.id, conversation.id, req.user.id, agent.id, 'assistant', reply]);
      replies.push(saved);
    } catch (error) {
      console.error(`AI provider error (${agent.provider}/${agent.model}):`, error.message);
      failures.push({ agentId: agent.id, agentName: agent.name, error: error.message.slice(0, 500) });
    }
  }
  await query('UPDATE conversations SET updated_at=NOW() WHERE id=$1', [conversation.id]);
  res.json({ userMessage, replies, failures });
}));

app.use((error, _req, res, _next) => {
  if (error.message?.startsWith('Origin này')) return res.status(403).json({ error: error.message });
  const status = Number(error.status || 500);
  if (status >= 500) console.error('API error:', error.message);
  res.status(status).json({ error: status >= 500 ? 'Máy chủ gặp lỗi. Hãy kiểm tra log backend trên Render.' : error.message });
});

await initDb();
app.listen(PORT, '0.0.0.0', () => console.log(`AI Room API listening on 0.0.0.0:${PORT}`));
