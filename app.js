/**
 * 나만의패스워드관리 - Application Logic Controller
 * Fully client-side, offline-safe, zero-dependency.
 */

(function() {
    'use strict';

    // 1. STATE MANAGEMENT
    let db = []; // Decrypted credentials list
    let masterPassword = ''; // Retained in-memory during session
    let activeCategory = 'all';
    let searchQuery = '';
    let autoLockTimer = null;
    const AUTO_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds
    let parsedImportItems = []; // Temporarily holds smart parsed items

    // DOM Elements
    const elements = {
        lockScreen: document.getElementById('lock-screen'),
        setupForm: document.getElementById('setup-vault-form'),
        unlockForm: document.getElementById('unlock-vault-form'),
        appDashboard: document.getElementById('app-dashboard'),
        authError: document.getElementById('auth-error-msg'),
        webAccessForm: document.getElementById('web-access-form'),
        webAccessToken: document.getElementById('web-access-token'),
        btnWebLogin: document.getElementById('btn-web-login'),
        brandSubtitle: document.querySelector('.brand-subtitle'),
        
        // Passwords fields
        newMasterPwd: document.getElementById('new-master-password'),
        confirmMasterPwd: document.getElementById('confirm-master-password'),
        masterPwd: document.getElementById('master-password'),
        
        // Dashboard
        searchInput: document.getElementById('search-input'),
        credentialsContainer: document.getElementById('credentials-container'),
        currentCategoryTitle: document.getElementById('current-category-title'),
        currentCategoryDesc: document.getElementById('current-category-desc'),
        
        // Buttons
        btnCreateVault: document.getElementById('btn-create-vault'),
        btnUnlockVault: document.getElementById('btn-unlock-vault'),
        btnResetWarning: document.getElementById('btn-reset-app-warning'),
        btnAddAccount: document.getElementById('btn-add-account'),
        btnOpenSmartImport: document.getElementById('btn-open-smart-import'),
        btnExportEnc: document.getElementById('btn-export-enc'),
        btnExportDec: document.getElementById('btn-export-dec'),
        fileImportSetup: document.getElementById('file-import-setup'),
        fileImportUnlock: document.getElementById('file-import-unlock'),
        
        // Modal Overlay
        modalOverlay: document.getElementById('modal-overlay'),
        
        // Account Modal
        modalAccount: document.getElementById('modal-account'),
        modalAccountTitle: document.getElementById('modal-account-title'),
        accountForm: document.getElementById('account-form'),
        editAccountId: document.getElementById('edit-account-id'),
        accTitle: document.getElementById('acc-title'),
        accCategory: document.getElementById('acc-category'),
        accUsername: document.getElementById('acc-username'),
        accPassword: document.getElementById('acc-password'),
        accUrl: document.getElementById('acc-url'),
        accEmergencyEmail: document.getElementById('acc-emergency-email'),
        accEmergencyPhone: document.getElementById('acc-emergency-phone'),
        accNotes: document.getElementById('acc-notes'),
        accPwdStrengthBar: document.getElementById('acc-pwd-strength-bar'),
        accPwdStrengthLabel: document.getElementById('acc-pwd-strength-label'),
        btnAccGenerate: document.getElementById('btn-acc-generate'),
        btnSaveAccount: document.getElementById('btn-save-account'),
        
        // Generator Modal
        modalGenerator: document.getElementById('modal-generator'),
        genOutputText: document.getElementById('gen-output-text'),
        btnCopyGen: document.getElementById('btn-copy-gen'),
        genLength: document.getElementById('gen-length'),
        genLengthVal: document.getElementById('gen-length-val'),
        genUpper: document.getElementById('gen-upper'),
        genLower: document.getElementById('gen-lower'),
        genNums: document.getElementById('gen-nums'),
        genSymbols: document.getElementById('gen-symbols'),
        btnTriggerGenerate: document.getElementById('btn-trigger-generate'),
        
        // Smart Importer Modal
        modalSmartImport: document.getElementById('modal-smart-import'),
        importRawText: document.getElementById('import-raw-text'),
        btnParseText: document.getElementById('btn-parse-text'),
        importPreviewContainer: document.getElementById('import-preview-container'),
        btnSubmitImported: document.getElementById('btn-submit-imported'),
        
        // Badges
        badgeAll: document.getElementById('badge-all'),
        badgeGoogle: document.getElementById('badge-구글'),
        badgeBiz: document.getElementById('badge-비즈니스'),
        badgeFinance: document.getElementById('badge-금융'),
        badgeEtc: document.getElementById('badge-기타')
    };

    // Category Info Details
    const categoryDetails = {
        'all': { title: '전체 계정', desc: '안전하게 암호화되어 보관 중인 모든 계정 목록입니다.' },
        '구글': { title: '구글/포털 계정', desc: '구글, 네이버 등 주요 포털 및 소셜 서비스 계정입니다.' },
        '비즈니스': { title: '비즈니스/업무 계정', desc: '사내 관리 사이트, 유튜브 채널 등 비즈니스 목적의 계정입니다.' },
        '금융': { title: '금융/카드 계정', desc: '은행, 신용카드, 결제 서비스 관련 민감 정보입니다.' },
        '기타': { title: '기타 계정', desc: '지정된 범주 외에 분류된 기타 계정 모음입니다.' }
    };

    // 2. INACTIVITY LOCK SYSTEM (Auto-Lock)
    function resetAutoLockTimer() {
        if (!masterPassword) return; // Don't run lock timer if locked
        if (autoLockTimer) clearTimeout(autoLockTimer);
        autoLockTimer = setTimeout(lockVault, AUTO_LOCK_TIMEOUT);
    }

    function setupActivityListeners() {
        const activities = ['mousemove', 'keypress', 'mousedown', 'scroll', 'click'];
        activities.forEach(event => {
            window.addEventListener(event, resetAutoLockTimer);
        });
    }

    // 3. INITIALIZATION & APP BOOT
    document.addEventListener('DOMContentLoaded', async () => {
        setupActivityListeners();
        bindEvents();
        const ready = await ensureWebAccess();
        if (ready) checkVaultStatus();
        startHeartbeatSystem();
    });

    let vaultFilePath = '';
    let webMode = false;

    function showWebGate(message) {
        elements.setupForm.classList.add('hidden');
        elements.unlockForm.classList.add('hidden');
        elements.webAccessForm.classList.remove('hidden');
        if (elements.brandSubtitle) {
            elements.brandSubtitle.textContent = '웹 접속 키가 필요합니다';
        }
        if (message) showAuthError(message);
        elements.webAccessToken.focus();
    }

    let serverTransportKey = '';

    async function ensureTransportKey() {
        if (!webMode) return;
        if (serverTransportKey) return;
        const response = await fetch('/api/transport-key');
        if (!response.ok) throw new Error('전송 암호화 키를 받지 못했습니다.');
        const data = await response.json();
        if (!data.publicKey) throw new Error('전송 암호화 키가 없습니다.');
        serverTransportKey = data.publicKey;
        const fingerprint = document.getElementById('transport-fingerprint');
        if (fingerprint) {
            fingerprint.textContent = '서버 지문 ' + data.fingerprint + ' (서버 창의 지문과 같아야 합니다)';
        }
    }

    async function readVaultFile() {
        if (!webMode) {
            const response = await fetch('/api/vault');
            return { status: response.status, text: response.ok ? await response.text() : '' };
        }
        await ensureTransportKey();
        const channel = await window.VaultCrypto.openChannel(serverTransportKey);
        const response = await fetch('/api/vault', {
            headers: { 'X-PM-Client-Key': channel.publicKey }
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            return { status: response.status, text: '', error: data.error || '' };
        }
        const envelope = await response.json();
        return { status: 200, text: await channel.open(envelope) };
    }

    async function writeVaultFile(vaultObj) {
        if (!webMode) {
            return fetch('/api/vault', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(vaultObj)
            });
        }
        await ensureTransportKey();
        const channel = await window.VaultCrypto.openChannel(serverTransportKey);
        const envelope = await channel.seal(JSON.stringify({
            ts: Date.now(),
            payload: vaultObj
        }));
        return fetch('/api/vault', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envelope)
        });
    }

    async function ensureWebAccess() {
        try {
            const response = await fetch('/api/web-status');
            if (!response.ok) return true;
            const data = await response.json();
            webMode = !!data.web;
            if (data.web) {
                try {
                    await ensureTransportKey();
                } catch (err) {
                    showAuthError(err.message);
                }
            }
            if (!data.web || data.authenticated) {
                if (data.web && elements.brandSubtitle) {
                    elements.brandSubtitle.textContent = '웹에서 여는 암호화 금고';
                }
                elements.webAccessForm.classList.add('hidden');
                return true;
            }
            showWebGate();
            return false;
        } catch (e) {
            return true;
        }
    }

    async function handleWebLogin() {
        const token = elements.webAccessToken.value.trim();
        if (!token) {
            showAuthError('웹 접속 키를 입력해 주세요.');
            return;
        }
        try {
            await ensureTransportKey();
            const channel = await window.VaultCrypto.openChannel(serverTransportKey);
            const envelope = await channel.seal(JSON.stringify({ ts: Date.now(), token }));
            const response = await fetch('/api/web-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(envelope)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                showAuthError(data.error || '웹 접속에 실패했습니다.');
                elements.webAccessToken.select();
                return;
            }
            elements.webAccessToken.value = '';
            elements.webAccessForm.classList.add('hidden');
            if (elements.brandSubtitle) {
                elements.brandSubtitle.textContent = '웹에서 여는 암호화 금고';
            }
            checkVaultStatus();
        } catch (e) {
            showAuthError('웹 서버와 연결할 수 없습니다.');
        }
    }

    async function fetchVaultPath() {
        try {
            const response = await fetch('/api/vault-path');
            if (response.status === 401) {
                showWebGate('웹 접속이 만료되었습니다. 접속 키를 다시 입력해 주세요.');
                return;
            }
            if (response.ok) {
                const data = await response.json();
                vaultFilePath = data.path || '';
                webMode = !!data.web;
            }
        } catch (e) {
            console.error("금고 경로 조회 실패:", e);
        }
    }

    async function checkVaultStatus() {
        // Fetch current vault path in the background
        fetchVaultPath();
        try {
            const response = await readVaultFile();
            if (response.status === 401) {
                showWebGate('웹 접속이 만료되었습니다. 접속 키를 다시 입력해 주세요.');
                return;
            }
            if (response.status === 200) {
                elements.setupForm.classList.add('hidden');
                elements.unlockForm.classList.remove('hidden');
                elements.masterPwd.focus();
            } else {
                elements.setupForm.classList.remove('hidden');
                elements.unlockForm.classList.add('hidden');
                elements.newMasterPwd.focus();
            }
        } catch (err) {
            console.error("로컬 서버 연결 오류:", err);
            showAuthError(webMode
                ? "웹 서버와 연결할 수 없습니다. run_web.bat 실행 상태를 확인해 주세요."
                : "로컬 보안 서버와 연결할 수 없습니다. run.bat 실행 상태를 확인해 주세요.");
        }
    }

    // Show Auth/Error Toast
    function showAuthError(message) {
        elements.authError.textContent = message;
        elements.authError.classList.remove('hidden');
        setTimeout(() => {
            elements.authError.classList.add('hidden');
        }, 5000);
    }

    // 4. VAULT CRYPTO HANDLERS (Save / Unlock / Reset)
    
    // Save state to local storage (encrypted)
    async function saveVault() {
        if (!masterPassword) return;
        try {
            const plaintext = JSON.stringify(db);
            const encryptedObj = await window.VaultCrypto.encrypt(plaintext, masterPassword);
            
            // Post encrypted database payload to local server
            const response = await writeVaultFile(encryptedObj);

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || '서버가 파일을 저장하지 못했습니다.');
            }

            updateCategoryBadges();
        } catch (e) {
            alert('데이터 저장 실패: ' + e.message);
        }
    }

    // Initialize fresh vault
    async function handleSetupVault() {
        const p1 = elements.newMasterPwd.value;
        const p2 = elements.confirmMasterPwd.value;

        if (!p1) {
            showAuthError('비밀번호를 입력해 주세요.');
            return;
        }
        if (p1 !== p2) {
            showAuthError('비밀번호 확인이 일치하지 않습니다.');
            return;
        }
        if (p1.length < 8) {
            showAuthError('비밀번호는 최소 8자 이상이어야 합니다.');
            return;
        }

        try {
            masterPassword = p1;
            db = []; // Start fresh
            await saveVault();
            
            // Unlock view
            elements.lockScreen.classList.remove('active');
            elements.appDashboard.classList.remove('hidden');
            renderCredentials();
            resetAutoLockTimer();
            
            elements.newMasterPwd.value = '';
            elements.confirmMasterPwd.value = '';
        } catch (err) {
            showAuthError('금고 생성 오류: ' + err.message);
        }
    }

    async function handleUnlockVault() {
        const password = elements.masterPwd.value;
        if (!password) {
            showAuthError('마스터 패스워드를 입력하세요.');
            return;
        }

        try {
            // Fetch the latest encrypted vault from server
            const response = await readVaultFile();
            if (response.status === 401) {
                showWebGate('웹 접속이 만료되었습니다. 접속 키를 다시 입력해 주세요.');
                return;
            }
            if (response.status !== 200) {
                showAuthError('서버에서 금고 데이터를 불러올 수 없습니다. 파일 상태를 확인하세요.');
                return;
            }
            
            const storedVaultStr = response.text;
            const encryptedObj = JSON.parse(storedVaultStr);
            const decryptedPlain = await window.VaultCrypto.decrypt(encryptedObj, password);
            
            // Success
            masterPassword = password;
            db = JSON.parse(decryptedPlain);
            
            elements.lockScreen.classList.remove('active');
            elements.appDashboard.classList.remove('hidden');
            
            renderCredentials();
            updateCategoryBadges();
            resetAutoLockTimer();
            
            elements.masterPwd.value = '';
        } catch (err) {
            showAuthError('잠금 해제 실패: 비밀번호가 올바르지 않습니다.');
            elements.masterPwd.select();
        }
    }

    // Lock Vault instantly
    function lockVault() {
        masterPassword = '';
        db = [];
        searchQuery = '';
        elements.searchInput.value = '';
        parsedImportItems = [];
        if (autoLockTimer) clearTimeout(autoLockTimer);
        
        elements.appDashboard.classList.add('hidden');
        elements.lockScreen.classList.add('active');
        checkVaultStatus();
    }

    async function resetAppVault() {
        if (!vaultFilePath) {
            await fetchVaultPath();
        }
        if (webMode) {
            const proceed = confirm('웹 금고 파일(vault.json.enc)을 서버에서 삭제합니다. 삭제하면 마스터 비밀번호로도 복구할 수 없습니다. 계속할까요?');
            if (!proceed) return;
            try {
                const response = await fetch('/api/vault', { method: 'DELETE' });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    alert(errData.error || '금고 파일을 삭제하지 못했습니다.');
                    return;
                }
                location.reload();
            } catch (err) {
                alert('금고 파일을 삭제하지 못했습니다.');
            }
            return;
        }
        const displayPath = vaultFilePath || "금고 폴더";
        const proceed = confirm(`🚨 [물리 파일 초기화 안내]\n나만의패스워드관리 프로그램은 귀중한 데이터 유실을 막기 위해 브라우저에서 직접 물리 파일을 강제 삭제할 수 없게 설계되어 있습니다.\n\n초기화를 원하시면 아래 경로의 'vault.json.enc' 파일을 탐색기에서 직접 삭제해 주신 뒤 페이지를 새로고침(F5) 해주시기 바랍니다!\n\n경로: ${displayPath}\n\n[확인]을 누르시면 탐색기에서 해당 금고 파일이 위치한 폴더를 열고 파일을 즉시 선택해 드립니다.`);
        if (proceed) {
            try {
                await fetch('/api/open-vault-folder', { method: 'POST' });
            } catch (err) {
                console.error("탐색기 열기 실패:", err);
                alert("탐색기를 열지 못했습니다. 경로를 직접 확인해 주세요: " + displayPath);
            }
        }
    }

    // 5. CRUD OPERATIONS (Credentials management)
    
    // Save account (Add or Edit)
    async function handleSaveAccount() {
        const id = elements.editAccountId.value;
        const title = elements.accTitle.value.trim();
        const category = elements.accCategory.value;
        const username = elements.accUsername.value.trim();
        const password = elements.accPassword.value;
        const url = elements.accUrl.value.trim();
        const emergencyEmail = elements.accEmergencyEmail.value.trim();
        const emergencyPhone = elements.accEmergencyPhone.value.trim();
        const notes = elements.accNotes.value;

        if (!title || !username || !password) {
            alert('필수 입력 항목(*)을 채워주세요.');
            return;
        }

        const accountData = {
            id: id || 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            title,
            category,
            username,
            password,
            url,
            emergencyEmail,
            emergencyPhone,
            notes
        };

        if (id) {
            // Edit existing
            const index = db.findIndex(acc => acc.id === id);
            if (index !== -1) {
                db[index] = accountData;
            }
        } else {
            // Add new
            db.push(accountData);
        }

        await saveVault();
        closeModal('modal-account');
        renderCredentials();
    }

    // Delete account
    async function deleteAccount(id, title) {
        if (confirm(`"${title}" 계정을 영구적으로 삭제하시겠습니까?`)) {
            db = db.filter(acc => acc.id !== id);
            await saveVault();
            renderCredentials();
        }
    }

    // Open edit modal
    function openEditModal(id) {
        const acc = db.find(a => a.id === id);
        if (!acc) return;

        elements.modalAccountTitle.textContent = "계정 정보 수정";
        elements.editAccountId.value = acc.id;
        elements.accTitle.value = acc.title;
        elements.accCategory.value = acc.category;
        elements.accUsername.value = acc.username;
        elements.accPassword.value = acc.password;
        elements.accUrl.value = acc.url || '';
        elements.accEmergencyEmail.value = acc.emergencyEmail || '';
        elements.accEmergencyPhone.value = acc.emergencyPhone || '';
        elements.accNotes.value = acc.notes || '';

        checkPasswordStrength(acc.password);
        openModal('modal-account');
    }

    // Open create modal
    function openCreateModal() {
        elements.modalAccountTitle.textContent = "새 계정 직접 추가";
        elements.accountForm.reset();
        elements.editAccountId.value = '';
        elements.accPwdStrengthBar.style.width = '0%';
        elements.accPwdStrengthLabel.textContent = "보안 수준: 입력 대기 중";
        openModal('modal-account');
    }

    // 6. RENDER LOGIC (Cards Grid & Sidebar Badges)
    function renderCredentials() {
        // Filter DB
        let filtered = db.filter(acc => {
            // Category check
            const catMatches = activeCategory === 'all' || acc.category === activeCategory;
            
            // Search query check
            const s = searchQuery.toLowerCase();
            const searchMatches = !s || 
                acc.title.toLowerCase().includes(s) ||
                acc.username.toLowerCase().includes(s) ||
                (acc.url && acc.url.toLowerCase().includes(s)) ||
                (acc.notes && acc.notes.toLowerCase().includes(s)) ||
                (acc.emergencyEmail && acc.emergencyEmail.toLowerCase().includes(s)) ||
                (acc.emergencyPhone && acc.emergencyPhone.toLowerCase().includes(s));
            
            return catMatches && searchMatches;
        });

        // Clear and render
        elements.credentialsContainer.innerHTML = '';

        if (filtered.length === 0) {
            elements.credentialsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>일치하는 계정이 없습니다</h3>
                    <p>검색어를 다르게 입력해 보시거나 선택한 카테고리를 확인해 보세요.</p>
                </div>`;
            return;
        }

        filtered.forEach(acc => {
            const card = document.createElement('div');
            card.className = 'credential-card glass';
            
            // URL Link HTML
            const urlHtml = acc.url ? `
                <a href="${acc.url}" target="_blank" rel="noopener noreferrer" class="card-link">
                    <span>🌐 사이트 열기</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
                </a>` : '';

            // Emergency Contacts HTML
            const hasEmergency = acc.emergencyEmail || acc.emergencyPhone;
            const emergencyHtml = hasEmergency ? `
                <div class="card-emergency">
                    <div class="emergency-title">⚠️ 비상 대처 정보</div>
                    ${acc.emergencyEmail ? `
                        <div class="emergency-item">
                            <span class="emergency-label">비상 메일</span>
                            <span class="emergency-val">${escapeHTML(acc.emergencyEmail)}</span>
                        </div>` : ''}
                    ${acc.emergencyPhone ? `
                        <div class="emergency-item">
                            <span class="emergency-label">비상 연락처</span>
                            <span class="emergency-val" style="white-space: pre-line; text-align: right;">${escapeHTML(acc.emergencyPhone)}</span>
                        </div>` : ''}
                </div>` : '';

            // Notes HTML
            const notesHtml = acc.notes ? `<div class="card-notes">${escapeHTML(acc.notes)}</div>` : '';

            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title-container">
                        <span class="card-category ${acc.category}">${acc.category}</span>
                        <h3 class="card-title" title="${escapeHTML(acc.title)}">${escapeHTML(acc.title)}</h3>
                    </div>
                    <div class="card-actions">
                        <button class="btn-card-action btn-edit" title="수정" data-id="${acc.id}">✏️</button>
                        <button class="btn-card-action btn-delete" title="삭제" data-id="${acc.id}" data-title="${escapeHTML(acc.title)}">🗑️</button>
                    </div>
                </div>
                
                <div class="card-details">
                    <div class="detail-row">
                        <span class="detail-label">아이디/메일</span>
                        <div class="detail-val-group">
                            <span class="detail-val" title="${escapeHTML(acc.username)}">${escapeHTML(acc.username)}</span>
                            <button class="btn-copy-mini" title="복사" data-copy="${escapeHTML(acc.username)}">📋</button>
                        </div>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">비밀번호</span>
                        <div class="detail-val-group">
                            <span class="detail-val password-val" data-password="${escapeHTML(acc.password)}">••••••••</span>
                            <button class="btn-copy-mini btn-reveal-pwd" title="보이기" data-revealed="false">👁️</button>
                            <button class="btn-copy-mini" title="복사" data-copy="${escapeHTML(acc.password)}">📋</button>
                        </div>
                    </div>
                </div>

                ${emergencyHtml}
                ${notesHtml}
                ${urlHtml}
            `;

            // Bind individual card buttons
            card.querySelector('.btn-edit').addEventListener('click', () => openEditModal(acc.id));
            card.querySelector('.btn-delete').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                deleteAccount(btn.dataset.id, btn.dataset.title);
            });
            card.querySelectorAll('[data-copy]').forEach(btn => {
                btn.addEventListener('click', (e) => copyToClipboard(e.currentTarget.dataset.copy));
            });
            
            // Password Reveal Toggle
            const revealBtn = card.querySelector('.btn-reveal-pwd');
            const pwdValEl = card.querySelector('.password-val');
            revealBtn.addEventListener('click', () => {
                const isRevealed = revealBtn.dataset.revealed === 'true';
                if (isRevealed) {
                    pwdValEl.textContent = '••••••••';
                    revealBtn.textContent = '👁️';
                    revealBtn.dataset.revealed = 'false';
                } else {
                    pwdValEl.textContent = pwdValEl.dataset.password;
                    revealBtn.textContent = '🙈';
                    revealBtn.dataset.revealed = 'true';
                }
            });

            elements.credentialsContainer.appendChild(card);
        });
    }

    function updateCategoryBadges() {
        const counts = { 'all': db.length, '구글': 0, '비즈니스': 0, '금융': 0, '기타': 0 };
        db.forEach(acc => {
            if (counts[acc.category] !== undefined) {
                counts[acc.category]++;
            } else {
                counts['기타']++;
            }
        });

        elements.badgeAll.textContent = counts['all'];
        elements.badgeGoogle.textContent = counts['구글'];
        elements.badgeBiz.textContent = counts['비즈니스'];
        elements.badgeFinance.textContent = counts['금융'];
        elements.badgeEtc.textContent = counts['기타'];

        // Also update the top dropdown trigger badge with the current active category count
        const selectedBadge = document.getElementById('selected-category-badge');
        if (selectedBadge) {
            selectedBadge.textContent = counts[activeCategory] !== undefined ? counts[activeCategory] : counts['all'];
        }
    }

    // Helper to escape HTML characters
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    // 7. SMART TEXT PARSER (The Heuristic Alchemist)
    
    /**
     * Parses the unstructured accounts text pasted by the user.
     * Splitting is done by blank lines. We then inspect line sequences.
     */
    function parseSmartText(text) {
        if (!text.trim()) return [];
        
        // 1. Split into blocks using two or more consecutive newlines (or isolated clean breaks)
        const rawBlocks = text.split(/\n\s*\n+/);
        const parsedAccounts = [];

        rawBlocks.forEach((block, index) => {
            const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return;

            let titleParts = [];
            let username = '';
            let password = '';
            let emergencyEmail = '';
            let emergencyPhones = [];
            let notesParts = [];
            let category = '비즈니스'; // Default category

            // Heuristic parsing per line
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // A. Check for Slash Separated IDs/Password: "remanncorp@gmail.com  /  kcrc7297@"
                if (line.includes('/') && !line.startsWith('http')) {
                    const slashParts = line.split(/\s*[\/]\s*/);
                    if (slashParts.length >= 2) {
                        const first = slashParts[0].trim();
                        const second = slashParts[1].trim();
                        
                        // Heuristic: Check if first part looks like email or login ID
                        if (first.length > 0 && second.length > 0) {
                            username = first;
                            password = second;
                            continue;
                        }
                    }
                }

                // B. Check for Emergency Email: "비상이메일 : replus3000@gmail.com"
                const emergencyEmailRegex = /(?:비상\s*이메일|비상\s*메일|복구\s*이메일)\s*[:：]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
                const emailMatch = line.match(emergencyEmailRegex);
                if (emailMatch) {
                    emergencyEmail = emailMatch[1];
                    continue;
                }

                // C. Check for Emergency Phone: "비상전화번호 : 010-3308-1803 (방성진전화)"
                const emergencyPhoneHeaderRegex = /(?:비상\s*전화|비상\s*연락처|비상\s*핸드폰|전화번호)\s*[:：]?\s*(.*)/i;
                const phoneHeaderMatch = line.match(emergencyPhoneHeaderRegex);
                if (phoneHeaderMatch) {
                    const phoneVal = phoneHeaderMatch[1].trim();
                    if (phoneVal) {
                        emergencyPhones.push(phoneVal);
                    }
                    continue;
                }

                // D. Check for generic phone numbers on indented or separate lines: "010-3586-3997 (구가온전화)"
                // Matches standard Korean phone format e.g. 010-1234-5678, with optional name in parentheses
                const phoneRegex = /(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?:\s*\(.*?\))?)/;
                const genericPhoneMatch = line.match(phoneRegex);
                if (genericPhoneMatch && !line.includes('/') && !line.includes('@')) {
                    emergencyPhones.push(line);
                    continue;
                }

                // E. Check for generic emails (if username not set yet)
                const genericEmailRegex = /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/;
                if (line.match(genericEmailRegex) && !username) {
                    username = line;
                    continue;
                }

                // F. Handle Titles (typically the first 1-2 lines of the block if they don't contain key identifiers)
                if (i === 0) {
                    titleParts.push(line);
                    // Automatic Category Suggestion based on title
                    if (line.toLowerCase().includes('구글') || line.toLowerCase().includes('google') || line.toLowerCase().includes('네이버') || line.toLowerCase().includes('daum')) {
                        category = '구글';
                    } else if (line.toLowerCase().includes('은행') || line.toLowerCase().includes('카드') || line.toLowerCase().includes('페이') || line.toLowerCase().includes('pay') || line.toLowerCase().includes('bank')) {
                        category = '금융';
                    }
                    continue;
                }
                
                // If it is the second line and doesn't contain colon labels or obvious details, join with title
                if (i === 1 && titleParts.length > 0 && !line.includes('/') && !line.includes('@') && !line.includes(':') && !line.includes('：')) {
                    titleParts.push(line);
                    continue;
                }

                // G. Everything else goes to detailed notes
                notesParts.push(line);
            }

            // Fallback for title
            const finalTitle = titleParts.join(' - ') || `불러온 계정 #${index + 1}`;
            
            // Fallback username/password if still missing
            if (!username && notesParts.length > 0) {
                // Look if any note line contains standard account string
                for (let k = 0; k < notesParts.length; k++) {
                    const nLine = notesParts[k];
                    if (nLine.includes(':') && !nLine.includes('http')) {
                        const colonParts = nLine.split(/[:：]/);
                        const label = colonParts[0].toLowerCase();
                        const val = colonParts[1].trim();
                        if ((label.includes('아이디') || label.includes('id') || label.includes('계정') || label.includes('이메일') || label.includes('email')) && !username) {
                            username = val;
                            notesParts.splice(k, 1);
                            k--;
                        } else if ((label.includes('비밀번호') || label.includes('패스워드') || label.includes('pwd') || label.includes('pw') || label.includes('password')) && !password) {
                            password = val;
                            notesParts.splice(k, 1);
                            k--;
                        }
                    }
                }
            }

            parsedAccounts.push({
                tempId: 'import_' + index + '_' + Date.now(),
                title: finalTitle,
                category: category,
                username: username || '아이디 없음',
                password: password || '비밀번호 없음',
                url: '',
                emergencyEmail: emergencyEmail,
                emergencyPhone: emergencyPhones.join('\n'),
                notes: notesParts.join('\n')
            });
        });

        return parsedAccounts;
    }

    // Trigger parsing and display preview
    function handleSmartParse() {
        const text = elements.importRawText.value;
        if (!text.trim()) {
            alert('가져올 계정 텍스트를 입력해 주세요.');
            return;
        }

        parsedImportItems = parseSmartText(text);
        renderSmartImportPreview();
    }

    // Render Preview in Smart Importer Modal
    function renderSmartImportPreview() {
        elements.importPreviewContainer.innerHTML = '';

        if (parsedImportItems.length === 0) {
            elements.importPreviewContainer.innerHTML = `<div class="preview-empty">분석된 계정이 없습니다. 텍스트 형식을 확인해 주세요.</div>`;
            elements.btnSubmitImported.disabled = true;
            elements.btnSubmitImported.textContent = "분석된 계정 일괄 등록하기 (0개)";
            return;
        }

        parsedImportItems.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'parse-item-card selected';
            card.dataset.tempId = item.tempId;

            card.innerHTML = `
                <div class="parse-card-header">
                    <div class="parse-card-select">
                        <input type="checkbox" checked class="import-select-chk" data-temp-id="${item.tempId}">
                        <input type="text" class="parse-title-input" value="${escapeHTML(item.title)}" data-field="title" data-index="${index}">
                    </div>
                    <span class="card-category" style="font-size: 0.7rem; padding: 2px 6px;">임시 항목</span>
                </div>
                
                <div class="parse-card-grid">
                    <div class="parse-field-group">
                        <label>카테고리</label>
                        <select class="parse-field-input" data-field="category" data-index="${index}">
                            <option value="구글" ${item.category === '구글' ? 'selected' : ''}>구글/포털</option>
                            <option value="비즈니스" ${item.category === '비즈니스' ? 'selected' : ''}>비즈니스/업무</option>
                            <option value="금융" ${item.category === '금융' ? 'selected' : ''}>금융/카드</option>
                            <option value="기타" ${item.category === '기타' ? 'selected' : ''}>기타 계정</option>
                        </select>
                    </div>
                    <div class="parse-field-group">
                        <label>웹주소 (URL)</label>
                        <input type="text" class="parse-field-input" value="${escapeHTML(item.url)}" placeholder="https://..." data-field="url" data-index="${index}">
                    </div>
                    <div class="parse-field-group">
                        <label>아이디/이메일</label>
                        <input type="text" class="parse-field-input" value="${escapeHTML(item.username)}" data-field="username" data-index="${index}">
                    </div>
                    <div class="parse-field-group">
                        <label>비밀번호</label>
                        <input type="text" class="parse-field-input" value="${escapeHTML(item.password)}" data-field="password" data-index="${index}">
                    </div>
                    <div class="parse-field-group">
                        <label>비상 이메일</label>
                        <input type="text" class="parse-field-input" value="${escapeHTML(item.emergencyEmail)}" placeholder="없음" data-field="emergencyEmail" data-index="${index}">
                    </div>
                    <div class="parse-field-group">
                        <label>비상 연락처</label>
                        <input type="text" class="parse-field-input" value="${escapeHTML(item.emergencyPhone)}" placeholder="없음" data-field="emergencyPhone" data-index="${index}">
                    </div>
                    <div class="parse-field-group parse-field-notes">
                        <label>추가 상세 메모</label>
                        <textarea class="parse-field-input parse-notes-textarea" data-field="notes" data-index="${index}">${escapeHTML(item.notes)}</textarea>
                    </div>
                </div>
            `;

            // Bind change events to sync preview inputs back to parsedImportItems array
            card.querySelectorAll('.parse-field-input, .parse-title-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    const field = e.target.dataset.field;
                    const idx = parseInt(e.target.dataset.index);
                    parsedImportItems[idx][field] = e.target.value;
                });
            });

            // Bind checkbox styling toggle
            const checkbox = card.querySelector('.import-select-chk');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    card.classList.add('selected');
                } else {
                    card.classList.remove('selected');
                }
                updateImportSelectedCount();
            });

            elements.importPreviewContainer.appendChild(card);
        });

        updateImportSelectedCount();
    }

    // Update count display on submit button
    function updateImportSelectedCount() {
        const checkedCount = document.querySelectorAll('.import-select-chk:checked').length;
        elements.btnSubmitImported.disabled = checkedCount === 0;
        elements.btnSubmitImported.textContent = `분석된 계정 일괄 등록하기 (${checkedCount}개)`;
    }

    // Submit selected parsed items into vault
    async function submitSmartImportedItems() {
        const checkedBoxes = document.querySelectorAll('.import-select-chk:checked');
        if (checkedBoxes.length === 0) return;

        let addedCount = 0;
        checkedBoxes.forEach(box => {
            const tempId = box.dataset.tempId;
            const item = parsedImportItems.find(p => p.tempId === tempId);
            if (item) {
                // Map to db format
                db.push({
                    id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    title: item.title.trim() || '가져온 계정',
                    category: item.category,
                    username: item.username.trim(),
                    password: item.password,
                    url: item.url.trim(),
                    emergencyEmail: item.emergencyEmail.trim(),
                    emergencyPhone: item.emergencyPhone.trim(),
                    notes: item.notes
                });
                addedCount++;
            }
        });

        if (addedCount > 0) {
            await saveVault();
            closeModal('modal-smart-import');
            renderCredentials();
            alert(`${addedCount}개의 계정이 금고에 성공적으로 일괄 등록되었습니다! 🔐`);
            // Reset fields
            elements.importRawText.value = '';
            parsedImportItems = [];
        }
    }

    // 8. SECURE BACKUP EXPORTER & IMPORT FILE HANDLERS
    
    async function downloadEncryptedBackup() {
        try {
            const response = await readVaultFile();
            if (response.status !== 200) {
                alert('내보낼 데이터가 없습니다. 금고 파일이 존재하지 않습니다.');
                return;
            }
            const dataStr = response.text;
            const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
            const exportFileDefaultName = 'aegis_vault_backup_' + new Date().toISOString().slice(0, 10) + '.json.enc';

            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
        } catch (err) {
            alert('백업 다운로드 실패: ' + err.message);
        }
    }

    // Download Plaintext CSV (With Warning!)
    function downloadPlaintextCSV() {
        if (db.length === 0) {
            alert('금고에 등록된 계정이 없습니다.');
            return;
        }

        const proceed = confirm("⚠️ [보안 경고] 암호화되지 않은 일반 텍스트 파일(CSV)로 계정 목록을 내보냅니다!\n이 파일을 가지고 있는 사람은 누구나 사용자의 비밀번호를 볼 수 있게 됩니다. 비밀번호 노출 위험을 감수하고 계속 진행하시겠습니까?");
        if (!proceed) return;

        // Build CSV Content
        let csvContent = "\uFEFF"; // UTF-8 BOM for Excel compatibility in Korean
        csvContent += "사이트명,카테고리,아이디/이메일,비밀번호,웹사이트 링크,비상 이메일,비상 연락처,메모\n";

        db.forEach(acc => {
            const row = [
                acc.title,
                acc.category,
                acc.username,
                acc.password,
                acc.url || '',
                acc.emergencyEmail || '',
                (acc.emergencyPhone || '').replace(/\n/g, ' / '),
                (acc.notes || '').replace(/\n/g, '  ')
            ].map(val => {
                // Escape double quotes and surround in quotes
                const escaped = val.replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(',');
            
            csvContent += row + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const dataUri = URL.createObjectURL(blob);
        const exportFileDefaultName = 'aegis_vault_decrypted_' + new Date().toISOString().slice(0, 10) + '.csv';

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        URL.revokeObjectURL(dataUri);
    }

    function handleBackupFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(evt) {
            try {
                const fileContent = evt.target.result;
                const parsed = JSON.parse(fileContent);

                if (!parsed.ciphertext || !parsed.salt || !parsed.iv) {
                    throw new Error("올바른 암호화 백업 형식의 파일이 아닙니다.");
                }

                // Send backup payload to local server to overwrite vault.json.enc
                const response = await writeVaultFile(parsed);

                if (!response.ok) {
                    throw new Error("로컬 서버가 백업 파일을 수신하지 못했습니다.");
                }

                alert("백업 파일이 금고 폴더에 성공적으로 복사 및 갱신되었습니다! 마스터 패스워드를 입력하여 잠금을 해제해 주세요.");
                
                // Clear input
                e.target.value = '';
                checkVaultStatus();
            } catch (err) {
                alert("백업 불러오기 실패: " + err.message);
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    }

    // Drag and Drop Zone Bindings
    function setupDragAndDropZone(zoneId, fileInputId) {
        const zone = document.getElementById(zoneId);
        const fileInput = document.getElementById(fileInputId);
        if (!zone || !fileInput) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
            }, false);
        });

        zone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                fileInput.files = files;
                // Dispatch change event manually
                const event = new Event('change');
                fileInput.dispatchEvent(event);
            }
        }, false);
    }

    // 9. HIGH QUALITY PASSWORD GENERATOR INTERFACE
    
    // Core password generation logic
    function generatePassword(length, upper, lower, nums, symbols) {
        const uppercaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lowercaseChars = 'abcdefghijklmnopqrstuvwxyz';
        const numberChars = '0123456789';
        const symbolChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

        let allowedChars = '';
        if (upper) allowedChars += uppercaseChars;
        if (lower) allowedChars += lowercaseChars;
        if (nums) allowedChars += numberChars;
        if (symbols) allowedChars += symbolChars;

        if (!allowedChars) return '';

        let password = '';
        // Ensure cryptographically secure random numbers
        const randomValues = new Uint32Array(length);
        window.crypto.getRandomValues(randomValues);

        for (let i = 0; i < length; i++) {
            password += allowedChars[randomValues[i] % allowedChars.length];
        }

        return password;
    }

    // Trigger Generator Modal Generation
    function triggerModalPasswordGeneration() {
        const len = parseInt(elements.genLength.value);
        const upper = elements.genUpper.checked;
        const lower = elements.genLower.checked;
        const nums = elements.genNums.checked;
        const symbols = elements.genSymbols.checked;

        const pwd = generatePassword(len, upper, lower, nums, symbols);
        elements.genOutputText.textContent = pwd || '옵션을 선택하세요';
        
        // Style feedback
        elements.genOutputText.style.color = pwd ? 'var(--secondary)' : 'var(--danger)';
    }

    // Clipboard Copy Utility
    function copyToClipboard(text) {
        if (!text || text === '••••••••') return;
        
        navigator.clipboard.writeText(text).then(() => {
            // Visual floating success pop alert or alert toast
            const tempAlert = document.createElement('div');
            tempAlert.style.position = 'fixed';
            tempAlert.style.bottom = '20px';
            tempAlert.style.right = '20px';
            tempAlert.style.padding = '12px 24px';
            tempAlert.style.background = 'var(--success)';
            tempAlert.style.color = '#fff';
            tempAlert.style.borderRadius = '30px';
            tempAlert.style.zIndex = '10000';
            tempAlert.style.fontWeight = 'bold';
            tempAlert.style.boxShadow = '0 4px 15px var(--success-glow)';
            tempAlert.style.fontFamily = 'var(--font-body)';
            tempAlert.style.fontSize = '0.9rem';
            tempAlert.textContent = '클립보드에 복사 완료! 📋';
            
            document.body.appendChild(tempAlert);
            
            setTimeout(() => {
                tempAlert.style.opacity = '0';
                tempAlert.style.transition = 'opacity 0.5s ease';
                setTimeout(() => tempAlert.remove(), 500);
            }, 2000);
        }).catch(err => {
            alert('복사 실패: ' + err);
        });
    }

    // Password Strength Meter
    function checkPasswordStrength(password) {
        let score = 0;
        if (!password) {
            elements.accPwdStrengthBar.style.width = '0%';
            elements.accPwdStrengthBar.style.backgroundColor = 'transparent';
            elements.accPwdStrengthLabel.textContent = "보안 수준: 입력 대기 중";
            return;
        }

        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        let pct = (score / 6) * 100;
        elements.accPwdStrengthBar.style.width = pct + '%';

        let label = "매우 위험 🚨";
        let color = 'var(--danger)';

        if (score >= 5) {
            label = "안전함 (강력함) 🔒";
            color = 'var(--success)';
        } else if (score >= 3) {
            label = "보통 (주의 요망) ⚠️";
            color = 'var(--warning)';
        }

        elements.accPwdStrengthBar.style.backgroundColor = color;
        elements.accPwdStrengthLabel.innerHTML = `보안 수준: <strong style="color: ${color}">${label}</strong>`;
    }

    // 10. MODAL DISPLAY SYSTEM
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        elements.modalOverlay.classList.remove('hidden');
        // Force reflow
        void elements.modalOverlay.offsetWidth;
        elements.modalOverlay.classList.add('active');
        
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.add('active');
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        
        modal.classList.remove('active');
        elements.modalOverlay.classList.remove('active');
        
        setTimeout(() => {
            modal.classList.add('hidden');
            elements.modalOverlay.classList.add('hidden');
        }, 300);
    }
    
    // Bind window triggers for global modal closures
    window.closeModal = closeModal;
    window.openModal = openModal;
    window.togglePasswordVisibility = function(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
        } else {
            input.type = 'password';
        }
    };

    // 11. BIND ACTIONS & EVENT LISTENERS
    function bindEvents() {
        // Auth submit buttons
        elements.btnCreateVault.addEventListener('click', handleSetupVault);
        elements.btnUnlockVault.addEventListener('click', handleUnlockVault);
        elements.btnResetWarning.addEventListener('click', resetAppVault);
        if (elements.btnWebLogin) {
            elements.btnWebLogin.addEventListener('click', handleWebLogin);
        }
        if (elements.webAccessToken) {
            elements.webAccessToken.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleWebLogin();
            });
        }

        // Auto-submit auth inputs on Enter key
        elements.masterPwd.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleUnlockVault();
        });
        elements.confirmMasterPwd.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSetupVault();
        });

        // Sidebar Actions
        elements.btnAddAccount.addEventListener('click', openCreateModal);
        elements.btnOpenSmartImport.addEventListener('click', () => {
            elements.importRawText.value = '';
            elements.importPreviewContainer.innerHTML = `<div class="preview-empty">텍스트를 분석하면 여기에 카드 목록이 생성됩니다.</div>`;
            elements.btnSubmitImported.disabled = true;
            elements.btnSubmitImported.textContent = "분석된 계정 일괄 등록하기 (0개)";
            openModal('modal-smart-import');
        });

        // Exporter & Importer
        elements.btnExportEnc.addEventListener('click', downloadEncryptedBackup);
        elements.btnExportDec.addEventListener('click', downloadPlaintextCSV);
        
        elements.fileImportSetup.addEventListener('change', handleBackupFileUpload);
        elements.fileImportUnlock.addEventListener('change', handleBackupFileUpload);

        // Drag & Drop
        setupDragAndDropZone('drop-zone-setup', 'file-import-setup');
        setupDragAndDropZone('drop-zone-unlock', 'file-import-unlock');

        // CRUD Account Form Save
        elements.accountForm.addEventListener('submit', handleSaveAccount);

        // Quick Generate inside Account Form
        elements.btnAccGenerate.addEventListener('click', () => {
            const pwd = generatePassword(16, true, true, true, true);
            elements.accPassword.value = pwd;
            checkPasswordStrength(pwd);
            // Flash input field briefly
            elements.accPassword.style.boxShadow = '0 0 15px var(--success)';
            setTimeout(() => {
                elements.accPassword.style.boxShadow = '';
            }, 500);
        });

        elements.accPassword.addEventListener('input', (e) => {
            checkPasswordStrength(e.target.value);
        });

        // Search event (debounced)
        let searchDebounce = null;
        elements.searchInput.addEventListener('input', (e) => {
            if (searchDebounce) clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                searchQuery = e.target.value;
                renderCredentials();
            }, 150);
        });

        // Category Dropdown Toggle & Selection
        const dropdownContainer = document.getElementById('category-dropdown-container');
        const dropdownTrigger = document.getElementById('category-dropdown-trigger');
        const dropdownMenu = document.getElementById('category-dropdown-menu');
        const selectedIcon = document.getElementById('selected-category-icon');
        const selectedLabel = document.getElementById('selected-category-label');
        const selectedBadge = document.getElementById('selected-category-badge');
        
        if (dropdownTrigger && dropdownMenu) {
            dropdownTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownContainer.classList.toggle('open');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (dropdownContainer && !dropdownContainer.contains(e.target)) {
                    dropdownContainer.classList.remove('open');
                }
            });
        }

        // Category Pills Navigation
        const categoryDropdownItems = document.querySelectorAll('.category-dropdown-item');
        categoryDropdownItems.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Clear search query and input when switching categories
                searchQuery = '';
                elements.searchInput.value = '';

                categoryDropdownItems.forEach(b => b.classList.remove('active'));
                
                const currentBtn = e.currentTarget;
                currentBtn.classList.add('active');
                
                activeCategory = currentBtn.dataset.category;
                
                // Update dropdown trigger text/icon/badge
                if (selectedIcon && selectedLabel && selectedBadge) {
                    const iconSpan = currentBtn.querySelector('.nav-icon');
                    const labelSpan = currentBtn.querySelector('.nav-label');
                    const badgeSpan = currentBtn.querySelector('.badge');
                    
                    selectedIcon.textContent = iconSpan ? iconSpan.textContent : '';
                    selectedLabel.textContent = labelSpan ? labelSpan.textContent : '';
                    selectedBadge.textContent = badgeSpan ? badgeSpan.textContent : '0';
                }
                
                // Update titles
                const details = categoryDetails[activeCategory] || categoryDetails['all'];
                elements.currentCategoryTitle.textContent = details.title;
                elements.currentCategoryDesc.textContent = details.desc;
                
                // Close dropdown menu
                if (dropdownContainer) {
                    dropdownContainer.classList.remove('open');
                }
                
                renderCredentials();
            });
        });

        // Password Generator Interactive controls
        elements.genLength.addEventListener('input', (e) => {
            elements.genLengthVal.textContent = e.target.value;
            triggerModalPasswordGeneration();
        });
        [elements.genUpper, elements.genLower, elements.genNums, elements.genSymbols].forEach(chk => {
            chk.addEventListener('change', triggerModalPasswordGeneration);
        });
        elements.btnTriggerGenerate.addEventListener('click', triggerModalPasswordGeneration);
        
        elements.btnCopyGen.addEventListener('click', () => {
            copyToClipboard(elements.genOutputText.textContent);
        });

        // Smart Text parser actions
        elements.btnParseText.addEventListener('click', handleSmartParse);
        elements.btnSubmitImported.addEventListener('click', submitSmartImportedItems);

        // Backdrop click to close modals
        elements.modalOverlay.addEventListener('click', () => {
            // Find active modal
            const activeModal = document.querySelector('.modal-card.active');
            if (activeModal) {
                closeModal(activeModal.id);
            }
        });
    }

    // 12. HEARTBEAT SYSTEM (Auto shutdown server when browser closes)
    function startHeartbeatSystem() {
        // Send heartbeat immediately on load
        fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});

        // Send heartbeat every 2.5 seconds
        setInterval(() => {
            fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
        }, 2500);
    }

})();
