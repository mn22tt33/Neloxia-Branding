import { TerminalWidget } from './terminal.js';

class QureoApp {
  constructor() {
    this.backendUrl = localStorage.getItem('qureo_backend_url') || this.detectDefaultBackend();
    this.currentSessionId = null;
    this.eventSource = null;
    this.socket = null;
    this.isSolving = false;

    // Initialize UI Elements
    this.terminal = new TerminalWidget('terminal-body');
    this.initDOMElements();
    this.bindEvents();
    this.checkBackendHealth();

    // Auto health check every 15 seconds
    setInterval(() => this.checkBackendHealth(), 15000);
  }

  detectDefaultBackend() {
    // If running on local server, point to local backend port 4000
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    // Otherwise fallback to Railway default or current origin
    return window.location.origin;
  }

  initDOMElements() {
    // Inputs & Buttons
    this.studentIdInput = document.getElementById('student-id');
    this.passwordInput = document.getElementById('student-pass');
    this.togglePassBtn = document.getElementById('toggle-pass');
    this.startBtn = document.getElementById('start-btn');
    this.stopBtn = document.getElementById('stop-btn');
    
    // Status & Counters
    this.statusPill = document.getElementById('server-status-pill');
    this.statusText = document.getElementById('server-status-text');
    this.progressFill = document.getElementById('progress-bar-fill');
    this.progressText = document.getElementById('progress-text');
    
    this.statDetected = document.getElementById('stat-detected');
    this.statSaved = document.getElementById('stat-saved');
    this.statRetrieved = document.getElementById('stat-retrieved');

    // Chapters Container
    this.chaptersGrid = document.getElementById('chapters-grid');

    // Settings Modal
    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsModal = document.getElementById('settings-modal');
    this.backendUrlInput = document.getElementById('backend-url-input');
    this.saveSettingsBtn = document.getElementById('save-settings-btn');
    this.closeSettingsBtn = document.getElementById('close-settings-btn');

    // Terminal Controls
    this.clearTermBtn = document.getElementById('clear-term-btn');
    this.copyTermBtn = document.getElementById('copy-term-btn');
    this.scrollTermBtn = document.getElementById('scroll-term-btn');

    if (this.backendUrlInput) {
      this.backendUrlInput.value = this.backendUrl;
    }
  }

  bindEvents() {
    // Password visibility toggle
    this.togglePassBtn?.addEventListener('click', () => {
      const type = this.passwordInput.type === 'password' ? 'text' : 'password';
      this.passwordInput.type = type;
      this.togglePassBtn.innerHTML = type === 'password' 
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
    });

    // Start Session
    this.startBtn?.addEventListener('click', () => this.handleStartSession());

    // Stop Session
    this.stopBtn?.addEventListener('click', () => this.handleStopSession());

    // Terminal Controls
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
  }

  async checkBackendHealth() {
    try {
      this.statusPill.className = 'status-pill connecting';
      this.statusText.textContent = 'جاري التحقق...';

      const res = await fetch(`${this.backendUrl}/api/v1/spx/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok) {
        this.statusPill.className = 'status-pill online';
        this.statusText.textContent = 'متصل بالسيرفر';
      } else {
        throw new Error('Server returned non-200');
      }
    } catch {
      this.statusPill.className = 'status-pill offline';
      this.statusText.textContent = 'غير متصل بالسيرفر';
    }
  }

  async handleStartSession() {
    const studentId = this.studentIdInput.value.trim();
    const password = this.passwordInput.value.trim();

    if (!studentId || !password) {
      alert('يرجى إدخال كود الطالب وكلمة المرور للمتابعة.');
      return;
    }

    this.setSolvingState(true);
    this.terminal.clear();
    this.terminal.log('جاري إرسال طلب إنشاء جلسة مستقلة بالمنصة...', 'info');

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
        throw new Error(data.message || 'فشل بدء الجلسة');
      }

      this.currentSessionId = data.data.sessionId;
      this.terminal.log(`تم بدء الجلسة بنجاح (Session ID: ${this.currentSessionId.substring(0, 8)}...)`, 'success');

      // Erase password from UI input for student privacy
      this.passwordInput.value = '';

      // Connect to Live SSE EventStream
      this.connectSSEStream(this.currentSessionId);

    } catch (err) {
      this.terminal.log(`خطأ في بدء المعالجة: ${err.message}`, 'error');
      this.setSolvingState(false);
    }
  }

  connectSSEStream(sessionId) {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const sseUrl = `${this.backendUrl}/api/v1/spx/stream/${sessionId}`;
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'CONNECTED') return;

        // 1. Terminal Log
        if (payload.message) {
          this.terminal.log(payload.message, payload.level || 'info');
        }

        // 2. Progress Update
        if (payload.percent !== undefined) {
          this.updateProgress(payload.percent);
        }

        // 3. Stats Update
        if (payload.stats) {
          this.updateStats(payload.stats);
        }

        // 4. Session Finished
        if (payload.level === 'success' && payload.message.includes('تهانينا')) {
          this.setSolvingState(false);
          this.updateProgress(100);
        }
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };

    this.eventSource.onerror = () => {
      // Periodic status fallback polling
      this.pollSessionStatus(sessionId);
    };

    // Also poll chapters status every 4s
    this.pollInterval = setInterval(() => {
      if (this.isSolving) {
        this.pollSessionStatus(sessionId);
      }
    }, 4000);
  }

  async pollSessionStatus(sessionId) {
    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/status/${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      const session = data.data?.session;

      if (session) {
        this.updateProgress(session.progressPercent);
        this.updateStats(session.stats);
        this.renderChapters(session.chapters);

        if (session.status === 'COMPLETED' || session.status === 'STOPPED' || session.status === 'ERROR') {
          this.setSolvingState(false);
          if (this.eventSource) this.eventSource.close();
          clearInterval(this.pollInterval);
        }
      }
    } catch {}
  }

  async handleStopSession() {
    if (!this.currentSessionId) return;

    this.terminal.log('جاري إرسال طلب إيقاف الجلسة وعزل المتصفح...', 'warn');
    this.stopBtn.disabled = true;

    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.currentSessionId }),
      });

      const data = await res.json();
      if (data.success) {
        this.terminal.log('تم إيقاف الجلسة بنجاح.', 'info');
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
        <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
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

// Global Spinner Keyframe
const style = document.createElement('style');
style.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
document.head.appendChild(style);

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  new QureoApp();
});
