const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// Biến môi trường hoặc mặc định
const serverIp = process.env.SERVER_IP || 'IP_CUA_BAN.aternos.me';
const serverPort = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 25565;
// Ép cứng phiên bản (ví dụ 1.21.1). Nếu muốn tự dò, đổi thành: const mcVersion = false;
const mcVersion = '1.21.1'; 

// Quản lý danh sách bot
let bots = []; 
let targetBotCount = 0; // Số lượng bot người dùng muốn bật
let isSpawning = false; // Tránh spam click tạo bot

// Hàm tạo tên ngẫu nhiên
function generateRandomName() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let name = 'Bot_';
    for (let i = 0; i < 6; i++) {
        name += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return name;
}

// Hàm khởi tạo 1 Bot
function spawnSingleBot() {
    return new Promise((resolve) => {
        const botName = generateRandomName();
        const bot = mineflayer.createBot({
            host: serverIp,
            port: serverPort,
            username: botName,
            version: mcVersion // Định dạng phiên bản Java (ví dụ: '1.21.1')
        });

        // Đánh dấu trạng thái riêng của bot này
        bot.customStatus = 'Đang vào... 🟡';
        bot.customPing = 0;

        bot.on('login', () => { 
            bot.customStatus = 'Online 🟢'; 
            console.log(`[+] ${botName} đã vào server.`);
            resolve(true); // Đã vào thành công
        });

        bot.on('end', () => { 
            console.log(`[-] ${botName} đã mất kết nối.`);
            removeBot(botName);
        });

        bot.on('kicked', (reason) => { 
            console.log(`[!] ${botName} bị kick: ${reason}`);
            removeBot(botName);
        });

        bot.on('error', (err) => { 
            console.log(`[Lỗi] ${botName}: ${err.message}`);
            removeBot(botName);
        });

        // Cập nhật ping liên tục
        setInterval(() => {
            if (bot && bot.player) {
                bot.customPing = bot.player.ping;
            }
        }, 5000);

        bots.push(bot);
    });
}

// Xoá bot khỏi mảng khi bị mất kết nối
function removeBot(username) {
    bots = bots.filter(b => b.username !== username);
}

// Quản lý việc tăng/giảm số lượng bot từ từ (tránh sập server)
async function manageBots() {
    if (isSpawning) return;
    isSpawning = true;

    // Nếu số lượng bot hiện tại ít hơn mục tiêu -> Thêm bot
    while (bots.length < targetBotCount) {
        await spawnSingleBot();
        // Đợi 3 giây giữa mỗi con bot để Aternos không chặn vì spam IP
        await new Promise(r => setTimeout(r, 3000)); 
    }

    // Nếu số lượng bot hiện tại nhiều hơn mục tiêu -> Tắt bớt bot
    while (bots.length > targetBotCount) {
        const botToKick = bots.pop(); // Lấy con bot cuối cùng
        if (botToKick) botToKick.quit();
        await new Promise(r => setTimeout(r, 1000));
    }

    isSpawning = false;
}

// Xoá toàn bộ bot ngay lập tức
function stopAllBots() {
    targetBotCount = 0;
    bots.forEach(bot => bot.quit());
    bots = [];
}

// --- GIAO DIỆN WEB (DASHBOARD) ---
// Chấp nhận dữ liệu form từ giao diện
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    // Lấy thông tin server chung (dựa vào con bot đầu tiên nếu có)
    let serverPlayers = (bots.length > 0 && bots[0].players) ? Object.keys(bots[0].players).length : 'Chưa kết nối';
    
    // Tạo danh sách HTML các bot đang chạy
    let botListHtml = '';
    if (bots.length === 0) {
        botListHtml = '<p style="color:#aaa;">Chưa có bot nào đang hoạt động.</p>';
    } else {
        bots.forEach(b => {
            botListHtml += `
            <div class="bot-item">
                <span>🤖 <b>${b.username}</b></span>
                <span>Ping: ${b.customPing}ms 📶</span>
                <span>${b.customStatus}</span>
            </div>`;
        });
    }

    const html = `
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Multi-Bot Dashboard</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #121212; color: white; margin: 0; padding: 20px; }
                .container { background: #1e1e1e; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); max-width: 500px; margin: auto; }
                h1 { font-size: 24px; color: #4CAF50; text-align: center; }
                .info-box { background: #2c2c2c; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .info-box p { margin: 5px 0; font-size: 15px; }
                
                .form-group { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
                input[type="number"] { width: 60px; padding: 8px; border-radius: 6px; border: 1px solid #4CAF50; background: #333; color: white; font-size: 16px; text-align: center;}
                
                .btn { padding: 12px 15px; font-size: 14px; font-weight: bold; border: none; border-radius: 8px; cursor: pointer; flex: 1; margin: 0 5px;}
                .btn-apply { background: #FF9800; color: white; }
                .btn-stop { background: #F44336; color: white; }
                .btn-refresh { background: #2196F3; color: white; width: 100%; margin-top: 15px; margin-left: 0; margin-right:0;}
                
                .bot-list { margin-top: 20px; border-top: 1px solid #444; padding-top: 15px; }
                .bot-item { display: flex; justify-content: space-between; background: #2a2a2a; padding: 10px; border-radius: 6px; margin-bottom: 8px; font-size: 14px;}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎮 Multi-Bot Controller</h1>
                
                <div class="info-box">
                    <p><strong>🌐 IP Server:</strong> ${serverIp}</p>
                    <p><strong>📦 Phiên bản:</strong> ${mcVersion}</p>
                    <p><strong>👥 Số người trong Server:</strong> ${serverPlayers}</p>
                    <p><strong>🤖 Số lượng Bot hiện tại:</strong> ${bots.length} / ${targetBotCount}</p>
                </div>

                <form action="/set-bots" method="POST" class="form-group">
                    <label style="font-weight:bold;">Chỉnh số lượng Bot:</label>
                    <input type="number" name="amount" value="${targetBotCount}" min="0" max="10">
                    <button type="submit" class="btn btn-apply">GỬI</button>
                </form>

                <div style="display: flex;">
                    <form action="/stop-all" method="POST" style="flex:1; margin:0;">
                        <button type="submit" class="btn btn-stop" style="width:100%;">⏹ TẮT TOÀN BỘ BOT</button>
                    </form>
                </div>

                <button class="btn btn-refresh" onclick="location.reload()">🔄 LÀM MỚI TRANG</button>

                <div class="bot-list">
                    <h3 style="margin-top:0; color:#aaa; font-size:16px;">Danh sách Bot đang chạy:</h3>
                    ${botListHtml}
                </div>
            </div>
        </body>
        </html>
    `;
    res.send(html);
});

// API nhận lệnh đổi số lượng bot từ form
app.post('/set-bots', (req, res) => {
    let amount = parseInt(req.body.amount);
    // Giới hạn tối đa 10 bot để Render không bị sập (hết RAM)
    if (isNaN(amount) || amount < 0) amount = 0;
    if (amount > 10) amount = 10; 
    
    targetBotCount = amount;
    manageBots(); // Gọi hàm xử lý tăng/giảm bot
    res.redirect('/');
});

// API nhận lệnh tắt toàn bộ
app.post('/stop-all', (req, res) => {
    stopAllBots();
    res.redirect('/');
});

app.listen(port, () => console.log(\`Dashboard Multi-bot chạy trên cổng \${port}\`));
