/**
 * rpc-worker.js — Отдельный процесс, который держит Discord RPC соединение живым.
 * Запускается как дочерний процесс (child_process.spawn) из main.js.
 * Получает команды через stdin в формате JSON, отвечает через stdout.
 */
process.noDeprecation = true;

const DiscordRPC = require('discord-rpc');
const WebSocket = require('ws');

let rpcClient = null;
let currentClientId = null;
let startTimestamp = null;
let isConnected = false;

// Discord WebSocket для чтения текущего presence
let discordWs = null;
let discordToken = null;
let currentPresence = null;

function send(type, data = {}) {
    const msg = JSON.stringify({ type, ...data });
    process.stdout.write(msg + '\n');
}

// Глобальное логирование ошибок
process.on('uncaughtException', (err) => {
    // Не отправляем в stdout, чтобы не ломать JSON протокол, если это не критично
});

process.on('unhandledRejection', (reason) => {
    // Аналогично
});

function updateConnectionStatus() {
    send('connection-status', { connected: isConnected });
}

// Подключение к Discord WebSocket для чтения presence
async function connectToDiscordWebSocket() {
    if (discordWs && discordWs.readyState === WebSocket.OPEN) return;

    try {
        // Пробуем подключиться к локальному Discord WebSocket
        const wsUrl = 'ws://127.0.0.1:6463/';
        discordWs = new WebSocket(wsUrl);

        discordWs.on('open', () => {
            console.log('[Discord WS] Connected');
            // Отправляем команду для аутентификации
            discordWs.send(JSON.stringify({
                cmd: 'DISPATCH',
                args: {
                    cmd: 'SET_ACTIVITY',
                    args: { pid: process.pid }
                }
            }));
        });

        discordWs.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.cmd === 'DISPATCH' && message.evt === 'PRESENCE_UPDATE') {
                    currentPresence = message.data;
                    send('presence-update', { presence: currentPresence });
                }
            } catch (e) { }
        });

        discordWs.on('close', () => {
            console.log('[Discord WS] Closed');
            discordWs = null;
        });

        discordWs.on('error', (err) => {
            console.log('[Discord WS] Error:', err.message);
            discordWs = null;
        });
    } catch (e) {
        console.log('[Discord WS] Connect error:', e.message);
    }
}

// Получение текущего presence из Discord
async function getCurrentPresence() {
    return new Promise((resolve) => {
        if (currentPresence) {
            resolve({ success: true, presence: currentPresence });
        } else {
            // Пробуем подключиться и подождать данные
            connectToDiscordWebSocket();
            setTimeout(() => {
                if (currentPresence) {
                    resolve({ success: true, presence: currentPresence });
                } else {
                    resolve({ success: false, error: 'Нет активного RPC presence' });
                }
            }, 2000);
        }
    });
}

async function startRpc(config) {
    try {
        // Валидация: нужен хотя бы clientId
        if (!config.clientId) {
            send('error', { message: 'Client ID обязателен!' });
            return;
        }

        // Валидация: если нет details, state и изображений — процесс не даёт RPC данные
        if (!config.details && !config.state && !config.largeImageKey && !config.smallImageKey) {
            send('error', { message: 'Процесс не предоставляет RPC данные. Заполните Details, State или добавьте изображения.' });
            return;
        }

        const activity = {};
        if (config.details) activity.details = config.details;
        if (config.state) activity.state = config.state;
        if (config.largeImageKey) activity.largeImageKey = config.largeImageKey;
        if (config.largeImageText) activity.largeImageText = config.largeImageText;
        if (config.smallImageKey) activity.smallImageKey = config.smallImageKey;
        if (config.smallImageText) activity.smallImageText = config.smallImageText;
        activity.instance = false;

        if (config.useTimestamp) {
            if (!startTimestamp) startTimestamp = new Date();
            activity.startTimestamp = startTimestamp;
        } else {
            startTimestamp = null;
        }

        let buttons = [];
        if (config.button1Label && config.button1Url) {
            buttons.push({ label: String(config.button1Label).substring(0, 32), url: String(config.button1Url).substring(0, 512) });
        }
        if (config.button2Label && config.button2Url) {
            buttons.push({ label: String(config.button2Label).substring(0, 32), url: String(config.button2Url).substring(0, 512) });
        }
        if (buttons.length > 0) activity.buttons = buttons;

        // Если клиент уже есть и ID тот же — просто обновляем активность
        if (rpcClient && currentClientId === config.clientId) {
            await rpcClient.setActivity(activity);
            send('ok');
            return;
        }

        // Иначе — пересоздаём подключение
        if (rpcClient) {
            try { rpcClient.destroy(); } catch (e) { }
            isConnected = false;
            updateConnectionStatus();
        }

        currentClientId = config.clientId;
        rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

        try {
            await new Promise((resolve, reject) => {
                const loginTimeout = setTimeout(() => {
                    if (rpcClient) {
                        try { rpcClient.destroy(); } catch (e) {}
                        rpcClient = null;
                    }
                    reject(new Error('Превышено время ожидания подключения к Discord (30 сек). Проверьте, запущен ли Discord.'));
                }, 30000);

                rpcClient.on('ready', () => {
                    clearTimeout(loginTimeout);
                    isConnected = true;
                    updateConnectionStatus();
                    
                    rpcClient.setActivity(activity).then(() => {
                        send('ok');
                    }).catch((e) => {
                        send('error', { message: 'Ошибка установки статуса: ' + e.message });
                    });
                    resolve();
                });

                rpcClient.on('error', (err) => {
                    // Внутренняя ошибка клиента
                });

                rpcClient.login({ clientId: config.clientId }).catch(err => {
                    clearTimeout(loginTimeout);
                    currentClientId = null;
                    isConnected = false;
                    updateConnectionStatus();
                    let msg = 'Не удалось подключиться к Discord.';
                    if (err.message && err.message.includes('connection closed')) {
                        msg = 'Ошибка: Discord не запущен на ПК!';
                    }
                    reject(new Error(msg));
                });
            });
        } catch (err) {
            send('error', { message: err.message });
            return;
        }
    } catch (e) {
        send('error', { message: e.message });
    }
}

function stopRpc() {
    if (rpcClient) {
        try { rpcClient.clearActivity(); } catch (e) { }
        try { rpcClient.destroy(); } catch (e) { }
        rpcClient = null;
        currentClientId = null;
        startTimestamp = null;
        isConnected = false;
        updateConnectionStatus();
    }
    send('stopped');
}

// Чтение команд из stdin
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    const data = chunk.toString();
    buffer += data;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const cmd = JSON.parse(trimmed);
            if (cmd.type === 'start') {
                startRpc(cmd.config);
            } else if (cmd.type === 'stop') {
                stopRpc();
            } else if (cmd.type === 'ping') {
                send('pong');
            } else if (cmd.type === 'exit') {
                process.exit(0);
            }
        } catch (e) { 
            send('error', { message: 'JSON Parse Error: ' + e.message });
        }
    }
});

// Сигнализируем что воркер готов
send('ready');
