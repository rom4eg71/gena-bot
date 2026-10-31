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

// --- База данных ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// --- WebSocket ---
const activeChats = {}; // Клиенты
const adminSockets = []; // Админы

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

// --- Товары ---
const lures = [
    { id: 1, name: "Набор TANTA для микроджига (20 мм)", fish: "Окунь", price: 1500, desc: "40 шт. Lox UV, болото, апельсин.", image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=400", action: "В корзину 🛒" },
    { id: 2, name: "Набор TANTA Vibro Slug (26 мм)", fish: "Щука", price: 1500, desc: "40 шт. Lox UV, болото, карамель.", image: "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?q=80&w=400", action: "В корзину 🛒" }
];

// --- Память для сценария (храним шаги в памяти, а не в БД) ---
const userStates = {}; 

// --- ГЛАВНЫЙ ЭНДПОИНТ ЧАТА ---
app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    
    // 1. Сохраняем сообщение клиента в БД
    await pool.query('INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)', [userId, 'client', text]);
    
    // 2. Отправляем в админку
    adminSockets.forEach(ws => ws.send(JSON.stringify({ type: 'new_message', userId, text })));

    // 3. Логика бота
    if (!userStates[userId]) {
        userStates[userId] = { step: 'start', data: {} };
    }
    const state = userStates[userId];
    let botReply = "";
    let options = [];
    let isProducts = false;

    if (state.step === 'start') {
        state.step = 'ask_fish';
        botReply = "Привет! Я Гена, помогу подобрать силикон TANTA. На какую рыбу планируете охоту?";
        options = ["Окунь", "Щука", "Судак", "Не знаю"];
    } 
    else if (state.step === 'ask_fish') {
        state.data.fish = text;
        state.step = 'ask_water';
        botReply = `Отлично, ${text.toLowerCase()}! Где планируете ловить?`;
        options = ["Река с течением", "Закрытый водоем", "Не знаю"];
    }
    else if (state.step === 'ask_water') {
        state.data.water = text;
        state.step = 'free_chat';
        
        const found = lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish));
        if (found.length > 0) {
            botReply = "Вот лучшие варианты:";
            options = ["Начать заново", "Позвать менеджера"];
            isProducts = true;
        } else {
            botReply = "Пока пусто. Давай изменим условия?";
            options = ["Начать заново", "Позвать менеджера"];
        }
    }
    else if (state.step === 'free_chat') {
        if (text === "Начать заново") {
            delete userStates[userId];
            return res.json({ text: "Поехали заново! На какую рыбу планируете охоту?", options: ["Окунь", "Щука", "Судак", "Не знаю"] });
        }
        if (text === "Позвать менеджера") {
            state.step = 'waiting_for_manager';
            await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: `🚨 Клиент (${userId}) просит менеджера!`
            });
            return res.json({ text: "Секунду, я передал трубку менеджеру! Напишите свой вопрос, и он ответит вам здесь.", options: [] });
        }

        // --- УМНЫЙ ОТВЕТ ОТ ИИ ---
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Ты — Гена, эксперт-рыболов магазина WorldBaits. Продаешь силикон TANTA. Отвечай дружелюбно, используй рыбацкий сленг." },
                    { role: "user", content: text }
                ],
                max_tokens: 200
            });
            botReply = completion.choices[0].message.content;
            options = ["Начать заново", "Позвать менеджера"];
        } catch (error) {
            botReply = "Ой, связь пропала. Попробуем еще раз?";
            options = ["Начать заново", "Позвать менеджера"];
        }
    }

    // 4. Сохраняем ответ бота в БД
    await pool.query('INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)', [userId, 'bot', botReply]);

    // 5. Отправляем клиенту
    if (activeChats[userId]) {
        activeChats[userId].send(JSON.stringify({ 
            type: 'bot_reply', 
            text: botReply, 
            options: options,
            products: isProducts ? lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish)) : null
        }));
    }

    // 6. Отвечаем через HTTP (для синхронного режима)
    res.json({
        text: botReply,
        options: options,
        type: isProducts ? 'products' : 'text',
        products: isProducts ? lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish)) : null
    });
});

// --- АДМИНКА: История и ответы ---
app.get('/api/admin/dialogs', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT m1.user_id, m1.text as last_message, m1.created_at
            FROM messages m1
            INNER JOIN (SELECT user_id, MAX(id) as max_id FROM messages GROUP BY user_id) m2 
            ON m1.id = m2.max_id ORDER BY m1.created_at DESC
        `);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/dialogs/:userId', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC', [req.params.userId]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/reply', async (req, res) => {
    const { userId, text } = req.body;
    try {
        await pool.query('INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)', [userId, 'admin', text]);
        if (activeChats[userId]) {
            activeChats[userId].send(JSON.stringify({ type: 'admin_reply', text }));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Сервер запущен: http://localhost:${PORT}`));
