require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const axios = require('axios'); // Добавляем Axios для запросов в Telegram

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

// --- Функция отправки сообщения в Telegram ---
async function sendToTelegram(message) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
        console.warn("Telegram не настроен. Пропускаем уведомление.");
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
        console.log("Уведомление в Telegram отправлено!");
    } catch (error) {
        console.error("Ошибка отправки в Telegram:", error.response ? error.response.data : error.message);
    }
}

// --- База данных TANTA ---
const lures = [
    { id: 1, name: "Набор TANTA для микроджига (20 мм)", fish: "Окунь", price: 1500, desc: "40 шт. в ячейке. Расцветки: Lox UV, болото, апельсин.", image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=400", action: "В корзину 🛒" },
    { id: 2, name: "Набор TANTA Vibro Slug (26 мм)", fish: "Щука", price: 1500, desc: "40 шт. в ячейке. Расцветки: Lox UV, болото, карамель.", image: "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?q=80&w=400", action: "В корзину 🛒" },
    { id: 3, name: "TANTA Коробка-набор (480 шт.)", fish: "Окунь", price: 4500, desc: "Полный набор 480 шт. Размер коробки: 20.5x14.5x2.5 см.", image: "https://images.unsplash.com/photo-1599058917212-d750089bc07e?q=80&w=400", action: "Заказать 📦" },
    { id: 4, name: "TANTA Цвет 'Апельсин'", fish: "Щука", price: 400, desc: "Яркая приманка для мутной воды.", image: "https://images.unsplash.com/photo-1534657433695-82645b3f2d4e?q=80&w=400", action: "В корзину 🛒" }
];

const GENNA_PROMPT = `Ты — Геннадий (Гена), опытный эксперт-рыболов и консультант магазина приманок WorldBaits. 
Ты продаешь ТОЛЬКО силиконовые приманки бренда TANTA (особенно ручной работы). 
Отвечай дружелюбно, используй рыбацкий сленг. Не придумывай товары. Если не знаешь — предложи позвать менеджера.`;

const userStates = {};

app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    
    if (!userId || !text) return res.status(400).json({ error: "Неверный запрос" });

    if (!userStates[userId]) {
        userStates[userId] = { step: 'start', data: {} };
        return res.json({
            text: "Привет! Я Гена, помогу подобрать идеальный силикон TANTA. На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    const state = userStates[userId];

    // --- Кнопка "Начать заново" ---
    if (text === "Начать заново") {
        delete userStates[userId];
        return res.json({
            text: "Поехали заново! На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    // --- Кнопка "Позвать менеджера" ---
    if (text === "Позвать менеджера") {
        await sendToTelegram(`🚨 <b>SOS! Клиент просит живого менеджера!</b>\nID клиента: <code>${userId}</code>\nПоследнее сообщение: "${text}"`);
        return res.json({
            text: "Секунду, я уже передал трубку живому человеку! Он скоро напишет.",
            options: ["Начать заново"]
        });
    }

    // --- Шаг 1: Выбор рыбы ---
    if (state.step === 'start' || state.step === 'ask_fish') {
        state.data.fish = text;
        state.step = 'ask_water';
        return res.json({
            text: `Отлично, ${text.toLowerCase()}! А где планируете ловить?`,
            options: ["Река с течением", "Закрытый водоем", "Платный пруд", "Не знаю"]
        });
    }

    // --- Шаг 2: Выбор воды ---
    if (state.step === 'ask_water') {
        state.data.water = text.includes("Река") ? "Река" : (text.includes("Озеро") ? "Озеро" : "Не знаю");
        state.step = 'ask_type';
        return res.json({
            text: "Понял. А какой силикон предпочитаете? У нас весь TANTA — ручная работа.",
            options: ["Силикон ручной работы", "Заводской силикон"]
        });
    }

    // --- Шаг 3: Выбор типа и ВЫДАЧА ТОВАРОВ ---
    if (state.step === 'ask_type') {
        state.data.type = text.includes("ручной") ? "Ручная работа" : "Заводской";
        state.step = 'free_chat';

        const found = lures.filter(l => (state.data.fish === "Не знаю" || l.fish === state.data.fish));

        if (found.length > 0) {
            return res.json({
                text: "Вот лучшие варианты под твой запрос. Все проверено на водоемах России! 🎣",
                type: 'products',
                products: found,
                options: ["Начать заново", "Позвать менеджера"]
            });
        } else {
            return res.json({
                text: "Хм, по таким параметрам у нас пока пусто. Давай изменим условия или я позову менеджера?",
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
                max_tokens: 250
            });
            return res.json({
                text: completion.choices[0].message.content,
                options: ["Начать заново", "Позвать менеджера"]
            });
        } catch (error) {
            console.error("OpenAI Error:", error);
            return res.json({
                text: "Ой, у меня связь с космосом пропала. Давай лучше подберем по кнопкам или позовем менеджера!",
                options: ["Начать заново", "Позвать менеджера"]
            });
        }
    }

    return res.json({ text: "Извини, я запутался. Давай начнем сначала?", options: ["Начать заново"] });
});

// --- НОВЫЙ ЭНДПОИНТ ДЛЯ ОФОРМЛЕНИЯ ЗАКАЗА ---
app.post('/api/order', async (req, res) => {
    const { userId, productName, price } = req.body;
    
    // Отправляем заказ в Telegram
    const orderMessage = `🔥 <b>НОВЫЙ ЗАКАЗ!</b> 🔥\n\n` +
                         `📦 <b>Товар:</b> ${productName}\n` +
                         `💰 <b>Сумма:</b> ${price} ₽\n` +
                         `🆔 <b>ID клиента:</b> <code>${userId}</code>\n\n` +
                         `<i>Свяжитесь с клиентом для подтверждения заказа!</i>`;
                         
    await sendToTelegram(orderMessage);

    res.json({ success: true, message: "Заказ принят! Менеджер свяжется с вами." });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер Гены (TANTA) запущен: http://localhost:${PORT}`);
});
