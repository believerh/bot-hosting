const CYPHERX_CONFIG = {
    paystackPublicKey: 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    apiBaseUrl: '/api',
    coinsPerDeployment: 10,
    coinsPerDayPerBot: 5,
    currency: 'KES',
    country: 'kenya',
    paymentMode: 'popup'
};

const CypherXPaystack = {
    isLoaded: false,
    isOpen: false,

    loadScript() {
        return new Promise((resolve, reject) => {
            if (this.isLoaded) return resolve();
            if (window.PaystackPop) return resolve();
            const script = document.createElement('script');
            script.src = 'https://js.paystack.co/v1/inline.js';
            script.onload = () => { this.isLoaded = true; resolve(); };
            script.onerror = () => reject(new Error('Failed to load Paystack'));
            document.head.appendChild(script);
        });
    },

    async initiatePayment(currency, amount, metadata = {}) {
        await this.loadScript();
        const email = metadata.email || 'user@cypherx.example';
        const ref = `CypherX-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        try {
            const result = await apiCall('/api/payments/paystack-initiate', {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    amount,
                    currency,
                    reference: ref,
                    metadata: { ...metadata, source: 'paystack-popup' }
                })
            });
            if (!result.success) throw new Error(result.error || 'Failed to initialize payment');
            const tx = await this.openPopup({
                key: CYPHERX_CONFIG.paystackPublicKey,
                email,
                amount: result.amount || amount,
                currency: result.currency || currency,
                ref: result.reference || ref,
                access_code: result.access_code,
                metadata: { ...metadata, source: 'paystack-popup' }
            });
            const verified = await this.verifyTransaction(result.reference || ref);
            return { status: 'success', transaction: tx, verified };
        } catch (error) {
            console.error('Paystack initiate error:', error);
            throw error;
        }
    },

    openPopup({ key, email, amount, currency, ref, access_code, metadata = {} }) {
        return new Promise((resolve, reject) => {
            if (!window.PaystackPop) return reject(new Error('Paystack not loaded'));
            this.isOpen = true;
            const handler = window.PaystackPop.setup({
                key,
                email,
                amount,
                currency,
                ref,
                access_code,
                metadata,
                onSuccess(transaction) {
                    CypherXPaystack.isOpen = false;
                    resolve(transaction);
                },
                onCancel() {
                    CypherXPaystack.isOpen = false;
                    reject(new Error('Payment cancelled by user'));
                },
                onError(error) {
                    CypherXPaystack.isOpen = false;
                    reject(new Error(error || 'Payment failed'));
                }
            });
            handler.openIframe();
        });
    },

    async verifyTransaction(reference) {
        try {
            const result = await apiCall('/api/payments/paystack-verify', {
                method: 'POST',
                body: JSON.stringify({ reference })
            });
            return result;
        } catch (error) {
            console.error('Paystack verify error:', error);
            return { success: false, error: error.message };
        }
    }
};

document.addEventListener('DOMContentLoaded', function() {
    console.log('CypherX Bot Platform loaded successfully!');
    initTooltips();
    enhanceForms();
    initializeGlobalSearch();
});

let currentConfigBotId = null;
let currentExplorerBotId = null;
let currentFilePath = '';

async function showPortManagement(botId, botName, currentPort) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h2>Port Management - ${botName}</h2>
            <div class="port-management-form">
                <div class="form-group">
                    <label for="port-input">Port Number (1024-65535):</label>
                    <input type="number" id="port-input" min="1024" max="65535" value="${currentPort}" class="form-control">
                    <small class="form-help">Current port: ${currentPort}</small>
                </div>
                <div class="port-actions">
                    <button onclick="updateBotPort(${botId}, '${botName}')" class="btn btn-primary">Update Port</button>
                    <button onclick="this.closest('.modal').remove()" class="btn btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function updateBotPort(botId, botName) {
    const portInput = document.getElementById('port-input');
    const newPort = parseInt(portInput.value);
    
    if (isNaN(newPort) || newPort < 1024 || newPort > 65535) {
        showNotification('Invalid port number. Must be between 1024 and 65535.', 'error');
        return;
    }

    try {
        showNotification('Updating port...', 'info');
        
        const result = await apiCall(`/api/deploy/${botId}/port`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ newPort: newPort })
        });

        if (result && result.success) {
            showNotification(`Port changed to ${newPort}. Bot restarted successfully.`, 'success');
            document.querySelector('.modal').remove();
            loadBots();
            setTimeout(() => {
                viewBot(botId); 
            }, 1000);
        } else {
            throw new Error(result?.error || 'Failed to update port');
        }
    } catch (error) {
        console.error('Port update error:', error);
        showNotification('Error changing port: ' + (error.message || 'Unknown error'), 'error');
    }
}

function closeBotModal() {
    const modal = document.getElementById('bot-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function createNewFile() {
    const fileName = prompt('Enter file name:');
    if (!fileName) return;

    try {
        const filePath = currentFilePath ? `${currentFilePath}/${fileName}` : fileName;
        
        const result = await apiCall(`/api/deploy/${currentExplorerBotId}/files`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: filePath,
                isDirectory: false
            })
        });

        if (result.success) {
            showNotification('File created successfully!', 'success');
            refreshFileList();
        }
    } catch (error) {
        showNotification('Error creating file: ' + error.message, 'error');
    }
}

async function createNewFolder() {
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;

    try {
        const folderPath = currentFilePath ? `${currentFilePath}/${folderName}` : folderName;
        
        const result = await apiCall(`/api/deploy/${currentExplorerBotId}/files`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: folderPath,
                isDirectory: true
            })
        });

        if (result.success) {
            showNotification('Folder created successfully!', 'success');
            refreshFileList();
        }
    } catch (error) {
        showNotification('Error creating folder: ' + error.message, 'error');
    }
}

let deferredPrompt;
let pwaInstallContainer;

function initPWA() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then((registration) => {
                    console.log('SW registered: ', registration);
                })
                .catch((registrationError) => {
                    console.log('SW registration failed: ', registrationError);
                });
        });
    }

    pwaInstallContainer = document.createElement('div');
    pwaInstallContainer.className = 'pwa-install-container';
    pwaInstallContainer.innerHTML = `
        <button class="pwa-install-btn" onclick="installPWA()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            Install App
        </button>
    `;
    pwaInstallContainer.style.display = 'none';
    document.body.appendChild(pwaInstallContainer);

    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('PWA install prompt available');
        e.preventDefault();
        deferredPrompt = e;
        showPWAInstallButton();
    });
    
    window.addEventListener('appinstalled', (e) => {
        console.log('PWA was installed');
        hidePWAInstallButton();
        showNotification('App installed successfully!', 'success');
        deferredPrompt = null;
    });
    
    if (window.matchMedia('(display-mode: standalone)').matches || 
        window.navigator.standalone === true) {
        console.log('PWA is running in standalone mode');
        hidePWAInstallButton();
    }

    const isIos = () => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod/.test(userAgent);
    };
    
    const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);
    
    if (isIos() && !isInStandaloneMode()) {
        setTimeout(() => {
            if (!deferredPrompt) {
                showIOSInstallPrompt();
            }
        }, 3000);
    }
}

function showIOSInstallPrompt() {
    const iosPrompt = document.createElement('div');
    iosPrompt.className = 'ios-install-prompt';
    iosPrompt.innerHTML = `
        <div class="ios-prompt-content">
            <h3>Install CypherX App</h3>
            <p>Tap the share button <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg> and then "Add to Home Screen"</p>
            <button onclick="this.parentElement.parentElement.remove()">Got it</button>
        </div>
    `;
    document.body.appendChild(iosPrompt);
    
    setTimeout(() => {
        if (iosPrompt.parentElement) {
            iosPrompt.remove();
        }
    }, 10000);
}

function showPWAInstallButton() {
    if (pwaInstallContainer) {
        pwaInstallContainer.style.display = 'block';
    }
}

function hidePWAInstallButton() {
    if (pwaInstallContainer) {
        pwaInstallContainer.style.display = 'none';
    }
}

async function installPWA() {
    if (!deferredPrompt) {
        showNotification('PWA install not available', 'info');
        return;
    }

    deferredPrompt.prompt();
    
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
        console.log('User accepted the PWA install prompt');
        showNotification('Installing app...', 'info');
    } else {
        console.log('User dismissed the PWA install prompt');
    }

    deferredPrompt = null;
    hidePWAInstallButton();
}

async function deleteItem(itemPath, isDirectory) {
    const itemType = isDirectory ? 'folder' : 'file';
    if (!confirm(`Are you sure you want to delete this ${itemType}? This action cannot be undone.`)) {
        return;
    }

    try {
        const result = await apiCall(`/api/deploy/${currentExplorerBotId}/files`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: itemPath
            })
        });

        if (result.success) {
            showNotification(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted successfully!`, 'success');
            refreshFileList();
        }
    } catch (error) {
        showNotification(`Error deleting ${itemType}: ` + error.message, 'error');
    }
} 

function openFileExplorer(botId, botName) {
    window.location.href = `/dashboard/file-explorer/${botId}`;
}

async function loadFileList(path) {
    try {
        const result = await apiCall(`/api/deploy/${currentExplorerBotId}/files?path=${encodeURIComponent(path)}`);
        
        if (result.success) {
            currentFilePath = result.currentPath;
            document.getElementById('current-path').textContent = '/' + result.currentPath;
            displayFileList(result.files);
        }
    } catch (error) {
        showNotification('Error loading files: ' + error.message, 'error');
    }
}

function displayFileList(files) {
    const fileList = document.getElementById('file-list');
    
    if (files.length === 0) {
        fileList.innerHTML = '<div class="file-item">No files found</div>';
        return;
    }

    fileList.innerHTML = files.map(file => `
        <div class="file-item" onclick="${file.isDirectory ? 'navigateToPath(\'' + file.path + '\')' : 'openFile(\'' + file.path + '\')'}">
            <div class="file-icon">
                <img src="/icons/${file.isDirectory ? 'folder' : 'file'}.svg" alt="${file.isDirectory ? 'Folder' : 'File'}" width="16" height="16" style="color: var(--text-primary);">
            </div>
            <div class="file-name">${file.name}</div>
            <div class="file-size">${file.size || ''}</div>
            <div class="file-actions">
                ${!file.isDirectory && file.canEdit ? 
                    `<button onclick="event.stopPropagation(); openFile('${file.path}')" class="btn btn-xs btn-primary">Edit</button>` : ''}
                <button onclick="event.stopPropagation(); deleteItem('${file.path}', ${file.isDirectory})" class="btn btn-xs btn-danger">Delete</button>
            </div>
        </div>
    `).join('');
}

async function openFile(filePath) {
    try {
        const result = await apiCall(`/api/deploy/${currentExplorerBotId}/files/content?path=${encodeURIComponent(filePath)}`);
        
        if (result.success) {
            document.getElementById('editor-filename').textContent = 'Editing: ' + filePath;
            document.getElementById('file-list').style.display = 'none';
            document.getElementById('file-editor').style.display = 'block';
            currentFilePath = filePath;
            
            if (typeof createMonacoEditor === 'function' && isMonacoLoaded) {
                const language = getFileLanguage(filePath);
                const editor = createMonacoEditor(result.content, language);
                
                if (editor) {
                    document.getElementById('monaco-editor').style.display = 'block';
                    document.getElementById('file-content-editor').style.display = 'none';
                    return;
                }
            }
            
            document.getElementById('file-content-editor').value = result.content;
            document.getElementById('monaco-editor').style.display = 'none';
            document.getElementById('file-content-editor').style.display = 'block';
        }
    } catch (error) {
        showNotification('Error opening file: ' + error.message, 'error');
    }
}

function closeEditor() {
    if (monacoEditor) {
        monacoEditor.dispose();
        monacoEditor = null;
    }
    
    document.getElementById('file-list').style.display = 'block';
    document.getElementById('file-editor').style.display = 'none';
}

async function saveFile() {
    let content;
    
    if (monacoEditor && document.getElementById('monaco-editor').style.display !== 'none') {
        content = monacoEditor.getValue();
    } else {
        content = document.getElementById('file-content-editor').value;
    }
    
    try {
        const result = await apiCall(`/api/deploy/${currentExplorerBotId}/files/content`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentFilePath,
                content: content
            })
        });
        
        if (result.success) {
            showNotification('File saved successfully!', 'success');
            closeEditor();
        }
    } catch (error) {
        showNotification('Error saving file: ' + error.message, 'error');
    }
}

function navigateToPath(path) {
    loadFileList(path);
}

function refreshFileList() {
    loadFileList(currentFilePath);
}

function openConfigModal(botId, botName) {
    currentConfigBotId = botId;
    document.getElementById('config-bot-name').textContent = botName;
    document.getElementById('config-modal').style.display = 'block';
    
    loadBotConfig(botId);
}

function closeConfigModal() {
    document.getElementById('config-modal').style.display = 'none';
    currentConfigBotId = null;
}

async function loadBotConfig(botId) {
    try {
        const result = await apiCall(`/api/deploy/${botId}/config`);
        
        if (result.success) {
            if (result.hasAppJson && result.config.length > 0) {
                showConfigForm(result.config);
            } else {
                showNoConfigMessage();
            }
        }
    } catch (error) {
        showNotification('Error loading configuration: ' + error.message, 'error');
    }
}

function showConfigForm(config) {
    document.getElementById('no-config-message').style.display = 'none';
    document.getElementById('config-form-container').style.display = 'block';
    
    const configFields = document.getElementById('config-fields');
    configFields.innerHTML = '';
    
    config.forEach(envVar => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'config-item';
        
        fieldDiv.innerHTML = `
            <label class="config-label">
                ${envVar.key}
                ${envVar.required ? '<span class="config-required">*</span>' : ''}
            </label>
            
            ${envVar.description ? `
                <div class="config-description">${envVar.description}</div>
            ` : ''}
            
            <input type="${envVar.type === 'password' ? 'password' : 'text'}" 
                   class="config-input"
                   name="${envVar.key}"
                   value="${envVar.value || ''}"
                   placeholder="${envVar.required ? 'Required' : 'Optional'}"
                   autocomplete="off"
                   autocapitalize="off"
                   autocorrect="off"
                   spellcheck="false"
                   ${envVar.required ? 'required' : ''}>
            
            <div class="config-type">Type: ${envVar.type}</div>
        `;
        
        configFields.appendChild(fieldDiv);
    });
}

function showNoConfigMessage() {
    document.getElementById('no-config-message').style.display = 'block';
    document.getElementById('config-form-container').style.display = 'none';
}

const configForm = document.getElementById('config-form');
if (configForm) configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const config = [];
    
    document.querySelectorAll('.config-item').forEach(item => {
        const key = item.querySelector('input').name;
        const value = item.querySelector('input').value;
        const description = item.querySelector('.config-description')?.textContent || '';
        const required = item.querySelector('.config-required') !== null;
        const type = item.querySelector('.config-type').textContent.replace('Type: ', '');
        
        config.push({
            key,
            value,
            description,
            required,
            type
        });
    });
    
    try {
        const result = await apiCall(`/api/deploy/${currentConfigBotId}/config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ config })
        });
        
        if (result.success) {
            showNotification('Configuration saved successfully!', 'success');
            closeConfigModal();
        }
    } catch (error) {
        showNotification('Error saving configuration: ' + error.message, 'error');
    }
});

function toggleMenu(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const navDock    = document.getElementById('navDock');
    const navBackdrop = document.getElementById('navBackdrop');
    const hamburger  = document.querySelector('.hamburger');

    if (navDock && hamburger) {
        const isActive = navDock.classList.contains('active');
        if (isActive) {
            closeMenu();
        } else {
            navDock.classList.add('active');
            hamburger.classList.add('active');
            if (navBackdrop) navBackdrop.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    return false;
}

document.addEventListener('click', function(event) {
    const navDock    = document.getElementById('navDock');
    const hamburger  = document.querySelector('.hamburger');
    const navBackdrop = document.getElementById('navBackdrop');

    if (navDock && hamburger && navDock.classList.contains('active')) {
        if (!navDock.contains(event.target) &&
            !hamburger.contains(event.target) &&
            event.target !== navBackdrop) {
            closeMenu();
        }
    }
});

window.addEventListener('resize', function() {
    const navDock = document.getElementById('navDock');
    if (navDock && navDock.classList.contains('active')) {
        closeMenu();
    }
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const navDock = document.getElementById('navDock');
        if (navDock && navDock.classList.contains('active')) {
            closeMenu();
        }
    }
});

function closeMenu() {
    const navDock    = document.getElementById('navDock');
    const navBackdrop = document.getElementById('navBackdrop');
    const hamburger  = document.querySelector('.hamburger');

    if (navDock && navDock.classList.contains('active')) {
        navDock.classList.remove('active');
        if (hamburger) hamburger.classList.remove('active');
        if (navBackdrop) navBackdrop.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function handleNavLinkClick(event) {
    closeMenu();
}

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.dock-item').forEach(item => {
        item.addEventListener('click', function() {
            if (!this.getAttribute('onclick')) closeMenu();
        });
    });
    const navBackdrop = document.getElementById('navBackdrop');
    if (navBackdrop) {
        navBackdrop.addEventListener('click', function() {
            closeMenu();
        });
    }
});

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme-mode', newTheme);
    localStorage.setItem('theme-mode-manual', 'true'); 
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    const themeIconDock = document.getElementById('theme-icon-dock');
    if (themeIcon) {
        themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
    }
    if (themeIconDock) {
        themeIconDock.textContent = theme === 'light' ? '🌙' : '☀️';
    }
}

function applyStoredTheme() {
    if (typeof initializeTheme === 'function') return;
    const savedTheme = localStorage.getItem('theme-mode');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', initialTheme);
    updateThemeIcon(initialTheme);
}

document.addEventListener('DOMContentLoaded', function() {
    applyStoredTheme();
});

function showDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) {
        modal.style.display = 'block';
    } else {
        window.location.href = '/delete-account';
    }
}

function closeDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) {
        modal.style.display = 'none';
        const confirmInput = document.getElementById('delete-confirmation');
        const confirmBtn = document.getElementById('delete-confirm-btn');
        if (confirmInput) confirmInput.value = '';
        if (confirmBtn) confirmBtn.disabled = true;
    }
}

async function confirmDeleteAccount() {
    const confirmation = document.getElementById('delete-confirmation');
    if (!confirmation || confirmation.value !== 'DELETE') {
        alert('Please type "DELETE" to confirm');
        return;
    }
    
    if (!confirm('Are you absolutely sure? This will permanently delete your account, all credits, and all bots!')) {
        return;
    }
    
    try {
        const result = await apiCall('/api/dashboard/delete-account', { method: 'POST' });
        if (result.success) {
            alert('Account deleted successfully. You will be redirected to the home page.');
            window.location.href = '/';
        }
    } catch (error) {
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    const container = document.getElementById('notification-container') || createNotificationContainer();
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, duration);
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-system';
    document.body.appendChild(container);
    return container;
}

document.addEventListener('DOMContentLoaded', function() {
    initPWA();
});

function initTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    
    tooltipElements.forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

function showTooltip(e) {
    const tooltipText = this.getAttribute('data-tooltip');
    if (!tooltipText) return;
    
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = tooltipText;
    tooltip.style.position = 'absolute';
    tooltip.style.background = '#333';
    tooltip.style.color = 'white';
    tooltip.style.padding = '5px 10px';
    tooltip.style.borderRadius = '3px';
    tooltip.style.fontSize = '12px';
    tooltip.style.zIndex = '1000';
    
    document.body.appendChild(tooltip);
    
    const rect = this.getBoundingClientRect();
    tooltip.style.top = (rect.top - tooltip.offsetHeight - 5) + 'px';
    tooltip.style.left = (rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';
    
    this.tooltipElement = tooltip;
}

function hideTooltip() {
    if (this.tooltipElement) {
        this.tooltipElement.remove();
        this.tooltipElement = null;
    }
}

const CYPHERX_AUTH_STORAGE_KEY = 'cypherx_token';

function getAuthToken() {
  try { return localStorage.getItem(CYPHERX_AUTH_STORAGE_KEY); } catch (_) { return null; }
}

async function apiCall(endpoint, options = {}) {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    try {
        const response = await fetch(endpoint, {
            headers,
            ...options
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server returned non-JSON response');
        }

        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem(CYPHERX_AUTH_STORAGE_KEY);
                localStorage.removeItem('cypherx_user');
                window.location.href = '/login';
                throw new Error('Session expired. Please log in again.');
            }
            throw new Error(data.error || data.message || 'API request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API call error:', error, 'Endpoint:', endpoint);
        throw error;
    }
}

async function getBotLogs(botId) {
    window.open(`/dashboard/bot/${botId}/logs`, '_blank');
}

async function getBotStats(botId) {
    try {
        const result = await apiCall(`/api/deploy/${botId}/stats`);
        showStatsModal(result.stats);
    } catch (error) {
    }
}

async function stopBot(botId) {
    try {
        const result = await apiCall(`/api/deploy/${botId}/stop`, {
            method: 'POST'
        });
        showNotification('Bot stopped successfully', 'success');
        loadBots();
    } catch (error) {
    }
}

async function restartBot(botId) {
    try {
        const result = await apiCall(`/api/deploy/${botId}/restart`, {
            method: 'POST'
        });
        showNotification('Bot restarted successfully', 'success');
        loadBots();
    } catch (error) {
    }
}


async function deleteBot(botId) {
    if (!confirm('Are you sure you want to delete this bot? This action cannot be undone.')) {
        return;
    }
    
    try {
        const result = await apiCall(`/api/deploy/${botId}`, {
            method: 'DELETE'
        });
        showNotification('Bot deleted successfully', 'success');
        loadBots();
    } catch (error) {
    }
}

async function viewBot(botId) {
    try {
        const result = await apiCall(`/api/deploy/${botId}`);
        showBotModal(result.bot);
    } catch (error) {
    }
}

async function loadBots() {
    try {
        const result = await apiCall('/api/deploy/list');
        
        if (result.success) {
            const botsList = document.getElementById('bots-list');
            const redeployingBots = result.redeployingBots || [];
            const botsCountEl = document.getElementById('total-bots-count');
            if (botsCountEl) {
                botsCountEl.textContent = result.bots.length + redeployingBots.length;
            }
            if (result.bots.length === 0 && redeployingBots.length === 0) {
                botsList.innerHTML = '<p>No bots deployed yet.</p>';
                return;
            }

            if (typeof loadApiKeyStatus === 'function') {
                loadApiKeyStatus();
            }

            const redeployingCards = redeployingBots.map(bp => `
                <div class="bot-item bot-item-redeploying">
                    <div class="bot-header">
                        <h4 class="bot-title">${bp.botName}</h4>
                        <div class="bot-status-container">
                            <span class="bot-status status-redeploying">redeploying</span>
                        </div>
                    </div>
                    <p class="bot-description">${bp.botDescription || 'No description'}</p>
                    <div class="redeploy-banner">
                        <svg class="redeploy-spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                        Being redeployed to the new Heroku account — this may take a few minutes.
                    </div>
                </div>
            `).join('');

            botsList.innerHTML = redeployingCards + result.bots.map(bot => `
                <div class="bot-item">
                    <div class="bot-header">
                        <h4 class="bot-title">${bot.name}</h4>
                        <div class="bot-status-container">
                            <span class="bot-status status-${bot.status}">${bot.status}</span>
                            ${bot.status === 'running' ? 
                                `<span class="bot-uptime" id="uptime-${bot.id}">
                                    Loading uptime...
                                </span>` : 
                                ''
                            }
                        </div>
                    </div>
                    <p class="bot-description">${bot.description || 'No description'}</p>
                    <div class="bot-url-display">
                        ${bot.herokuAppUrl ? `
                            <a href="${bot.herokuAppUrl}" target="_blank" class="bot-url-link">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                                ${bot.herokuAppUrl}
                            </a>
                        ` : bot.subdomain ? `
                            <a href="https://${bot.subdomain}" target="_blank" class="bot-url-link">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                                ${bot.subdomain}
                            </a>
                        ` : (bot.port ? `
                            <a href="http://${window.location.hostname}:${bot.port}" target="_blank" class="bot-url-link">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                                ${window.location.hostname}:${bot.port}
                            </a>
                        ` : '')}
                    </div>
                    <div class="bot-actions" id="bot-actions-${bot.id}">
                        <div class="primary-actions">
                            ${bot.status === 'running' ? 
                                `<button onclick="stopBot(${bot.id})" class="btn btn-sm btn-warning" title="Stop Bot">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="6" y="4" width="4" height="16"></rect>
                                        <rect x="14" y="4" width="4" height="16"></rect>
                                    </svg>
                                    Stop
                                </button>` : 
                                `<button onclick="restartBot(${bot.id})" class="btn btn-sm btn-success" title="Start Bot">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polygon points="5,3 19,12 5,21"></polygon>
                                    </svg>
                                    Start
                                </button>`
                            }
                            <button onclick="toggleBotActions(${bot.id})" class="btn btn-sm btn-secondary expand-btn" title="More Actions">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="6,9 12,15 18,9"></polyline>
                                </svg>
                                More
                            </button>
                        </div>
                        <div class="secondary-actions" id="secondary-actions-${bot.id}" style="display: none;">
                            <button onclick="viewBot(${bot.id})" class="btn btn-sm btn-primary" title="View Details">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                                View
                            </button>
                            <button onclick="getBotLogs(${bot.id})" class="btn btn-sm btn-secondary" title="View Logs">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14,2 14,8 20,8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                    <polyline points="10,9 9,9 8,9"></polyline>
                                </svg>
                                Logs
                            </button>
                            <button onclick="getBotStats(${bot.id})" class="btn btn-sm btn-info" title="View Statistics">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="20" x2="18" y2="10"></line>
                                    <line x1="12" y1="20" x2="12" y2="4"></line>
                                    <line x1="6" y1="20" x2="6" y2="14"></line>
                                </svg>
                                Stats
                            </button>
                            <button onclick="openConfigModal(${bot.id}, '${bot.name}')" class="btn btn-sm btn-warning" title="Configuration">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="3"></circle>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                </svg>
                                Config
                            </button>
                            <button onclick="openFileExplorer(${bot.id}, '${bot.name}')" class="btn btn-sm btn-info" title="File Explorer">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                Files
                            </button>
                            <button onclick="deleteBot(${bot.id})" class="btn btn-sm btn-danger" title="Delete Bot">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3,6 5,6 21,6"></polyline>
                                    <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"></path>
                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                </svg>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');

            result.bots.filter(bot => bot.status === 'running').forEach(bot => {
                loadAccurateUptime(bot.id);
            });
        }
    } catch (error) {
    }
}

async function loadAccurateUptime(botId) {
    try {
        const result = await apiCall(`/api/deploy/${botId}`);
        
        if (result.success && result.bot && result.bot.liveStats && result.bot.liveStats.uptime) {
            const uptimeElement = document.getElementById(`uptime-${botId}`);
            if (uptimeElement) {
                uptimeElement.textContent = `uptime: ${formatUptime(result.bot.liveStats.uptime)}`;
            }
        } else {
            const uptimeElement = document.getElementById(`uptime-${botId}`);
            if (uptimeElement) {
                uptimeElement.textContent = 'uptime: N/A';
            }
        }
    } catch (error) {
        console.error(`Error loading uptime for bot ${botId}:`, error);
        const uptimeElement = document.getElementById(`uptime-${botId}`);
        if (uptimeElement) {
            uptimeElement.textContent = 'uptime: Error';
        }
    }
}

function initializeGlobalSearch() {
    const searchInput = document.querySelector('.search-input');
    if (!searchInput) {
        console.log('Search input not found');
        return;
    }
    
    console.log('Global search initialized');
    
    const suggestionsDropdown = document.createElement('div');
    suggestionsDropdown.className = 'search-suggestions';
    suggestionsDropdown.style.display = 'none';
    searchInput.parentElement.appendChild(suggestionsDropdown);
    
    const searchableItems = [
        { type: 'route', name: 'Dashboard', url: '/dashboard', icon: '🏠', keywords: ['home', 'main', 'overview'] },
        { type: 'route', name: 'Support', url: '/dashboard/support', icon: '💬', keywords: ['help', 'ticket', 'contact', 'assistance'] },
        { type: 'route', name: 'Settings', url: '/dashboard/settings', icon: '⚙️', keywords: ['preferences', 'account', 'profile', 'config'] },
        { type: 'route', name: 'Guide', url: '/dashboard/guide', icon: '📖', keywords: ['tutorial', 'documentation', 'help', 'how to'] },
        { type: 'route', name: 'Vouchers', url: '/dashboard/vouchers', icon: '🎁', keywords: ['gift', 'redeem', 'code', 'promo'] },
        { type: 'action', name: 'Deploy New Bot', action: 'showDeployModal', icon: '🚀', keywords: ['create', 'new', 'add', 'upload'] },
        { type: 'action', name: 'Buy Credits', action: 'openBuyCoinsModal', icon: '💰', keywords: ['purchase', 'coins', 'payment', 'pay'] },
        { type: 'action', name: 'Refresh Bots', action: 'loadBots', icon: '🔄', keywords: ['reload', 'update'] }
    ];
    
    let selectedIndex = -1;
    
    searchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase().trim();
        
        if (!searchTerm) {
            suggestionsDropdown.style.display = 'none';
            resetBotFiltering();
            return;
        }
        
        const matches = searchableItems.filter(item => {
            const nameMatch = item.name.toLowerCase().includes(searchTerm);
            const keywordMatch = item.keywords.some(keyword => keyword.includes(searchTerm));
            return nameMatch || keywordMatch;
        });
        
        const botMatches = searchBots(searchTerm);
        
        if (matches.length > 0 || botMatches.length > 0) {
            displaySuggestions(matches, botMatches, searchTerm);
            selectedIndex = -1;
        } else {
            suggestionsDropdown.style.display = 'none';
        }
    });
    
    searchInput.addEventListener('keydown', function(e) {
        const suggestions = suggestionsDropdown.querySelectorAll('.suggestion-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
            updateSelectedSuggestion(suggestions);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion(suggestions);
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            suggestions[selectedIndex].click();
        } else if (e.key === 'Escape') {
            suggestionsDropdown.style.display = 'none';
            selectedIndex = -1;
        }
    });
    
    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
            suggestionsDropdown.style.display = 'none';
            selectedIndex = -1;
        }
    });
    
    function displaySuggestions(routeMatches, botMatches, searchTerm) {
        suggestionsDropdown.innerHTML = '';
        
        if (routeMatches.length > 0) {
            const routeSection = document.createElement('div');
            routeSection.className = 'suggestion-section';
            routeSection.innerHTML = '<div class="suggestion-header">Navigation & Actions</div>';
            
            routeMatches.forEach(item => {
                const suggestionItem = createSuggestionItem(item, searchTerm);
                routeSection.appendChild(suggestionItem);
            });
            
            suggestionsDropdown.appendChild(routeSection);
        }
        
        if (botMatches.length > 0) {
            const botSection = document.createElement('div');
            botSection.className = 'suggestion-section';
            botSection.innerHTML = '<div class="suggestion-header">Your Bots</div>';
            
            botMatches.slice(0, 5).forEach(bot => {
                const suggestionItem = createBotSuggestionItem(bot, searchTerm);
                botSection.appendChild(suggestionItem);
            });
            
            suggestionsDropdown.appendChild(botSection);
        }
        
        suggestionsDropdown.style.display = 'block';
    }
    
    function createSuggestionItem(item, searchTerm) {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `
            <span class="suggestion-icon">${item.icon}</span>
            <div class="suggestion-content">
                <div class="suggestion-name">${highlightMatch(item.name, searchTerm)}</div>
                <div class="suggestion-type">${item.type === 'route' ? 'Navigate to' : 'Action'}</div>
            </div>
        `;
        
        div.addEventListener('click', function() {
            if (item.type === 'route') {
                window.location.href = item.url;
            } else if (item.type === 'action' && typeof window[item.action] === 'function') {
                window[item.action]();
                suggestionsDropdown.style.display = 'none';
                searchInput.value = '';
            }
        });
        
        return div;
    }
    
    function createBotSuggestionItem(bot, searchTerm) {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `
            <span class="suggestion-icon">🤖</span>
            <div class="suggestion-content">
                <div class="suggestion-name">${highlightMatch(bot.name, searchTerm)}</div>
                <div class="suggestion-type">Bot • ${bot.status}</div>
            </div>
        `;
        
        div.addEventListener('click', function() {
            viewBot(bot.id);
            suggestionsDropdown.style.display = 'none';
            searchInput.value = '';
        });
        
        return div;
    }
    
    function highlightMatch(text, searchTerm) {
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }
    
    function updateSelectedSuggestion(suggestions) {
        suggestions.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }
    
    function searchBots(searchTerm) {
        const botItems = document.querySelectorAll('.bot-item');
        const matches = [];
        
        botItems.forEach(botItem => {
            const botName = botItem.querySelector('.bot-title')?.textContent || '';
            const botDescription = botItem.querySelector('.bot-description')?.textContent || '';
            const botUrl = botItem.querySelector('.bot-url-link')?.textContent || '';
            const statusElement = botItem.querySelector('.bot-status');
            const status = statusElement ? statusElement.textContent : 'unknown';
            
            if (botName.toLowerCase().includes(searchTerm) || 
                botDescription.toLowerCase().includes(searchTerm) || 
                botUrl.toLowerCase().includes(searchTerm)) {
                
                const viewButton = botItem.querySelector('button[onclick^="viewBot"]');
                const botId = viewButton ? viewButton.getAttribute('onclick').match(/\d+/)[0] : null;
                
                if (botId) {
                    matches.push({
                        id: botId,
                        name: botName,
                        description: botDescription,
                        status: status,
                        element: botItem
                    });
                }
                
                botItem.style.display = '';
            } else {
                botItem.style.display = 'none';
            }
        });
        
        const botsList = document.getElementById('bots-list');
        if (botsList) {
            const visibleBots = Array.from(botItems).filter(item => item.style.display !== 'none');
            const noResultsMsg = document.getElementById('no-search-results');
            
            if (visibleBots.length === 0 && searchTerm) {
                if (!noResultsMsg) {
                    const msg = document.createElement('p');
                    msg.id = 'no-search-results';
                    msg.style.color = 'var(--text-secondary)';
                    msg.style.textAlign = 'center';
                    msg.style.padding = '2rem';
                    msg.textContent = `No bots found matching "${searchTerm}"`;
                    botsList.appendChild(msg);
                }
            } else if (noResultsMsg) {
                noResultsMsg.remove();
            }
        }
        
        return matches;
    }
    
    function resetBotFiltering() {
        const botItems = document.querySelectorAll('.bot-item');
        botItems.forEach(item => item.style.display = '');
        
        const noResultsMsg = document.getElementById('no-search-results');
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
}

function showDeployModal() {
    closeAllModals();
    const modal = document.getElementById('deploy-modal');
    if (!modal) {
        console.error('Deploy modal not found');
        return;
    }
    modal.style.display = 'block';
    
    const forms = modal.querySelectorAll('form');
    forms.forEach(form => {
        form.reset();
        const buttons = form.querySelectorAll('button[type="submit"]');
        buttons.forEach(btn => {
            btn.disabled = false;
            if (btn.textContent.includes('Processing') || btn.textContent.includes('Scanning') || btn.textContent.includes('Deploying')) {
                btn.textContent = btn.textContent.includes('GitHub') ? 'Scan Repository' : 
                                 btn.textContent.includes('ZIP') ? 'Scan ZIP File' : 
                                 'Deploy Bot';
            }
        });
    });
    
    if (typeof window.showDeployStep1 === 'function') {
        window.showDeployStep1();
    } else if (typeof showDeployStep1 === 'function') {
        showDeployStep1();
    }
}

function showDeployStep1() {
    const content = document.getElementById('deploy-modal-content');
    if (!content) return;
    
    content.innerHTML = `
        <h2>Deploy New Bot</h2>
        <p style="margin-bottom: 1.5rem; color: var(--text-secondary);">Choose a deployment method to get started.</p>
        
        <div class="deployment-method-grid">
            <div class="deployment-method-card" onclick="showDeployStep2('github')">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                </svg>
                <h3>GitHub Repository</h3>
                <p>Deploy from a GitHub repo. We will clone, install dependencies, and run your bot.</p>
            </div>
            
            <div class="deployment-method-card" onclick="showDeployStep2('upload')">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <h3>Upload Files</h3>
                <p>Upload a ZIP file containing your bot. Quick and easy for small projects.</p>
            </div>
        </div>
    `;
}

function showDeployStep2(method) {
    const content = document.getElementById('deploy-modal-content');
    if (!content) return;
    
    if (method === 'github') {
        content.innerHTML = `
            <h2>Deploy from GitHub</h2>
            <button onclick="showDeployStep1()" class="btn btn-sm btn-secondary" style="margin-bottom: 1rem;">← Back</button>
            <form onsubmit="deployFromGitHub(event)">
                <div class="form-group">
                    <label for="repoUrl">GitHub Repository URL</label>
                    <input type="url" id="repoUrl" name="repoUrl" placeholder="https://github.com/username/repo" required>
                    <small class="form-help">Make sure the repo is public or you have added our deploy key</small>
                </div>
                <div class="form-group">
                    <label for="botName">Bot Name</label>
                    <input type="text" id="botName" name="botName" placeholder="My Awesome Bot" required minlength="3" maxlength="50">
                </div>
                <div class="form-group">
                    <label for="description">Description (optional)</label>
                    <textarea id="description" name="description" rows="3" placeholder="What does this bot do?"></textarea>
                </div>
                <div style="display: flex; gap: 1rem;">
                    <button type="submit" class="btn btn-primary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="16"></line>
                            <line x1="8" y1="12" x2="16" y2="12"></line>
                        </svg>
                        Deploy Bot
                    </button>
                    <button type="button" onclick="closeDeployModal()" class="btn btn-secondary">Cancel</button>
                </div>
            </form>
        `;
    } else {
        content.innerHTML = `
            <h2>Upload Bot Files</h2>
            <button onclick="showDeployStep1()" class="btn btn-sm btn-secondary" style="margin-bottom: 1rem;">← Back</button>
            <form onsubmit="deployFromUpload(event)">
                <div class="form-group">
                    <label for="botFile">ZIP File</label>
                    <input type="file" id="botFile" name="botFile" accept=".zip" required>
                    <small class="form-help">Upload a ZIP file containing your bot project</small>
                </div>
                <div class="form-group">
                    <label for="botName">Bot Name</label>
                    <input type="text" id="botName" name="botName" placeholder="My Awesome Bot" required minlength="3" maxlength="50">
                </div>
                <div class="form-group">
                    <label for="description">Description (optional)</label>
                    <textarea id="description" name="description" rows="3" placeholder="What does this bot do?"></textarea>
                </div>
                <div style="display: flex; gap: 1rem;">
                    <button type="submit" class="btn btn-primary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        Upload & Deploy
                    </button>
                    <button type="button" onclick="closeDeployModal()" class="btn btn-secondary">Cancel</button>
                </div>
            </form>
        `;
    }
}

function closeDeployModal() {
    const modal = document.getElementById('deploy-modal');
    if (!modal) {
        console.error('Deploy modal not found');
        return;
    }
    modal.style.display = 'none';
    
    const forms = modal.querySelectorAll('form');
    forms.forEach(form => {
        form.reset();
        const buttons = form.querySelectorAll('button[type="submit"]');
        buttons.forEach(btn => {
            btn.disabled = false;
        });
    });
}

function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName('tab-content');
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove('active');
    }

    const tablinks = document.getElementsByClassName('tab-btn');
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove('active');
    }

    document.getElementById(tabName).classList.add('active');
    evt.currentTarget.classList.add('active');
}

async function deployFromGitHub(event) {
    event.preventDefault();
    
    const deployData = {
        type: 'github',
        repoUrl: event.target.repoUrl.value,
        botName: event.target.botName.value,
        description: event.target.description.value
    };
    
    showProgressModal();
    await startDeploymentProcess(deployData);
}

async function deployFromUpload(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting...';
    
    const formData = new FormData(form);

    try {
        const response = await fetch('/api/deploy/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (result.success) {
            showProgressModal(result.deploymentId, 'File Upload Deployment');
            trackDeploymentProgress(result.deploymentId);
        } else {
            showNotification('Deployment failed: ' + result.error, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    } catch (error) {
        showNotification('Deployment error: ' + error.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function startDeploymentProcess(deployData) {
    const progressBar = document.querySelector('.progress-bar');
    const statusText = document.querySelector('.status-text');
    const progressLogs = document.querySelector('.progress-logs');
    
    const steps = [
        { percentage: 10, status: 'Initializing...', log: 'Starting deployment process' },
        { percentage: 25, status: 'Cloning repository...', log: 'Cloning from GitHub repository' },
        { percentage: 40, status: 'Installing dependencies...', log: 'Running npm install' },
        { percentage: 60, status: 'Building application...', log: 'Building production bundle' },
        { percentage: 80, status: 'Starting bot...', log: 'Starting bot process' },
        { percentage: 100, status: 'Deployment completed!', log: 'Bot deployed successfully' }
    ];
    
    progressBar.style.width = '0%';
    progressBar.textContent = '0%';
    progressBar.className = 'progress-bar';
    statusText.textContent = 'Starting deployment...';
    statusText.className = 'status-text';
    progressLogs.innerHTML = '';
    
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await new Promise(resolve => setTimeout(resolve, 1500));
        progressBar.style.width = step.percentage + '%';
        progressBar.textContent = step.percentage + '%';
        statusText.textContent = step.status;
        
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.textContent = step.log;
        progressLogs.appendChild(logEntry);
        progressLogs.scrollTop = progressLogs.scrollHeight;
       
        if (step.percentage === 100) {
            progressBar.classList.add('completed');
            statusText.classList.add('status-completed');
            
            setTimeout(() => {
                closeProgressModal();
                if (typeof loadBots === 'function') {
                    loadBots();
                }
                showNotification('Bot deployed successfully!', 'success');
            }, 5000);
        }
    }
}

let _deployTimerInterval = null;
let _deployStartTime = null;

function showProgressModal(deploymentId, title) {
    const modal = document.getElementById('progress-modal');
    const titleElement = modal.querySelector('#progress-title');
    if (titleElement) titleElement.textContent = title || 'Deployment Progress';
    modal.style.display = 'block';

    _deployStartTime = Date.now();
    clearInterval(_deployTimerInterval);
    const elapsedEl = document.getElementById('deploy-elapsed');
    if (elapsedEl) elapsedEl.textContent = '';
    _deployTimerInterval = setInterval(() => {
        const el = document.getElementById('deploy-elapsed');
        if (!el) return;
        const secs = Math.floor((Date.now() - _deployStartTime) / 1000);
        const m = Math.floor(secs / 60), s = secs % 60;
        el.textContent = `Please wait, deployment running: ${m}m ${String(s).padStart(2, '0')}s`;
    }, 1000);
}

function closeProgressModal() {
    clearInterval(_deployTimerInterval);
    _deployTimerInterval = null;
    const elapsedEl = document.getElementById('deploy-elapsed');
    if (elapsedEl) elapsedEl.textContent = '';
    document.getElementById('progress-modal').style.display = 'none';
}

function showLogsModal(logs) {
    const modal = document.getElementById('logs-modal');
    const content = modal.querySelector('#logs-content');
    content.textContent = logs || 'No logs available';
    modal.style.display = 'block';
}

function closeLogsModal() {
    document.getElementById('logs-modal').style.display = 'none';
}

function showStatsModal(stats) {
    const modal = document.getElementById('stats-modal');
    const content = modal.querySelector('#stats-content');
    
    if (stats) {
        content.innerHTML = `
            <div class="stat-item">
                <span class="stat-label">Status:</span>
                <span class="stat-value">${stats.status || 'Unknown'}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">CPU Usage:</span>
                <span class="stat-value">${stats.cpu || 0}%</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Memory Usage:</span>
                <span class="stat-value">${Math.round((stats.memory || 0) / 1024 / 1024)} MB</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Uptime:</span>
                <span class="stat-value">${formatUptime(stats.uptime)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Restarts:</span>
                <span class="stat-value">${stats.restarts || 0}</span>
            </div>
        `;
    } else {
        content.innerHTML = '<p>No statistics available</p>';
    }
    
    modal.style.display = 'block';
}

function closeStatsModal() {
    document.getElementById('stats-modal').style.display = 'none';
}

function toggleBotActions(botId) {
    const secondaryActions = document.getElementById(`secondary-actions-${botId}`);
    const expandBtn = document.querySelector(`#bot-actions-${botId} .expand-btn`);
    const expandIcon = expandBtn.querySelector('svg');
    
    if (secondaryActions.style.display === 'none') {
        secondaryActions.style.display = 'grid';
        expandBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="18,15 12,9 6,15"></polyline>
            </svg>
            Less
        `;
        expandBtn.title = 'Hide Actions';
    } else {
        secondaryActions.style.display = 'none';
        expandBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9"></polyline>
            </svg>
            More
        `;
        expandBtn.title = 'More Actions';
    }
}

function showBotModal(bot) {
    const modal = document.getElementById('bot-modal');
    const content = modal.querySelector('#bot-modal-content');
    
    const publicUrl = bot.herokuAppUrl ?
        bot.herokuAppUrl :
        (bot.subdomain ? `https://${bot.subdomain}` : (bot.port ? `http://${window.location.hostname}:${bot.port}` : null));
    
    content.innerHTML = `
        <div class="bot-modal-header">
            <h2>${bot.name}</h2>
            <span class="bot-status status-${bot.status}">${bot.status}</span>
        </div>
        
        <div class="bot-modal-body">
            <div class="bot-info-section">
                <h4>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14,2 14,8 20,8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10,9 9,9 8,9"></polyline>
                    </svg>
                    Basic Information
                </h4>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Description:</span>
                        <span class="info-value">${bot.description || 'No description'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Type:</span>
                        <span class="info-value">${bot.type}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Status:</span>
                        <span class="info-value status-${bot.status}">${bot.status}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Deployed:</span>
                        <span class="info-value">${new Date(bot.createdAt).toLocaleString()}</span>
                    </div>
                </div>
            </div>

            <div class="bot-info-section">
                <h4>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="6" y2="12"></line>
                        <line x1="18" y1="12" x2="22" y2="12"></line>
                        <line x1="12" y1="6" x2="12" y2="2"></line>
                        <line x1="12" y1="22" x2="12" y2="18"></line>
                    </svg>
                    Network Configuration
                </h4>
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Internal Port:</span>
                        <span class="info-value">
                            ${bot.port || 'Not assigned'}
                            <button onclick="showUrlInfo(${bot.id}, '${bot.name}')" class="btn btn-xs btn-info">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1"></path>
                                </svg>
                                View URL
                            </button>
                        </span>
                    </div>
                    ${publicUrl ? `
                    <div class="info-item">
                        <span class="info-label">${bot.herokuAppUrl || bot.subdomain ? 'App URL:' : 'Local URL:'}</span>
                        <span class="info-value">
                            <a href="${publicUrl}" target="_blank" class="bot-url">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                    <polyline points="15,3 21,3 21,9"></polyline>
                                    <line x1="10" y1="14" x2="21" y2="3"></line>
                                </svg>
                                ${publicUrl}
                            </a>
                        </span>
                    </div>
                    ` : ''}
                </div>
            </div>

            ${bot.liveStats ? `
            <div class="bot-info-section">
                <h4>📊 Live Statistics</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">CPU Usage:</span>
                        <span class="stat-value">${bot.liveStats.cpu || 0}%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Memory Usage:</span>
                        <span class="stat-value">${Math.round((bot.liveStats.memory || 0) / 1024 / 1024)} MB</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Uptime:</span>
                        <span class="stat-value">${formatUptime(bot.liveStats.uptime)}</span>
                    </div>
                    ${bot.liveStats.restarts !== undefined ? `
                    <div class="stat-item">
                        <span class="stat-label">Restarts:</span>
                        <span class="stat-value">${bot.liveStats.restarts}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
            ` : ''}

            <div class="bot-info-section">
                <h4>⚙️ Management Actions</h4>
                <div class="bot-actions-grid">
                    <button onclick="getBotLogs(${bot.id})" class="btn btn-sm btn-info">📋 View Logs</button>
                    <button onclick="getBotStats(${bot.id})" class="btn btn-sm btn-success">📊 Refresh Stats</button>
                    <button onclick="openConfigModal(${bot.id}, '${bot.name}')" class="btn btn-sm btn-warning">⚙️ Configure</button>
                    <button onclick="openFileExplorer(${bot.id}, '${bot.name}')" class="btn btn-sm btn-primary">
                        <img src="/icons/folder.svg" alt="Files" width="14" height="14" style="filter: brightness(0) invert(1);">
                        Files
                    </button>
                    ${bot.status === 'running' ? 
                        `<button onclick="stopBot(${bot.id})" class="btn btn-sm btn-danger">⏹️ Stop</button>` : 
                        `<button onclick="restartBot(${bot.id})" class="btn btn-sm btn-success">▶️ Start</button>`
                    }
                    <button onclick="deleteBot(${bot.id})" class="btn btn-sm btn-danger">
                        <img src="/icons/trash.svg" alt="Delete" width="14" height="14" style="filter: brightness(0) invert(1);">
                        Delete
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modal.style.display = 'block';
}

function closeBotModal() {
    document.getElementById('bot-modal').style.display = 'none';
}

function formatUptime(timestamp) {
    if (!timestamp) return '0s';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function formatBotUptime(createdAt, status) {
    if (status !== 'running' || !createdAt) return '';
    
    const uptimeMs = Date.now() - new Date(createdAt).getTime();
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

async function loadServerStats() {
    try {
        const result = await apiCall('/api/deploy/server/stats');
        const statsElement = document.getElementById('server-stats');
        
        if (result.success) {
            statsElement.innerHTML = `
                <div class="stat-item">
                    <span class="stat-label">CPU Usage:</span>
                    <span class="stat-value">${result.stats.cpu.toFixed(1)}%</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Memory Usage:</span>
                    <span class="stat-value">${Math.round(result.stats.memory / 1024 / 1024)} MB</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Active Bots:</span>
                    <span class="stat-value">${result.stats.activeBots}</span>
                </div>
            `;
        }
    } catch (error) {
        const statsElement = document.getElementById('server-stats');
        statsElement.innerHTML = '<p>Error loading server statistics</p>';
    }
}

window.onclick = function(event) {
    const modals = document.getElementsByClassName('modal');
    for (let modal of modals) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    }
}

async function trackDeploymentProgress(deploymentId) {
    const progressModal = document.getElementById('progress-modal');
    const progressBar = progressModal.querySelector('.progress-bar');
    const statusText = progressModal.querySelector('.status-text');
    const logsContainer = progressModal.querySelector('.progress-logs');
    
    addLogEntry(logsContainer, 'Deployment process started');
    
    const checkProgress = async () => {
        try {
            const response = await fetch(`/api/deploy/progress/${deploymentId}`);
            const result = await response.json();
            
            if (result.success) {
                const progress = result.progress;
                
                progressBar.style.width = `${progress.progress}%`;
                progressBar.textContent = `${progress.progress}%`;
                statusText.textContent = progress.message;
                statusText.className = `status-text status-${progress.status}`;
                
                if (progress.logs && progress.logs.length > 0) {
                    const existingLogs = logsContainer.querySelectorAll('.log-entry');
                    const lastTimestamp = existingLogs.length > 0 ? 
                        parseInt(existingLogs[existingLogs.length - 1].dataset.timestamp) : 0;
                    
                    progress.logs.forEach(log => {
                        if (log.timestamp > lastTimestamp) {
                            addLogEntry(logsContainer, log.message, log.timestamp);
                        }
                    });
                }
                
                if (progress.status === 'completed' || progress.status === 'failed') {
                    progressBar.className = `progress-bar ${progress.status}`;
                    
                    if (progress.status === 'completed') {
                        addLogEntry(logsContainer, 'Deployment completed successfully!');
                        setTimeout(() => {
                            closeProgressModal();
                            showNotification('Deployment completed successfully!', 'success');
                            loadBots();
                        }, 2000);
                    } else {
                        addLogEntry(logsContainer, 'Deployment failed');
                        showNotification('Deployment failed: ' + progress.message, 'error');
                    }
                } else {
                    setTimeout(checkProgress, 1000);
                }
            }
        } catch (error) {
            addLogEntry(logsContainer, 'Error checking progress: ' + error.message);
            setTimeout(checkProgress, 2000);
        }
    };
    
    checkProgress();
}

function addLogEntry(container, message, timestamp = Date.now()) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.dataset.timestamp = timestamp;
    logEntry.textContent = `[${new Date(timestamp).toLocaleTimeString()}] ${message}`;
    container.appendChild(logEntry);
    
    const maxEntries = 500;
    const logEntries = container.querySelectorAll('.log-entry');
    if (logEntries.length > maxEntries) {
        for (let i = 0; i < logEntries.length - maxEntries; i++) {
            logEntries[i].remove();
        }
    }
    
    container.scrollTop = container.scrollHeight;
}

function closeAllModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (modal.id === 'deploy-modal' || modal.id === 'progress-modal') return;
        modal.style.display = 'none';
    });
    
    const dynamicModals = document.querySelectorAll('.notification-modal');
    dynamicModals.forEach(modal => {
        modal.remove();
    });
}

async function loadApiKeyStatus() {
    try {
        const result = await apiCall('/api/dashboard/api-key/status');
        
        if (result && result.success) {
            const statusDiv = document.getElementById('api-key-status');
            
            if (result.hasApiKey) {
                const createdDate = new Date(result.createdAt).toLocaleDateString();
                const lastUsedText = result.lastUsed 
                    ? `Last used: ${new Date(result.lastUsed).toLocaleString()}`
                    : 'Never used';
                
                statusDiv.innerHTML = `
                    <div style="background: #e8f5e9; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                        <p style="margin: 0 0 0.5rem 0; color: #2e7d32; font-weight: bold;">✓ API Key Active</p>
                        <p style="margin: 0; font-size: 0.875rem; color: #666;">Created: ${createdDate}</p>
                        <p style="margin: 0; font-size: 0.875rem; color: #666;">${lastUsedText}</p>
                    </div>
                    <button onclick="revokeApiKey()" class="btn btn-danger" style="width: 100%;">
                        🗑️ Revoke API Key
                    </button>
                `;
            } else {
                statusDiv.innerHTML = `
                    <div style="background: #fff3cd; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                        <p style="margin: 0; color: #856404;">No API key generated yet.</p>
                    </div>
                    <button onclick="generateApiKey()" class="btn btn-primary" style="width: 100%;">
                        🔑 Generate API Key
                    </button>
                `;
            }
        }
    } catch (error) {
        console.error('Error loading API key status:', error);
        document.getElementById('api-key-status').innerHTML = `
            <p style="color: #dc2626;">Error loading API key status</p>
        `;
    }
}

async function generateApiKey() {
    if (!confirm('Generate a new API key? This will replace any existing key.')) {
        return;
    }

    try {
        showNotification('Generating API key...', 'info');
        
        const result = await apiCall('/api/dashboard/api-key/generate', {
            method: 'POST'
        });

        if (result && result.success) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'block';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>🔑 Your API Key</h2>
                    <div style="background: #fff3cd; padding: 1rem; border-radius: 4px; margin: 1rem 0;">
                        <p style="margin: 0 0 0.5rem 0; color: #856404; font-weight: bold;">⚠️ Important: Save this key now!</p>
                        <p style="margin: 0; font-size: 0.875rem; color: #856404;">You won't be able to see it again.</p>
                    </div>
                    <div style="background: #f5f5f5; padding: 1rem; border-radius: 4px; margin: 1rem 0; word-break: break-all; font-family: monospace;">
                        ${result.apiKey}
                    </div>
                    <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                        <button onclick="copyToClipboard('${result.apiKey}')" class="btn btn-primary" style="flex: 1;">
                            📋 Copy to Clipboard
                        </button>
                        <button onclick="this.closest('.modal').remove(); loadApiKeyStatus();" class="btn btn-secondary" style="flex: 1;">
                            Close
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            showNotification('API key generated successfully!', 'success');
        } else {
            throw new Error(result?.error || 'Failed to generate API key');
        }
    } catch (error) {
        console.error('Error generating API key:', error);
        showNotification('Error: ' + (error.message || 'Failed to generate API key'), 'error');
    }
}

async function revokeApiKey() {
    if (!confirm('Are you sure you want to revoke your API key? All applications using this key will stop working.')) {
        return;
    }

    try {
        showNotification('Revoking API key...', 'info');
        
        const result = await apiCall('/api/dashboard/api-key/revoke', {
            method: 'POST'
        });

        if (result && result.success) {
            showNotification('API key revoked successfully', 'success');
            loadApiKeyStatus();
        } else {
            throw new Error(result?.error || 'Failed to revoke API key');
        }
    } catch (error) {
        console.error('Error revoking API key:', error);
        showNotification('Error: ' + (error.message || 'Failed to revoke API key'), 'error');
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showNotification('Failed to copy to clipboard', 'error');
    });
}

function showUrlInfo(botId, botName) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h2>URL Information - ${botName}</h2>
            <div class="bot-url-info">
                <p><strong>Local URL:</strong> http://${window.location.hostname}:<span id="url-port">loading...</span></p>
                <p><strong>Access URL:</strong> <a href="http://${window.location.hostname}:<span id="url-port-2">loading...</span>" target="_blank">Open in new tab</a></p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    apiCall(`/api/deploy/${botId}`).then(result => {
        if (result.success && result.bot && result.bot.port) {
            const port = result.bot.port;
            modal.querySelectorAll('#url-port, #url-port-2').forEach(el => el.textContent = port);
            const links = modal.querySelectorAll('a');
            links.forEach(a => a.href = `http://${window.location.hostname}:${port}`);
        }
    }).catch(() => {
        modal.querySelectorAll('#url-port, #url-port-2').forEach(el => el.textContent = 'N/A');
    });
}

function enhanceForms() {
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const submitButton = this.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = submitButton.getAttribute('data-loading-text') || 'Processing...';
            }
        });
        
        const passwordField = form.querySelector('input[name="password"]');
        const confirmPasswordField = form.querySelector('input[name="confirmPassword"]');
        
        if (passwordField && confirmPasswordField) {
            confirmPasswordField.addEventListener('input', function() {
                if (this.value !== passwordField.value) {
                    this.setCustomValidity('Passwords do not match');
                } else {
                    this.setCustomValidity('');
                }
            });
        }
    });
}

function updateStatsDisplay(stats) {
    const statsElements = {
        botCount: document.querySelector('[data-stat="bot-count"]'),
        cpuUsage: document.querySelector('[data-stat="cpu-usage"]'),
        memoryUsage: document.querySelector('[data-stat="memory-usage"]')
    };
    
    for (const [key, element] of Object.entries(statsElements)) {
        if (element && stats[key] !== undefined) {
            element.textContent = stats[key];
        }
    }
}

function clearLogs() {
    const logsContent = document.getElementById('logs-content');
    if (logsContent) {
        logsContent.innerHTML = '<div class="log-line log-info">Logs cleared.</div>';
    }
}

window.NodeBotPlatform = {
    showNotification,
    apiCall,
    CypherXPaystack,
    CYPHERX_CONFIG
};

