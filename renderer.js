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

let currentProc = null;

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
    processList.innerHTML = '<div class="text-muted" style="padding: 16px;">Загрузка списка процессов...</div>';
    procSettings.style.display = 'none';
    currentProc = null;

    try {
        const processes = await ipcRenderer.invoke('get-processes');
        processList.innerHTML = '';

        if (processes.length === 0) {
            processList.innerHTML = '<div class="text-muted" style="padding: 16px;">Не найдено запущенных окон приложения.</div>';
            return;
        }

        processes.forEach(proc => {
            const el = document.createElement('div');
            el.className = 'process-item';
            el.innerHTML = `
                <div>
                    <div class="proc-name">${proc.Name}</div>
                    <div class="proc-title" title="${proc.MainWindowTitle || ''}">${proc.MainWindowTitle || 'Окно без названия'}</div>
                </div>
                <div class="proc-id">PID: ${proc.Id}</div>
            `;
            el.addEventListener('click', () => selectProcess(proc, el));
            processList.appendChild(el);
        });
    } catch (e) {
        processList.innerHTML = '<div class="text-muted" style="color:var(--danger); padding: 16px;">Ошибка загрузки окон</div>';
    }
}

function selectProcess(proc, element) {
    document.querySelectorAll('.process-item').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

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
    const config = {
        clientId: document.getElementById('proc-client-id').value || '1131976092524458054',
        details: document.getElementById('proc-details').value,
        state: document.getElementById('proc-state').value,
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
    await ipcRenderer.invoke('stop-rpc');

    btnStartProc.textContent = 'Запустить RPC';
    btnStartCustom.textContent = '🔥 Установить Кастомный Статус';
    updateStatusUI(false);
    showToast('RPC Остановлено');
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


// Инициализация
async function initSettings() {
    const autosave = localStorage.getItem('fastrpc_autosave');
    if (autosave !== null) autosaveCheck.checked = autosave === 'true';
    if (autosaveCheck.checked) loadCustomInputs();

    const isAutostart = await ipcRenderer.invoke('get-autostart');
    autostartCheck.checked = isAutostart;
}

initSettings();
loadProcesses();
