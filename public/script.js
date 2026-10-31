const chatWidget = document.getElementById('chat-widget');
const chatBtn = document.getElementById('chat-widget-button');
const closeBtn = document.getElementById('close-chat');
const messagesArea = document.getElementById('chat-messages');
const optionsArea = document.getElementById('chat-options');
const inputField = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// ВАЖНО: Укажите адрес вашего сервера на Render
const API_URL = window.location.hostname === 'localhost' ? '' : 'https://gena-bot-sthi.onrender.com';

const userId = "user_" + Math.random().toString(36).substr(2, 9);
let isChatInitialized = false;

chatBtn.addEventListener('click', () => {
    chatWidget.classList.remove('hidden');
    if (!isChatInitialized) {
        // При открытии показываем "печатает" и потом приветствие
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

sendBtn.addEventListener('click', () => sendMessage(inputField.value));
inputField.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(inputField.value); });

async function sendMessage(text) {
    if (!text.trim()) return;
    
    addMessage(text, 'user');
    inputField.value = '';
    optionsArea.innerHTML = ''; // Очищаем кнопки
    showTyping(); // Показываем "Печатает..."

    try {
        const response = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, text: text })
        });
        
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();

        // Задержка для реалистичности (чтобы бот не отвечал мгновенно)
        setTimeout(() => {
            removeTyping();
            
            // Если пришли карточки товаров
            if (data.type === 'products') {
                addMessage(data.text, 'bot');
                renderProducts(data.products);
            } else {
                addMessage(data.text, 'bot');
            }

            if (data.options && data.options.length > 0) {
                renderOptions(data.options);
            }
        }, 1200); // 1.2 секунды бот "думает"

    } catch (error) {
        removeTyping();
        addMessage("Ошибка соединения. Проверьте сервер.", 'bot');
    }
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
                    <button class="buy-btn" onclick="alert('Товар добавлен в корзину!')">${p.action}</button>
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
        btn.onclick = () => sendMessage(opt);
        optionsArea.appendChild(btn);
    });
}

// Эффект "Печатает..."
function showTyping() {
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
