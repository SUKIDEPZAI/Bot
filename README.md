# AI Room 2.1 — nhiều AI trong một workspace

**Giao diện:** GitHub Pages · **Backend:** Render · **Database:** PostgreSQL.

## Có gì trong bản 2.1?

- Đăng ký/đăng nhập email + mật khẩu; đăng nhập Google qua xác minh token phía backend.
- Tạo nhiều trợ lý: tên, ảnh, tính cách, model, API key riêng.
- Phòng trò chuyện tối đa 4 AI; các AI phản hồi tuần tự và đọc được câu hỏi/câu trả lời trước.
- Mẫu năng lực: **Lập trình viên kiểu Codex**, **Code review**, **Claude — phân tích dài**, **Nghiên cứu**, **Viết nội dung**.
- API: OpenAI Responses, Google Gemini, Anthropic Claude, và endpoint OpenAI-compatible (ví dụ các dịch vụ DeepSeek/Groq/Mistral nếu tài khoản của bạn có API phù hợp).
- Markdown, bảng, code block; lịch sử chat PostgreSQL.
- API key cá nhân được mã hóa ở backend bằng AES-256-GCM.
- Root scripts giúp cài và chạy cả frontend/backend dễ hơn; Docker Compose tạo PostgreSQL local.
- Tra cứu web bằng OpenAI web search, Gemini Google Search grounding hoặc Firecrawl adapter tùy cấu hình.
- Đính kèm tệp văn bản/code để phân tích; xuất lịch sử hội thoại thành Markdown.

**Lưu ý:** “Mẫu Codex/Claude” là cấu hình vai trò/prompt. Chúng không tự cấp quyền truy cập sản phẩm Codex/Claude Code, terminal, filesystem hoặc chạy code an toàn. Tạo ảnh, voice realtime, đọc PDF/Word và sandbox thực thi code chưa được triển khai.

## Chức năng mới và giới hạn

- **Tra cứu web:** bật nút “Tra cứu web” trong ô chat. OpenAI dùng Responses API `web_search`; Gemini dùng Google Search grounding. Nếu đặt `FIRECRAWL_API_KEY` trong Render, Firecrawl tìm nguồn và đưa URL/tóm tắt vào ngữ cảnh để dùng được với Claude và API tương thích. Có thể phát sinh phí/hạn mức từ nhà cung cấp.
- **Tệp đính kèm:** tối đa 5 tệp văn bản/code mỗi lượt, tối đa 250 KB/tệp; hỗ trợ TXT, MD, JSON, CSV, JS/TS, Python, HTML/CSS, SQL và một số định dạng text phổ biến. Nội dung được đưa vào bản nháp để xem trước trước khi gửi. PDF/Word chưa được phân tích tự động.
- **Xuất hội thoại:** nút “Xuất” tải hội thoại đang mở thành tệp Markdown.
- **Mẫu vai trò:** Codex-style coding, code review, Claude-style phân tích dài, nghiên cứu và biên tập. Đây là prompt preset, không phải quyền sử dụng app Codex hoặc Claude Code.

## Plugin / tích hợp theo từng việc

- **GitHub:** quản lý mã nguồn và Actions workflow. Connector GitHub trong ChatGPT khả dụng riêng; kết nối đó không tự động cấp quyền cho website.
- **Render:** deploy backend, xem logs, quản lý service và PostgreSQL. `render.yaml` cấu hình hạ tầng website; connector Render trong ChatGPT (nếu tài khoản có thể kết nối) là công cụ quản trị độc lập.
- **Firecrawl:** adapter tìm kiếm web đã có trong backend. Đặt `FIRECRAWL_API_KEY` ở Render để bật tìm kiếm cho cả Claude/API tương thích; không đặt key ở frontend.
- **OpenAI Developers:** nguồn tài liệu để đối chiếu API/tool calling; đây không phải plugin runtime của AI Room.

Plugin của ChatGPT không tự động trở thành plugin chạy bên trong AI Room. Tích hợp website phải gọi API/MCP từ backend, lưu secret ở Render và tự kiểm soát quyền. Không đưa khóa vào GitHub hoặc mã frontend.

## Cài local dễ nhất

Yêu cầu: Node.js 20+, npm và Docker Desktop (chỉ để chạy PostgreSQL local).

1. Giải nén ZIP, mở terminal tại thư mục `ai-room-web`.
2. Chạy PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

3. Tạo file môi trường backend từ mẫu:

   **Windows PowerShell:**
   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```
   **macOS/Linux:**
   ```bash
   cp backend/.env.example backend/.env
   ```

4. Sửa `backend/.env` tối thiểu:
   ```env
   PORT=10000
   NODE_ENV=development
   DATABASE_URL=postgresql://airoom_user:airoom_local_password@localhost:5432/airoom
   JWT_SECRET=thay-bang-chuoi-ngau-nhien-dai
   ENCRYPTION_KEY=thay-bang-khoa-base64-32-byte
   GOOGLE_CLIENT_ID=
   FRONTEND_ORIGINS=http://localhost:5173
   ```
   Tạo các giá trị bí mật bằng Node.js:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Dán chuỗi đầu vào `JWT_SECRET`, chuỗi thứ hai vào `ENCRYPTION_KEY`. Giữ nguyên `ENCRYPTION_KEY` lâu dài sau khi đã lưu API key.

5. Tại thư mục gốc, chạy **một lệnh cài đặt**:
   ```bash
   npm run setup
   ```
6. Tạo file cấu hình frontend:

   **Windows PowerShell:** `Copy-Item frontend/.env.example frontend/.env`

   **macOS/Linux:** `cp frontend/.env.example frontend/.env`

   Mở `frontend/.env` và đặt `VITE_API_URL=http://localhost:10000`. Nếu chưa cấu hình Google, để `VITE_GOOGLE_CLIENT_ID` trống.

7. Chạy cả backend và frontend cùng lúc:
   ```bash
   npm run dev
   ```
8. Mở `http://localhost:5173`. Backend health check: `http://localhost:10000/health`.

Nếu chỉ muốn build frontend: `npm run build`.

## Đưa lên GitHub Pages + Render

### A. GitHub Pages

1. Tạo repository GitHub mới và upload **các file bên trong thư mục `ai-room-web`** vào nhánh `main`.
2. Trong repo, vào **Settings → Pages**, chọn **GitHub Actions**.
3. Vào **Settings → Secrets and variables → Actions → Variables**, tạo:
   - `VITE_API_URL` = URL backend Render, không có dấu `/` cuối.
   - `VITE_GOOGLE_CLIENT_ID` = Google OAuth Web Client ID (có thể để trống nếu chưa cần Google login).
4. Workflow tự build/deploy giao diện; xem tab **Actions** để biết kết quả. URL thường là `https://TEN-GITHUB.github.io/TEN-REPO/`.

### B. Render backend + PostgreSQL

1. Mở Render → **New → Blueprint**, chọn repo có `render.yaml`.
2. Render tạo Web Service và PostgreSQL. Điền các biến được yêu cầu:
   - `ENCRYPTION_KEY`: tạo bằng lệnh Node ở trên.
   - `GOOGLE_CLIENT_ID`: cùng ID với GitHub variable; có thể để trống và cấu hình sau nếu chưa dùng Google Login.
   - `FRONTEND_ORIGINS`: chỉ origin của Pages, ví dụ `https://TEN-GITHUB.github.io` (không thêm `/TEN-REPO/`).
   - `FIRECRAWL_API_KEY`: tùy chọn; chỉ cần nếu muốn tìm web cho Claude/API tương thích. Bỏ trống nếu không dùng.
3. Đợi deploy, mở `https://TEN-SERVICE.onrender.com/health`; cần thấy `ok: true` và `database: connected`.
4. Cập nhật GitHub variable `VITE_API_URL` với URL Render thực tế rồi chạy lại workflow Pages.

### C. Google Login

Trong Google Cloud Console tạo OAuth Client ID loại **Web application**. Thêm Authorized JavaScript origins `http://localhost:5173` và `https://TEN-GITHUB.github.io`. Đặt cùng Client ID ở Render `GOOGLE_CLIENT_ID` và GitHub Actions variable `VITE_GOOGLE_CLIENT_ID`. Không đặt Google Client Secret ở frontend.

## Tạo AI và sử dụng

1. Đăng ký/đăng nhập.
2. Chọn **Tạo AI**, đặt tên/ảnh và chọn nhà cung cấp/model.
3. Nhập API key của nhà cung cấp đó. Key cá nhân được lưu mã hóa; sau khi lưu giao diện không đọc lại key.
4. Chọn mẫu năng lực (Codex-style coding, code review, Claude-style analysis...) rồi chỉnh lại chỉ dẫn nếu muốn.
5. Tạo phòng chat và chọn từ 1 đến 4 AI. Mỗi AI gọi API riêng nên có thể phát sinh chi phí/hạn mức riêng.

## Nhà cung cấp và model

- OpenAI: gợi ý hiện tại gồm `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna`; khả năng truy cập tùy tài khoản API.
- Gemini: dùng model ID hiện hành của Google AI Studio.
- Anthropic: dùng model ID hiện hành của Anthropic API.
- OpenAI-compatible: điền Base URL và model ID chính xác của dịch vụ. Không phải mọi dịch vụ tương thích đều hỗ trợ cùng tính năng.

Danh sách gợi ý trong giao diện chỉ là ví dụ, có thể thay đổi theo tài khoản/nhà cung cấp. Nếu model báo 404/permission error, kiểm tra tài liệu và quyền API của nhà cung cấp.

## Lỗi thường gặp

- **Không kết nối được backend:** kiểm tra `VITE_API_URL`, `/health`, log Render và `FRONTEND_ORIGINS`.
- **Database chưa kết nối:** xác nhận Docker đang chạy local hoặc `DATABASE_URL` đúng trên Render.
- **Google login không hiện:** cấu hình `VITE_GOOGLE_CLIENT_ID`, deploy lại Pages và khai báo origin chính xác trong Google Cloud.
- **AI báo thiếu key/model:** kiểm tra API key, quyền truy cập, model ID, hạn mức và Base URL.
- **Không cài được dependency:** cần Node.js 20+; chạy `npm run setup` tại thư mục gốc, không chạy lệnh ở thư mục khác.

## Ghi chú bảo mật / giới hạn

Bản này là MVP, chưa nên mở công khai cho lượng người dùng lớn nếu chưa có kiểm thử bảo mật độc lập, xác minh email/khôi phục mật khẩu, giới hạn chi phí theo tài khoản, chính sách dữ liệu và cơ chế chống lạm dụng đầy đủ. Không commit `.env`, API keys, JWT secret hoặc encryption key. Nếu mất `ENCRYPTION_KEY`, API key đã mã hóa không thể giải mã.
