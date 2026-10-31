require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({
    origin: ['https://worldbaits.ru', 'https://www.worldbaits.ru', 'http://localhost:3000', 'http://127.0.0.1:3000']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const userStates = {}; 
const activeChats = {}; 

// --- WebSocket ---
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.replace('/?', ''));
    const userId = urlParams.get('userId');
    if (userId) {
        activeChats[userId] = ws;
        ws.on('close', () => delete activeChats[userId]);
    }
});

// --- Telegram ---
async function sendToTelegram(message) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error("Ошибка Telegram:", error.message);
    }
}

// --- Товары ---
const lures = [
    { id: 1, name: "Набор TANTA для микроджига (20 мм)", fish: "Окунь", price: 1500, desc: "40 шт. Lox UV, болото, апельсин.", image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=400", action: "В корзину 🛒" },
    { id: 2, name: "Набор TANTA Vibro Slug (26 мм)", fish: "Щука", price: 1500, desc: "40 шт. Lox UV, болото, карамель.", image: "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?q=80&w=400", action: "В корзину 🛒" }
];

// --- Основной эндпоинт чата ---
app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    if (!userId || !text) return res.status(400).json({ error: "Неверный запрос" });

    // Инициализация, если пользователь новый
    if (!userStates[userId]) {
        userStates[userId] = { step: 'start', data: {} };
    }

    const state = userStates[userId];

    // --- ГЛАВНОЕ ИСПРАВЛЕНИЕ: Если ждем менеджера, не запускаем сценарий заново ---
    if (state.step === 'waiting_for_manager') {
        // Пересылаем сообщение клиента вам в Telegram
        await sendToTelegram(`💬 <b>Клиент (${userId}) написал:</b>\n${text}`);
        return res.json({
            text: "Сообщение передано менеджеру. Ожидайте ответа здесь...",
            options: [] // Кнопки убираем, чтобы не сбивать
        });
    }

    // --- Кнопка "Начать заново" (сброс) ---
    if (text === "Начать заново") {
        delete userStates[userId];
        return res.json({
            text: "Поехали заново! На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    // --- Кнопка "Позвать менеджера" ---
    if (text === "Позвать менеджера") {
        state.step = 'waiting_for_manager';
        await sendToTelegram(`🚨 <b>Клиент просит менеджера!</b>\nID: <code>${userId}</code>\n\n<i>Напишите ответ в этот чат, и клиент увидит его на сайте.</i>`);
        return res.json({
            text: "Секунду, я передал трубку менеджеру! Напишите свой вопрос, и он ответит вам здесь.",
            options: [] // Кнопки убираем
        });
    }

    // --- Стандартный сценарий ---
    if (state.step === 'start') {
        state.step = 'ask_fish';
        return res.json({
            text: "Привет! Я Гена, помогу подобрать силикон TANTA. На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    if (state.step === 'ask_fish') {
        state.data.fish = text;
        state.step = 'ask_water';
        return res.json({
            text: `Отлично, ${text.toLowerCase()}! Где планируете ловить?`,
            options: ["Река с течением", "Закрытый водоем", "Не знаю"]
        });
    }

    if (state.step === 'ask_water') {
        state.step = 'free_chat';
        const found = lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish));
        
        return res.json({
            text: found.length > 0 ? "Вот лучшие варианты:" : "Пока пусто. Давай изменим условия?",
            type: found.length > 0 ? 'products' : 'text',
            products: found,
            options: ["Начать заново", "Позвать менеджера"]
        });
    }

    // --- Свободный чат (ИИ) ---
    if (state.step === 'free_chat') {
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: "Ты — Гена, эксперт по силикону TANTA." }, { role: "user", content: text }],
                max_tokens: 200
            });
            return res.json({
                text: completion.choices[0].message.content,
                options: ["Начать заново", "Позвать менеджера"]
            });
        } catch (error) {
            return res.json({ text: "Связь пропала. Попробуем еще раз?", options: ["Начать заново", "Позвать менеджера"] });
        }
    }
});

// --- Заказ ---
app.post('/api/order', async (req, res) => {
    const { userId, productName, price } = req.body;
    userStates[userId] = { step: 'awaiting_phone', data: { productName, price } };
    await sendToTelegram(`🛒 <b>Клиент хочет заказать:</b>\n${productName} за ${price} ₽`);
    res.json({ success: true, message: "Отлично! Напишите ваше ФИО и телефон." });
});

app.post('/api/contact', async (req, res) => {
    const { userId, contactInfo } = req.body;
    const state = userStates[userId];
    if (state && state.step === 'awaiting_phone') {
        await sendToTelegram(`🔥 <b>НОВЫЙ ЗАКАЗ!</b>\n📦 ${state.data.productName}\n💰 ${state.data.price} ₽\n👤 ${contactInfo}\n🆔 <code>${userId}</code>`);
        delete userStates[userId];
        return res.json({ success: true, message: "Спасибо! Заказ принят." });
    }
    res.json({ success: false, message: "Ошибка." });
});

// --- Вебхук Telegram (ответ менеджера) ---
app.post('/api/telegram-webhook', (req, res) => {
    const { message } = req.body;
    if (message && message.text) {
        const text = message.text;
        // Ищем всех, кто ждет менеджера, и отправляем им ответ
        for (const userId in userStates) {
            if (userStates[userId].step === 'waiting_for_manager' && activeChats[userId]) {
                activeChats[userId].send(JSON.stringify({ type: 'manager_reply', text: text }));
            }
        }
    }
    res.sendStatus(200);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
