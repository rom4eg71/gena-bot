const chatWidget = document.getElementById('chat-widget');
const chatBtn = document.getElementById('chat-widget-button');
const closeBtn = document.getElementById('close-chat');
const messagesArea = document.getElementById('chat-messages');
const optionsArea = document.getElementById('chat-options');
const inputField = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// Если скрипт лежит на том же сервере, оставляем пустую строку.
// Если виджет встраивается на worldbaits.ru, укажите URL вашего задеплоенного сервера:
const API_URL = window.location.hostname === 'localhost' ? '' : 'https://gena-bot-sthi.onrender.com';

const userId = "user_" + Math.random().toString(36).substr(2, 9);
let isChatInitialized = false;

chatBtn.addEventListener('click', () => {
    chatWidget.classList.remove('hidden');
    if (!isChatInitialized) {
        sendMessage("Привет");
        isChatInitialized = true;
    }
});
closeBtn.addEventListener('click', () => chatWidget.classList.add('hidden'));

sendBtn.addEventListener('click', () => sendMessage(inputField.value));
inputField.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(inputField.value); });

async function sendMessage(text) {
    if (!text.trim()) return;
    
    addMessage(text, 'user');
    inputField.value = '';
    optionsArea.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, text: text })
        });
        
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();

        setTimeout(() => {
            addMessage(data.text, 'bot');
            if (data.options && data.options.length > 0) {
                renderOptions(data.options);
            }
        }, 500);

    } catch (error) {
        console.error(error);
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
