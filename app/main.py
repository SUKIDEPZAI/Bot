from __future__ import annotations
import os, re, hmac, hashlib, secrets, zipfile, io, shutil, mimetypes, urllib.request, urllib.error, json
from pathlib import Path, PurePosixPath
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Request, Response, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, String, Text, DateTime, ForeignKey, Boolean, select, desc
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, relationship

from app.services.codex import run_codex, CodexUnavailable

APP_SECRET = os.getenv("APP_SECRET", "dev-only-change-this-secret")
if len(APP_SECRET) < 32 and os.getenv("APP_SECRET"):
    raise RuntimeError("APP_SECRET phải dài ít nhất 32 ký tự.")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "7"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "15"))
UPLOAD_ROOT = Path(os.getenv("UPLOAD_ROOT", "./user_uploads")).resolve()
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://") and "+psycopg" not in DATABASE_URL:
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

class Base(DeclarativeBase): pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)

class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Cuộc trò chuyện mới")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class Upload(Base):
    __tablename__ = "uploads"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(Text)
    size: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class GitHubRepo(Base):
    __tablename__ = "github_repos"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(100))
    detail: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class InstalledSkill(Base):
    __tablename__ = "installed_skills"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str] = mapped_column(Text)
    skill_path: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="installed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class InstalledPlugin(Base):
    __tablename__ = "installed_plugins"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str] = mapped_column(Text)
    manifest_path: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="staged_review")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(engine)

app = FastAPI(title="ChatGPT + Codex Web", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$" + salt.hex() + "$" + digest.hex()

def verify_password(password: str, stored: str) -> bool:
    try:
        kind, salt_hex, digest_hex = stored.split("$", 2)
        if kind != "scrypt": return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False

def session_user(request: Request):
    sid = request.cookies.get("sid")
    if not sid: return None, None
    with SessionLocal() as db:
        row = db.get(SessionRow, sid)
        if not row or row.expires_at < now():
            if row: db.delete(row); db.commit()
            return None, None
        user = db.get(User, row.user_id)
        return user, row.csrf

def require_user(request: Request):
    user, csrf = session_user(request)
    if not user: raise HTTPException(401, "Bạn cần đăng nhập.")
    return user, csrf

def check_csrf(request: Request, csrf: str | None = None):
    user, expected = require_user(request)
    # Never trust a caller-supplied token argument; require the header.
    supplied = request.headers.get("x-csrf-token")
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(403, "CSRF token không hợp lệ.")
    return user

def user_dir(uid: int) -> Path:
    p = (UPLOAD_ROOT / str(uid)).resolve()
    if UPLOAD_ROOT not in p.parents: raise HTTPException(400, "Đường dẫn không hợp lệ.")
    p.mkdir(parents=True, exist_ok=True)
    return p

def conv_for(db, conv_id, uid):
    conv = db.get(Conversation, conv_id)
    if not conv or conv.user_id != uid: raise HTTPException(404, "Không tìm thấy hội thoại.")
    return conv

@app.get("/", response_class=HTMLResponse)
def home():
    return (Path("app/static/index.html")).read_text(encoding="utf-8")

@app.get("/health")
def health():
    return {"ok": True, "service": "chatgpt-codex-web"}

@app.get("/api/me")
def me(request: Request):
    user, csrf = session_user(request)
    if not user: return {"authenticated": False}
    return {"authenticated": True, "email": user.email, "csrf": csrf}

@app.post("/api/register")
async def register(request: Request):
    data = await request.json()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not re.fullmatch(r"[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+", email):
        raise HTTPException(400, "Email không hợp lệ.")
    if len(password) < 10 or len(password) > 200:
        raise HTTPException(400, "Mật khẩu phải từ 10 đến 200 ký tự.")
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(409, "Email đã được đăng ký.")
        user = User(email=email, password_hash=hash_password(password))
        db.add(user); db.flush()
        sid = secrets.token_urlsafe(32); csrf = secrets.token_urlsafe(24)
        db.add(SessionRow(id=sid, user_id=user.id, csrf=csrf, expires_at=now()+timedelta(days=SESSION_DAYS)))
        db.commit()
    resp = JSONResponse({"ok": True, "email": email, "csrf": csrf})
    resp.set_cookie("sid", sid, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=SESSION_DAYS*86400, path="/")
    return resp

@app.post("/api/login")
async def login(request: Request):
    data = await request.json()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(401, "Email hoặc mật khẩu không đúng.")
        sid = secrets.token_urlsafe(32); csrf = secrets.token_urlsafe(24)
        db.add(SessionRow(id=sid, user_id=user.id, csrf=csrf, expires_at=now()+timedelta(days=SESSION_DAYS)))
        db.commit()
    resp = JSONResponse({"ok": True, "email": email, "csrf": csrf})
    resp.set_cookie("sid", sid, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=SESSION_DAYS*86400, path="/")
    return resp

@app.post("/api/logout")
def logout(request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    sid = request.cookies.get("sid")
    with SessionLocal() as db:
        row = db.get(SessionRow, sid)
        if row: db.delete(row); db.commit()
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("sid", path="/")
    return resp

@app.get("/api/conversations")
def conversations(request: Request):
    user, _ = require_user(request)
    with SessionLocal() as db:
        rows = db.scalars(select(Conversation).where(Conversation.user_id == user.id).order_by(desc(Conversation.updated_at))).all()
        return [{"id": x.id, "title": x.title, "updated_at": x.updated_at.isoformat()} for x in rows]

@app.post("/api/conversations")
async def create_conversation(request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    title = str(data.get("title", "Cuộc trò chuyện mới"))[:200]
    cid = secrets.token_urlsafe(12)
    with SessionLocal() as db:
        db.add(Conversation(id=cid, user_id=user.id, title=title or "Cuộc trò chuyện mới")); db.commit()
    return {"id": cid, "title": title or "Cuộc trò chuyện mới"}

@app.get("/api/conversations/{cid}/messages")
def get_messages(cid: str, request: Request):
    user, _ = require_user(request)
    with SessionLocal() as db:
        conv = conv_for(db, cid, user.id)
        rows = db.scalars(select(Message).where(Message.conversation_id == cid, Message.user_id == user.id).order_by(Message.id)).all()
        return [{"role": x.role, "content": x.content, "created_at": x.created_at.isoformat()} for x in rows]

@app.delete("/api/conversations/{cid}")
def delete_conversation(cid: str, request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    with SessionLocal() as db:
        conv = conv_for(db, cid, user.id); db.delete(conv); db.commit()
    return {"ok": True}

@app.post("/api/conversations/{cid}/chat")
async def chat(cid: str, request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    prompt = str(data.get("message", "")).strip()
    mode = str(data.get("mode", "chat"))
    if not prompt: raise HTTPException(400, "Tin nhắn trống.")
    if len(prompt) > 20000: raise HTTPException(413, "Tin nhắn quá dài.")
    with SessionLocal() as db:
        conv = conv_for(db, cid, user.id)
        db.add(Message(conversation_id=cid, user_id=user.id, role="user", content=prompt))
        if conv.title == "Cuộc trò chuyện mới":
            conv.title = prompt[:70]
        conv.updated_at = now()
        db.commit()
    if mode == "codex":
        # Shared server-side Codex login is deliberately disabled by default.
        try:
            result = run_codex(prompt, str(user_dir(user.id)))
        except CodexUnavailable as e:
            result = "Chưa thể chạy Codex an toàn: " + str(e)
        except Exception:
            result = "Codex gặp lỗi. Kiểm tra log worker; không gửi thông tin bí mật vào log."
    else:
        result = ("Website đã lưu tin nhắn. Chưa có nhà cung cấp AI được ủy quyền cấu hình cho ứng dụng này. "
                  "Hãy hoàn tất tích hợp Sign in with ChatGPT theo tài liệu OpenAI; đăng nhập website không tự cấp quyền AI. "
                  "Trong lúc đó, bạn vẫn có thể quản lý lịch sử, tải file và workspace.")
    with SessionLocal() as db:
        db.add(Message(conversation_id=cid, user_id=user.id, role="assistant", content=result))
        conv = db.get(Conversation, cid)
        if conv: conv.updated_at = now()
        db.commit()
    return {"role": "assistant", "content": result}

@app.post("/api/uploads")
async def upload(request: Request, file: UploadFile = File(...)):
    user, csrf = require_user(request)
    check_csrf(request, request.headers.get("x-csrf-token"))
    raw_name = Path(file.filename or "upload.bin").name
    if raw_name in ("", ".", ".."): raise HTTPException(400, "Tên file không hợp lệ.")
    content = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024: raise HTTPException(413, "File vượt giới hạn.")
    uid = secrets.token_urlsafe(12)
    root = user_dir(user.id)
    if raw_name.lower().endswith(".zip"):
        target = root / uid
        target.mkdir(mode=0o700)
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                members = zf.infolist()
                if len(members) > 500: raise HTTPException(400, "ZIP có quá nhiều mục.")
                total = sum(i.file_size for i in members)
                if total > MAX_UPLOAD_MB * 1024 * 1024 * 4: raise HTTPException(413, "ZIP giải nén quá lớn.")
                for info in members:
                    name = info.filename.replace("\\", "/")
                    p = PurePosixPath(name)
                    mode = (info.external_attr >> 16) & 0o170000
                    if p.is_absolute() or ".." in p.parts or mode == 0o120000:
                        raise HTTPException(400, "ZIP chứa đường dẫn hoặc symlink không an toàn.")
                    out = (target / Path(*p.parts)).resolve()
                    if target.resolve() not in out.parents and out != target.resolve():
                        raise HTTPException(400, "ZIP path traversal bị chặn.")
                zf.extractall(target)
        except zipfile.BadZipFile:
            shutil.rmtree(target, ignore_errors=True)
            raise HTTPException(400, "File ZIP không hợp lệ.")
        stored = str(target)
    else:
        safe_name = re.sub(r"[^a-zA-Z0-9._ -]", "_", raw_name)[:150]
        target = (root / f"{uid}_{safe_name}").resolve()
        if root not in target.parents: raise HTTPException(400, "Tên file không an toàn.")
        target.write_bytes(content)
        stored = str(target)
    with SessionLocal() as db:
        db.add(Upload(id=uid, user_id=user.id, original_name=raw_name, stored_path=stored, size=len(content)))
        db.commit()
    return {"id": uid, "name": raw_name, "size": len(content), "message": "Đã tải lên. File chưa được thực thi."}

@app.get("/api/uploads")
def uploads(request: Request):
    user, _ = require_user(request)
    with SessionLocal() as db:
        rows = db.scalars(select(Upload).where(Upload.user_id == user.id).order_by(desc(Upload.created_at))).all()
        return [{"id": x.id, "name": x.original_name, "size": x.size, "created_at": x.created_at.isoformat()} for x in rows]

@app.get("/api/workspace")
def workspace(request: Request):
    user, _ = require_user(request)
    root = user_dir(user.id)
    items = []
    for p in root.rglob("*"):
        if p.is_file():
            try: rel = str(p.relative_to(root))
            except ValueError: continue
            items.append({"path": rel, "size": p.stat().st_size})
            if len(items) >= 500: break
    return {"files": items}

@app.get("/api/workspace/file")
def workspace_file(path: str, request: Request):
    user, _ = require_user(request)
    root = user_dir(user.id).resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file(): raise HTTPException(404, "Không tìm thấy file.")
    if target.stat().st_size > 512 * 1024: raise HTTPException(413, "File quá lớn để xem.")
    try: content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError: raise HTTPException(415, "File nhị phân không thể xem như văn bản.")
    return {"path": path, "content": content}

@app.post("/api/github")
async def github_repo(request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    url = str(data.get("url", "")).strip()
    if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?", url):
        raise HTTPException(400, "Chỉ chấp nhận URL repository GitHub HTTPS công khai.")
    # Store the repository URL; cloning and private repo auth are intentionally not automatic.
    with SessionLocal() as db:
        db.add(GitHubRepo(user_id=user.id, url=url))
        db.commit()
    return {"ok": True, "url": url, "message": "Đã ghi nhận URL. Bản starter chưa clone hoặc chạy repository."}

@app.post("/api/approvals")
async def create_approval(request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    action = str(data.get("action", "")).strip()[:100]
    detail = str(data.get("detail", "")).strip()[:4000]
    if action not in {"run_command", "delete_files", "git_push", "install_dependencies", "network_access"}:
        raise HTTPException(400, "Loại thao tác không nằm trong danh sách cho phép.")
    aid = secrets.token_urlsafe(12)
    with SessionLocal() as db:
        db.add(Approval(id=aid, user_id=user.id, action=action, detail=detail, status="pending")); db.commit()
    return {"id": aid, "status": "pending", "message": "Đã tạo yêu cầu. Bản starter chưa tự thi hành thao tác nguy hiểm."}

@app.get("/api/approvals")
def list_approvals(request: Request):
    user, _ = require_user(request)
    with SessionLocal() as db:
        rows = db.scalars(select(Approval).where(Approval.user_id == user.id).order_by(desc(Approval.created_at))).all()
        return [{"id": x.id, "action": x.action, "detail": x.detail, "status": x.status, "created_at": x.created_at.isoformat()} for x in rows]

@app.post("/api/approvals/{aid}/decision")
async def approval_decision(aid: str, request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    decision = data.get("decision")
    if decision not in ("approved", "rejected"): raise HTTPException(400, "Quyết định không hợp lệ.")
    with SessionLocal() as db:
        row = db.get(Approval, aid)
        if not row or row.user_id != user.id: raise HTTPException(404, "Không tìm thấy yêu cầu.")
        if row.status != "pending": raise HTTPException(409, "Yêu cầu đã được xử lý.")
        row.status = decision; db.commit()
    return {"ok": True, "status": decision}


def fetch_public_github_zip(repo_url: str):
    """
    Fetch a public GitHub repository archive only. This does not run code.
    Accepted URL: https://github.com/OWNER/REPO or /tree/BRANCH/PATH
    """
    match = re.fullmatch(
        r"https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:/tree/([A-Za-z0-9_.-]+)(?:/(.*))?)?/?",
        repo_url.strip()
    )
    if not match:
        raise HTTPException(400, "URL phải là repository GitHub công khai: https://github.com/owner/repo")
    owner, repo, branch, subpath = match.groups()
    repo = repo.removesuffix(".git")
    api_url = f"https://api.github.com/repos/{owner}/{repo}"
    headers = {"User-Agent": "AI-Studio-Skill-Installer/1.0", "Accept": "application/vnd.github+json"}
    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            meta = json.loads(resp.read(512 * 1024).decode("utf-8"))
        if meta.get("private"):
            raise HTTPException(400, "Chỉ hỗ trợ repository công khai trong bản này.")
        branch = branch or meta.get("default_branch", "main")
        zip_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{branch}"
        req = urllib.request.Request(zip_url, headers={"User-Agent": "AI-Studio-Skill-Installer/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = resp.read(12 * 1024 * 1024 + 1)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Không tải được repository công khai. Kiểm tra URL, branch hoặc quyền truy cập.")
    if len(payload) > 12 * 1024 * 1024:
        raise HTTPException(413, "Repository archive vượt giới hạn 12 MB.")
    try:
        zf = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        raise HTTPException(400, "GitHub trả về archive không hợp lệ.")
    entries = []
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        p = PurePosixPath(name)
        mode = (info.external_attr >> 16) & 0o170000
        if p.is_absolute() or ".." in p.parts or mode == 0o120000:
            raise HTTPException(400, "Repository có đường dẫn/symlink không an toàn.")
        if info.file_size > 4 * 1024 * 1024:
            raise HTTPException(413, "Một file trong repository vượt giới hạn 4 MB.")
        entries.append((info, p))
    prefix = entries[0][1].parts[0] if entries else ""
    selected = []
    normalized_sub = (subpath or "").strip("/")
    for info, p in entries:
        rel = PurePosixPath(*p.parts[1:]) if len(p.parts) > 1 and p.parts[0] == prefix else p
        if normalized_sub:
            if str(rel) == normalized_sub:
                rel = PurePosixPath(".")
            elif str(rel).startswith(normalized_sub + "/"):
                rel = PurePosixPath(str(rel)[len(normalized_sub)+1:])
            else:
                continue
        selected.append((info, rel))
    return zf, selected, f"https://github.com/{owner}/{repo}/tree/{branch}" + ("/" + normalized_sub if normalized_sub else ""), owner, repo

@app.get("/api/plugins")
def list_plugins(request: Request):
    user, _ = require_user(request)
    with SessionLocal() as db:
        skills = db.scalars(select(InstalledSkill).where(InstalledSkill.user_id == user.id).order_by(desc(InstalledSkill.created_at))).all()
        plugins = db.scalars(select(InstalledPlugin).where(InstalledPlugin.user_id == user.id).order_by(desc(InstalledPlugin.created_at))).all()
        return {
            "skills": [{"id": x.id, "name": x.name, "description": x.description, "source_url": x.source_url, "status": x.status} for x in skills],
            "plugins": [{"id": x.id, "name": x.name, "description": x.description, "source_url": x.source_url, "status": x.status} for x in plugins],
        }

@app.post("/api/plugins/install-github")
async def install_github_plugin(request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    repo_url = str(data.get("url", "")).strip()
    zf, entries, source_url, owner, repo = fetch_public_github_zip(repo_url)
    root = user_dir(user.id)
    install_root = (root / ".agents" / "imports" / secrets.token_hex(6)).resolve()
    if root.resolve() not in install_root.parents:
        raise HTTPException(400, "Đường dẫn cài đặt không hợp lệ.")
    install_root.mkdir(parents=True, exist_ok=True)
    skills_found = []
    manifest = None
    total_uncompressed = 0
    for info, rel in entries:
        if str(rel) == ".":
            continue
        total_uncompressed += info.file_size
        if total_uncompressed > 30 * 1024 * 1024:
            shutil.rmtree(install_root, ignore_errors=True)
            raise HTTPException(413, "Tổng dung lượng giải nén vượt giới hạn 30 MB.")
        out = (install_root / Path(*rel.parts)).resolve()
        if install_root not in out.parents and out != install_root:
            shutil.rmtree(install_root, ignore_errors=True)
            raise HTTPException(400, "Đường dẫn archive không an toàn.")
        if info.is_dir():
            out.mkdir(parents=True, exist_ok=True)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        # Never install executable files into an active path. Everything is staged for review.
        out.write_bytes(zf.read(info))
        if rel.name.lower() == "skill.md":
            try:
                text = out.read_text(encoding="utf-8")
            except Exception:
                text = ""
            name_match = re.search(r"(?m)^name:\s*([a-zA-Z0-9_.-]+)\s*$", text)
            desc_match = re.search(r"(?m)^description:\s*(.+)$", text)
            skills_found.append((name_match.group(1) if name_match else rel.parent.name, desc_match.group(1).strip() if desc_match else "", out))
        if rel.name.lower() == "plugin.json":
            manifest = out

    # Copy skills into a per-user skill directory; SKILL.md is data/instructions only.
    skill_root = (root / ".agents" / "skills").resolve()
    skill_root.mkdir(parents=True, exist_ok=True)
    installed_count = 0
    with SessionLocal() as db:
        for name, description, skill_md in skills_found[:50]:
            skill_dir = skill_md.parent
            safe_name = re.sub(r"[^a-zA-Z0-9_.-]", "-", name)[:80] or "imported-skill"
            dest = (skill_root / safe_name).resolve()
            if skill_root not in dest.parents:
                continue
            if dest.exists():
                dest = (skill_root / (safe_name + "-" + secrets.token_hex(3))).resolve()
            shutil.copytree(skill_dir, dest)
            db.add(InstalledSkill(id=secrets.token_urlsafe(12), user_id=user.id, name=safe_name,
                                  description=description[:1000], source_url=source_url,
                                  skill_path=str(dest), status="installed_in_workspace"))
            installed_count += 1
        plugin_count = 0
        if manifest:
            try:
                manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
            except Exception:
                manifest_data = {}
            pname = re.sub(r"[^a-zA-Z0-9_.-]", "-", str(manifest_data.get("name") or repo))[:100]
            desc = str(manifest_data.get("description") or "Plugin được nhập từ GitHub; cần rà soát cấu hình và quyền.")[:2000]
            db.add(InstalledPlugin(id=secrets.token_urlsafe(12), user_id=user.id, name=pname,
                                   description=desc, source_url=source_url, manifest_path=str(manifest),
                                   status="staged_review"))
            plugin_count = 1
        db.commit()
    return {
        "ok": True, "source": source_url, "skills_installed": installed_count,
        "plugin_staged": bool(plugin_count),
        "message": f"Đã nhập {installed_count} skill. Plugin manifest được đặt ở trạng thái cần rà soát. Không chạy script, hook hoặc MCP server tự động."
    }

@app.delete("/api/plugins/skills/{skill_id}")
def remove_skill(skill_id: str, request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    with SessionLocal() as db:
        row = db.get(InstalledSkill, skill_id)
        if not row or row.user_id != user.id: raise HTTPException(404, "Không tìm thấy skill.")
        p = Path(row.skill_path).resolve()
        allowed = (user_dir(user.id) / ".agents" / "skills").resolve()
        if allowed not in p.parents: raise HTTPException(400, "Đường dẫn skill không hợp lệ.")
        shutil.rmtree(p, ignore_errors=True)
        db.delete(row); db.commit()
    return {"ok": True}

@app.post("/api/plugins/skills/create")
async def create_skill(request: Request):
    user, csrf = require_user(request); check_csrf(request, csrf)
    data = await request.json()
    name = re.sub(r"[^a-zA-Z0-9_.-]", "-", str(data.get("name", "")).strip())[:80]
    description = str(data.get("description", "")).strip()[:500]
    instructions = str(data.get("instructions", "")).strip()[:20000]
    if not name or not instructions: raise HTTPException(400, "Cần tên skill và hướng dẫn.")
    root = (user_dir(user.id) / ".agents" / "skills").resolve()
    root.mkdir(parents=True, exist_ok=True)
    dest = (root / name).resolve()
    if root not in dest.parents: raise HTTPException(400, "Tên skill không hợp lệ.")
    if dest.exists(): raise HTTPException(409, "Skill cùng tên đã tồn tại.")
    dest.mkdir(parents=True)
    (dest / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\n\n{instructions}\n", encoding="utf-8")
    sid = secrets.token_urlsafe(12)
    with SessionLocal() as db:
        db.add(InstalledSkill(id=sid, user_id=user.id, name=name, description=description,
                              source_url="local", skill_path=str(dest), status="installed_in_workspace"))
        db.commit()
    return {"ok": True, "id": sid, "name": name}
