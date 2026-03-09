process.noDeprecation = true; // Скрываем надоедливую ошибку punycode ядра Node.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const DiscordRPC = require('discord-rpc');

let mainWindow;
let rpcClient = null;
let currentClientId = null;
let startTimestamp = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 750,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#f4f6f8',
        icon: path.join(__dirname, 'build', 'icon.ico'),
        title: 'Fast RPC'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Получить запущенные процессы с окнами
ipcMain.handle('get-processes', async () => {
    return new Promise((resolve) => {
        // Скрываем системные процессы и программы без окна
        const script = `Get-Process | Where-Object {$_.MainWindowTitle -ne '' -and $_.Name -ne 'ApplicationFrameHost'} | Select-Object Name, MainWindowTitle, Id | ConvertTo-Json`;
        exec(`powershell -Command "${script}"`, (err, stdout) => {
            if (err) {
                resolve([]);
                return;
            }
            try {
                let processes = JSON.parse(stdout);
                if (!Array.isArray(processes)) processes = [processes];
                resolve(processes);
            } catch (e) {
                resolve([]);
            }
        });
    });
});

// Установить RPC активность
ipcMain.handle('set-rpc', async (event, config) => {
    try {
        const activity = {};
        if (config.details) activity.details = config.details;
        if (config.state) activity.state = config.state;
        if (config.largeImageKey) activity.largeImageKey = config.largeImageKey;
        if (config.largeImageText) activity.largeImageText = config.largeImageText;
        if (config.smallImageKey) activity.smallImageKey = config.smallImageKey;
        if (config.smallImageText) activity.smallImageText = config.smallImageText;

        activity.instance = false;

        // Обработка времени
        if (config.useTimestamp) {
            if (!startTimestamp) startTimestamp = new Date();
            activity.startTimestamp = startTimestamp;
        } else {
            startTimestamp = null;
        }

        // Кнопки
        let buttons = [];
        if (config.button1Label && config.button1Url) {
            buttons.push({
                label: String(config.button1Label).substring(0, 32),
                url: String(config.button1Url).substring(0, 512)
            });
        }
        if (config.button2Label && config.button2Url) {
            buttons.push({
                label: String(config.button2Label).substring(0, 32),
                url: String(config.button2Url).substring(0, 512)
            });
        }
        if (buttons.length > 0) {
            activity.buttons = buttons;
        }

        // Если клиент уже подключен и ID не изменился, просто обновляем
        if (rpcClient && currentClientId === config.clientId) {
            try {
                await rpcClient.setActivity(activity);
                return { success: true };
            } catch (err) {
                // Если ошибка обновления, продолжаем, чтобы попытаться переподключиться
                console.error("Set Activity Error:", err);
            }
        }

        // Уничтожаем старый клиент
        if (rpcClient) {
            try { rpcClient.destroy(); } catch (err) { }
        }

        // Создаем новое подключение
        currentClientId = config.clientId;
        rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

        return new Promise((resolve, reject) => {
            rpcClient.on('ready', () => {
                rpcClient.setActivity(activity).catch(console.error);
                resolve({ success: true });
            });

            rpcClient.login({ clientId: config.clientId }).catch(err => {
                let errorMsg = "Не удалось подключиться к Discord (Неверный ID?)";
                if (err && err.message && (err.message.includes('connection closed') || err.message.includes('Could not connect'))) {
                    errorMsg = "Ошибка подключения: Убедитесь, что Discord запущен на ПК!";
                } else if (err && err.message) {
                    errorMsg = "Ошибка: " + err.message;
                    console.error("RPC Login Error:", err);
                }

                rpcClient = null;
                currentClientId = null;
                resolve({ success: false, error: errorMsg });
            });
        });
    } catch (e) {
        console.error("Unhandled RPC Error:", e);
        return { success: false, error: e.message };
    }
});

// Остановка RPC
ipcMain.handle('stop-rpc', async () => {
    if (rpcClient) {
        try { rpcClient.clearActivity(); } catch (err) { }
        try { rpcClient.destroy(); } catch (err) { }
        rpcClient = null;
        currentClientId = null;
        startTimestamp = null;
    }
    return true;
});

// Настройки автозапуска
ipcMain.handle('get-autostart', () => {
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('toggle-autostart', (event, enable) => {
    app.setLoginItemSettings({
        openAtLogin: enable,
        path: app.getPath("exe"),
        args: ["--hidden"] // Если в будущем захотим запускать в трее
    });
    return true;
});
