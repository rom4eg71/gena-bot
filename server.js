require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { WebSocketServer } = require('ws');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: '*' })); 
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Подключение к MySQL ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Проверка подключения
pool.getConnection()
    .then(conn => { console.log("MySQL подключена"); conn.release(); })
    .catch(err => console.error("Ошибка MySQL:", err.message));

// --- WebSocket ---
const activeChats = {};
const adminSockets = [];

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.replace('/?', ''));
    const userId = urlParams.get('userId');
    const isAdmin = urlParams.get('admin') === 'true';

    if (isAdmin) {
        adminSockets.push(ws);
        ws.on('close', () => {
            const index = adminSockets.indexOf(ws);
            if (index > -1) adminSockets.splice(index, 1);
        });
    } else if (userId) {
        activeChats[userId] = ws;
        ws.on('close', () => delete activeChats[userId]);
    }
});

// --- Функция отправки в Telegram ---
async function sendToTelegram(message) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("Telegram error", e.message); }
}

// --- Товары ---
const lures = [
    { id: 1, name: "Набор TANTA для микроджига (20 мм)", fish: "Окунь", price: 1500, desc: "40 шт. Lox UV, болото, апельсин.", image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=400", action: "В корзину 🛒" },
    { id: 2, name: "Набор TANTA Vibro Slug (26 мм)", fish: "Щука", price: 1500, desc: "40 шт. Lox UV, болото, карамель.", image: "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?q=80&w=400", action: "В корзину 🛒" }
];

// --- ЧАТ (Клиент -> Сервер) ---
app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    
    try {
        // 1. Сохраняем сообщение клиента
        await pool.query(
            'INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)',
            [userId, 'client', text]
        );

        // 2. Отправляем в админку (если открыта)
        adminSockets.forEach(ws => ws.send(JSON.stringify({ type: 'new_message', userId, text })));

        // 3. Логика ответа бота (пока простая)
        let botReply = "Я передал ваш вопрос менеджеру. Ожидайте!";
        
        // 4. Сохраняем ответ бота
        await pool.query(
            'INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)',
            [userId, 'bot', botReply]
        );
        
        // 5. Отправляем клиенту
        if (activeChats[userId]) {
            activeChats[userId].send(JSON.stringify({ type: 'bot_reply', text: botReply }));
        }

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Ошибка базы данных" });
    }
});

// --- ЗАКАЗЫ ---
app.post('/api/order', async (req, res) => {
    const { userId, productName, price, contactInfo } = req.body;
    
    try {
        await pool.query(
            'INSERT INTO orders (user_id, product_name, price, contact_info) VALUES (?, ?, ?, ?)',
            [userId, productName, price, contactInfo || 'Не указаны']
        );

        await sendToTelegram(`🔥 <b>НОВЫЙ ЗАКАЗ!</b>\n📦 ${productName}\n💰 ${price} ₽\n👤 ${contactInfo || 'Клиент не оставил контакты'}`);

        res.json({ success: true, message: "Заказ принят!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Ошибка базы данных" });
    }
});

// --- АДМИН ПАНЕЛЬ: Список диалогов ---
app.get('/api/admin/dialogs', async (req, res) => {
    try {
        // Получаем последнее сообщение для каждого уникального пользователя
        const [rows] = await pool.query(`
            SELECT m1.user_id, m1.text as last_message, m1.created_at
            FROM messages m1
            INNER JOIN (
                SELECT user_id, MAX(id) as max_id
                FROM messages
                GROUP BY user_id
            ) m2 ON m1.id = m2.max_id
            ORDER BY m1.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- АДМИН ПАНЕЛЬ: История клиента ---
app.get('/api/admin/dialogs/:userId', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC',
            [req.params.userId]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- АДМИН ПАНЕЛЬ: Ответ клиенту ---
app.post('/api/admin/reply', async (req, res) => {
    const { userId, text } = req.body;
    
    try {
        await pool.query(
            'INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)',
            [userId, 'admin', text]
        );
        
        if (activeChats[userId]) {
            activeChats[userId].send(JSON.stringify({ type: 'admin_reply', text }));
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Сервер с MySQL запущен: http://localhost:${PORT}`));
