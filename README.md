# ChatGPT + Codex Web (starter an toàn)

Website chat tiếng Việt có tài khoản riêng, lịch sử hội thoại PostgreSQL, upload file/ZIP, khai báo repository GitHub, workspace và cổng phê duyệt thao tác nguy hiểm.

## Quan trọng về đăng nhập ChatGPT/Codex

- Đăng nhập tài khoản website này **khác** đăng nhập ChatGPT.
- Nút "Kết nối ChatGPT" không giả lập OAuth. Tích hợp Sign in with ChatGPT cần đăng ký client/đáp ứng điều kiện OpenAI. Chưa có `CHATGPT_CLIENT_ID` hợp lệ thì ứng dụng hiển thị rõ trạng thái chưa cấu hình.
- Không đưa cookie/token ChatGPT của người dùng vào Render, không dùng chung phiên Codex giữa nhiều tài khoản.
- Codex SDK có thể điều khiển một phiên Codex đã xác thực trên máy chạy worker. Trong bản này, chạy agent chỉ được bật khi `CODEX_SINGLE_USER_MODE=true`; chế độ đó chỉ dành cho máy cá nhân/instance riêng của một người, **không bật cho website nhiều người dùng**. Muốn production multi-user cần worker/VM cách ly và luồng ủy quyền chính thức riêng cho từng người dùng.
- Không có API key AI nào được nhúng. Khi chưa cấu hình quyền SIWC/Codex hợp lệ, chat AI trả thông báo minh bạch thay vì giả vờ chạy.

## Tính năng đã có

- Đăng ký/đăng nhập tài khoản ứng dụng, cookie phiên HttpOnly, CSRF token, mật khẩu băm scrypt.
- PostgreSQL; tự tạo bảng khi khởi động.
- Lịch sử hội thoại riêng theo tài khoản.
- Upload file đơn lẻ và ZIP (giới hạn dung lượng, chặn path traversal và symlink).
- Khai báo URL GitHub HTTPS; bản starter không tự clone/chạy repo.
- Workspace liệt kê file, xem văn bản; không thực thi mã upload.
- Yêu cầu phê duyệt trước thao tác nguy hiểm (mô hình dữ liệu + API).
- UI responsive kiểu trợ lý AI, sidebar, chat, tab Codex/Workspace.

## Chạy local

Python 3.11+ khuyến nghị.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Mở http://127.0.0.1:8000

Nếu không có `DATABASE_URL`, dùng SQLite cục bộ để thử giao diện. Trên Render, cấu hình `DATABASE_URL` từ Render PostgreSQL.

## Triển khai GitHub + Render

1. Tải ZIP, giải nén, tạo repository GitHub và push toàn bộ file.
2. Render → New → PostgreSQL. Sao chép **Internal Database URL**.
3. Render → New → Web Service, kết nối repo.
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. Environment variables:
   - `DATABASE_URL` = Internal Database URL (đổi prefix `postgres://` thành `postgresql://` nếu cần; app tự chuẩn hóa `postgres://`)
   - `APP_SECRET` = chuỗi ngẫu nhiên dài ít nhất 32 ký tự
   - `COOKIE_SECURE=true`
   - `MAX_UPLOAD_MB=15`
   - `CHATGPT_CLIENT_ID` = chỉ điền sau khi OpenAI cấp/đăng ký client hợp lệ
   - `CODEX_SINGLE_USER_MODE=false` (giữ false cho website nhiều người dùng)
7. Deploy, mở URL, đăng ký tài khoản.

> PostgreSQL free trên Render có thể hết hạn theo chính sách gói hiện hành; chọn gói phù hợp nếu cần lưu dữ liệu lâu dài. Xem docs Render.

## Bật Codex SDK (chỉ môi trường một người dùng)

Chỉ làm trên máy riêng hoặc worker chỉ dành cho một người:
1. Cài `openai-codex` (đã khai báo trong requirements).
2. Thực hiện đăng nhập Codex theo hướng dẫn chính thức trong terminal.
3. Đặt `CODEX_SINGLE_USER_MODE=true`.
4. Không dùng thiết lập này cho website công khai nhiều tài khoản. Phiên Codex trên máy chủ sẽ là danh tính của instance đó, không phải từng người dùng.

## Việc cần hoàn tất để dùng ChatGPT plan chính thức

- Đăng ký/được chấp thuận cho Sign in with ChatGPT / open-source integration theo tài liệu OpenAI.
- Cấu hình client ID và triển khai đúng luồng OAuth, redirect URI, PKCE, scope, token storage/refresh và consent theo spec hiện hành.
- Với nhiều người dùng, mỗi phiên/worker phải tách biệt, có kiểm soát quyền và giới hạn sử dụng; không dùng một phiên Codex dùng chung.
- Xác minh điều kiện và quyền sử dụng ChatGPT plan cho ứng dụng cụ thể. Đăng nhập danh tính không tự động cấp quyền dùng hạn mức AI.

## Bảo mật trước khi public

- Đặt `APP_SECRET` mạnh, bật HTTPS và `COOKIE_SECURE=true`.
- Dùng dịch vụ object storage nếu cần file bền vững; file upload trên filesystem Render có thể mất khi deploy/restart.
- Thêm rate limiting/WAF, email verification, password reset, audit logs, retention policy và backup.
- Không coi container app web là sandbox an toàn để chạy code không tin cậy. Tính năng thực thi code cần worker riêng, container/VM tách biệt, không có secret, network egress hạn chế, quota CPU/RAM/time, filesystem giới hạn và approval.


## Plugins & Skills từ GitHub

Trong giao diện, mở **Plugins & Skills** rồi dán URL public GitHub, ví dụ repo chứa `skills/<name>/SKILL.md`. Có thể dán URL thư mục `/tree/branch/path`. Hệ thống tải archive, kiểm tra đường dẫn và symlink, giới hạn kích thước, rồi nhập `SKILL.md` vào thư mục riêng của tài khoản.

- Skill là hướng dẫn dạng văn bản; agent cần được cấu hình để đọc skill khi chạy tác vụ.
- Plugin manifest được lưu ở trạng thái `staged_review`.
- Không tự chạy `install.sh`, `postinstall`, hook, MCP server hoặc script đến từ repo.
- Không tự cài package Python/Node từ repo chưa tin cậy.
- Chỉ nhập repo mà bạn có quyền sử dụng; rà soát nội dung trước khi bật.
