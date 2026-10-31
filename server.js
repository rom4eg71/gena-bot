require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Разрешаем запросы с вашего сайта
app.use(cors({
    origin: ['https://worldbaits.ru', 'http://localhost:3000', 'http://127.0.0.1:3000']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- База данных TANTA (на основе страницы /tanta/) ---
const lures = [
    { 
        id: 1, 
        name: "Набор TANTA для микроджига (20 мм)", 
        fish: "Окунь", 
        water: "Река", 
        type: "Ручная работа", 
        price: 1500, 
        desc: "40 шт. в ячейке. Расцветки: Lox UV, болото, апельсин, лимонный, барби-розовый, гранат. Идеален для окуня." 
    },
    { 
        id: 2, 
        name: "Набор TANTA Vibro Slug (26 мм)", 
        fish: "Щука", 
        water: "Река", 
        type: "Ручная работа", 
        price: 1500, 
        desc: "40 шт. в ячейке. Расцветки: Lox UV, болото, апельсин, карамель, светло-фиолетовый, фиолетовый. Для щуки." 
    },
    { 
        id: 3, 
        name: "TANTA Коробка-набор (480 шт.)", 
        fish: "Окунь", 
        water: "Озеро", 
        type: "Ручная работа", 
        price: 4500, 
        desc: "Полный набор 480 шт. Размер коробки: 20.5x14.5x2.5 см. Только по предзаказу." 
    },
    { 
        id: 4, 
        name: "TANTA Цвет 'Апельсин'", 
        fish: "Щука", 
        water: "Река", 
        type: "Ручная работа", 
        price: 400, 
        desc: "Яркая приманка для мутной воды. Проверено на водоемах России." 
    },
    { 
        id: 5, 
        name: "TANTA Цвет 'Машинное масло'", 
        fish: "Окунь", 
        water: "Озеро", 
        type: "Ручная работа", 
        price: 400, 
        desc: "Классика для окуня. Работает по пассивной рыбе." 
    },
    { 
        id: 6, 
        name: "TANTA Цвет 'Фиолетовый'", 
        fish: "Судак", 
        water: "Река", 
        type: "Ручная работа", 
        price: 400, 
        desc: "Универсальный цвет для судака на течении." 
    }
];

// --- Системный промпт для ИИ (Гена) ---
const GENNA_PROMPT = `Ты — Геннадий (Гена), опытный эксперт-рыболов и консультант магазина приманок WorldBaits. 
Ты продаешь ТОЛЬКО силиконовые приманки бренда TANTA (особенно ручной работы). 
Отвечай дружелюбно, используй рыбацкий сленг, но будь профессионален. 
Знай, что TANTA — это российское производство, проверенное на водоемах России. В наборах 480 шт., 12 расцветок. 
Если спрашивают про воблеры или блесны — вежливо скажи, что ты специализируешься только на силиконе TANTA. 
Не придумывай товары, которых нет в базе. Если не знаешь — предложи позвать менеджера.`;

// Хранилище состояний пользователей
const userStates = {};

app.post('/api/chat', async (req, res) => {
    const { userId, text } = req.body;
    
    if (!userId || !text) {
        return res.status(400).json({ error: "Неверный запрос" });
    }

    // Инициализация нового пользователя
    if (!userStates[userId]) {
        userStates[userId] = { step: 'start', data: {} };
        return res.json({
            text: "Привет! Я Гена, эксперт по приманкам TANTA. Помогу подобрать идеальный силикон. На какую рыбу планируете охоту?",
            options: ["Окунь", "Щука", "Судак", "Не знаю"]
        });
    }

    const state = userStates[userId];

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

        // Фильтрация товаров
        const found = lures.filter(l => 
            (state.data.fish === "Не знаю" || l.fish === state.data.fish) &&
            (state.data.water === "Не знаю" || l.water === state.data.water)
        );

        let responseText = "";
        if (found.length > 0) {
            responseText = "Вот лучшие варианты TANTA под твой запрос:\n\n" + 
                found.map(l => `🎣 **${l.name}**\n📝 ${l.desc}\n💰 Цена: ${l.price} руб.`).join('\n\n') + 
                "\n\nЕсли нужен конкретный цвет или размер — просто напиши мне!";
        } else {
            responseText = "Хм, по таким параметрам у нас пока пусто. Давай изменим условия или я позову менеджера?";
        }

        return res.json({
            text: responseText,
            options: ["Начать заново", "Позвать менеджера"]
        });
    }

    // --- Шаг 4: Свободный чат (ИИ) ---
    if (state.step === 'free_chat') {
        if (text === "Начать заново") {
            delete userStates[userId];
            return res.json({
                text: "Поехали заново! На какую рыбу планируете охоту?",
                options: ["Окунь", "Щука", "Судак", "Не знаю"]
            });
        }

        if (text === "Позвать менеджера") {
            return res.json({
                text: "Секунду, передаю трубку живому человеку! Он скоро напишет.",
                options: []
            });
        }

        // Обращение к OpenAI
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: GENNA_PROMPT },
                    { role: "user", content: text }
                ],
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

    // Фолбэк
    return res.json({
        text: "Извини, я немного запутался. Давай начнем сначала?",
        options: ["Начать заново"]
    });
});

app.listen(PORT, () => {
    console.log(`Сервер Гены (TANTA) запущен: http://localhost:${PORT}`);
});