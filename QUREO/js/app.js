/**
 * QureoSolver Frontend Controller
 * Fully unified client compatible with Localhost & Railway Cloud Backend.
 * Features: Turbo Mode, Pre-stored 418 Knowledge Bank, Human Emulation, SSE Stream, Audio Chime.
 */

// Terminal UI Widget
class TerminalWidget {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.autoScroll = true;
    this.maxLines = options.maxLines || 600;
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
}

// Main QureoApp Controller
class QureoApp {
  constructor() {
    const HOSTED_BACKEND_URL = 'https://neloxia-branding-production.up.railway.app';
    const savedUrl = localStorage.getItem('qureo_backend_url');
    this.backendUrl = savedUrl || HOSTED_BACKEND_URL;

    this.currentSessionId = null;
    this.eventSource = null;
    this.pollInterval = null;
    this.isSolving = false;
    this.renderedLogs = new Set();

    this.terminal = new TerminalWidget('terminal-body');
    this.initDOMElements();
    this.bindEvents();
    this.initGradeSelector();

    this.checkBackendHealth();
    setInterval(() => this.checkBackendHealth(), 12000);
  }

  initDOMElements() {
    this.studentIdInput = document.getElementById('student-id');
    this.passwordInput = document.getElementById('student-pass');
    this.togglePassBtn = document.getElementById('toggle-pass');
    this.solverForm = document.getElementById('solver-form');
    this.startBtn = document.getElementById('start-btn');
    this.btnFreeTrial = document.getElementById('btn-free-trial');
    this.btnFullSolve = document.getElementById('btn-full-solve');
    this.stopBtn = document.getElementById('stop-btn');
    this.stopContainer = document.getElementById('stop-container');

    this.gradeSelect = document.getElementById('portalGrade');
    this.courseSelect = document.getElementById('portalCourse');

    this.statusPill = document.getElementById('server-status-pill');
    this.statusText = document.getElementById('server-status-text');
    this.progressFill = document.getElementById('progress-bar-fill');
    this.progressText = document.getElementById('progress-text');

    this.statDetected = document.getElementById('stat-detected');
    this.statSaved = document.getElementById('stat-saved');
    this.statRetrieved = document.getElementById('stat-retrieved');

    this.chaptersGrid = document.getElementById('chapters-grid');
    this.chaptersCountBadge = document.getElementById('chapters-count-badge');

    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsModal = document.getElementById('settings-modal');
    this.backendUrlInput = document.getElementById('backend-url-input');
    this.saveSettingsBtn = document.getElementById('save-settings-btn');
    this.closeSettingsBtn = document.getElementById('close-settings-btn');
    this.presetRailwayBtn = document.getElementById('preset-railway');
    this.presetLocalBtn = document.getElementById('preset-local');

    this.clearTermBtn = document.getElementById('clear-term-btn');
    this.copyTermBtn = document.getElementById('copy-term-btn');

    this.celebrationModal = document.getElementById('celebration-modal');
    this.closeCelebrationBtn = document.getElementById('close-celebration-btn');

    if (this.backendUrlInput) {
      this.backendUrlInput.value = this.backendUrl;
    }
  }

  initGradeSelector() {
    if (!this.gradeSelect || !this.courseSelect) return;

    const coursesByGrade = {
      g10: [
        { id: 'javascript_ar', name: '🔷 كيريو - البرمجة جافاسكريبت (42 فصلاً - 210 💎)' }
      ],
      g11: [
        { id: 'financial_literacy', name: '🔶 سبريكس - التثقيف المالي (6 وحدات كاملة)' },
        { id: 'python_short_en', name: '🟢 كيريو - البرمجة بايثون (10 فصول)' }
      ]
    };

    const updateCourses = () => {
      const selectedGrade = this.gradeSelect.value;
      const courses = coursesByGrade[selectedGrade] || coursesByGrade.g10;
      this.courseSelect.innerHTML = '';
      courses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        this.courseSelect.appendChild(opt);
      });
    };

    this.gradeSelect.addEventListener('change', updateCourses);
    updateCourses();
  }

  bindEvents() {
    // Password visibility toggle
    this.togglePassBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const type = this.passwordInput.type === 'password' ? 'text' : 'password';
      this.passwordInput.type = type;
      this.togglePassBtn.textContent = type === 'password' ? '👁️' : '🙈';
    });

    // Form submit
    this.solverForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleStartSession(10);
    });

    // Free trial CTA
    this.btnFreeTrial?.addEventListener('click', () => {
      this.handleStartSession(10);
    });

    // Full solve CTA
    this.btnFullSolve?.addEventListener('click', () => {
      this.handleStartSession(42);
    });

    // Stop button
    this.stopBtn?.addEventListener('click', () => {
      this.handleStopSession();
    });

    // Clear and Copy Terminal
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

    this.presetRailwayBtn?.addEventListener('click', () => {
      this.backendUrlInput.value = 'https://neloxia-branding-production.up.railway.app';
    });

    this.presetLocalBtn?.addEventListener('click', () => {
      this.backendUrlInput.value = 'http://localhost:4000';
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

    // Close Celebration Modal
    this.closeCelebrationBtn?.addEventListener('click', () => {
      this.celebrationModal.classList.remove('active');
    });
  }

  async checkBackendHealth() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${this.backendUrl}/api/v1/spx/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        this.statusPill.className = 'status-pill online';
        this.statusPill.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span> <span>الخادم متصل وجاهز</span>';
        return true;
      }
    } catch (_) {}

    this.statusPill.className = 'status-pill offline';
    this.statusPill.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span> <span>تعذر الاتصال بالخادم</span>';
    return false;
  }

  sanitizeCredential(str, isId = false) {
    if (!str) return '';
    const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let clean = String(str)
      .replace(/[٠-٩]/g, d => arabicNumerals.indexOf(d))
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0\u3000\u0000-\u001F]/g, '')
      .trim();
    if (isId) {
      clean = clean.replace(/\s+/g, '');
    }
    return clean;
  }

  async handleStartSession(maxLessons = 10) {
    if (this.isSolving) return;

    const rawId = this.studentIdInput.value;
    const rawPass = this.passwordInput.value;
    const studentId = this.sanitizeCredential(rawId, true);
    const password = this.sanitizeCredential(rawPass, false);

    if (!studentId || !password) {
      this.terminal.log('تنبيه: يرجى إدخال كود الطالب وكلمة المرور.', 'warn');
      return;
    }

    const selectedMode = document.querySelector('input[name="solveMode"]:checked')?.value || 'turbo';
    const grade = this.gradeSelect?.value || 'g10';
    const course = this.courseSelect?.value || 'javascript_ar';

    this.isSolving = true;
    this.startBtn.disabled = true;
    this.btnFreeTrial.disabled = true;
    this.btnFullSolve.disabled = true;
    this.stopContainer.classList.remove('hidden');

    this.terminal.log(`جاري إرسال طلب بدء الحل للطالب (${studentId.substring(0, 3)}***) [النمط: ${selectedMode === 'turbo' ? '⚡ Turbo Mode' : '👤 Stealth Browser'}]...`, 'info');

    try {
      const res = await fetch(`${this.backendUrl}/api/v1/spx/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          password,
          maxLessons,
          grade,
          course,
          mode: selectedMode,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'فشل إنشاء جلسة الطالب');
      }

      this.currentSessionId = data.data.sessionId;
      this.terminal.log(`تم إنشاء جلسة الطالب بنجاح! Session ID: ${this.currentSessionId.substring(0, 8)}...`, 'success');

      // Start SSE Live Stream & Polling fallback
      this.connectSSEStream(this.currentSessionId);
      this.startPolling(this.currentSessionId);

    } catch (err) {
      this.terminal.log(`فشل بدء الجلسة: ${err.message}`, 'error');
      this.resetSolvingState();
    }
  }

  connectSSEStream(sessionId) {
    if (this.eventSource) {
      this.eventSource.close();
    }

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

          if (data.data.status === 'COMPLETED' || data.data.status === 'STOPPED' || data.data.status === 'ERROR') {
            this.handleSessionEnded(data.data.status);
          }
        }
      } catch (_) {}
    }, 2500);
  }

  handleLivePacket(packet) {
    // Process logs
    if (packet.logs && Array.isArray(packet.logs)) {
      packet.logs.forEach((log) => {
        const key = `${log.timestamp}_${log.message}`;
        if (!this.renderedLogs.has(key)) {
          this.renderedLogs.add(key);
          this.terminal.log(log.message, log.level, log.timestamp);

          // Update instant retrieval stat if mentioned
          if (log.message.includes('استرجاع الإجابة الموثقة') || log.message.includes('0ms') || log.message.includes('Instant verified')) {
            const current = parseInt(this.statRetrieved.textContent, 10) || 0;
            this.statRetrieved.textContent = current + 1;
          }
        }
      });
    }

    // Process progress
    if (typeof packet.progressPercent === 'number') {
      const pct = Math.min(100, Math.max(0, packet.progressPercent));
      this.progressFill.style.width = `${pct}%`;
      this.progressText.textContent = `${pct}%`;
    }

    // Process stats
    if (packet.stats) {
      if (packet.stats.totalChapters) {
        this.statDetected.textContent = packet.stats.totalChapters;
        if (this.chaptersCountBadge) {
          this.chaptersCountBadge.textContent = `${packet.stats.totalChapters} عنصر`;
        }
      }
    }

    // Process chapter tree
    if (packet.chapters && Array.isArray(packet.chapters) && packet.chapters.length > 0) {
      this.renderChaptersGrid(packet.chapters);
    }
  }

  renderChaptersGrid(chapters) {
    if (!this.chaptersGrid) return;
    this.chaptersGrid.innerHTML = '';

    chapters.forEach((item, index) => {
      const el = document.createElement('div');
      const isDone = item.isCompleted || item.status === 'COMPLETED';
      const isActive = item.status === 'ACTIVE' || item.status === 'SOLVING';

      el.className = `p-3 rounded-2xl border flex items-center justify-between transition-all ${
        isDone
          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
          : isActive
          ? 'bg-blue-950/30 border-blue-500/50 text-blue-200 animate-pulse'
          : 'bg-slate-900/60 border-slate-800 text-slate-300'
      }`;

      el.innerHTML = `
        <div class="flex items-center gap-2.5">
          <span class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
            isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
          }">
            ${isDone ? '✓' : index + 1}
          </span>
          <div>
            <div class="text-xs font-bold">${item.title || `نشاط #${index + 1}`}</div>
            <div class="text-[10px] text-slate-400">${item.type || 'نشاط تعليمي'}</div>
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
      this.playCelebrationChime();
      if (this.celebrationModal) {
        this.celebrationModal.classList.add('active');
      }
    }

    this.resetSolvingState();
  }

  async handleStopSession() {
    if (!this.currentSessionId) return;

    this.terminal.log('جاري إرسال طلب إيقاف الجلسة وعزل الموارد...', 'warn');

    try {
      await fetch(`${this.backendUrl}/api/v1/spx/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.currentSessionId }),
      });
      this.terminal.log('تم إيقاف الجلسة بنجاح.', 'info');
    } catch (_) {}

    this.handleSessionEnded('STOPPED');
  }

  resetSolvingState() {
    this.isSolving = false;
    this.startBtn.disabled = false;
    this.btnFreeTrial.disabled = false;
    this.btnFullSolve.disabled = false;
    this.stopContainer.classList.add('hidden');
    this.currentSessionId = null;
  }

  // Synthesizes a glorious celebration fanfare using native Web Audio API (Zero external MP3 dependencies)
  playCelebrationChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + idx * 0.12 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.42);
      });
    } catch (_) {}
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.qureoApp = new QureoApp();
});
