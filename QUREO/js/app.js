/**
 * QUERO Solver - Complete Platform Frontend Controller
 * Localhost Port 4000 Engine (Zero AI • Central Knowledge Base)
 */

class TerminalWidget {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.autoScroll = true;
    this.maxLines = options.maxLines || 600;
    this.lines = [];
  }

  log(message, level = 'info', timestamp = null) {
    if (!this.container) return;

    const time = timestamp ? timestamp.split('T')[1]?.split('.')[0] || timestamp : new Date().toTimeString().split(' ')[0];

    const existingCursor = this.container.querySelector('.cursor-blink');
    if (existingCursor) existingCursor.remove();

    const lineEl = document.createElement('div');
    lineEl.className = `log-line ${level}`;

    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = `[${time}]`;

    const msgEl = document.createElement('span');
    msgEl.className = 'log-msg';
    msgEl.textContent = message.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');

    lineEl.appendChild(timeEl);
    lineEl.appendChild(msgEl);

    this.container.appendChild(lineEl);
    this.lines.push(`[${time}] ${msgEl.textContent}`);

    if (this.lines.length > this.maxLines) {
      this.lines.shift();
      const firstLine = this.container.querySelector('.log-line');
      if (firstLine) firstLine.remove();
    }

    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    this.container.appendChild(cursor);

    if (this.autoScroll) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  clear() {
    if (!this.container) return;
    this.container.innerHTML = '<span class="cursor-blink"></span>';
    this.lines = [];
    this.log('تم مسح سجل الأوامر.', 'info');
  }

  copyAll() {
    navigator.clipboard.writeText(this.lines.join('\n'));
  }
}

class QureoApp {
  constructor() {
    const LOCAL_BACKEND = 'http://localhost:4000';
    const savedUrl = localStorage.getItem('qureo_backend_url');

    if (!savedUrl || savedUrl.includes('railway')) {
      this.backendUrl = LOCAL_BACKEND;
      localStorage.setItem('qureo_backend_url', LOCAL_BACKEND);
    } else {
      this.backendUrl = savedUrl;
    }

    this.currentOrder = null;
    this.currentSessionId = null;
    this.eventSource = null;
    this.pollInterval = null;
    this.isSolving = false;
    this.renderedLogs = new Set();
    this.packages = [];
    this.receiptBase64 = null;

    this.terminal = new TerminalWidget('terminal-body');
    this.initDOMElements();
    this.bindEvents();

    this.loadPackages();
    this.checkBackendHealth();
    setInterval(() => this.checkBackendHealth(), 10000);
  }

  initDOMElements() {
    // Navigation
    this.navTabs = document.querySelectorAll('.nav-tab');
    this.tabPanes = document.querySelectorAll('.tab-pane');

    // Packages
    this.packagesGrid = document.getElementById('packages-grid');
    this.orderPackageSelect = document.getElementById('order-package-select');
    this.summaryBox = document.getElementById('order-summary-box');
    this.summaryPackageName = document.getElementById('summary-package-name');
    this.summaryPackageDesc = document.getElementById('summary-package-desc');
    this.summaryPackagePrice = document.getElementById('summary-package-price');

    // Order Creation Form
    this.orderForm = document.getElementById('order-creation-form');
    this.orderStudentName = document.getElementById('order-student-name');
    this.orderStudentPhone = document.getElementById('order-student-phone');
    this.orderStudentId = document.getElementById('order-student-id');
    this.orderStudentPass = document.getElementById('order-student-pass');
    this.orderTogglePass = document.getElementById('order-toggle-pass');
    this.receiptFileInput = document.getElementById('receipt-file-input');
    this.receiptPlaceholder = document.getElementById('receipt-placeholder');
    this.receiptPreviewContainer = document.getElementById('receipt-preview-container');
    this.receiptPreviewImg = document.getElementById('receipt-preview-img');
    this.submitOrderBtn = document.getElementById('submit-order-btn');

    // Payment Methods
    this.paymentMethodCards = document.querySelectorAll('.payment-method-card');
    this.paymentInstapayDetails = document.getElementById('payment-details-instapay');
    this.paymentVodafoneDetails = document.getElementById('payment-details-vodafone');

    // Tracker & Solver
    this.trackOrderForm = document.getElementById('track-order-form');
    this.trackOrderInput = document.getElementById('track-order-input');
    this.orderStatusCard = document.getElementById('order-status-card');
    this.cardOrderId = document.getElementById('card-order-id');
    this.cardOrderStatusBadge = document.getElementById('card-order-status-badge');
    this.cardOrderPackageInfo = document.getElementById('card-order-package-info');
    this.cardOrderPrice = document.getElementById('card-order-price');
    this.gatePendingNotice = document.getElementById('gate-pending-notice');
    this.gateRejectedNotice = document.getElementById('gate-rejected-notice');
    this.gateRejectedReason = document.getElementById('gate-rejected-reason');
    this.solverCredentialSection = document.getElementById('solver-credential-section');

    this.solverForm = document.getElementById('start-solver-form');
    this.solverStudentId = document.getElementById('solver-student-id');
    this.solverStudentPass = document.getElementById('solver-student-pass');
    this.solverTogglePass = document.getElementById('solver-toggle-pass');
    this.solverStartBtn = document.getElementById('solver-start-btn');

    // Stats Bar
    this.statDetected = document.getElementById('stat-detected');
    this.statDiamonds = document.getElementById('stat-diamonds');
    this.statRetrieved = document.getElementById('stat-retrieved');
    this.statMissing = document.getElementById('stat-missing');
    this.progressText = document.getElementById('progress-text');
    this.progressFill = document.getElementById('progress-bar-fill');
    this.chaptersGrid = document.getElementById('chapters-grid');
    this.chaptersCountBadge = document.getElementById('chapters-count-badge');

    // Server Status
    this.statusPill = document.getElementById('server-status-pill');
    this.statusText = document.getElementById('server-status-text');

    // Terminal Controls
    this.clearTermBtn = document.getElementById('clear-term-btn');
    this.copyTermBtn = document.getElementById('copy-term-btn');

    // Settings Modal
    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsModal = document.getElementById('settings-modal');
    this.closeSettingsBtn = document.getElementById('close-settings-btn');
    this.backendUrlInput = document.getElementById('backend-url-input');
    this.presetLocalBtn = document.getElementById('preset-local');
    this.presetRailwayBtn = document.getElementById('preset-railway');
    this.saveSettingsBtn = document.getElementById('save-settings-btn');

    // Admin Modal
    this.adminModal = document.getElementById('admin-modal');
    this.adminPinScreen = document.getElementById('admin-pin-screen');
    this.adminPinInput = document.getElementById('admin-pin-input');
    this.adminWorkspace = document.getElementById('admin-workspace');
    this.adminOrdersTbody = document.getElementById('admin-orders-tbody');
    this.adminKbTbody = document.getElementById('admin-kb-tbody');
    this.missingQuestionsList = document.getElementById('missing-questions-list');
    this.activeSessionsList = document.getElementById('active-sessions-list');

    if (this.backendUrlInput) {
      this.backendUrlInput.value = this.backendUrl;
    }
  }

  bindEvents() {
    // Password toggle
    this.solverTogglePass?.addEventListener('click', () => {
      const type = this.solverStudentPass.type === 'password' ? 'text' : 'password';
      this.solverStudentPass.type = type;
      this.solverTogglePass.textContent = type === 'password' ? '👁️' : '🙈';
    });

    this.orderTogglePass?.addEventListener('click', () => {
      const type = this.orderStudentPass.type === 'password' ? 'text' : 'password';
      this.orderStudentPass.type = type;
      this.orderTogglePass.textContent = type === 'password' ? '👁️' : '🙈';
    });

    // Payment method toggle
    this.paymentMethodCards.forEach((card) => {
      card.addEventListener('click', () => {
        this.paymentMethodCards.forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        if (radio?.value === 'INSTAPAY') {
          this.paymentInstapayDetails.classList.remove('hidden');
          this.paymentVodafoneDetails.classList.add('hidden');
        } else {
          this.paymentInstapayDetails.classList.add('hidden');
          this.paymentVodafoneDetails.classList.remove('hidden');
        }
      });
    });

    // Receipt File Upload & Preview
    this.receiptFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        this.receiptBase64 = evt.target.result;
        this.receiptPreviewImg.src = this.receiptBase64;
        this.receiptPlaceholder.classList.add('hidden');
        this.receiptPreviewContainer.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });

    // Package selection change
    this.orderPackageSelect?.addEventListener('change', (e) => {
      const pkgId = e.target.value;
      const pkg = this.packages.find((p) => p.id === pkgId);
      if (pkg) {
        this.summaryPackageName.textContent = pkg.name;
        this.summaryPackageDesc.textContent = pkg.description;
        this.summaryPackagePrice.textContent = `${pkg.price} ج.م`;
      }
    });

    // Order Form Submit
    this.orderForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleCreateOrder();
    });

    // Track Order Form Submit
    this.trackOrderForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const orderId = this.trackOrderInput.value.trim();
      if (orderId) this.trackOrder(orderId);
    });

    // Solver Form Submit
    this.solverForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleStartSolver();
    });

    // Terminal clear & copy
    this.clearTermBtn?.addEventListener('click', () => this.terminal.clear());
    this.copyTermBtn?.addEventListener('click', () => {
      this.terminal.copyAll();
      const orig = this.copyTermBtn.textContent;
      this.copyTermBtn.textContent = 'تم النسخ ✓';
      setTimeout(() => (this.copyTermBtn.textContent = orig), 1500);
    });

    // Settings Modal
    this.settingsBtn?.addEventListener('click', () => {
      this.backendUrlInput.value = this.backendUrl;
      this.settingsModal.classList.add('active');
    });
    this.closeSettingsBtn?.addEventListener('click', () => {
      this.settingsModal.classList.remove('active');
    });
    this.presetLocalBtn?.addEventListener('click', () => {
      this.backendUrlInput.value = 'http://localhost:4000';
    });
    this.presetRailwayBtn?.addEventListener('click', () => {
      this.backendUrlInput.value = 'https://neloxia-branding-production.up.railway.app';
    });
    this.saveSettingsBtn?.addEventListener('click', () => {
      const url = this.backendUrlInput.value.trim().replace(/\/$/, '');
      if (url) {
        this.backendUrl = url;
        localStorage.setItem('qureo_backend_url', url);
        this.settingsModal.classList.remove('active');
        this.checkBackendHealth();
        this.loadPackages();
      }
    });
  }

  switchTab(tabId) {
    this.navTabs.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    this.tabPanes.forEach((pane) => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async checkBackendHealth() {
    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/health`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        this.statusPill.className = 'status-pill online text-[11px]';
        const isLocal = this.backendUrl.includes('localhost');
        this.statusPill.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> <span>السيرفر جاهز (${isLocal ? 'Port 4000' : 'سحابي'})</span>`;
        return true;
      }
    } catch (_) {}

    this.statusPill.className = 'status-pill offline text-[11px]';
    this.statusPill.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span> <span>غير متصل</span>';
    return false;
  }

  async loadPackages() {
    try {
      const res = await fetch(`${this.backendUrl}/api/packages`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        this.packages = data.data;
        this.renderPackages();
      }
    } catch (_) {}
  }

  renderPackages() {
    if (!this.packagesGrid || !this.orderPackageSelect) return;

    // 1. Render Home Pricing Cards
    this.packagesGrid.innerHTML = '';
    this.orderPackageSelect.innerHTML = '<option value="">-- اختر المادة التعليمية --</option>';

    this.packages.forEach((pkg, index) => {
      // Home Cards
      const card = document.createElement('div');
      card.className = 'glass-card rounded-3xl p-6 border border-slate-800 flex flex-col justify-between space-y-5 hover:border-emerald-500/50 transition-all';
      card.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-mono">
              مجاني 100% 🎁
            </span>
            <span class="text-xs text-slate-400">${pkg.estimatedDuration}</span>
          </div>

          <h3 class="text-base font-black text-white leading-snug">${pkg.name}</h3>
          <p class="text-xs text-slate-300 leading-relaxed">${pkg.description}</p>

          <ul class="space-y-1.5 pt-2 text-xs text-slate-400">
            ${(pkg.features || []).map((f) => `<li class="flex items-center gap-2"><span class="text-emerald-400">✓</span><span>${f}</span></li>`).join('')}
          </ul>
        </div>

        <div class="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <div>
            <div class="text-[10px] text-slate-400">رسوم الخدمة</div>
            <div class="text-xl font-black text-emerald-400 font-mono">مجاناً 🎁</div>
          </div>
          <button onclick="app.selectPackageAndOrder('${pkg.id}')" class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs transition-colors shadow-md shadow-emerald-500/20">
            بدء الحل مجاناً 🚀
          </button>
        </div>
      `;
      this.packagesGrid.appendChild(card);

      // Order Select Options
      const opt = document.createElement('option');
      opt.value = pkg.id;
      opt.textContent = `${pkg.name} — مجاناً 100% 🎁`;
      if (index === 0) opt.selected = true;
      this.orderPackageSelect.appendChild(opt);
    });

    if (this.packages.length > 0) {
      const p = this.packages[0];
      this.summaryPackageName.textContent = p.name;
      this.summaryPackageDesc.textContent = p.description;
      this.summaryPackagePrice.textContent = 'مجاناً 100% 🎁';
    }
  }

  selectPackageAndOrder(packageId) {
    this.switchTab('new-order');
    if (this.orderPackageSelect) {
      this.orderPackageSelect.value = packageId;
      this.orderPackageSelect.dispatchEvent(new Event('change'));
    }
  }

  async handleCreateOrder() {
    const packageId = this.orderPackageSelect.value;
    const studentId = this.orderStudentId?.value.trim();
    const password = this.orderStudentPass?.value.trim();
    const studentName = this.orderStudentName?.value.trim() || 'طالب منصة';
    const studentPhone = this.orderStudentPhone?.value.trim() || '01000000000';
    const paymentMethod = 'FREE';

    if (!packageId) {
      alert('يرجى اختيار المادة التعليمية.');
      return;
    }

    if (!studentId || !password) {
      alert('يرجى إدخال كود الطالب (Student ID) وكلمة المرور الخاصة بالمنصة.');
      return;
    }

    this.submitOrderBtn.disabled = true;
    this.submitOrderBtn.innerHTML = 'جاري إطلاق جلسة المتصفح والاتصال بالمنصة... ⏳';

    try {
      // 1. Create free auto-approved order
      const createRes = await fetch(`${this.backendUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, studentName, studentPhone, paymentMethod }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.message || 'فشل إنشاء جلسة الخدمة');
      }

      const order = createData.data;
      const orderId = order.orderId;
      this.currentOrder = order;

      // 2. Automatically launch solver session immediately!
      this.terminal.log(`تم إنشاء الطلب المجاني بنجاح: [${orderId}] للطالب (${studentId.substring(0, 3)}***).`, 'success');
      this.terminal.log('جاري تهيئة متصفح Chromium المعزول والاتصال بالمنصة التعليمية...', 'info');

      // Populate solver form inputs in tracker
      if (this.solverStudentId) this.solverStudentId.value = studentId;
      if (this.solverStudentPass) this.solverStudentPass.value = password;

      // Switch to tracker tab
      this.trackOrderInput.value = orderId;
      this.switchTab('tracker');
      this.displayOrderStatus(order);

      // Launch solver
      const solverRes = await fetch(`${this.backendUrl}/api/orders/${orderId}/start-solver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, password }),
      });

      const solverData = await solverRes.json();
      if (!solverRes.ok || !solverData.success) {
        throw new Error(solverData.message || 'فشل تشغيل جلسة المتصفح');
      }

      this.currentSessionId = solverData.data.sessionId;
      this.isSolving = true;
      this.terminal.log(`تم الاتصال بالمتصفح بنجاح! Session ID: ${this.currentSessionId.substring(0, 8)}...`, 'success');

      // Start live SSE and polling
      this.connectSSEStream(this.currentSessionId);
      this.startPolling(this.currentSessionId);

    } catch (err) {
      alert(`خطأ: ${err.message}`);
      this.terminal.log(`خطأ في بدء الخدمة: ${err.message}`, 'error');
    } finally {
      this.submitOrderBtn.disabled = false;
      this.submitOrderBtn.innerHTML = '🚀 ابدأ الحل التلقائي المباشر مجاناً الآن';
    }
  }

  displayOrderStatus(order) {
    if (!order) return;
    this.currentOrder = order;

    // Populate Order Card
    this.cardOrderId.textContent = order.orderId;
    this.cardOrderPackageInfo.textContent = `${order.packageName} — الطالب: ${order.studentName}`;
    this.cardOrderPrice.textContent = order.price === 0 ? 'مجاناً 🎁' : `${order.price} ج.م`;

    const statusMap = {
      PENDING_PAYMENT: { text: 'بانتظار سداد الرسوم', class: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
      PENDING_REVIEW: { text: 'قيد مراجعة الإدارة (الإيصال مرفوع)', class: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
      APPROVED: { text: 'مفعل وجاهز للتشغيل ✓', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
      IN_PROGRESS: { text: 'جاري الحل التلقائي المباشر ⚡', class: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      COMPLETED: { text: 'مكتمل بنجاح 🏆', class: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
      REJECTED: { text: 'تم الرفض ✗', class: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
    };

    const s = statusMap[order.status] || { text: order.status, class: 'bg-slate-800 text-slate-300' };
    this.cardOrderStatusBadge.textContent = s.text;
    this.cardOrderStatusBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold border ${s.class}`;

    // Handle Gates
    if (order.status === 'APPROVED' || order.status === 'IN_PROGRESS' || order.status === 'COMPLETED') {
      this.gatePendingNotice?.classList.add('hidden');
      this.gateRejectedNotice?.classList.add('hidden');
      this.solverCredentialSection?.classList.remove('hidden');
    } else if (order.status === 'REJECTED') {
      this.gatePendingNotice?.classList.add('hidden');
      this.solverCredentialSection?.classList.add('hidden');
      this.gateRejectedNotice?.classList.remove('hidden');
      if (this.gateRejectedReason) this.gateRejectedReason.textContent = `السبب: ${order.rejectionReason || 'غير مطابق'}`;
    } else {
      this.gatePendingNotice?.classList.remove('hidden');
      this.gateRejectedNotice?.classList.add('hidden');
      this.solverCredentialSection?.classList.add('hidden');
    }

    this.orderStatusCard.classList.remove('hidden');
  }

  async trackOrder(orderId) {
    try {
      const res = await fetch(`${this.backendUrl}/api/orders/${orderId.trim()}`);
      const data = await res.json();

      if (!res.ok || !data.success || !data.data) {
        alert('لم يتم العثور على أي طلب مسجل بهذا الرقم.');
        return;
      }

      const order = data.data.order;
      this.displayOrderStatus(order);

      // If already has active session, auto-connect
      if (order.sessionId && !this.isSolving) {
        this.currentSessionId = order.sessionId;
        this.connectSSEStream(this.currentSessionId);
        this.startPolling(this.currentSessionId);
      }
    } catch (err) {
      alert(`خطأ أثناء فحص الطلب: ${err.message}`);
    }
  }

  async handleStartSolver() {
    if (!this.currentOrder) {
      alert('يرجى تحديد وفحص الطلب أولاً.');
      return;
    }

    const studentId = this.solverStudentId.value.trim();
    const password = this.solverStudentPass.value.trim();

    if (!studentId || !password) {
      alert('يرجى إدخال كود الطالب وكلمة المرور.');
      return;
    }

    this.isSolving = true;
    this.solverStartBtn.disabled = true;
    this.solverStartBtn.innerHTML = 'جاري إنشاء الجلسة وبدء المتصفح...';

    this.terminal.log(`جاري إرسال طلب تشغيل الجلسة المعزولة للطالب (${studentId.substring(0, 3)}***)...`, 'info');

    try {
      const res = await fetch(`${this.backendUrl}/api/orders/${this.currentOrder.orderId}/start-solver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'فشل بدء الجلسة');
      }

      this.currentSessionId = data.data.sessionId;
      this.terminal.log(`تم إنشاء جلسة متصفح Chromium مستقلة بنجاح! Session ID: ${this.currentSessionId.substring(0, 8)}...`, 'success');

      // Start SSE Live stream and polling fallback
      this.connectSSEStream(this.currentSessionId);
      this.startPolling(this.currentSessionId);
    } catch (err) {
      this.terminal.log(`خطأ في بدء الجلسة: ${err.message}`, 'error');
      this.isSolving = false;
      this.solverStartBtn.disabled = false;
      this.solverStartBtn.innerHTML = '🚀 بدء التشغيل والمتابعة الحية';
    }
  }

  connectSSEStream(sessionId) {
    if (this.eventSource) this.eventSource.close();

    try {
      this.eventSource = new EventSource(`${this.backendUrl}/api/v1/spx/stream/${sessionId}`);

      this.eventSource.onopen = () => {
        this.terminal.log('تم تأسيس قناة البث المباشر (SSE Live Stream) بنجاح.', 'info');
      };

      this.eventSource.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handleLivePacket(packet);
        } catch (_) {}
      };

      this.eventSource.onerror = () => {
        this.eventSource.close();
      };
    } catch (_) {}
  }

  startPolling(sessionId) {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.backendUrl}/api/v1/spx/status/${sessionId}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data.success && data.data) {
          this.handleLivePacket(data.data);
        }
      } catch (_) {}
    }, 2500);
  }

  handleLivePacket(packet) {
    if (!packet) return;

    const data = packet.session || packet;

    // Collect all incoming logs
    const logList = [];
    if (Array.isArray(data.logs)) logList.push(...data.logs);
    else if (Array.isArray(packet.logs)) logList.push(...packet.logs);

    if (data.message) {
      logList.push({
        message: data.message,
        level: data.level || 'info',
        timestamp: data.timestamp,
      });
    }

    logList.forEach((log) => {
      const key = `${log.timestamp || ''}_${log.message}`;
      if (!this.renderedLogs.has(key)) {
        this.renderedLogs.add(key);
        this.terminal.log(log.message, log.level, log.timestamp);

        if (
          log.message.includes('ذاكرة المعرفة') ||
          log.message.includes('0ms') ||
          log.message.includes('Instant verified') ||
          log.message.includes('موثقة محفوظة') ||
          log.message.includes('استرجاع فوري')
        ) {
          const current = parseInt(this.statRetrieved.textContent, 10) || 0;
          this.statRetrieved.textContent = current + 1;
        }

        if (log.message.includes('غير مسجل') || log.message.includes('غير موجود في قاعدة')) {
          const current = parseInt(this.statMissing.textContent, 10) || 0;
          this.statMissing.textContent = current + 1;
        }
      }
    });

    // Progress
    const pct = typeof data.progressPercent === 'number'
      ? data.progressPercent
      : typeof data.percent === 'number'
      ? data.percent
      : null;

    if (pct !== null) {
      const bounded = Math.min(100, Math.max(0, pct));
      this.progressFill.style.width = `${bounded}%`;
      this.progressText.textContent = `${bounded}%`;
    }

    // Stats
    const stats = data.stats || packet.stats;
    if (stats) {
      if (stats.totalChapters) {
        this.statDetected.textContent = stats.totalChapters;
        if (this.chaptersCountBadge) this.chaptersCountBadge.textContent = `${stats.totalChapters} عنصر`;
      }
      if (typeof stats.currentChapterIndex === 'number') {
        const diamonds = Math.min(210, stats.currentChapterIndex * 5);
        this.statDiamonds.textContent = `${diamonds} / 210 💎`;
      }
      if (typeof stats.missingQuestions === 'number') {
        this.statMissing.textContent = stats.missingQuestions;
      }
    }

    // Chapters Tree
    const chapters = data.chapters || packet.chapters;
    if (chapters && Array.isArray(chapters) && chapters.length > 0) {
      this.renderChaptersGrid(chapters);
    }

    // End detection
    const status = data.status || packet.status;
    if (status === 'COMPLETED' || status === 'STOPPED' || status === 'ERROR') {
      this.handleSessionEnded(status);
    }
  }

  renderChaptersGrid(chapters) {
    if (!this.chaptersGrid) return;
    this.chaptersGrid.innerHTML = '';

    chapters.forEach((item, index) => {
      const el = document.createElement('div');
      const isDone = item.isCompleted || item.status === 'COMPLETED';
      const isActive = item.status === 'ACTIVE' || item.status === 'SOLVING';

      el.className = `p-2.5 rounded-xl border flex items-center justify-between transition-all ${
        isDone
          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
          : isActive
          ? 'bg-cyan-950/30 border-cyan-500/50 text-cyan-200 animate-pulse'
          : 'bg-slate-900/60 border-slate-800 text-slate-300'
      }`;

      el.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
            isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
          }">
            ${isDone ? '✓' : index + 1}
          </span>
          <div>
            <div class="text-xs font-bold leading-snug">${item.title || `نشاط #${index + 1}`}</div>
            <div class="text-[9px] text-slate-400">${item.type || 'نشاط تعليمي'}</div>
          </div>
        </div>
        <div class="text-xs font-mono font-bold">
          <span class="text-amber-400">💎 ${isDone ? '5/5' : '0/5'}</span>
        </div>
      `;

      this.chaptersGrid.appendChild(el);
    });
  }

  handleSessionEnded(status) {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.eventSource) this.eventSource.close();

    if (status === 'COMPLETED') {
      this.progressFill.style.width = '100%';
      this.progressText.textContent = '100%';
      this.terminal.log('🏆 تهانينا! تم الانتهاء بنجاح وحصد كافة الماسات بالكامل!', 'success');
    }

    this.isSolving = false;
    if (this.solverStartBtn) {
      this.solverStartBtn.disabled = false;
      this.solverStartBtn.innerHTML = '🚀 بدء التشغيل والمتابعة الحية';
    }
  }

  // --- ADMIN PANEL FUNCTIONS ---

  openAdminModal() {
    this.adminModal.classList.add('active');
  }

  closeAdminModal() {
    this.adminModal.classList.remove('active');
  }

  verifyAdminPin() {
    const pin = this.adminPinInput.value.trim();
    if (pin === 'admin123' || pin === '470' || pin === '1234') {
      this.adminPinScreen.classList.add('hidden');
      this.adminWorkspace.classList.remove('hidden');
      this.loadAdminOrders();
    } else {
      alert('رمز المرور غير صحيح.');
    }
  }

  switchAdminTab(atabId) {
    document.querySelectorAll('.admin-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.atab === atabId);
    });
    document.querySelectorAll('.admin-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `atab-${atabId}`);
    });

    if (atabId === 'orders') this.loadAdminOrders();
    if (atabId === 'kb') this.loadKnowledgeBase();
    if (atabId === 'missing') this.loadMissingQuestions();
    if (atabId === 'sessions') this.loadActiveSessions();
  }

  async loadAdminOrders() {
    try {
      const res = await fetch(`${this.backendUrl}/api/admin/orders`);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data)) return;

      this.adminOrdersTbody.innerHTML = '';
      if (data.data.length === 0) {
        this.adminOrdersTbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500">لا توجد طلبات مسجلة حتى الآن.</td></tr>';
        return;
      }

      data.data.forEach((ord) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/60';
        tr.innerHTML = `
          <td class="p-3 font-mono font-bold text-cyan-400">${ord.orderId}</td>
          <td class="p-3">${ord.studentName}<br><span class="text-[10px] text-slate-400 font-mono">${ord.studentPhone}</span></td>
          <td class="p-3 font-semibold text-slate-200">${ord.packageName}</td>
          <td class="p-3 font-mono font-bold text-white">${ord.price} ج.م</td>
          <td class="p-3 text-[11px] text-slate-400">${ord.paymentMethod || 'InstaPay'}</td>
          <td class="p-3">
            ${ord.paymentReceiptUrl ? `<a href="${this.backendUrl}${ord.paymentReceiptUrl}" target="_blank" class="text-cyan-400 hover:underline">عرض الإيصال 🖼️</a>` : '<span class="text-slate-500">لا يوجد</span>'}
          </td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${ord.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' : ord.status === 'PENDING_REVIEW' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400'}">
              ${ord.status}
            </span>
          </td>
          <td class="p-3 text-center">
            ${ord.status === 'PENDING_REVIEW' || ord.status === 'PENDING_PAYMENT' ? `
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="app.adminApproveOrder('${ord.orderId}')" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px]">اعتماد ✓</button>
                <button onclick="app.adminRejectOrder('${ord.orderId}')" class="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px]">رفض ✗</button>
              </div>
            ` : '<span class="text-slate-500 text-[11px]">تم الفحص</span>'}
          </td>
        `;
        this.adminOrdersTbody.appendChild(tr);
      });
    } catch (_) {}
  }

  async adminApproveOrder(orderId) {
    if (!confirm(`هل أنت متأكد من اعتماد دفع الطلب ${orderId} وتفعيل الخدمة للطالب؟`)) return;
    try {
      const res = await fetch(`${this.backendUrl}/api/admin/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'تم التأكد من استلام المبلغ بنجاح.' }),
      });
      const data = await res.json();
      if (data.success) {
        alert('تم اعتماد الطلب وتفعيل الخدمة بنجاح!');
        this.loadAdminOrders();
      }
    } catch (_) {}
  }

  async adminRejectOrder(orderId) {
    const reason = prompt('أدخل سبب رفض الإيصال لإبلاغ الطالب:', 'إيصال غير واضح أو المبلغ لم يصل');
    if (!reason) return;

    try {
      const res = await fetch(`${this.backendUrl}/api/admin/orders/${orderId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (data.success) {
        alert('تم رفض الإيصال.');
        this.loadAdminOrders();
      }
    } catch (_) {}
  }

  async loadKnowledgeBase(query = '') {
    try {
      const url = query ? `${this.backendUrl}/api/admin/knowledge-base?search=${encodeURIComponent(query)}&limit=40` : `${this.backendUrl}/api/admin/knowledge-base?limit=40`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data)) return;

      this.adminKbTbody.innerHTML = '';
      data.data.forEach((q) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/60';
        tr.innerHTML = `
          <td class="p-2.5 font-bold text-cyan-400 whitespace-nowrap">${q.subjectName || q.platformName}</td>
          <td class="p-2.5 text-slate-200 max-w-xs truncate" title="${q.rawQuestionText}">${q.rawQuestionText}</td>
          <td class="p-2.5 font-bold text-emerald-400 max-w-xs truncate" title="${q.verifiedAnswer}">${q.verifiedAnswer}</td>
          <td class="p-2.5 font-mono text-slate-400">${q.retrievalCount || 0}</td>
          <td class="p-2.5 text-center">
            <button onclick="app.adminDeleteQuestion('${q.id}')" class="text-rose-400 hover:text-rose-300 text-xs">حذف</button>
          </td>
        `;
        this.adminKbTbody.appendChild(tr);
      });
    } catch (_) {}
  }

  searchKnowledgeBase() {
    const val = document.getElementById('kb-search-input')?.value.trim();
    this.loadKnowledgeBase(val);
  }

  async adminDeleteQuestion(id) {
    if (!confirm('هل أنت متأكد من حذف هذا السؤال من قاعدة المعرفة؟')) return;
    try {
      await fetch(`${this.backendUrl}/api/admin/knowledge-base/${id}`, { method: 'DELETE' });
      this.loadKnowledgeBase();
    } catch (_) {}
  }

  async exportKnowledgeBase() {
    window.open(`${this.backendUrl}/api/admin/knowledge-base/export`, '_blank');
  }

  async openAddQuestionModal() {
    const qText = prompt('أدخل نص السؤال:');
    if (!qText) return;
    const answer = prompt('أدخل الإجابة الموثقة الصحيحة:');
    if (!answer) return;
    const subject = prompt('المادة (مثال: كيريو — جافاسكريبت أو سبريكس — الثقافة المالية):', 'كيريو — جافاسكريبت');

    try {
      const res = await fetch(`${this.backendUrl}/api/admin/knowledge-base`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: qText,
          verifiedAnswer: answer,
          options: [answer],
          subjectName: subject,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('تمت إضافة السؤال وتوثيقه بنجاح!');
        this.loadKnowledgeBase();
      }
    } catch (_) {}
  }

  async loadMissingQuestions() {
    try {
      const res = await fetch(`${this.backendUrl}/api/admin/missing-questions`);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data)) return;

      this.missingQuestionsList.innerHTML = '';
      if (data.data.length === 0) {
        this.missingQuestionsList.innerHTML = '<div class="p-8 text-center text-xs text-emerald-400 font-bold">لا توجد أسئلة مفقودة حالياً ✓ (جميع أسئلة المناهج مسجلة).</div>';
        return;
      }

      data.data.forEach((q) => {
        const card = document.createElement('div');
        card.className = 'p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2';
        card.innerHTML = `
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-amber-400">${q.subjectName || 'عام'}</span>
            <span class="text-slate-500 font-mono text-[10px]">تكرار: ${q.occurrenceCount} مرات</span>
          </div>
          <div class="text-xs font-bold text-white">${q.questionText}</div>
          <div class="text-[11px] text-slate-400">الاختيارات: ${q.options.join(' • ')}</div>
          <div class="pt-2 flex justify-end">
            <button onclick="app.adminVerifyMissingQuestion('${q.id}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
              + توثيق الإجابة وإضافتها فوراً
            </button>
          </div>
        `;
        this.missingQuestionsList.appendChild(card);
      });
    } catch (_) {}
  }

  async adminVerifyMissingQuestion(missingId) {
    const answer = prompt('أدخل الإجابة النموذجية المعتمدة لهذا السؤال:');
    if (!answer) return;

    try {
      const res = await fetch(`${this.backendUrl}/api/admin/missing-questions/${missingId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifiedAnswer: answer }),
      });
      const data = await res.json();
      if (data.success) {
        alert('تم اعتماد الإجابة ونقل السؤال لقاعدة المعرفة المركزية بنجاح!');
        this.loadMissingQuestions();
      }
    } catch (_) {}
  }

  async loadActiveSessions() {
    try {
      const res = await fetch(`${this.backendUrl}/api/admin/sessions`);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data)) return;

      this.activeSessionsList.innerHTML = '';
      if (data.data.length === 0) {
        this.activeSessionsList.innerHTML = '<div class="p-8 text-center text-xs text-slate-500">لا توجد جلسات متصفح تعمل حالياً.</div>';
        return;
      }

      data.data.forEach((s) => {
        const item = document.createElement('div');
        item.className = 'p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between';
        item.innerHTML = `
          <div>
            <div class="text-xs font-bold text-white font-mono">Session ${s.sessionId.substring(0, 8)} (${s.studentId})</div>
            <div class="text-[10px] text-slate-400">الحالة: ${s.status}</div>
          </div>
          <button onclick="app.adminStopSession('${s.sessionId}')" class="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold">
            إيقاف
          </button>
        `;
        this.activeSessionsList.appendChild(item);
      });
    } catch (_) {}
  }

  async adminStopSession(sessionId) {
    if (!confirm('هل تريد إيقاف هذه الجلسة فوراً وعزل الموارد؟')) return;
    try {
      await fetch(`${this.backendUrl}/api/admin/sessions/${sessionId}/stop`, { method: 'POST' });
      this.loadActiveSessions();
    } catch (_) {}
  }
}

// Global instance
window.app = new QureoApp();
