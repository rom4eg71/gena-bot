const chatWidget = document.getElementById('chat-widget');
const chatBtn = document.getElementById('chat-widget-button');
const closeBtn = document.getElementById('close-chat');
const messagesArea = document.getElementById('chat-messages');
const optionsArea = document.getElementById('chat-options');
const inputField = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

const API_URL = window.location.hostname === 'localhost' ? '' : 'https://gena-bot-sthi.onrender.com';
const userId = "user_" + Math.random().toString(36).substr(2, 9);
let isChatInitialized = false;
let isWaitingForContact = false;

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = window.location.hostname === 'localhost' ? 'localhost:3000' : 'gena-bot-sthi.onrender.com';
let socket = new WebSocket(`${wsProtocol}//${wsHost}/?userId=${userId}`);

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'bot_reply') {
        removeTyping();
        if (data.products) { addMessage(data.text, 'bot'); renderProducts(data.products); } 
        else { addMessage(data.text, 'bot'); }
        if (data.options && data.options.length > 0) renderOptions(data.options);
    } 
    else if (data.type === 'admin_reply') {
        removeTyping();
        addMessage(`👨‍💼 <b>Менеджер:</b> ${data.text}`, 'bot');
        isWaitingForContact = false;
    }
};

chatBtn.addEventListener('click', () => {
    chatWidget.classList.remove('hidden');
    if (!isChatInitialized) {
        showTyping();
        setTimeout(() => {
            removeTyping();
            addMessage("Привет! Я Гена, помогу подобрать идеальный силикон TANTA. На какую рыбу планируете охоту?", 'bot');
            renderOptions(["Окунь", "Щука", "Судак", "Не знаю"]);
            isChatInitialized = true;
        }, 800);
    }
});
closeBtn.addEventListener('click', () => chatWidget.classList.add('hidden'));

sendBtn.addEventListener('click', () => {
    const text = inputField.value;
    if (isWaitingForContact) handleContactSubmit(text); else sendMessage(text);
});

inputField.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') {
        const text = inputField.value;
        if (isWaitingForContact) handleContactSubmit(text); else sendMessage(text);
    } 
});

async function sendMessage(text) {
    if (!text.trim()) return;
    addMessage(text, 'user');
    inputField.value = ''; optionsArea.innerHTML = ''; showTyping();
    try {
        await fetch(`${API_URL}/api/chat`, { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ userId, text }) 
        });
    } catch (error) { removeTyping(); addMessage("Ошибка соединения.", 'bot'); }
}

async function buyProduct(name, price) {
    try {
        const res = await fetch(`${API_URL}/api/order`, { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ userId, productName: name, price }) 
        });
        const data = await res.json();
        if (data.success) {
            addMessage(data.message, 'bot');
            isWaitingForContact = true;
        } else { addMessage("Ошибка при заказе.", 'bot'); }
    } catch (e) { addMessage("Ошибка при заказе.", 'bot'); }
}

async function handleContactSubmit(text) {
    if (!text.trim()) return;
    addMessage(text, 'user'); inputField.value = ''; showTyping();
    try {
        const res = await fetch(`${API_URL}/api/contact`, { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ userId, contactInfo: text }) 
        });
        const data = await res.json();
        removeTyping(); 
        addMessage(data.message, 'bot'); 
        
        if (data.success) {
            isWaitingForContact = false;
            renderOptions(["Начать заново"]);
        } else {
            // Если ошибка (например, нет цифр), остаемся в режиме ожидания
            // Кнопки не показываем, чтобы клиент ввел телефон
        }
    } catch (e) { removeTyping(); addMessage("Ошибка отправки данных.", 'bot'); }
}

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
            if (opt === "Начать заново") isWaitingForContact = false; 
            optionsArea.innerHTML = ''; 
            sendMessage(opt); 
        }; 
        optionsArea.appendChild(btn); 
    }); 
}

function showTyping() { 
    if (document.getElementById('typing-indicator')) return; 
    const div = document.createElement('div'); 
    div.classList.add('typing-indicator'); 
    div.id = 'typing-indicator'; 
    div.innerHTML = '<span></span><span></span><span></span>'; 
    messagesArea.appendChild(div); 
    messagesArea.scrollTop = messagesArea.scrollHeight; 
}

function removeTyping() { 
    const t = document.getElementById('typing-indicator'); 
    if (t) t.remove(); 
}

window.buyProduct = buyProduct;
