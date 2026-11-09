/**
 * QUERO Solver - Standalone Frontend Controller
 * Self-contained without ES module dependencies (Compatible with file://, localhost, and static hosting)
 */

// Terminal UI Component
class TerminalWidget {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.autoScroll = true;
    this.maxLines = options.maxLines || 500;
    this.lines = [];
  }

  log(message, level = 'info', timestamp = null) {
    if (!this.container) return;

    const time = timestamp || new Date().toTimeString().split(' ')[0];

    // Remove existing cursor if present
    const existingCursor = this.container.querySelector('.cursor-blink');
    if (existingCursor) existingCursor.remove();

    const lineEl = document.createElement('div');
    lineEl.className = `log-line ${level}`;

    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = `[${time}]`;

    const msgEl = document.createElement('span');
    msgEl.className = 'log-msg';
    // Strip redundant bracketed timestamp if server sent one
    msgEl.textContent = message.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');

    lineEl.appendChild(timeEl);
    lineEl.appendChild(msgEl);

    this.container.appendChild(lineEl);
    this.lines.push(`[${time}] ${msgEl.textContent}`);

    // Re-append cursor
    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    this.container.appendChild(cursor);

    // Limit buffer
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
      const firstLine = this.container.querySelector('.log-line');
      if (firstLine) firstLine.remove();
    }

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
    const text = this.lines.join('\n');
    navigator.clipboard.writeText(text);
  }

  toggleAutoScroll() {
    this.autoScroll = !this.autoScroll;
    return this.autoScroll;
  }
}

// Main Application Controller
class QureoApp {
  constructor() {
    // Hosted Railway Backend URL is strictly primary and permanent
    const HOSTED_BACKEND_URL = 'https://neloxia-branding-production.up.railway.app';
    this.defaultBackends = [HOSTED_BACKEND_URL];
    this.backendUrl = HOSTED_BACKEND_URL;
    localStorage.setItem('qureo_backend_url', HOSTED_BACKEND_URL);

    this.currentSessionId = null;
    this.eventSource = null;
    this.pollInterval = null;
    this.isSolving = false;
    this.renderedLogs = new Set();

    // Initialize UI
    this.terminal = new TerminalWidget('terminal-body');
    this.initDOMElements();
    this.bindEvents();
    
    // Initial health check and backend discovery
    this.discoverActiveBackend();
    setInterval(() => this.checkBackendHealth(), 10000);
  }

  initDOMElements() {
    this.studentIdInput = document.getElementById('student-id');
    this.passwordInput = document.getElementById('student-pass');
    this.togglePassBtn = document.getElementById('toggle-pass');
    this.startBtn = document.getElementById('start-btn');
    this.stopBtn = document.getElementById('stop-btn');

    this.statusPill = document.getElementById('server-status-pill');
    this.statusText = document.getElementById('server-status-text');
    this.progressFill = document.getElementById('progress-bar-fill');
    this.progressText = document.getElementById('progress-text');

    this.statDetected = document.getElementById('stat-detected');
    this.statSaved = document.getElementById('stat-saved');
    this.statRetrieved = document.getElementById('stat-retrieved');

    this.chaptersGrid = document.getElementById('chapters-grid');

    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsModal = document.getElementById('settings-modal');
    this.backendUrlInput = document.getElementById('backend-url-input');
    this.saveSettingsBtn = document.getElementById('save-settings-btn');
    this.closeSettingsBtn = document.getElementById('close-settings-btn');

    this.clearTermBtn = document.getElementById('clear-term-btn');
    this.copyTermBtn = document.getElementById('copy-term-btn');
    this.scrollTermBtn = document.getElementById('scroll-term-btn');

    if (this.backendUrlInput) {
      this.backendUrlInput.value = this.backendUrl;
    }
  }

  bindEvents() {
    // Password visibility toggle
    this.togglePassBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const type = this.passwordInput.type === 'password' ? 'text' : 'password';
      this.passwordInput.type = type;
      this.togglePassBtn.innerHTML = type === 'password'
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
    });

    // Start Session
    this.startBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleStartSession();
    });

    // Stop Session
    this.stopBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleStopSession();
    });

    // Terminal Actions
    this.clearTermBtn?.addEventListener('click', () => this.terminal.clear());
    this.copyTermBtn?.addEventListener('click', () => {
      this.terminal.copyAll();
      const original = this.copyTermBtn.textContent;
      this.copyTermBtn.textContent = 'تم النسخ!';
      setTimeout(() => { this.copyTermBtn.textContent = original; }, 2000);
    });
    this.scrollTermBtn?.addEventListener('click', () => {
      const active = this.terminal.toggleAutoScroll();
      this.scrollTermBtn.style.color = active ? 'var(--primary)' : 'var(--text-dim)';
    });

    // Settings Modal
    this.settingsBtn?.addEventListener('click', () => {
      this.backendUrlInput.value = this.backendUrl;
      this.settingsModal.classList.add('active');
    });
    this.closeSettingsBtn?.addEventListener('click', () => {
      this.settingsModal.classList.remove('active');
    });
    this.saveSettingsBtn?.addEventListener('click', () => {
      const url = this.backendUrlInput.value.trim().replace(/\/$/, '');
      if (url) {
        this.backendUrl = url;
        localStorage.setItem('qureo_backend_url', url);
        this.settingsModal.classList.remove('active');
        this.checkBackendHealth();
        this.terminal.log(`تم تحديث خادم Backend إلى: ${url}`, 'info');
      }
    });

    // Enter key trigger on inputs
    [this.studentIdInput, this.passwordInput].forEach(el => {
      el?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleStartSession();
        }
      });
    });
  }

  async discoverActiveBackend() {
    this.statusPill.className = 'status-pill connecting';
    this.statusText.textContent = 'جاري البحث عن الخادم...';

    // Prioritize candidates based on environment
    const candidates = [
      this.backendUrl,
      ...this.defaultBackends,
    ];

    const uniqueCandidates = Array.from(new Set(candidates));

    for (const url of uniqueCandidates) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`${url}/api/v1/spx/health`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          this.backendUrl = url;
          localStorage.setItem('qureo_backend_url', url);
          this.setOnlineStatus(url);
          this.terminal.log(`تم الاتصال بنجاح بخادم Backend: ${url}`, 'success');
          return;
        }
      } catch (e) {
        // Continue searching
      }
    }

    this.statusPill.className = 'status-pill offline';
    this.statusText.textContent = 'غير متصل بالسيرفر';
    this.terminal.log('تنبيه: تعذر الاتصال التلقائي بالخادم. يرجى التأكد من تشغيل السيرفر أو فحص رابط الإعدادات ⚙️.', 'warn');
  }

  async checkBackendHealth() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${this.backendUrl}/api/v1/spx/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        this.setOnlineStatus(this.backendUrl);
      } else {
        throw new Error('Not OK');
      }
    } catch {
      this.statusPill.className = 'status-pill offline';
      this.statusText.textContent = 'غير متصل بالسيرفر';
    }
  }

  setOnlineStatus(url) {
    this.statusPill.className = 'status-pill online';
    const isRailway = url.includes('railway');
    this.statusText.textContent = isRailway ? 'متصل بالسيرفر (Railway ⚡)' : 'متصل بالسيرفر (محلي ⚡)';
  }

  async handleStartSession() {
    const studentId = this.studentIdInput.value.trim();
    const password = this.passwordInput.value.trim();

    if (!studentId) {
      this.studentIdInput.focus();
      this.terminal.log('يرجى كتابة كود الطالب أولاً.', 'warn');
      return;
    }

    if (!password) {
      this.passwordInput.focus();
      this.terminal.log('يرجى كتابة كلمة المرور للمتابعة.', 'warn');
      return;
    }

    this.setSolvingState(true);
    this.renderedLogs.clear();
    this.terminal.clear();
    this.terminal.log(`جاري إرسال طلب إنشاء جلسة معزولة للطالب (${studentId.substring(0, 3)}***)...`, 'info');

    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ studentId, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'فشل بدء الجلسة في السيرفر');
      }

      this.currentSessionId = data.data.sessionId;
      this.terminal.log(`تم إنشاء جلسة الطالب بنجاح! Session ID: ${this.currentSessionId.substring(0, 8)}...`, 'success');

      // Erase password from UI for student privacy
      this.passwordInput.value = '';

      // Connect to Live SSE stream
      this.connectSSEStream(this.currentSessionId);

    } catch (err) {
      this.terminal.log(`خطأ في تشغيل الجلسة: ${err.message}`, 'error');
      this.setSolvingState(false);
    }
  }

  connectSSEStream(sessionId) {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const sseUrl = `${this.backendUrl}/api/v1/spx/stream/${sessionId}`;
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onopen = () => {
      this.terminal.log('تم تأسيس قناة البث المباشر (SSE Live Stream) بنجاح.', 'info');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'CONNECTED') return;

        // Terminal Log
        if (payload.message && !this.renderedLogs.has(payload.message)) {
          this.renderedLogs.add(payload.message);
          this.terminal.log(payload.message, payload.level || 'info');
        }

        // Progress Update
        if (payload.percent !== undefined) {
          this.updateProgress(payload.percent);
        }

        // Stats Update
        if (payload.stats) {
          this.updateStats(payload.stats);
        }

        // Session Finished
        if (payload.level === 'success' && payload.message.includes('تهانينا')) {
          this.setSolvingState(false);
          this.updateProgress(100);
        }
      } catch (e) {
        console.error('SSE Error', e);
      }
    };

    this.eventSource.onerror = () => {
      // Fallback: Immediate Status Polling
      this.pollSessionStatus(sessionId);
    };

    // Periodic polling to update chapters grid and retrieve buffered server logs
    clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => {
      if (this.isSolving) {
        this.pollSessionStatus(sessionId);
      }
    }, 1500); // Fast 1.5s polling
  }

  async pollSessionStatus(sessionId) {
    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/status/${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      const session = data.data?.session;

      if (session) {
        // Replay any server logs that were buffered
        if (Array.isArray(session.logs)) {
          session.logs.forEach((log) => {
            if (!this.renderedLogs.has(log.message)) {
              this.renderedLogs.add(log.message);
              this.terminal.log(log.message, log.level || 'info');
            }
          });
        }

        this.updateProgress(session.progressPercent);
        this.updateStats(session.stats);
        this.renderChapters(session.chapters);

        if (session.status === 'ERROR') {
          if (session.errorMessage) {
            this.terminal.log(`[خطأ السيرفر]: ${session.errorMessage}`, 'error');
          }
          this.setSolvingState(false);
          if (this.eventSource) this.eventSource.close();
          clearInterval(this.pollInterval);
        } else if (session.status === 'COMPLETED' || session.status === 'STOPPED') {
          this.setSolvingState(false);
          if (this.eventSource) this.eventSource.close();
          clearInterval(this.pollInterval);
        }
      }
    } catch {}
  }

  async handleStopSession() {
    if (!this.currentSessionId) return;

    this.terminal.log('جاري إرسال أمر إيقاف الجلسة وعزل المتصفح...', 'warn');
    this.stopBtn.disabled = true;

    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.currentSessionId }),
      });

      const data = await res.json();
      if (data.success) {
        this.terminal.log('تم إيقاف الجلسة بنجاح وعزل الموارد.', 'info');
      }
    } catch (err) {
      this.terminal.log(`خطأ أثناء إيقاف الجلسة: ${err.message}`, 'error');
    } finally {
      this.setSolvingState(false);
      if (this.eventSource) this.eventSource.close();
      clearInterval(this.pollInterval);
    }
  }

  setSolvingState(isSolving) {
    this.isSolving = isSolving;
    if (this.startBtn) this.startBtn.disabled = isSolving;
    if (this.stopBtn) this.stopBtn.disabled = !isSolving;
    if (this.studentIdInput) this.studentIdInput.disabled = isSolving;
    if (this.passwordInput) this.passwordInput.disabled = isSolving;

    if (isSolving) {
      this.startBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
        </svg>
        <span>جارٍ الحل التلقائي...</span>
      `;
    } else {
      this.startBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>بدء الحل الذكي ⚡</span>
      `;
    }
  }

  updateProgress(percent) {
    const val = Math.min(100, Math.max(0, Math.round(percent)));
    if (this.progressFill) this.progressFill.style.width = `${val}%`;
    if (this.progressText) this.progressText.textContent = `${val}%`;
  }

  updateStats(stats) {
    if (!stats) return;
    if (this.statDetected) this.statDetected.textContent = stats.detectedQuestions ?? 0;
    if (this.statSaved) this.statSaved.textContent = stats.savedToKnowledge ?? 0;
    if (this.statRetrieved) this.statRetrieved.textContent = stats.retrievedFromMemory ?? 0;
  }

  renderChapters(chapters) {
    if (!this.chaptersGrid || !Array.isArray(chapters)) return;
    if (chapters.length === 0) return;

    this.chaptersGrid.innerHTML = '';

    chapters.forEach((ch) => {
      const card = document.createElement('div');
      card.className = 'chapter-card';

      let badgeClass = 'badge-pending';
      let badgeLabel = 'في الانتظار';

      switch (ch.status) {
        case 'EXPLORING':
          badgeClass = 'badge-exploring';
          badgeLabel = 'جارٍ الاستكشاف';
          break;
        case 'SOLVING':
          badgeClass = 'badge-solving';
          badgeLabel = 'جارٍ معالجة الأسئلة';
          break;
        case 'REVIEW':
          badgeClass = 'badge-review';
          badgeLabel = 'يحتاج مراجعة';
          break;
        case 'COMPLETED':
          badgeClass = 'badge-completed';
          badgeLabel = 'مكتمل ✓';
          break;
        case 'ERROR':
          badgeClass = 'badge-error';
          badgeLabel = 'حدث خطأ';
          break;
      }

      card.innerHTML = `
        <div class="chapter-info">
          <span class="chapter-title">${ch.title}</span>
          <span class="chapter-unit">${ch.unitName || 'الوحدة الدراسية'}</span>
        </div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      `;

      this.chaptersGrid.appendChild(card);
    });
  }
}

// Add CSS keyframes for loading spinner
const styleEl = document.createElement('style');
styleEl.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
document.head.appendChild(styleEl);

// Launch on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.qureoApp = new QureoApp(); });
} else {
  window.qureoApp = new QureoApp();
}
