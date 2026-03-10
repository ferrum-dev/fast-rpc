process.noDeprecation = true;

const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, Notification, nativeImage } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Задаём уникальный ID приложения для Windows — без него иконка в таскбаре может не подхватиться
app.setAppUserModelId('com.ferrum.fastrpc');

const LOGO_PATH = path.join(__dirname, 'logo', 'logo.png');

// Создаём nativeImage из PNG — Electron сам конвертирует в нужный формат для Windows
const APP_ICON = nativeImage.createFromPath(LOGO_PATH);

let mainWindow;
let tray;
let rpcWorker = null;
let rpcActive = false;

// ===== RPC WORKER (ОТДЕЛЬНЫЙ ПРОЦЕСС) =====

function startWorker() {
    if (rpcWorker) return; // Уже запущен

    rpcWorker = spawn(process.execPath, [path.join(__dirname, 'rpc-worker.js')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
    });

    let outBuffer = '';

    rpcWorker.stdout.on('data', (chunk) => {
        outBuffer += chunk.toString();
        const lines = outBuffer.split('\n');
        outBuffer = lines.pop();

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                handleWorkerMessage(msg);
            } catch (e) { }
        }
    });

    rpcWorker.stderr.on('data', (d) => console.error('[Worker]', d.toString()));
    rpcWorker.on('exit', () => {
        console.log('RPC Worker exited');
        rpcWorker = null;
        rpcActive = false;
    });
}

function sendWorker(data) {
    if (rpcWorker && rpcWorker.stdin.writable) {
        rpcWorker.stdin.write(JSON.stringify(data) + '\n');
    }
}

function killWorker() {
    if (rpcWorker) {
        sendWorker({ type: 'exit' });
        setTimeout(() => {
            if (rpcWorker) { rpcWorker.kill(); rpcWorker = null; }
        }, 500);
        rpcActive = false;
    }
}

function handleWorkerMessage(msg) {
    if (!msg) return;
    if (msg.type === 'ok') {
        rpcActive = true;
        if (mainWindow) mainWindow.webContents.send('rpc-status', { active: true });
    } else if (msg.type === 'error') {
        rpcActive = false;
        if (mainWindow) mainWindow.webContents.send('rpc-status', { active: false, error: msg.message });
    } else if (msg.type === 'stopped') {
        rpcActive = false;
        if (mainWindow) mainWindow.webContents.send('rpc-status', { active: false });
    }
    
    // Обработка ответа для set-rpc
    if (rpcResponseHandler) {
        rpcResponseHandler(msg);
    }
    
    // Обновляем трей
    if (msg.type === 'ok' || msg.type === 'stopped' || msg.type === 'error') {
        ipcMain.emit('rpc-status-changed');
    }
}

// ===== MAIN WINDOW =====

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
        icon: APP_ICON,
        title: 'Fast RPC'
    });

    mainWindow.loadFile('index.html');

    // Закрытие по крестику = сворачиваем в трей
    mainWindow.on('close', (e) => {
        if (!app.isQuiting) {
            e.preventDefault();
            mainWindow.hide();

            // Windows уведомление
            if (Notification.isSupported()) {
                const notif = new Notification({
                    title: 'Fast RPC работает в фоне',
                    body: rpcActive
                        ? '🟢 RPC активен! Нажмите, чтобы управлять.'
                        : '💤 Нажмите, чтобы открыть приложение.',
                    icon: LOGO_PATH,
                    silent: false
                });

                notif.on('click', () => {
                    if (rpcActive) {
                        // Спрашиваем что делать
                        dialog.showMessageBox({
                            type: 'question',
                            title: 'Fast RPC',
                            message: 'RPC активен в фоне!',
                            detail: 'Что вы хотите сделать?',
                            buttons: ['Открыть приложение', 'Остановить RPC и выйти', 'Оставить в фоне'],
                            defaultId: 0,
                            icon: LOGO_PATH
                        }).then(({ response }) => {
                            if (response === 0) {
                                mainWindow.show();
                            } else if (response === 1) {
                                app.isQuiting = true;
                                killWorker();
                                app.quit();
                            }
                            // 2 = Оставить в фоне, ничего не делаем
                        });
                    } else {
                        mainWindow.show();
                    }
                });

                notif.show();
            }
        }
    });

    mainWindow.webContents.once('did-finish-load', () => {
        // Передаём текущее состояние RPC при открытии окна
        mainWindow.webContents.send('rpc-status', { active: rpcActive });

        setTimeout(() => {
            autoUpdater.checkForUpdates().catch(() => { });
        }, 3000);
    });
}

// ===== TRAY =====

function createTray() {
    tray = new Tray(APP_ICON);

    const updateMenu = () => {
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Fast RPC Manager', enabled: false },
            { type: 'separator' },
            {
                label: rpcActive ? '🟢 RPC Активен' : '⚪ RPC Неактивен',
                enabled: false
            },
            { type: 'separator' },
            {
                label: 'Открыть',
                click: () => { mainWindow && mainWindow.show(); }
            },
            {
                label: 'Остановить RPC',
                enabled: rpcActive,
                click: () => {
                    sendWorker({ type: 'stop' });
                }
            },
            { type: 'separator' },
            {
                label: 'Выход',
                click: () => {
                    app.isQuiting = true;
                    killWorker();
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);
    };

    tray.setToolTip('Fast RPC Manager');
    tray.on('double-click', () => mainWindow && mainWindow.show());
    updateMenu();

    // Обновляем трей-меню при смене статуса RPC
    ipcMain.on('rpc-status-changed', () => updateMenu());
}

// ===== APP INIT =====

app.whenReady().then(() => {
    startWorker(); // Стартуем воркер сразу при запуске приложения
    createWindow();
    createTray();
});

app.on('window-all-closed', (e) => {
    // НЕ выходим — мы висим в трее
});

app.on('before-quit', () => {
    app.isQuiting = true;
});

// ===== IPC HANDLERS =====

ipcMain.handle('get-processes', async () => {
    return new Promise((resolve) => {
        const script = `Get-Process | Where-Object {$_.MainWindowTitle -ne '' -and $_.Name -ne 'ApplicationFrameHost'} | Select-Object Name, MainWindowTitle, Id | ConvertTo-Json`;
        exec(`powershell -Command "${script}"`, (err, stdout) => {
            if (err) { resolve([]); return; }
            try {
                let processes = JSON.parse(stdout);
                if (!Array.isArray(processes)) processes = [processes];
                resolve(processes);
            } catch (e) { resolve([]); }
        });
    });
});

// Запуск/обновление RPC — делегируем воркеру
let rpcResponseHandler = null;

ipcMain.handle('set-rpc', async (event, config) => {
    startWorker(); // На случай если воркер упал
    
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            rpcResponseHandler = null;
            resolve({ success: false, error: 'Время ожидания истекло. Попробуйте ещё раз.' });
        }, 30000);

        // Устанавливаем обработчик для одного ответа
        rpcResponseHandler = (msg) => {
            if (msg.type === 'ok' || msg.type === 'error') {
                clearTimeout(timeout);
                rpcResponseHandler = null;
                if (msg.type === 'ok') resolve({ success: true });
                else resolve({ success: false, error: msg.message });
            }
        };

        sendWorker({ type: 'start', config });
    });
});

ipcMain.handle('stop-rpc', async () => {
    sendWorker({ type: 'stop' });
    return true;
});

ipcMain.handle('get-autostart', () => {
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('toggle-autostart', (event, enable) => {
    app.setLoginItemSettings({
        openAtLogin: enable,
        path: app.getPath("exe"),
        args: []
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
        title: 'Доступно обновление!',
        message: `Вышла новая версия Fast RPC (v${info.version})!`,
        detail: 'Хотите скачать и установить обновление сейчас?',
        buttons: ['Обновить', 'Потом'],
        defaultId: 0,
        cancelId: 1,
        icon: LOGO_PATH
    }).then(({ response }) => {
        if (response === 0) {
            if (mainWindow) mainWindow.webContents.send('update-message', 'Загружаем обновление...');
            autoUpdater.downloadUpdate().catch(err => {
                console.error('Download failed:', err);
                if (mainWindow) dialog.showErrorBox('Ошибка загрузки', err.message);
            });
        }
    });
});

autoUpdater.on('update-not-available', () => {
    console.log('Нет обновлений.');
});

autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
        mainWindow.setProgressBar(progress.percent / 100);
        mainWindow.webContents.send('update-progress', Math.round(progress.percent));
    }
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
        mainWindow.setProgressBar(-1);
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Обновление готово!',
            message: `Fast RPC v${info.version} загружен!`,
            detail: 'Перезапустить сейчас?',
            buttons: ['Перезапустить', 'Потом'],
            defaultId: 0,
            icon: LOGO_PATH
        }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall();
        });
    }
});

autoUpdater.on('error', (err) => {
    console.error('Updater error:', err.message);
});
