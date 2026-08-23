const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// --- CẤU HÌNH SERVER CỦA BẠN ---
const serverIp = process.env.SERVER_IP || 'sucvatmc.aternos.me';
const serverPort = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 29587;
const mcVersion = '1.21.1'; 

let bots = []; 
let targetBotCount = 0; 
let isSpawning = false;

// 1. HỆ THỐNG ANTI-CRASH (Ngăn Render tắt ứng dụng khi lỗi)
process.on('uncaughtException', (err) => {
    console.log('[ANTI-CRASH] Đã chặn một lỗi:', err.message);
});
process.on('unhandledRejection', (reason, p) => {
    console.log('[ANTI-CRASH] Từ chối Promise:', reason);
});

// 2. KHỞI ĐỘNG WEB SERVER TRƯỚC ĐỂ RENDER NHẬN DIỆN NGAY
app.use(express.urlencoded({ extended: true }));
app.listen(port, () => {
    console.log(`[OK] Web Server đang chạy tại cổng ${port}`);
});

// Hàm tạo tên ngẫu nhiên
function generateName() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let name = 'Bot_';
    for (let i = 0; i < 5; i++) name += chars.charAt(Math.floor(Math.random() * chars.length));
    return name;
}

// Xử lý tạo 1 bot
function spawnSingleBot() {
    return new Promise((resolve) => {
        const botName = generateName();
        const bot = mineflayer.createBot({
            host: serverIp,
            port: serverPort,
            username: botName,
            version: mcVersion
        });

        bot.customStatus = 'Đang vào... 🟡';
        bot.customPing = 0;

        bot.on('login', () => { 
            bot.customStatus = 'Online 🟢'; 
            console.log(`[+] ${botName} đã vào game.`);
            resolve(true); 
        });

        bot.on('end', () => { removeBot(botName); resolve(false); });
        bot.on('kicked', () => { removeBot(botName); resolve(false); });
        bot.on('error', () => { removeBot(botName); resolve(false); });

        setInterval(() => {
            if (bot && bot.player) bot.customPing = bot.player.ping;
        }, 3000);

        bots.push(bot);
    });
}

function removeBot(username) {
    bots = bots.filter(b => b.username !== username);
}

// Quản lý số lượng bot (Thêm từ từ để chống sập server)
async function manageBots() {
    if (isSpawning) return;
    isSpawning = true;
    while (bots.length < targetBotCount) {
        await spawnSingleBot();
        await new Promise(r => setTimeout(r, 4000)); // Đợi 4s mỗi lần tạo bot
    }
    while (bots.length > targetBotCount) {
        const b = bots.pop();
        if (b) b.quit();
        await new Promise(r => setTimeout(r, 1000));
    }
    isSpawning = false;
}

// 3. API ĐỂ GIAO DIỆN TỰ ĐỘNG CẬP NHẬT (Không cần tải lại trang)
app.get('/api/status', (req, res) => {
    res.json({
        ip: serverIp,
        port: serverPort,
        version: mcVersion,
        totalBots: bots.length,
        target: targetBotCount,
        botList: bots.map(b => ({ name: b.username, ping: b.customPing, status: b.customStatus }))
    });
});

// Nhận lệnh từ Form
app.post('/set-bots', (req, res) => {
    let amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount < 0) amount = 0;
    if (amount > 10) amount = 10; // Tối đa 10 bot
    targetBotCount = amount;
    manageBots();
    res.redirect('/');
});

app.post('/stop-all', (req, res) => {
    targetBotCount = 0;
    bots.forEach(b => b.quit());
    bots = [];
    res.redirect('/');
});

// 4. GIAO DIỆN CHÍNH (DASHBOARD)
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Bot VIP Controller</title>
            <style>
                body { font-family: sans-serif; background: #0f172a; color: white; padding: 20px; margin: 0; }
                .card { background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); max-width: 500px; margin: auto; }
                h1 { color: #38bdf8; text-align: center; margin-top: 0;}
                .box { background: #334155; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 15px;}
                input[type="number"] { width: 70px; padding: 10px; border-radius: 6px; border: none; background: #0f172a; color: white; font-size: 16px; text-align: center; font-weight: bold;}
                .btn { padding: 12px; font-size: 14px; font-weight: bold; border: none; border-radius: 8px; cursor: pointer; color: white; width: 100%; margin-top: 10px;}
                .btn-green { background: #22c55e; }
                .btn-red { background: #ef4444; }
                .bot-item { display: flex; justify-content: space-between; background: #475569; padding: 12px; border-radius: 6px; margin-bottom: 8px; font-size: 14px;}
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🎮 Bảng Điều Khiển VIP</h1>
                <div class="box" id="info-box">
                    <p>⏳ Đang tải dữ liệu server...</p>
                </div>
                
                <form action="/set-bots" method="POST" style="display:flex; justify-content:space-between; align-items:center;">
                    <b>Số lượng Bot cần chạy:</b>
                    <input type="number" name="amount" value="${targetBotCount}" min="0" max="10">
                    <button type="submit" class="btn btn-green" style="width: auto; margin-top:0;">LƯU & CHẠY</button>
                </form>

                <form action="/stop-all" method="POST">
                    <button type="submit" class="btn btn-red">⏹ TẮT TOÀN BỘ BOT</button>
                </form>

                <h3 style="color:#cbd5e1; margin-top: 20px; font-size:16px;">🔥 Danh sách Bot:</h3>
                <div id="bot-list">
                    <p style="color:#94a3b8; font-size: 14px;">Chưa có bot nào...</p>
                </div>
            </div>

            <script>
                // Tự động làm mới dữ liệu mỗi 2 giây
                setInterval(async () => {
                    try {
                        const res = await fetch('/api/status');
                        const data = await res.json();
                        
                        document.getElementById('info-box').innerHTML = \`
                            <p>🌐 <b>IP:</b> \${data.ip}:\${data.port}</p>
                            <p>📦 <b>Phiên bản:</b> \${data.version}</p>
                            <p>🤖 <b>Trạng thái Bot:</b> \${data.totalBots} / \${data.target} đang hoạt động</p>
                        \`;

                        let botHtml = '';
                        if (data.botList.length === 0) {
                            botHtml = '<p style="color:#94a3b8; font-size: 14px;">Chưa có bot nào đang chạy.</p>';
                        } else {
                            data.botList.forEach(b => {
                                botHtml += \`
                                <div class="bot-item">
                                    <span>🤖 <b>\${b.name}</b></span>
                                    <span>Ping: \${b.ping}ms</span>
                                    <span>\${b.status}</span>
                                </div>\`;
                            });
                        }
                        document.getElementById('bot-list').innerHTML = botHtml;
                    } catch (e) {}
                }, 2000);
            </script>
        </body>
        </html>
    `);
});
