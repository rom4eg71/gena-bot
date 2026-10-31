require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const axios = require('axios');
const http = require('http'); // Для WebSocket
const { WebSocketServer } = require('ws'); // WebSocket

const app = express();
const PORT = process.env.PORT || 3000;

// Создаем HTTP-сервер для Express и WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({
    origin: ['https://worldbaits.ru', 'https://www.worldbaits.ru', 'http://localhost:3000', 'http://127.0.0.1:3000']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Хранилища ---
const userStates = {}; // Состояние диалога
const activeChats = {}; // Связка: ID клиента на сайте -> WebSocket соединение
let lastTelegramMessage = ""; // Буфер для сообщений из Telegram (если клиент еще не подключен)

// --- WebSocket: Подключение клиента с сайта ---
wss.on('connection', (ws, req) => {
    // Извлекаем userId из URL (например, ws://.../?userId=user_123)
    const urlParams = new URLSearchParams(req.url.replace('/?', ''));
    const userId = urlParams.get('userId');

    if (userId) {
        activeChats[userId] = ws;
        console.log(`Клиент ${userId} подключен к WebSocket`);

        // Если было сообщение от менеджера, пока клиент не был подключен — отправляем его
        if (lastTelegramMessage) {
            ws.send(JSON.stringify({ type: 'manager_reply', text: lastTelegramMessage }));
            lastTelegramMessage = ""; // Очищаем буфер
        }

        ws.on('close', () => {
            delete activeChats[userId];
            console.log(`Клиент ${userId} отключился`);
        });
    }
});

// --- Функция отправки сообщения в Telegram ---
async function sendToTelegram(message) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error("Ошибка Telegram:", error.response?.data || error.message);
    }
}

// --- База данных TANTA ---
const lures = [
    { id: 1, name: "Набор TANTA для микроджига (20 мм)", fish: "Окунь", price: 1500, desc: "40 шт. Lox UV, болото, апельсин.", image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=400", action: "В корзину 🛒" },
    { id: 2, name: "Набор TANTA Vibro Slug (26 мм)", fish: "Щука", price: 1500, desc: "40 шт. Lox UV, болото, карамель.", image: "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?q=80&w=400", action: "В корзину 🛒" },
    { id: 3, name: "TANTA Коробка-набор (480 шт.)", fish: "Окунь", price: 4500, desc: "Полный набор 480 шт.", image: "https://images.unsplash.com/photo-1599058917212-d750089bc07e?q=80&w=400", action: "Заказать 📦" },
    { id: 4, name: "TANTA Цвет 'Апельсин'", fish: "Щука", price: 400, desc: "Яркая приманка для мутной воды.", image: "https://images.unsplash.com/photo-1534657433695-82645b3f2d4e?q=80&w=400", action: "В корзину 🛒" }
];

const GENNA_PROMPT = `Ты — Геннадий (Гена), эксперт-рыболов магазина WorldBaits. Продаешь силикон TANTA. Отвечай дружелюбно.`;

app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    if (!userId || !text) return res.status(400).json({ error: "Неверный запрос" });

    if (!userStates[userId]) {
        userStates[userId] = { step: 'start', data: {} };
        return res.json({
            text: "Привет! Я Гена, помогу подобрать силикон TANTA. На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    const state = userStates[userId];

    if (text === "Начать заново") {
        delete userStates[userId];
        return res.json({
            text: "Поехали заново! На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    // --- ИСПРАВЛЕННЫЙ ВЫЗОВ МЕНЕДЖЕРА ---
    if (text === "Позвать менеджера") {
        // Меняем шаг на "ожидание менеджера", чтобы бот не сбрасывал диалог
        state.step = 'waiting_for_manager';
        await sendToTelegram(`🚨 <b>Клиент просит менеджера!</b>\nID: <code>${userId}</code>\n\n<i>Напишите ответ в этот чат, и клиент увидит его на сайте.</i>`);
        return res.json({
            text: "Секунду, я передал трубку менеджеру! Напишите свой вопрос, и он ответит вам здесь.",
            options: [] // Убираем кнопки, чтобы не сбивать
        });
    }

    // Если клиент в режиме ожидания менеджера
    if (state.step === 'waiting_for_manager') {
        // Просто пересылаем его сообщение вам в Telegram
        await sendToTelegram(`💬 <b>Клиент (${userId}) написал:</b>\n${text}`);
        return res.json({
            text: "Сообщение передано менеджеру. Ожидайте ответа...",
            options: []
        });
    }

    // --- Остальной сценарий (Рыба -> Вода -> Товары) ---
    if (state.step === 'start' || state.step === 'ask_fish') {
        state.data.fish = text;
        state.step = 'ask_water';
        return res.json({
            text: `Отлично, ${text.toLowerCase()}! Где планируете ловить?`,
            options: ["Река с течением", "Закрытый водоем", "Платный пруд", "Не знаю"]
        });
    }

    if (state.step === 'ask_water') {
        state.data.water = text;
        state.step = 'ask_type';
        return res.json({
            text: "Понял. А какой силикон предпочитаете?",
            options: ["Силикон ручной работы", "Заводской силикон"]
        });
    }

    if (state.step === 'ask_type') {
        state.data.type = text;
        state.step = 'free_chat';
        const found = lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish));
        
        if (found.length > 0) {
            return res.json({
                text: "Вот лучшие варианты:",
                type: 'products',
                products: found,
                options: ["Начать заново", "Позвать менеджера"]
            });
        } else {
            return res.json({
                text: "Пока пусто. Изменим условия?",
                options: ["Начать заново", "Позвать менеджера"]
            });
        }
    }

    if (state.step === 'free_chat') {
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: GENNA_PROMPT }, { role: "user", content: text }],
                max_tokens: 200
            });
            return res.json({
                text: completion.choices[0].message.content,
                options: ["Начать заново", "Позвать менеджера"]
            });
        } catch (error) {
            return res.json({
                text: "Связь пропала. Попробуем еще раз?",
                options: ["Начать заново", "Позвать менеджера"]
            });
        }
    }
});

// --- Заказ (Сбор контактов) ---
app.post('/api/order', async (req, res) => {
    const { userId, productName, price } = req.body;
    userStates[userId] = { step: 'awaiting_phone', data: { productName, price } };
    await sendToTelegram(`🛒 <b>Клиент хочет заказать:</b>\n${productName} за ${price} ₽\n\n<i>Ожидаем ввода контактов...</i>`);
    res.json({ success: true, message: "Отлично! Напишите ваше ФИО и телефон одним сообщением." });
});

app.post('/api/contact', async (req, res) => {
    const { userId, contactInfo } = req.body;
    const state = userStates[userId];
    if (state && state.step === 'awaiting_phone') {
        const { productName, price } = state.data;
        await sendToTelegram(`🔥 <b>НОВЫЙ ЗАКАЗ!</b>\n📦 ${productName}\n💰 ${price} ₽\n👤 ${contactInfo}\n🆔 <code>${userId}</code>`);
        delete userStates[userId];
        return res.json({ success: true, message: "Спасибо! Заказ принят." });
    }
    res.json({ success: false, message: "Ошибка." });
});

// --- ВЕБХУК ДЛЯ ОТВЕТОВ ИЗ TELEGRAM ---
app.post('/api/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    if (message && message.text) {
        const text = message.text;
        
        // Ищем активного клиента, который ждет менеджера
        for (const userId in userStates) {
            if (userStates[userId].step === 'waiting_for_manager' && activeChats[userId]) {
                // Отправляем сообщение клиенту через WebSocket
                activeChats[userId].send(JSON.stringify({ type: 'manager_reply', text: text }));
                break; // Отправляем только первому ожидающему (или можно всем)
            }
        }
        // Если клиент не подключен по WebSocket, сохраняем в буфер
        lastTelegramMessage = text;
    }
    res.sendStatus(200);
});

// Запускаем HTTP-сервер (вместо app.listen)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер Гены (TANTA) с WebSocket запущен: http://localhost:${PORT}`);
});
