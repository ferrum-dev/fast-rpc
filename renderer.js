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
    btnStartCustom.textContent = 'Запустить Кастомный RPC';
    updateStatusUI(false);
    showToast('RPC Остановлено');
});

// Инициализация
loadProcesses();
