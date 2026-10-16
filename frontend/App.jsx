import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, CircleHelp,
  Code2, Command, Cpu, Download, Ellipsis, FileText, Globe2, ImagePlus, LogOut, Menu,
  MessageCircle, MessageSquarePlus, Paperclip, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck,
  Sparkles, Trash2, Users, WandSparkles, X, Zap
} from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', help: 'OpenAI API', model: 'gpt-6-astra' },
  { value: 'gemini', label: 'Google Gemini', help: 'Google AI Studio', model: 'gemini-3.8-flash' },
  { value: 'anthropic', label: 'Anthropic Claude', help: 'Anthropic API', model: 'claude-sonnet-4-6' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (DeepSeek, Groq, Mistral…)', help: 'Nhà cung cấp có API tương thích OpenAI', model: 'model-name' },
];
const MODEL_SUGGESTIONS = {
  openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.5', 'gpt-4.1-mini'],
  gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro-preview'],
  anthropic: ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'openai-compatible': ['deepseek-chat', 'deepseek-reasoner', 'llama-3.3-70b-versatile', 'mistral-large-latest', 'model-name'],
};

async function request(path, { token, ...options } = {}) {
  if (!API_BASE) throw new Error('Chưa cấu hình VITE_API_URL. Hãy thêm URL API Render vào biến Actions của GitHub rồi chạy deploy lại.');
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Không kết nối được máy chủ. Kiểm tra URL Render, trạng thái backend và cấu hình CORS.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (${response.status}).`);
  return data;
}

function initials(text = 'AI') {
  return String(text).trim().split(/\s+/).slice(0, 2).map((v) => v[0] || '').join('').toUpperCase() || 'AI';
}
function Avatar({ src, name, size = 'normal', className = '' }) {
  return <span className={`avatar avatar-${size} ${className}`}>{src ? <img src={src} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : initials(name)}</span>;
}
function ProviderIcon({ provider, size = 14 }) {
  if (provider === 'gemini') return <Sparkles size={size} />;
  if (provider === 'anthropic') return <WandSparkles size={size} />;
  if (provider === 'openai-compatible') return <Globe2 size={size} />;
  return <Bot size={size} />;
}
function Markdown({ children }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>;
}
function LoadingDots() { return <span className="loading-dots"><i /><i /><i /></span>; }

function App({ googleEnabled }) {
  const [token, setToken] = useState(() => localStorage.getItem('airoom_token') || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [agents, setAgents] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [attachedNames, setAttachedNames] = useState([]);
  const fileInputRef = useRef(null);
  const [view, setView] = useState('chats');
  const [modal, setModal] = useState('');
  const [editingAgent, setEditingAgent] = useState(null);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingConvo, setLoadingConvo] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const api = useCallback((path, options = {}) => request(path, { token, ...options }), [token]);
  const currentAgents = activeConversation?.agents || [];
  const title = activeConversation?.title || 'Cuộc trò chuyện mới';

  const refreshWorkspace = useCallback(async () => {
    if (!token) return;
    const [agentData, conversationData] = await Promise.all([
      request('/api/agents', { token }), request('/api/conversations', { token }),
    ]);
    setAgents(agentData.agents || []);
    setConversations(conversationData.conversations || []);
  }, [token]);

  useEffect(() => {
    if (!token) { setUser(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await request('/api/auth/me', { token });
        if (cancelled) return;
        setUser(data.user);
        const [agentData, conversationData] = await Promise.all([
          request('/api/agents', { token }), request('/api/conversations', { token }),
        ]);
        if (cancelled) return;
        setAgents(agentData.agents || []);
        setConversations(conversationData.conversations || []);
        const first = (conversationData.conversations || [])[0];
        if (first) setActiveId(first.id);
      } catch (error) {
        if (!cancelled) {
          localStorage.removeItem('airoom_token');
          setToken(''); setUser(null); setAuthError(error.message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token || !activeId) { setActiveConversation(null); setMessages([]); return; }
    let cancelled = false;
    setLoadingConvo(true);
    request(`/api/conversations/${activeId}`, { token }).then((data) => {
      if (cancelled) return;
      setActiveConversation(data.conversation);
      setMessages(data.messages || []);
    }).catch((error) => {
      if (!cancelled) setNotice(error.message);
    }).finally(() => { if (!cancelled) setLoadingConvo(false); });
    return () => { cancelled = true; };
  }, [activeId, token]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const logout = () => {
    localStorage.removeItem('airoom_token'); setToken(''); setUser(null); setAgents([]); setConversations([]);
    setActiveId(''); setActiveConversation(null); setMessages([]); setDraft(''); setView('chats');
  };

  async function handleAuth(event) {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    const form = new FormData(event.currentTarget);
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = Object.fromEntries(form.entries());
      const result = await request(endpoint, { method: 'POST', body: JSON.stringify(body) });
      localStorage.setItem('airoom_token', result.token); setToken(result.token); setUser(result.user);
    } catch (error) { setAuthError(error.message); }
    finally { setAuthBusy(false); }
  }

  async function handleGoogleSuccess(response) {
    setAuthBusy(true); setAuthError('');
    try {
      const result = await request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
      localStorage.setItem('airoom_token', result.token); setToken(result.token); setUser(result.user);
    } catch (error) { setAuthError(error.message); }
    finally { setAuthBusy(false); }
  }

  async function openConversation(conversationId) {
    setActiveId(conversationId); setView('chats'); setSidebarOpen(false);
  }

  function openNewChat() {
    if (!agents.length) { setNotice('Hãy tạo AI đầu tiên trước khi mở cuộc trò chuyện.'); setEditingAgent(null); setModal('agent'); return; }
    setSelectedAgents(agents.length === 1 ? [agents[0].id] : []);
    setModal('new-chat'); setSidebarOpen(false);
  }

  async function createConversation() {
    if (!selectedAgents.length) { setNotice('Chọn ít nhất một AI.'); return; }
    setBusy(true);
    try {
      const data = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ agentIds: selectedAgents }) });
      await refreshWorkspace(); setActiveId(data.id); setView('chats'); setModal(''); setMessages([]); setActiveConversation(null);
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending || !activeId) return;
    setDraft(''); setSending(true);
    const temporary = { id: `pending-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString(), pending: true };
    setMessages((prev) => [...prev, temporary]);
    try {
      const data = await api(`/api/conversations/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ content, webSearch }) });
      setMessages((prev) => [...prev.filter((m) => m.id !== temporary.id), data.userMessage, ...(data.replies || []), ...(data.failures || []).map((failure, index) => ({
        id: `failure-${Date.now()}-${index}`, role: 'assistant', agent_name: failure.agentName,
        content: `⚠️ **Chưa nhận được câu trả lời từ ${failure.agentName}.**\n\n${failure.error}`,
        failed: true, created_at: new Date().toISOString(),
      }))]);
      setAttachedNames([]);
      await refreshWorkspace();
    } catch (error) {
      setMessages((prev) => [...prev.filter((m) => m.id !== temporary.id), { ...temporary, id: `error-${Date.now()}`, failed: true, content: `Không gửi được tin nhắn: ${error.message}` }]);
      setNotice(error.message);
    } finally { setSending(false); setTimeout(() => inputRef.current?.focus(), 80); }
  }

  async function attachTextFiles(files) {
    const accepted = Array.from(files || []);
    if (!accepted.length) return;
    const allowed = /\.(txt|md|markdown|json|csv|tsv|js|jsx|ts|tsx|py|html|css|xml|yaml|yml|toml|ini|log|sql|sh|py|java|c|cpp|h|hpp|rs|go|php|rb|vue|svelte)$/i;
    const blocks = [];
    const names = [];
    for (const file of accepted.slice(0, 5)) {
      if (!allowed.test(file.name)) { setNotice(`Chưa hỗ trợ đọc trực tiếp ${file.name}. Hãy dùng tệp văn bản/code (TXT, MD, JSON, CSV, JS, PY…).`); continue; }
      if (file.size > 250_000) { setNotice(`${file.name} vượt 250 KB. Hãy chia nhỏ tệp trước khi gửi.`); continue; }
      try {
        const text = await file.text();
        blocks.push(`\n\n--- TỆP ĐÍNH KÈM: ${file.name} ---\n${text.slice(0, 18_000)}\n--- HẾT TỆP ---`);
        names.push(file.name);
      } catch { setNotice(`Không đọc được tệp ${file.name}.`); }
    }
    if (blocks.length) {
      setDraft((current) => `${current}${blocks.join('')}`.slice(0, 29_000));
      setAttachedNames((current) => [...current, ...names].slice(0, 5));
      setNotice(`Đã thêm ${blocks.length} tệp vào nội dung nháp. Kiểm tra trước khi gửi.`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function exportConversation() {
    const lines = [`# ${title}`, '', `Xuất từ AI Room · ${new Date().toLocaleString()}`, ''];
    for (const message of messages) {
      const author = message.role === 'user' ? (user?.displayName || 'Bạn') : (message.agent_name || 'AI');
      lines.push(`## ${author}`, '', message.content || '', '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(title || 'ai-room-chat').replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'ai-room-chat'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  }

  async function saveAgent(payload) {
    setBusy(true);
    try {
      const result = editingAgent
        ? await api(`/api/agents/${editingAgent.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
      await refreshWorkspace(); setModal(''); setEditingAgent(null); setNotice(`Đã ${editingAgent ? 'cập nhật' : 'tạo'} AI “${result.agent.name}”.`);
      setView('agents');
    } catch (error) { setNotice(error.message); throw error; }
    finally { setBusy(false); }
  }

  async function deleteAgent(agent) {
    if (!window.confirm(`Xóa AI “${agent.name}”? AI này sẽ bị gỡ khỏi các cuộc trò chuyện liên quan.`)) return;
    try { await api(`/api/agents/${agent.id}`, { method: 'DELETE' }); await refreshWorkspace(); setNotice('Đã xóa AI.'); }
    catch (error) { setNotice(error.message); }
  }

  async function deleteConversation(conversation, event) {
    event?.stopPropagation();
    if (!window.confirm(`Xóa cuộc trò chuyện “${conversation.title}”? Lịch sử sẽ bị xóa.`)) return;
    try {
      await api(`/api/conversations/${conversation.id}`, { method: 'DELETE' });
      const next = conversations.filter((item) => item.id !== conversation.id);
      setConversations(next);
      if (activeId === conversation.id) { setActiveId(next[0]?.id || ''); setMessages([]); setActiveConversation(null); }
    } catch (error) { setNotice(error.message); }
  }

  const activeTitleAgents = useMemo(() => currentAgents.slice(0, 4), [currentAgents]);

  if (!user) {
    return <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onSubmit={handleAuth} busy={authBusy} error={authError} googleEnabled={googleEnabled} onGoogleSuccess={handleGoogleSuccess} />;
  }

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-overlay" onClick={() => setSidebarOpen(false)} aria-label="Đóng menu" />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={20} /></div>
          <div className="brand-word">ai<span>room</span><div className="brand-caption">YOUR PERSONAL AI SPACE</div></div>
          <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Đóng menu"><X size={18} /></button>
        </div>
        <button className="new-chat-button" onClick={openNewChat}><MessageSquarePlus size={17} /><span>Cuộc trò chuyện mới</span><kbd>⌘ K</kbd></button>
        <div className="side-label">KHÔNG GIAN</div>
        <nav className="side-nav">
          <button className={view === 'chats' ? 'selected' : ''} onClick={() => setView('chats')}><MessageCircle size={17} />Trò chuyện <span className="nav-count">{conversations.length}</span></button>
          <button className={view === 'agents' ? 'selected' : ''} onClick={() => { setView('agents'); setSidebarOpen(false); }}><Bot size={17} />Thư viện AI <span className="nav-count">{agents.length}</span></button>
        </nav>
        <div className="side-label recent-label">GẦN ĐÂY <button title="Tải lại" onClick={refreshWorkspace}><RefreshCw size={12} /></button></div>
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button key={conversation.id} className={`conversation-item ${activeId === conversation.id && view === 'chats' ? 'active' : ''}`} onClick={() => openConversation(conversation.id)}>
              <span className="conversation-icon"><MessageCircle size={15} /></span>
              <span className="conversation-copy"><span>{conversation.title || 'Cuộc trò chuyện mới'}</span><small>{(conversation.agents || []).length > 1 ? `${conversation.agents.length} AI` : (conversation.agents || [])[0]?.name || 'Chưa có AI'}</small></span>
              <span className="delete-chat" onClick={(e) => deleteConversation(conversation, e)} title="Xóa cuộc trò chuyện"><Trash2 size={13} /></span>
            </button>
          ))}
          {!conversations.length && <div className="sidebar-empty">Chưa có cuộc trò chuyện.<br />Tạo một phòng mới để bắt đầu.</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="safe-note"><ShieldCheck size={15} /><span>API key được mã hóa ở máy chủ</span></div>
          <div className="profile-row">
            <Avatar src={user.avatarUrl} name={user.displayName} />
            <div className="profile-copy"><strong>{user.displayName}</strong><small>{user.email}</small></div>
            <button className="icon-button" onClick={logout} title="Đăng xuất"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-trigger" onClick={() => setSidebarOpen(true)} aria-label="Mở menu"><Menu size={19} /></button>
            <span className="breadcrumb-muted">Workspace</span><span className="crumb-slash">/</span><strong>{view === 'agents' ? 'Thư viện AI' : 'Trò chuyện'}</strong>
          </div>
          <div className="topbar-right"><span className="connection-dot" /><span className="connection-text">Không gian cá nhân</span><button className="create-agent-top" onClick={() => { setEditingAgent(null); setModal('agent'); }}><Plus size={15} /> Tạo AI</button></div>
        </header>

        {view === 'agents' ? (
          <section className="library-page">
            <div className="page-heading"><div><div className="eyebrow"><Cpu size={14} /> AI WORKSHOP</div><h1>Thư viện AI của bạn</h1><p>Tạo các trợ lý riêng theo tính cách, model và API bạn lựa chọn.</p></div><button className="primary-button" onClick={() => { setEditingAgent(null); setModal('agent'); }}><Plus size={17} /> Tạo trợ lý mới</button></div>
            <div className="library-stats"><div><span className="stat-icon"><Bot size={17} /></span><span><small>Tổng trợ lý</small><strong>{agents.length}</strong></span></div><div><span className="stat-icon purple"><Users size={17} /></span><span><small>Phòng trò chuyện</small><strong>{conversations.length}</strong></span></div><div><span className="stat-icon green"><ShieldCheck size={17} /></span><span><small>Khóa API</small><strong>{agents.filter((a) => a.apiKeyConfigured).length}/{agents.length}</strong></span></div></div>
            {agents.length ? <div className="agent-grid">{agents.map((agent) => <AgentCard key={agent.id} agent={agent} onEdit={() => { setEditingAgent(agent); setModal('agent'); }} onDelete={() => deleteAgent(agent)} onChat={() => { setSelectedAgents([agent.id]); setModal('new-chat'); }} />)}</div> : <EmptyAgents onCreate={() => { setEditingAgent(null); setModal('agent'); }} />}
            <div className="security-banner"><div className="security-icon"><ShieldCheck size={20} /></div><div><strong>Quản lý API key an toàn hơn</strong><p>Khóa API được mã hóa bằng khóa bí mật đặt trên Render. Không đưa API key vào GitHub hoặc mã frontend.</p></div></div>
          </section>
        ) : (
          <section className="chat-page">
            {!activeId || !activeConversation ? (
              <WelcomeScreen agents={agents} onNewChat={openNewChat} onCreateAgent={() => { setEditingAgent(null); setModal('agent'); }} loading={loadingConvo} />
            ) : (
              <>
                <div className="chat-heading"><div className="chat-heading-main"><div className="chat-stack-avatars">{activeTitleAgents.map((agent) => <Avatar key={agent.id} src={agent.avatar} name={agent.name} size="small" />)}</div><div><h1>{title}</h1><p>{activeTitleAgents.length > 1 ? `${activeTitleAgents.length} trợ lý đang phối hợp` : activeTitleAgents[0]?.name || 'Trợ lý AI'} <span className="live-mark" /> Sẵn sàng</p></div></div><div className="chat-header-actions"><button className="subtle-button" onClick={exportConversation} disabled={!messages.length} title="Xuất cuộc trò chuyện thành Markdown"><Download size={15} /> Xuất</button><button className="subtle-button" onClick={openNewChat}><Users size={15} /> Phòng mới</button></div></div>
                <div className="chat-scroll">
                  {!messages.length ? <div className="conversation-start"><div className="start-aurora"><Sparkles size={28} /></div><h2>Bắt đầu cuộc trò chuyện</h2><p>Đặt câu hỏi, giao nhiệm vụ hoặc gửi đoạn code cần phân tích.</p><div className="prompt-suggestions"><button onClick={() => setDraft('Giải thích một chủ đề khó theo cách dễ hiểu, có ví dụ minh họa.')}> <WandSparkles size={15} /> Giải thích dễ hiểu</button><button onClick={() => setDraft('Hãy giúp tôi viết và rà soát code cho một tính năng.')}> <Code2 size={15} /> Viết và rà code</button><button onClick={() => setDraft('Đưa ra kế hoạch từng bước để giải quyết vấn đề này.')}> <FileText size={15} /> Lập kế hoạch</button></div></div> : <div className="message-list">{messages.map((message) => <Message key={message.id} message={message} user={user} />)}{sending && <div className="message-row ai-message"><div className="message-avatar"><Avatar name="AI" size="small" /></div><div className="message-content"><div className="message-author">AI Room <span>đang suy nghĩ</span></div><div className="message-bubble typing-bubble"><LoadingDots /></div></div></div>}<div ref={endRef} /></div>}
                </div>
                <form className="composer-wrap" onSubmit={sendMessage}><div className="composer"><textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKeyDown} placeholder="Nhắn tin cho trợ lý AI..." rows={1} maxLength={30000} disabled={sending} /><div className="composer-options"><button type="button" className="composer-option" onClick={() => fileInputRef.current?.click()} disabled={sending}><Paperclip size={13} /> Đính kèm code/tài liệu</button><input ref={fileInputRef} type="file" hidden multiple accept=".txt,.md,.markdown,.json,.csv,.tsv,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yaml,.yml,.toml,.ini,.log,.sql,.sh,.java,.c,.cpp,.h,.hpp,.rs,.go,.php,.rb,.vue,.svelte" onChange={(e) => attachTextFiles(e.target.files)} /><button type="button" className={`composer-option ${webSearch ? 'option-enabled' : ''}`} onClick={() => setWebSearch((value) => !value)} title="Tra cứu web cần model/API hỗ trợ"><Search size={13} /> {webSearch ? 'Tra cứu web: bật' : 'Tra cứu web'}</button>{attachedNames.length > 0 && <span className="attachment-count">{attachedNames.length} tệp trong nháp</span>}</div><div className="composer-bottom"><div className="composer-tools"><span><Command size={13} /> Enter để gửi</span><span className="dot-separator">·</span><span>Shift + Enter xuống dòng</span></div><button type="submit" className="send-button" disabled={!draft.trim() || sending}><Send size={16} /><span>Gửi</span></button></div></div><div className="composer-footnote"><ShieldCheck size={12} /> AI có thể trả lời chưa chính xác. Tệp văn bản được gửi cùng câu hỏi; không gửi dữ liệu bí mật.</div></form>
              </>
            )}
          </section>
        )}
      </main>

      {notice && <div className="toast"><span className="toast-dot" />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
      {modal === 'agent' && <AgentModal agent={editingAgent} busy={busy} onClose={() => { setModal(''); setEditingAgent(null); }} onSave={saveAgent} />}
      {modal === 'new-chat' && <NewChatModal agents={agents} selected={selectedAgents} setSelected={setSelectedAgents} busy={busy} onClose={() => setModal('')} onCreate={createConversation} onCreateAgent={() => { setModal('agent'); setEditingAgent(null); }} />}
    </div>
  );
}

function AuthScreen({ authMode, setAuthMode, onSubmit, busy, error, googleEnabled, onGoogleSuccess }) {
  return <div className="auth-page"><div className="auth-ambient ambient-one" /><div className="auth-ambient ambient-two" /><div className="auth-brand"><div className="brand-mark"><Sparkles size={22} /></div><span>ai<span>room</span></span></div><div className="auth-layout"><div className="auth-story"><div className="eyebrow"><span className="eyebrow-pulse" /> KHÔNG GIAN AI CỦA RIÊNG BẠN</div><h1>Một nơi.<br /><em>Nhiều trí tuệ.</em></h1><p>Tự tạo các trợ lý AI theo cách của bạn. Đưa nhiều AI vào cùng một cuộc trò chuyện để cùng suy nghĩ, phân tích và tạo ra kết quả tốt hơn.</p><div className="story-features"><div><span className="feature-symbol"><Bot size={17} /></span><span><strong>Trợ lý của riêng bạn</strong><small>Tên, ảnh, model và tính cách tùy chỉnh</small></span></div><div><span className="feature-symbol purple"><Users size={17} /></span><span><strong>Nhiều AI phối hợp</strong><small>OpenAI, Gemini, Claude và API tương thích</small></span></div><div><span className="feature-symbol green"><ShieldCheck size={17} /></span><span><strong>API key được mã hóa</strong><small>Khóa bí mật không nhúng vào frontend</small></span></div></div><div className="auth-art"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit-core"><Sparkles size={27} /></div><div className="orbit-node node-a"><Bot size={18} /></div><div className="orbit-node node-b"><WandSparkles size={17} /></div><div className="orbit-node node-c"><Code2 size={17} /></div><div className="orbit-label">AI MULTIVERSE <span>● ONLINE</span></div></div></div><div className="auth-card"><div className="auth-card-heading"><div className="auth-kicker">BẮT ĐẦU NGAY</div><h2>{authMode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản mới'}</h2><p>{authMode === 'login' ? 'Đăng nhập để vào không gian AI của bạn.' : 'Chỉ cần email, mật khẩu và một chút tò mò.'}</p></div><form className="auth-form" onSubmit={onSubmit}>{authMode === 'register' && <label>Tên hiển thị<input name="displayName" placeholder="Tên của bạn" minLength={1} maxLength={80} required /></label>}<label>Email<input type="email" name="email" placeholder="ban@email.com" autoComplete="email" required /></label><label>Mật khẩu<input type="password" name="password" placeholder="Tối thiểu 8 ký tự" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label>{error && <div className="form-error"><CircleHelp size={15} />{error}</div>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoadingDots /> : authMode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'} <ArrowUp size={17} /></button></form><div className="auth-divider"><span />hoặc tiếp tục với<span /></div>{googleEnabled ? <div className="google-login"><GoogleLogin onSuccess={onGoogleSuccess} onError={() => {}} text="continue_with" shape="rectangular" theme="filled_black" size="large" width="340" /></div> : <div className="google-disabled"><Globe2 size={16} /> Đăng nhập Google sẽ hoạt động sau khi cấu hình OAuth Client ID.</div>}<p className="auth-toggle">{authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'} <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Tạo tài khoản' : 'Đăng nhập'}</button></p><div className="auth-legal"><ShieldCheck size={13} /> Không chia sẻ API key trong tin nhắn hoặc tên AI.</div></div></div><div className="auth-bottom"><span>© 2026 AI ROOM</span><span>BUILT FOR CURIOSITY <Sparkles size={11} /></span></div></div>;
}

function WelcomeScreen({ agents, onNewChat, onCreateAgent, loading }) {
  return <div className="welcome-screen"><div className="welcome-topline"><span className="welcome-line" /><span>AI WORKSPACE</span><span className="welcome-line" /></div><div className="welcome-icon"><div className="welcome-icon-ring" /><Sparkles size={31} /></div><h1>Ý tưởng bắt đầu từ đây.</h1><p>Một trợ lý hay đã hữu ích. Nhiều trợ lý phối hợp còn mở ra cách làm hoàn toàn mới.</p><div className="welcome-actions"><button className="primary-button" onClick={onNewChat}><MessageSquarePlus size={17} /> Bắt đầu trò chuyện</button><button className="secondary-button" onClick={onCreateAgent}><Plus size={17} /> Tạo trợ lý AI</button></div><div className="welcome-mini-stats"><div><strong>{agents.length.toString().padStart(2, '0')}</strong><span>TRỢ LÝ ĐÃ TẠO</span></div><div className="mini-stat-divider" /><div><strong>{agents.filter((agent) => agent.apiKeyConfigured).length.toString().padStart(2, '0')}</strong><span>API ĐÃ CẤU HÌNH</span></div></div>{agents.length > 0 && <div className="quick-agents"><div className="quick-agents-head"><span>TRỢ LÝ SẴN SÀNG</span><button onClick={onNewChat}>Chọn AI <ArrowDown size={12} /></button></div><div className="quick-agent-avatars">{agents.slice(0, 5).map((agent) => <div className="quick-agent" key={agent.id}><Avatar src={agent.avatar} name={agent.name} /><span>{agent.name}</span></div>)}</div></div>}{loading && <div className="subtle-loading"><LoadingDots /></div>}</div>;
}

function Message({ message, user }) {
  const isUser = message.role === 'user';
  return <div className={`message-row ${isUser ? 'user-message' : 'ai-message'} ${message.failed ? 'message-failed' : ''}`}><div className="message-avatar">{isUser ? <Avatar src={user.avatarUrl} name={user.displayName} size="small" /> : <Avatar src={message.agent_avatar} name={message.agent_name || 'AI'} size="small" />}</div><div className="message-content"><div className="message-author">{isUser ? user.displayName : message.agent_name || 'AI'}{!isUser && <span>trợ lý AI</span>}{message.pending && <span>đang gửi</span>}</div><div className="message-bubble"><Markdown>{message.content}</Markdown></div><div className="message-time">{message.created_at ? new Date(message.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}</div></div></div>;
}

function AgentCard({ agent, onEdit, onDelete, onChat }) {
  const provider = PROVIDERS.find((item) => item.value === agent.provider);
  return <article className="agent-card"><div className="agent-card-top"><Avatar src={agent.avatar} name={agent.name} size="large" /><button className="card-menu" title="Xóa AI" onClick={onDelete}><Trash2 size={15} /></button></div><div className="agent-card-title"><h3>{agent.name}</h3><span className="provider-chip"><ProviderIcon provider={agent.provider} size={12} />{provider?.label || agent.provider}</span></div><p className="agent-description">{agent.description || 'Trợ lý AI tùy chỉnh của bạn, sẵn sàng giúp giải quyết công việc.'}</p><div className="agent-model"><Cpu size={13} /><span>{agent.model}</span></div><div className="agent-status-row"><span className={`status-pill ${agent.apiKeyConfigured ? 'status-ready' : 'status-missing'}`}><span />{agent.apiKeyConfigured ? 'API đã cấu hình' : 'Thiếu API key'}</span><button className="edit-agent" onClick={onEdit}><Settings2 size={13} /> Cấu hình</button></div><div className="agent-card-actions"><button className="agent-chat-button" onClick={onChat}><MessageCircle size={15} /> Trò chuyện</button><button className="agent-edit-button" onClick={onEdit} aria-label="Sửa AI"><Settings2 size={16} /></button></div></article>;
}

function EmptyAgents({ onCreate }) {
  return <div className="empty-agents"><div className="empty-agent-art"><Bot size={31} /><span><Plus size={15} /></span></div><h2>Chưa có trợ lý nào</h2><p>Tạo trợ lý đầu tiên bằng API của nhà cung cấp bạn đang sử dụng.</p><button className="primary-button" onClick={onCreate}><Plus size={16} /> Tạo trợ lý đầu tiên</button></div>;
}

function AgentModal({ agent, busy, onClose, onSave }) {
  const [provider, setProvider] = useState(agent?.provider || 'openai');
  const [model, setModel] = useState(agent?.model || 'gpt-6-astra');
  const [avatar, setAvatar] = useState(agent?.avatar || '');
  const [temperature, setTemperature] = useState(agent?.temperature ?? 0.7);
  const [formError, setFormError] = useState('');
  const [profile, setProfile] = useState('custom');
  const fileRef = useRef(null);
  const modelPresets = MODEL_SUGGESTIONS[provider] || [];

  const PROFILES = {
    custom: { label: 'Tùy chỉnh', instructions: 'Bạn là một trợ lý AI hữu ích. Trả lời bằng ngôn ngữ người dùng đang sử dụng.' },
    codex: { label: 'Lập trình viên kiểu Codex', instructions: 'Bạn là trợ lý kỹ thuật phần mềm chuyên sâu. Làm rõ yêu cầu, phân tích kiến trúc, chia việc thành bước nhỏ, viết mã hoàn chỉnh có thể chạy, nêu tên file và vị trí thay đổi, xử lý lỗi và trường hợp biên, đề xuất test. Khi sửa code, ưu tiên diff tối thiểu và không bịa rằng đã chạy test nếu chưa chạy được. Nếu thiếu repo hoặc file, yêu cầu người dùng cung cấp.' },
    review: { label: 'Code review', instructions: 'Bạn là kỹ sư review code cấp cao. Ưu tiên tìm bug thực tế, lỗ hổng bảo mật, race condition, hiệu năng và lỗi tương thích. Sắp xếp phát hiện theo mức độ nghiêm trọng, nêu file/dòng khi có dữ liệu, cách tái hiện và cách sửa. Tránh nhận xét phong cách không cần thiết.' },
    claude: { label: 'Claude — phân tích dài', instructions: 'Bạn là trợ lý phân tích cẩn thận, giỏi tổng hợp tài liệu dài và giải quyết vấn đề phức tạp. Nêu giả định, phân biệt dữ kiện với suy luận, trình bày kết luận rõ ràng và kiểm tra tính nhất quán. Không tiết lộ suy nghĩ nội bộ; chỉ cung cấp giải thích ngắn gọn có thể kiểm chứng.' },
    research: { label: 'Nghiên cứu / tổng hợp', instructions: 'Bạn là trợ lý nghiên cứu. Xác định câu hỏi, phân tách các khía cạnh, ghi rõ điều chưa chắc chắn và đưa ra kết luận có cấu trúc. Không tuyên bố đã tra cứu web nếu chưa có công cụ tìm kiếm được cấp.' },
    writer: { label: 'Viết nội dung', instructions: 'Bạn là biên tập viên chuyên nghiệp. Viết tự nhiên, đúng mục tiêu và đối tượng; tránh sáo rỗng; giữ nguyên các dữ kiện người dùng cung cấp và hỏi lại nếu thiếu thông tin quan trọng.' },
  };
  function applyProfile(value) { setProfile(value); const box = document.querySelector('[name="instructions"]'); if (box) box.value = PROFILES[value]?.instructions || PROFILES.custom.instructions; }
  function changeProvider(next) { setProvider(next); setModel(MODEL_SUGGESTIONS[next]?.[0] || ''); }
  function uploadAvatar(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setFormError('Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.'); return; }
    if (file.size > 850 * 1024) { setFormError('Ảnh cần nhỏ hơn 850 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setAvatar(String(reader.result || '')); setFormError(''); };
    reader.onerror = () => setFormError('Không đọc được ảnh này.');
    reader.readAsDataURL(file);
  }
  async function submit(event) {
    event.preventDefault(); setFormError('');
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get('name'), description: form.get('description'), avatar, provider, model: form.get('model'),
      apiKey: form.get('apiKey'), baseUrl: form.get('baseUrl'), instructions: form.get('instructions'), temperature: Number(temperature),
    };
    try { await onSave(payload); } catch (error) { setFormError(error.message); }
  }

  return <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card agent-modal"><div className="modal-header"><div><div className="eyebrow"><Cpu size={13} /> AI CONFIGURATION</div><h2>{agent ? 'Chỉnh sửa trợ lý' : 'Tạo trợ lý AI'}</h2><p>Đặt danh tính, chọn API và định hình cách AI trả lời.</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><form onSubmit={submit} className="agent-form"><div className="agent-identity"><button className="avatar-upload" type="button" onClick={() => fileRef.current?.click()}><Avatar src={avatar} name={agent?.name || 'AI mới'} size="xl" /><span><ImagePlus size={14} /></span></button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => uploadAvatar(e.target.files?.[0])} /><div><strong>Ảnh đại diện</strong><small>Chọn ảnh từ thiết bị hoặc dùng URL ảnh bên dưới.</small></div><button className="clear-avatar" type="button" onClick={() => setAvatar('')}>Xóa ảnh</button></div><label>Tên trợ lý <span className="required-star">*</span><input name="name" defaultValue={agent?.name || ''} placeholder="VD: Cố vấn lập trình" required maxLength={80} /></label><label>Mô tả ngắn<input name="description" defaultValue={agent?.description || ''} placeholder="Trợ lý này chuyên giúp việc gì?" maxLength={500} /></label><label>URL ảnh đại diện <span className="muted-label">(không bắt buộc)</span><input value={avatar.startsWith('data:') ? '' : avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://.../avatar.png" /></label><div className="form-two-cols"><label>Nhà cung cấp API<select value={provider} onChange={(e) => changeProvider(e.target.value)}>{PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Model <span className="required-star">*</span><input name="model" value={model} onChange={(e) => setModel(e.target.value)} list="model-presets" placeholder="Nhập đúng tên model" required maxLength={160} /><datalist id="model-presets">{modelPresets.map((name) => <option key={name} value={name} />)}</datalist></label></div>{provider === 'openai-compatible' && <label>Base URL <span className="required-star">*</span><input name="baseUrl" defaultValue={agent?.base_url || ''} placeholder="https://api.example.com/v1" required /></label>}<label>API key {agent?.apiKeyConfigured && <span className="key-set-indicator"><Check size={12} /> đã lưu</span>}<input name="apiKey" type="password" autoComplete="new-password" placeholder={agent?.apiKeyConfigured ? 'Để trống để giữ khóa hiện tại' : 'Dán API key của nhà cung cấp'} maxLength={5000} /><small className="field-help">Khóa được mã hóa ở backend. Không hiển thị lại sau khi lưu.</small></label><label>Mẫu năng lực<select value={profile} onChange={(e) => applyProfile(e.target.value)}>{Object.entries(PROFILES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select><small className="field-help">Mẫu hướng dẫn cách làm việc; khả năng thật vẫn phụ thuộc model/API bạn chọn.</small></label><label>Chỉ dẫn / tính cách<textarea name="instructions" defaultValue={agent?.instructions || PROFILES.custom.instructions} rows={4} maxLength={8000} placeholder="Bạn là ai? Phong cách trả lời? Vai trò trong nhóm?" /></label><div className="temperature-row"><div><label htmlFor="temperature">Mức sáng tạo</label><small>Thấp = ổn định · Cao = đa dạng</small></div><div className="temperature-control"><input id="temperature" type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /><strong>{Number(temperature).toFixed(1)}</strong></div></div>{formError && <div className="form-error"><CircleHelp size={15} />{formError}</div>}<div className="modal-footer"><span className="privacy-caption"><ShieldCheck size={13} /> API key không được gửi về trình duyệt sau khi lưu</span><div><button className="secondary-button" type="button" onClick={onClose}>Hủy</button><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoadingDots /> : <><Check size={15} /> {agent ? 'Lưu thay đổi' : 'Tạo trợ lý'}</>}</button></div></div></form></div></div>;
}

function NewChatModal({ agents, selected, setSelected, busy, onClose, onCreate, onCreateAgent }) {
  function toggle(id) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 4 ? [...current, id] : current); }
  return <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card new-chat-modal"><div className="modal-header"><div><div className="eyebrow"><Users size={13} /> MULTI-AGENT ROOM</div><h2>Tạo phòng trò chuyện</h2><p>Chọn AI sẽ cùng nhận và trả lời tin nhắn. Tối đa 4 AI mỗi phòng.</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>{agents.length ? <><div className="selection-counter">Đã chọn <strong>{selected.length}/4</strong> trợ lý <span>· Mỗi AI dùng API key riêng</span></div><div className="agent-select-list">{agents.map((agent) => <button type="button" key={agent.id} className={`agent-select-item ${selected.includes(agent.id) ? 'checked' : ''}`} onClick={() => toggle(agent.id)} disabled={!selected.includes(agent.id) && selected.length >= 4}><span className={`custom-check ${selected.includes(agent.id) ? 'on' : ''}`}>{selected.includes(agent.id) && <Check size={13} />}</span><Avatar src={agent.avatar} name={agent.name} /><span className="select-agent-copy"><strong>{agent.name}</strong><small><ProviderIcon provider={agent.provider} size={11} /> {agent.model}</small></span><span className={`select-status ${agent.apiKeyConfigured ? 'ready' : ''}`}>{agent.apiKeyConfigured ? 'Sẵn sàng' : 'Thiếu key'}</span></button>)}</div><div className="group-info"><Zap size={16} /><p><strong>Cách phối hợp:</strong> Sau khi bạn gửi tin, backend gọi từng AI theo thứ tự đã chọn. AI phía sau được xem câu trả lời trước đó để bổ sung ý kiến.</p></div><div className="modal-footer"><span className="privacy-caption"><ShieldCheck size={13} /> Chỉ dùng AI trong tài khoản của bạn</span><div><button className="secondary-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={!selected.length || busy} onClick={onCreate}>{busy ? <LoadingDots /> : <><MessageCircle size={15} /> Tạo phòng ({selected.length})</>}</button></div></div></> : <EmptyAgents onCreate={onCreateAgent} />}</div></div>;
}

export default App;
