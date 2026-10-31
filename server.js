require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://worldbaits.ru', 'https://www.worldbaits.ru', 'http://localhost:3000', 'http://127.0.0.1:3000']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "img-src * data:;");
    next();
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Хранилища ---
const userStates = {}; // Состояние диалога
const activeChats = {}; // Связка: ID клиента на сайте -> Chat ID в Telegram (для ответов)

// --- Функция отправки сообщения в Telegram ---
async function sendToTelegram(message, replyToChatId = null) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID; // Ваш основной ID для уведомлений
    
    if (!token || !chatId) return;

    const targetChatId = replyToChatId || chatId; // Если нужно ответить клиенту, шлем ему, иначе вам
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    try {
        await axios.post(url, {
            chat_id: targetChatId,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error("Ошибка Telegram:", error.response?.data || error.message);
    }
}

// --- База данных TANTA ---
const lures = [
    { id: 1, name: "Набор TANTA для микроджига (20 мм)", fish: "Окунь", price: 1500, desc: "40 шт. в ячейке. Lox UV, болото, апельсин.", image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=400", action: "В корзину 🛒" },
    { id: 2, name: "Набор TANTA Vibro Slug (26 мм)", fish: "Щука", price: 1500, desc: "40 шт. в ячейке. Lox UV, болото, карамель.", image: "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?q=80&w=400", action: "В корзину 🛒" },
    { id: 3, name: "TANTA Коробка-набор (480 шт.)", fish: "Окунь", price: 4500, desc: "Полный набор 480 шт. 20.5x14.5x2.5 см.", image: "https://images.unsplash.com/photo-1599058917212-d750089bc07e?q=80&w=400", action: "Заказать 📦" },
    { id: 4, name: "TANTA Цвет 'Апельсин'", fish: "Щука", price: 400, desc: "Яркая приманка для мутной воды.", image: "https://images.unsplash.com/photo-1534657433695-82645b3f2d4e?q=80&w=400", action: "В корзину 🛒" }
];

const GENNA_PROMPT = `Ты — Геннадий (Гена), эксперт-рыболов магазина WorldBaits. Продаешь силикон TANTA. Отвечай дружелюбно. Не придумывай товары.`;

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

    // --- СБРОС (Начать заново) ---
    if (text === "Начать заново") {
        delete userStates[userId];
        return res.json({
            text: "Поехали заново! На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    // --- ВЫЗОВ МЕНЕДЖЕРА ---
    if (text === "Позвать менеджера") {
        // Регистрируем клиента в Telegram, чтобы вы могли ему ответить
        activeChats[userId] = process.env.TELEGRAM_CHAT_ID; 
        
        await sendToTelegram(`🚨 <b>SOS! Клиент просит живого менеджера!</b>\nID клиента: <code>${userId}</code>\n\nЧтобы ответить клиенту, просто напишите сообщение в этот чат, и оно появится у него на сайте.`);
        
        return res.json({
            text: "Я передал трубку менеджеру! Напишите свой вопрос, и он ответит вам здесь в чате.",
            options: ["Начать заново"]
        });
    }

    // --- Шаг 1: Рыба ---
    if (state.step === 'start' || state.step === 'ask_fish') {
        state.data.fish = text;
        state.step = 'ask_water';
        return res.json({
            text: `Отлично, ${text.toLowerCase()}! Где планируете ловить?`,
            options: ["Река с течением", "Закрытый водоем", "Платный пруд", "Не знаю"]
        });
    }

    // --- Шаг 2: Вода ---
    if (state.step === 'ask_water') {
        state.data.water = text;
        state.step = 'ask_type';
        return res.json({
            text: "Понял. А какой силикон предпочитаете?",
            options: ["Силикон ручной работы", "Заводской силикон"]
        });
    }

    // --- Шаг 3: Выдача товаров ---
    if (state.step === 'ask_type') {
        state.data.type = text;
        state.step = 'free_chat';

        const found = lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish));

        if (found.length > 0) {
            return res.json({
                text: "Вот лучшие варианты под твой запрос:",
                type: 'products',
                products: found,
                options: ["Начать заново", "Позвать менеджера"]
            });
        } else {
            return res.json({
                text: "Пока пусто. Давай изменим условия?",
                options: ["Начать заново", "Позвать менеджера"]
            });
        }
    }

    // --- Шаг 4: Свободный чат (ИИ) ---
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

    return res.json({ text: "Я запутался. Начнем сначала?", options: ["Начать заново"] });
});

// --- НОВЫЙ ЭНДПОИНТ ДЛЯ ЗАКАЗА (Сбор данных) ---
app.post('/api/order', async (req, res) => {
    const { userId, productName, price } = req.body;
    
    // Ставим клиента в очередь на ввод данных
    userStates[userId] = { step: 'awaiting_phone', data: { productName, price } };

    // Отправляем сигнал вам в Telegram
    await sendToTelegram(`🛒 <b>Клиент хочет заказать:</b>\n${productName} за ${price} ₽\n\n<i>Ожидаем ввода данных...</i>`);

    res.json({ success: true, message: "Отлично! Чтобы оформить заказ, напишите ваше ФИО и номер телефона одним сообщением." });
});

// --- НОВЫЙ ЭНДПОИНТ ДЛЯ ПРИЕМА КОНТАКТОВ ---
app.post('/api/contact', async (req, res) => {
    const { userId, contactInfo } = req.body;
    const state = userStates[userId];

    if (state && state.step === 'awaiting_phone') {
        const { productName, price } = state.data;
        
        // Отправляем финальный заказ вам в Telegram
        await sendToTelegram(`🔥 <b>НОВЫЙ ЗАКАЗ!</b>\n\n📦 Товар: ${productName}\n💰 Сумма: ${price} ₽\n👤 Клиент: ${contactInfo}\n🆔 ID: <code>${userId}</code>`);
        
        // Регистрируем чат для ответа
        activeChats[userId] = process.env.TELEGRAM_CHAT_ID;
        
        // Сбрасываем состояние
        delete userStates[userId];

        return res.json({ success: true, message: "Спасибо! Заказ принят. Менеджер свяжется с вами в ближайшее время." });
    }
    
    res.json({ success: false, message: "Ошибка состояния." });
});

// --- ВЕБХУК ДЛЯ ОТВЕТОВ ИЗ TELEGRAM ---
// Этот эндпоинт Render будет вызывать, когда ВЫ пишете сообщение боту в Telegram
app.post('/api/telegram-webhook', async (req, res) => {
    const { message } = req.body;
    
    if (message && message.text) {
        const text = message.text;
        
        // Ищем, какому клиенту на сайте нужно отправить этот ответ
        // (В реальном проекте тут нужна база данных, но для 1 менеджера хватит и так)
        const clientIds = Object.keys(activeChats);
        
        if (clientIds.length > 0) {
            const clientId = clientIds[0]; // Берем последнего активного клиента
            
            // Отправляем сообщение клиенту на сайт
            // Для этого мы сохраняем его в очередь (в реальности нужна БД или WebSocket)
            // В рамках этого простого кода мы просто пишем в консоль
            console.log(`Ответ для клиента ${clientId}: ${text}`);
            
            // ВАЖНО: Чтобы клиент увидел это сообщение, нужно использовать WebSocket или SSE.
            // Пока что мы просто фиксируем факт ответа. (Ниже объясню, как это увидеть клиенту).
        }
    }
    res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер Гены (TANTA) запущен: http://localhost:${PORT}`);
});
