process.noDeprecation = true;

const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const DiscordRPC = require('discord-rpc');
const { autoUpdater } = require('electron-updater');

const LOGO_PATH = path.join(__dirname, 'logo', 'logo.png');

let mainWindow;
let tray;
let rpcClient = null;
let currentClientId = null;
let startTimestamp = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 750,
        minWidth: 850,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#f4f6f8',
        icon: LOGO_PATH,
        title: 'Fast RPC'
    });

    mainWindow.loadFile('index.html');

    mainWindow.webContents.once('did-finish-load', () => {
        // Проверка обновлений через 3 секунды после загрузки
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch(() => { });
        }, 3000);
    });
}

function createTray() {
    tray = new Tray(LOGO_PATH);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Fast RPC', enabled: false },
        { type: 'separator' },
        { label: 'Открыть', click: () => mainWindow && mainWindow.show() },
        {
            label: 'Остановить RPC', click: () => {
                if (rpcClient) {
                    try { rpcClient.clearActivity(); rpcClient.destroy(); } catch (e) { }
                    rpcClient = null; currentClientId = null; startTimestamp = null;
                    if (mainWindow) mainWindow.webContents.send('rpc-stopped-tray');
                }
            }
        },
        { type: 'separator' },
        { label: 'Выход', click: () => app.quit() }
    ]);
    tray.setToolTip('Fast RPC Manager');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow && mainWindow.show());
}

app.whenReady().then(() => {
    createWindow();
    createTray();
});

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

// ===== АВТО-ОБНОВЛЕНИЕ =====
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

autoUpdater.on('update-available', (info) => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '🚀 Доступно обновление!',
        message: `Вышла новая версия Fast RPC (v${info.version})!`,
        detail: 'Хотите скачать и установить обновление сейчас? Это займёт совсем немного времени.',
        buttons: ['Обновить', 'Потом'],
        defaultId: 0,
        cancelId: 1,
        icon: LOGO_PATH
    }).then(({ response }) => {
        if (response === 0) {
            if (mainWindow) mainWindow.webContents.send('update-message', '⬇️ Загружаем обновление...');
            autoUpdater.downloadUpdate().catch(err => {
                console.error('Download failed:', err);
                if (mainWindow) {
                    dialog.showErrorBox('Ошибка загрузки', `Не удалось загрузить обновление: ${err.message}`);
                }
            });
        }
    });
});

autoUpdater.on('update-not-available', () => {
    // Тихо, не показываем ничего — просто в консоль
    console.log('Обновлений нет, всё актуально.');
});

autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
        const percent = Math.round(progress.percent);
        mainWindow.setProgressBar(progress.percent / 100); // Прогресс в таскбаре!
        mainWindow.webContents.send('update-progress', percent);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
        mainWindow.setProgressBar(-1); // Убираем прогресс из таскбара
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '✅ Обновление готово!',
            message: `Fast RPC v${info.version} загружен!`,
            detail: 'Нажмите "Перезапустить", чтобы применить обновление прямо сейчас.',
            buttons: ['Перезапустить', 'Потом (при следующем запуске)'],
            defaultId: 0,
            icon: LOGO_PATH
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    }
});

autoUpdater.on('error', (err) => {
    console.error('Updater error:', err.message);
});
