/**
 * Terminal UI Widget Controller
 * Manages timestamped logging, coloring, auto-scroll, and controls
 */
export class TerminalWidget {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.autoScroll = true;
    this.maxLines = options.maxLines || 500;
    this.lines = [];
  }

  /**
   * Add a log entry to the terminal
   */
  log(message, level = 'info', timestamp = null) {
    if (!this.container) return;

    const time = timestamp || new Date().toTimeString().split(' ')[0];
    
    // Remove cursor if present
    const existingCursor = this.container.querySelector('.cursor-blink');
    if (existingCursor) existingCursor.remove();

    const lineEl = document.createElement('div');
    lineEl.className = `log-line ${level}`;

    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = `[${time}]`;

    const msgEl = document.createElement('span');
    msgEl.className = 'log-msg';
    msgEl.textContent = message.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ''); // strip duplicate time if present

    lineEl.appendChild(timeEl);
    lineEl.appendChild(msgEl);

    this.container.appendChild(lineEl);
    this.lines.push(`[${time}] ${msgEl.textContent}`);

    // Re-append animated cursor
    const cursor = document.createElement('span');
    cursor.className = 'cursor-blink';
    this.container.appendChild(cursor);

    // Enforce max buffer
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
