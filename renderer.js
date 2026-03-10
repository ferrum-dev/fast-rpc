const { ipcRenderer } = require('electron');

// DOM Элементы
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const processList = document.getElementById('process-list');
const btnRefresh = document.getElementById('btn-refresh-proc');
const procSettings = document.getElementById('process-settings');
const procNameSpan = document.getElementById('selected-proc-name');
const btnStartProc = document.getElementById('btn-start-proc');
const btnStartCustom = document.getElementById('btn-start-custom');
const btnStop = document.getElementById('btn-stop-rpc');
const statusDot = document.getElementById('ds-dot');
const statusText = document.getElementById('ds-status-text');
const selectTheme = document.getElementById('setting-theme');
const selectLang = document.getElementById('setting-lang');

let currentProc = null;

// Локализация
const translations = {
    ru: {
        'ad-label': 'РЕКЛАМА',
        'ad-desc': 'Поставь звезду на GitHub!',
        'status-disconnected': 'Отключено',
        'btn-stop': 'Остановить RPC',
        'settings-appearance': 'Внешний вид',
        'settings-theme': 'Тема приложения',
        'theme-dark': 'Темная',
        'theme-light': 'Светлая',
        'theme-system': 'Системная',
        'settings-lang': 'Язык интерфейса',
        'settings-autostart-title': 'Запуск вместе с ПК'
    },
    en: {
        'ad-label': 'ADVERTISING',
        'ad-desc': 'Star us on GitHub!',
        'status-disconnected': 'Disconnected',
        'btn-stop': 'Stop RPC',
        'settings-appearance': 'Appearance',
        'settings-theme': 'App Theme',
        'theme-dark': 'Dark',
        'theme-light': 'Light',
        'theme-system': 'System',
        'settings-lang': 'Interface Language',
        'settings-autostart-title': 'Run at Startup'
    }
};

function applyLanguage(lang) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang] && translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });
}

// Тема
function applyTheme(theme) {
    if (theme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.toggle('dark-theme', isDark);
    } else {
        document.body.classList.toggle('dark-theme', theme === 'dark');
    }
}

selectTheme.addEventListener('change', (e) => {
    const theme = e.target.value;
    localStorage.setItem('fastrpc_theme', theme);
    applyTheme(theme);
});

selectLang.addEventListener('change', (e) => {
    const lang = e.target.value;
    localStorage.setItem('fastrpc_lang', lang);
    applyLanguage(lang);
});

// Уведомления
function showToast(message, type = 'success') {
    const area = document.getElementById('notifications');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    area.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-in reverse backwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Главный IPC: статус RPC от воркера
ipcRenderer.on('rpc-status', (event, { active, error }) => {
    updateStatusUI(active);
    if (error) showToast(error, 'error');
});

// Переключение на вкладку процессов из трея
ipcRenderer.on('switch-process', () => {
    // Сбрасываем текущий выбор и загружаем процессы заново
    document.querySelector('[data-tab="tab-process"]').click();
    loadProcesses();
    procSettings.style.display = 'none';
    currentProc = null;
});

// Обновления
ipcRenderer.on('update-message', (event, message) => {
    showToast(message, 'success');
});

ipcRenderer.on('update-progress', (event, percent) => {
    // Обновляем только последний тост, чтобы не спамить
    const area = document.getElementById('notifications');
    let existing = area.querySelector('.toast-progress');
    if (!existing) {
        existing = document.createElement('div');
        existing.className = 'toast toast-success toast-progress';
        area.appendChild(existing);
    }
    existing.innerHTML = `<span>Загружаем обновление: ${percent}%</span>`;
    if (percent >= 100) setTimeout(() => existing.remove(), 2000);
});

// Discord presence обновления
let currentDiscordPresence = null;

ipcRenderer.on('discord-presence', (event, presence) => {
    currentDiscordPresence = presence;
    updatePresenceUI();
});

ipcRenderer.on('discord-presence-result', (event, result) => {
    if (result.success && result.presence) {
        currentDiscordPresence = result.presence;
        updatePresenceUI();
    }
});

function updatePresenceUI() {
    const presenceEl = document.getElementById('current-presence-display');
    if (!presenceEl) return;

    if (currentDiscordPresence && currentDiscordPresence.activities && currentDiscordPresence.activities.length > 0) {
        const activity = currentDiscordPresence.activities[0];
        presenceEl.style.display = 'block';
        document.getElementById('presence-app-name').textContent = activity.name || 'Неизвестно';
        document.getElementById('presence-details').textContent = activity.details || '—';
        document.getElementById('presence-state').textContent = activity.state || '—';
    } else {
        presenceEl.style.display = 'none';
    }
}

// Вкладки
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(i => i.classList.remove('active'));
        tabContents.forEach(t => t.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.dataset.tab).classList.add('active');
    });
});

// Загрузка процессов
async function loadProcesses() {
    btnRefresh.disabled = true;
    const originalText = btnRefresh.textContent;
    btnRefresh.textContent = localStorage.getItem('fastrpc_lang') === 'en' ? 'Refreshing...' : 'Обновление...';
    
    processList.innerHTML = `<div class="text-muted" style="padding: 16px;">${localStorage.getItem('fastrpc_lang') === 'en' ? 'Loading process list...' : 'Загрузка списка процессов...'}</div>`;
    procSettings.style.display = 'none';
    currentProc = null;

    try {
        const processes = await ipcRenderer.invoke('get-processes');
        processList.innerHTML = '';

        if (processes.length === 0) {
            processList.innerHTML = `<div class="text-muted" style="padding: 16px;">${localStorage.getItem('fastrpc_lang') === 'en' ? 'No running application windows found.' : 'Не найдено запущенных окон приложения.'}</div>`;
            return;
        }

        processes.forEach(proc => {
            const el = document.createElement('div');
            el.className = 'process-item';
            el.innerHTML = `
                <div>
                    <div class="proc-name">${proc.Name}</div>
                    <div class="proc-title" title="${proc.MainWindowTitle || ''}">${proc.MainWindowTitle || (localStorage.getItem('fastrpc_lang') === 'en' ? 'Untitled window' : 'Окно без названия')}</div>
                </div>
                <div class="proc-id">PID: ${proc.Id}</div>
            `;
            el.addEventListener('click', () => selectProcess(proc, el));
            processList.appendChild(el);
        });
    } catch (e) {
        processList.innerHTML = `<div class="text-muted" style="color:var(--danger); padding: 16px;">${localStorage.getItem('fastrpc_lang') === 'en' ? 'Error loading windows' : 'Ошибка загрузки окон'}</div>`;
    } finally {
        btnRefresh.disabled = false;
        btnRefresh.textContent = originalText;
    }
}

function selectProcess(proc, element) {
    document.querySelectorAll('.process-item').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

    const result = confirm(`Отображать процесс "${proc.Name}" в Discord RPC?\n\nНажмите "OK" для подтверждения или "Отмена" для отказа.`);
    
    if (!result) {
        return;
    }

    currentProc = proc;
    procNameSpan.textContent = proc.Name;
    procSettings.style.display = 'block';

    document.getElementById('proc-details').value = `Играет в ${proc.Name}`;
    document.getElementById('proc-state').value = proc.MainWindowTitle || '';
}

btnRefresh.addEventListener('click', loadProcesses);

// Управление статусом
function updateStatusUI(active) {
    statusDot.className = `dot ${active ? 'connected' : ''}`;
    statusText.textContent = active ? 'RPC Активно' : 'Отключено';
    btnStop.disabled = !active;
}

// Запуск (Выбор процесса)
btnStartProc.addEventListener('click', async () => {
    console.log('[Renderer] Start RPC clicked (Process)');
    const details = document.getElementById('proc-details').value;
    const state = document.getElementById('proc-state').value;

    if (!currentProc) {
        showToast('Выберите процесс из списка!', 'error');
        return;
    }

    if (!details && !state) {
        showToast('Процесс не предоставляет RPC данные. Заполните Details или State.', 'error');
        return;
    }

    const config = {
        clientId: '1131976092524458054',
        details: details,
        state: state,
        useTimestamp: document.getElementById('proc-time').checked
    };

    btnStartProc.textContent = 'Запуск...';
    btnStartProc.disabled = true;

    const res = await ipcRenderer.invoke('set-rpc', config);

    btnStartProc.textContent = 'Обновить RPC';
    btnStartProc.disabled = false;

    if (res.success) {
        updateStatusUI(true);
        showToast('RPC успешно установлено для окна!');
    } else {
        showToast(res.error, 'error');
    }
});

// Запуск (Свой статус)
btnStartCustom.addEventListener('click', async () => {
    console.log('[Renderer] Start RPC clicked (Custom)');
    const config = {
        clientId: document.getElementById('custom-client-id').value,
        details: document.getElementById('custom-details').value,
        state: document.getElementById('custom-state').value,
        largeImageKey: document.getElementById('custom-large-img').value,
        largeImageText: document.getElementById('custom-large-text').value,
        smallImageKey: document.getElementById('custom-small-img').value,
        smallImageText: document.getElementById('custom-small-text').value,
        button1Label: document.getElementById('custom-btn1-lbl').value,
        button1Url: document.getElementById('custom-btn1-url').value,
        button2Label: document.getElementById('custom-btn2-lbl').value,
        button2Url: document.getElementById('custom-btn2-url').value,
        useTimestamp: document.getElementById('custom-time').checked
    };

    if (!config.clientId) {
        showToast('Discord Client ID обязателен!', 'error');
        return;
    }

    try {
        if (config.button1Url && !config.button1Url.startsWith('http://') && !config.button1Url.startsWith('https://')) {
            config.button1Url = 'https://' + config.button1Url;
        }
        if (config.button2Url && !config.button2Url.startsWith('http://') && !config.button2Url.startsWith('https://')) {
            config.button2Url = 'https://' + config.button2Url;
        }
    } catch (e) { }

    btnStartCustom.textContent = 'Обновление...';
    btnStartCustom.disabled = true;

    const res = await ipcRenderer.invoke('set-rpc', config);

    btnStartCustom.textContent = 'Обновить Кастомный RPC';
    btnStartCustom.disabled = false;

    if (res.success) {
        updateStatusUI(true);
        showToast('Свой статус успешно установлен!');
    } else {
        showToast(res.error, 'error');
    }
});

// Остановка
btnStop.addEventListener('click', async () => {
    btnStop.disabled = true;
    const originalText = btnStop.innerHTML;
    btnStop.innerHTML = localStorage.getItem('fastrpc_lang') === 'en' ? 'Stopping...' : 'Остановка...';
    
    try {
        await ipcRenderer.invoke('stop-rpc');
        btnStartProc.textContent = localStorage.getItem('fastrpc_lang') === 'en' ? 'Start RPC' : 'Запустить RPC';
        btnStartCustom.textContent = localStorage.getItem('fastrpc_lang') === 'en' ? 'Set Custom Status' : '🔥 Установить Кастомный Статус';
        updateStatusUI(false);
        showToast(localStorage.getItem('fastrpc_lang') === 'en' ? 'RPC Stopped' : 'RPC Остановлено');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btnStop.disabled = false;
        btnStop.innerHTML = originalText;
    }
});

// Сохранение и Загрузка данных (Настройки)
const autostartCheck = document.getElementById('setting-autostart');
const autosaveCheck = document.getElementById('setting-autosave');

const customInputs = [
    'custom-client-id', 'custom-details', 'custom-state',
    'custom-large-img', 'custom-large-text', 'custom-small-img', 'custom-small-text',
    'custom-btn1-lbl', 'custom-btn1-url', 'custom-btn2-lbl', 'custom-btn2-url'
];

function saveCustomInputs() {
    if (!autosaveCheck.checked) return;
    const data = {};
    customInputs.forEach(id => {
        data[id] = document.getElementById(id).value;
    });
    data['custom-time'] = document.getElementById('custom-time').checked;
    localStorage.setItem('fastrpc_custom', JSON.stringify(data));
}

function loadCustomInputs() {
    const saved = localStorage.getItem('fastrpc_custom');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            customInputs.forEach(id => {
                if (data[id] !== undefined) document.getElementById(id).value = data[id];
            });
            if (data['custom-time'] !== undefined) document.getElementById('custom-time').checked = data['custom-time'];
        } catch (e) { }
    }
}

// Слушатели настроек
autosaveCheck.addEventListener('change', (e) => {
    localStorage.setItem('fastrpc_autosave', e.target.checked);
    if (e.target.checked) saveCustomInputs();
    else localStorage.removeItem('fastrpc_custom');
});

autostartCheck.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('toggle-autostart', e.target.checked);
    showToast(e.target.checked ? 'Автозапуск включен' : 'Автозапуск выключен');
});

customInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', saveCustomInputs);
});
document.getElementById('custom-time').addEventListener('change', saveCustomInputs);

// Тема
function applyTheme(theme) {
    if (theme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.toggle('dark-theme', isDark);
    } else {
        document.body.classList.toggle('dark-theme', theme === 'dark');
    }
}

// Удаляем старый код управления темой
function toggleTheme() {}
function updateThemeIcons(isDark) {}

// Инициализация
async function initSettings() {
    const savedTheme = localStorage.getItem('fastrpc_theme') || 'dark';
    const savedLang = localStorage.getItem('fastrpc_lang') || 'ru';

    const selectTheme = document.getElementById('setting-theme');
    const selectLang = document.getElementById('setting-lang');

    if (selectTheme) {
        selectTheme.value = savedTheme;
        selectTheme.addEventListener('change', (e) => {
            const theme = e.target.value;
            localStorage.setItem('fastrpc_theme', theme);
            applyTheme(theme);
        });
    }

    if (selectLang) {
        selectLang.value = savedLang;
        selectLang.addEventListener('change', (e) => {
            const lang = e.target.value;
            localStorage.setItem('fastrpc_lang', lang);
            applyLanguage(lang);
        });
    }
    
    applyTheme(savedTheme);
    applyLanguage(savedLang);

    const autosave = localStorage.getItem('fastrpc_autosave');
    const autosaveCheck = document.getElementById('setting-autosave');
    if (autosaveCheck) {
        if (autosave !== null) autosaveCheck.checked = autosave === 'true';
        if (autosaveCheck.checked) loadCustomInputs();
    }

    const autostartCheck = document.getElementById('setting-autostart');
    if (autostartCheck) {
        const isAutostart = await ipcRenderer.invoke('get-autostart');
        autostartCheck.checked = isAutostart;
    }
}

initSettings();
loadProcesses();

// Кнопка перехвата RPC
const btnInterceptRpc = document.getElementById('btn-intercept-rpc');
if (btnInterceptRpc) {
    btnInterceptRpc.addEventListener('click', async () => {
        btnInterceptRpc.textContent = 'Запрос...';
        btnInterceptRpc.disabled = true;

        const result = await ipcRenderer.invoke('get-current-rpc');

        btnInterceptRpc.textContent = 'Перехватить';
        btnInterceptRpc.disabled = false;

        if (result.success && result.presence) {
            showToast('RPC перехвачен! Данные загружены.', 'success');
        } else {
            showToast(result.error || 'Не удалось перехватить RPC', 'error');
        }
    });
}
