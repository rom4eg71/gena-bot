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
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10
});

// --- WebSocket (Связь сайт <-> админка) ---
const activeChats = {}; // Клиенты на сайте
const adminSockets = []; // Вы в админке

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.replace('/?', ''));
    const userId = urlParams.get('userId');
    const isAdmin = urlParams.get('admin') === 'true';

    if (isAdmin) {
        adminSockets.push(ws);
        ws.on('close', () => { const i = adminSockets.indexOf(ws); if (i > -1) adminSockets.splice(i, 1); });
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

// --- Память сценария ---
const userStates = {}; 

// --- ЧАТ ---
app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    
    // Сохраняем в БД
    await pool.query('INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)', [userId, 'client', text]);
    adminSockets.forEach(ws => ws.send(JSON.stringify({ type: 'new_message', userId, text })));

    if (!userStates[userId]) userStates[userId] = { step: 'start', data: {} };
    const state = userStates[userId];
    let botReply = "";
    let options = [];
    let productsToSend = null;

    if (state.step === 'waiting_for_manager') {
        // Если ждем менеджера, бот молчит, только пересылает вам
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID, text: `💬 Клиент (${userId}): ${text}`
        });
        return res.json({ text: "", options: [] }); // Клиенту ничего не отвечаем, ждем вас
    }

    if (text === "Начать заново") {
        delete userStates[userId];
        return res.json({ text: "Поехали заново! На какую рыбу планируете охоту?", options: ["Окунь", "Щука", "Судак", "Не знаю"] });
    }

    if (text === "Позвать менеджера") {
        state.step = 'waiting_for_manager';
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID, text: `🚨 Клиент (${userId}) просит менеджера!`
        });
        botReply = "Секунду, я передал трубку менеджеру! Напишите свой вопрос, и он ответит вам здесь.";
        options = [];
    }
    else if (state.step === 'start') {
        state.step = 'ask_fish';
        botReply = "Привет! Я Гена, помогу подобрать силикон TANTA. На какую рыбу планируете охоту?";
        options = ["Окунь", "Щука", "Судак", "Не знаю"];
    }
    else if (state.step === 'ask_fish') {
        state.data.fish = text; state.step = 'ask_water';
        botReply = `Отлично, ${text.toLowerCase()}! Где планируете ловить?`;
        options = ["Река с течением", "Закрытый водоем", "Не знаю"];
    }
    else if (state.step === 'ask_water') {
        state.data.water = text; state.step = 'free_chat';
        const found = lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish));
        if (found.length > 0) {
            botReply = "Вот лучшие варианты:"; options = ["Начать заново", "Позвать менеджера"]; productsToSend = found;
        } else {
            botReply = "Пока пусто. Давай изменим условия?"; options = ["Начать заново", "Позвать менеджера"];
        }
    }
    else if (state.step === 'free_chat') {
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: "Ты — Гена, эксперт по рыбалке. Продаешь TANTA. Отвечай дружелюбно." }, { role: "user", content: text }],
                max_tokens: 200
            });
            botReply = completion.choices[0].message.content; options = ["Начать заново", "Позвать менеджера"];
        } catch (error) { botReply = "Связь пропала. Попробуем еще раз?"; options = ["Начать заново", "Позвать менеджера"]; }
    }

    // Сохраняем ответ бота и отправляем
    await pool.query('INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)', [userId, 'bot', botReply]);
    
    // Отправляем ответ ТОЛЬКО через WebSocket (чтобы не было дублей)
    if (activeChats[userId]) {
        activeChats[userId].send(JSON.stringify({ type: 'bot_reply', text: botReply, options, products: productsToSend }));
    }
    
    // Отвечаем HTTP-запросом (на случай, если WebSocket не сработал)
    res.json({ text: botReply, options, type: productsToSend ? 'products' : 'text', products: productsToSend });
});

// --- ЗАКАЗ (Кнопка "В корзину") ---
app.post('/api/order', async (req, res) => {
    const { userId, productName, price } = req.body;
    try {
        await pool.query('INSERT INTO orders (user_id, product_name, price) VALUES (?, ?, ?)', [userId, productName, price]);
        userStates[userId] = { step: 'awaiting_phone', data: { productName, price } };
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID, text: `🛒 Клиент (${userId}) хочет: ${productName} за ${price} ₽`
        });
        res.json({ success: true, message: `Отлично! Вы выбрали ${productName}. Напишите ваше ФИО и телефон.` });
    } catch (e) { res.status(500).json({ error: "Ошибка БД" }); }
});

app.post('/api/contact', async (req, res) => {
    const { userId, contactInfo } = req.body;
    const state = userStates[userId];
    if (state && state.step === 'awaiting_phone') {
        await pool.query('UPDATE orders SET contact_info = ? WHERE user_id = ? ORDER BY id DESC LIMIT 1', [contactInfo, userId]);
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID, text: `🔥 ЗАКАЗ! Товар: ${state.data.productName}. Контакт: ${contactInfo}`
        });
        delete userStates[userId];
        return res.json({ success: true, message: "Спасибо! Заказ принят. Менеджер свяжется с вами." });
    }
    res.json({ success: false });
});

// --- АДМИНКА ---
app.get('/api/admin/dialogs', async (req, res) => {
    const [rows] = await pool.query(`
        SELECT m1.user_id, m1.text as last_message, m1.created_at
        FROM messages m1
        INNER JOIN (SELECT user_id, MAX(id) as max_id FROM messages GROUP BY user_id) m2 
        ON m1.id = m2.max_id ORDER BY m1.created_at DESC
    `);
    res.json(rows);
});

app.get('/api/admin/dialogs/:userId', async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC', [req.params.userId]);
    res.json(rows);
});

app.post('/api/admin/reply', async (req, res) => {
    const { userId, text } = req.body;
    await pool.query('INSERT INTO messages (user_id, sender, text) VALUES (?, ?, ?)', [userId, 'admin', text]);
    if (activeChats[userId]) {
        activeChats[userId].send(JSON.stringify({ type: 'admin_reply', text }));
    }
    res.json({ success: true });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Сервер запущен: ${PORT}`));
