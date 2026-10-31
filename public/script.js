// --- 1. Инициализация элементов ---
const chatWidget = document.getElementById('chat-widget');
const chatBtn = document.getElementById('chat-widget-button');
const closeBtn = document.getElementById('close-chat');
const messagesArea = document.getElementById('chat-messages');
const optionsArea = document.getElementById('chat-options');
const inputField = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// --- 2. Настройки сервера ---
// ВАЖНО: Укажите адрес вашего сервера на Render
const API_URL = window.location.hostname === 'localhost' ? '' : 'https://gena-bot-sthi.onrender.com';
const userId = "user_" + Math.random().toString(36).substr(2, 9);
let isChatInitialized = false;
let isWaitingForContact = false; // Флаг: ждем ли мы ФИО и телефон

// --- 3. Подключение к WebSocket (для ответов менеджера) ---
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = window.location.hostname === 'localhost' ? 'localhost:3000' : 'gena-bot-sthi.onrender.com';
let socket;

try {
    socket = new WebSocket(`${wsProtocol}//${wsHost}/?userId=${userId}`);
    
    socket.onopen = () => {
        console.log("WebSocket подключен. Ждем ответов менеджера.");
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'manager_reply') {
            // Если менеджер написал из Telegram
            removeTyping();
            addMessage(`👨‍💼 <b>Менеджер:</b> ${data.text}`, 'bot');
        }
    };

    socket.onerror = (error) => {
        console.error("Ошибка WebSocket:", error);
    };
} catch (e) {
    console.log("WebSocket не поддерживается или ошибка подключения.");
}


// --- 4. Логика открытия/закрытия чата ---
chatBtn.addEventListener('click', () => {
    chatWidget.classList.remove('hidden');
    if (!isChatInitialized) {
        showTyping();
        setTimeout(() => {
            removeTyping();
            addMessage("Привет! Я Гена, помогу подобрать идеальный силикон TANTA. На какую рыбу планируете охоту?", 'bot');
            renderOptions(["Окунь", "Щука", "Судак", "Не знаю"]);
            isChatInitialized = true;
        }, 1000);
    }
});

closeBtn.addEventListener('click', () => chatWidget.classList.add('hidden'));

// --- 5. Отправка сообщений ---
sendBtn.addEventListener('click', () => {
    const text = inputField.value;
    if (isWaitingForContact) {
        handleContactSubmit(text);
    } else {
        sendMessage(text);
    }
});

inputField.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') {
        const text = inputField.value;
        if (isWaitingForContact) {
            handleContactSubmit(text);
        } else {
            sendMessage(text);
        }
    } 
});

// --- 6. Основная функция отправки сообщения боту ---
async function sendMessage(text) {
    if (!text.trim()) return;
    
    addMessage(text, 'user');
    inputField.value = '';
    optionsArea.innerHTML = ''; 
    showTyping(); 

    try {
        const response = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, text: text })
        });
        
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();

        setTimeout(() => {
            removeTyping();
            
            if (data.type === 'products') {
                addMessage(data.text, 'bot');
                renderProducts(data.products);
            } else {
                addMessage(data.text, 'bot');
            }

            if (data.options && data.options.length > 0) {
                renderOptions(data.options);
            }
        }, 1000); 

    } catch (error) {
        removeTyping();
        addMessage("Ошибка соединения. Проверьте сервер.", 'bot');
    }
}

// --- 7. Оформление заказа (Кнопка "В корзину") ---
async function buyProduct(name, price) {
    try {
        const response = await fetch(`${API_URL}/api/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, productName: name, price: price })
        });
        const data = await response.json();
        
        if (data.success) {
            addMessage(data.message, 'bot');
            isWaitingForContact = true; // Включаем режим ожидания ввода контактов
        } else {
            addMessage("Упс, не получилось оформить заказ.", 'bot');
        }
    } catch (e) {
        addMessage("Ошибка соединения при заказе.", 'bot');
    }
}

// --- 8. Отправка контактов (ФИО и телефон) ---
async function handleContactSubmit(text) {
    if (!text.trim()) return;
    
    addMessage(text, 'user');
    inputField.value = '';
    showTyping();

    try {
        const response = await fetch(`${API_URL}/api/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, contactInfo: text })
        });
        const data = await response.json();
        
        removeTyping();
        addMessage(data.message, 'bot');
        isWaitingForContact = false; // Выключаем режим ожидания
        
        // Показываем кнопки снова
        renderOptions(["Начать заново"]);
        
    } catch (e) {
        removeTyping();
        addMessage("Ошибка при отправке данных.", 'bot');
    }
}

// --- 9. Вспомогательные функции отрисовки ---
function addMessage(text, sender) {
    const div = document.createElement('div');
    div.classList.add('msg', sender);
    div.innerHTML = text.replace(/\n/g, '<br>');
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function renderProducts(products) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('msg', 'products');
    
    products.forEach(p => {
        const card = document.createElement('div');
        card.classList.add('product-card');
        // Обратите внимание: onclick вызывает глобальную функцию buyProduct
        card.innerHTML = `
            <img src="${p.image}" alt="${p.name}">
            <div class="product-info">
                <h4>${p.name}</h4>
                <p>${p.desc}</p>
                <div class="product-footer">
                    <span class="product-price">${p.price} ₽</span>
                    <button class="buy-btn" onclick="buyProduct('${p.name}', ${p.price})">${p.action}</button>
                </div>
            </div>
        `;
        wrapper.appendChild(card);
    });

    messagesArea.appendChild(wrapper);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function renderOptions(options) {
    optionsArea.innerHTML = '';
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.classList.add('option-btn');
        btn.innerText = opt;
        btn.onclick = () => {
            if (opt === "Начать заново") {
                isWaitingForContact = false; // Сбрасываем флаг
                optionsArea.innerHTML = ''; // Убираем кнопки
                sendMessage(opt);
            } else {
                sendMessage(opt);
            }
        };
        optionsArea.appendChild(btn);
    });
}

// --- 10. Эффект "Печатает..." ---
function showTyping() {
    if (document.getElementById('typing-indicator')) return; // Если уже есть, не дублируем
    const div = document.createElement('div');
    div.classList.add('typing-indicator');
    div.id = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function removeTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
}

// Делаем функцию buyProduct глобальной, чтобы она была доступна из HTML-кода карточек
window.buyProduct = buyProduct;
