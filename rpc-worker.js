/**
 * rpc-worker.js — Отдельный процесс, который держит Discord RPC соединение живым.
 * Запускается как дочерний процесс (child_process.spawn) из main.js.
 * Получает команды через stdin в формате JSON, отвечает через stdout.
 */
process.noDeprecation = true;

const DiscordRPC = require('discord-rpc');

let rpcClient = null;
let currentClientId = null;
let startTimestamp = null;

function send(type, data = {}) {
    process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
}

async function startRpc(config) {
    try {
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
        }

        currentClientId = config.clientId;
        rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

        await new Promise((resolve, reject) => {
            rpcClient.on('ready', () => {
                rpcClient.setActivity(activity).catch(() => { });
                resolve();
            });
            rpcClient.login({ clientId: config.clientId }).catch(err => {
                rpcClient = null;
                currentClientId = null;
                let msg = 'Не удалось подключиться к Discord.';
                if (err.message && err.message.includes('connection closed')) {
                    msg = 'Ошибка: Discord не запущен на ПК!';
                }
                reject(new Error(msg));
            });
        });

        send('ok');
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
    }
    send('stopped');
}

// Чтение команд из stdin
let buffer = '';
process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Последняя строка может быть неполной

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const cmd = JSON.parse(trimmed);
            if (cmd.type === 'start') startRpc(cmd.config);
            else if (cmd.type === 'stop') stopRpc();
            else if (cmd.type === 'ping') send('pong');
            else if (cmd.type === 'exit') process.exit(0);
        } catch (e) { }
    }
});

// Сигнализируем что воркер готов
send('ready');
