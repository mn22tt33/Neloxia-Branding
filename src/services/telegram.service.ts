import { logger } from '../utils/logger';
import { config } from '../config';

export interface TelegramNotificationPayload {
  title: string;
  fields: Record<string, string | number | undefined>;
  footer?: string;
}

export class TelegramService {
  private static instance: TelegramService;
  private botToken: string;
  private adminChatId: string;
  private isEnabled: boolean;

  private constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    this.isEnabled = Boolean(this.botToken && this.adminChatId);

    if (this.isEnabled) {
      logger.info('[TelegramService] Telegram Admin Bot notifications initialized.');
    } else {
      logger.info('[TelegramService] Telegram notifications disabled (set TELEGRAM_BOT_TOKEN & TELEGRAM_ADMIN_CHAT_ID in .env).');
    }
  }

  public static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
    }
    return TelegramService.instance;
  }

  /**
   * Send formatted message to admin Telegram chat
   */
  public async sendMessage(message: string): Promise<boolean> {
    if (!this.isEnabled) {
      logger.debug(`[Telegram Notification Simulated]:\n${message}`);
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.adminChatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      return res.ok;
    } catch (err: any) {
      logger.warn(`[TelegramService] Failed to send notification: ${err.message}`);
      return false;
    }
  }

  /**
   * Format and send an event notification
   */
  public async notifyEvent(event: TelegramNotificationPayload): Promise<boolean> {
    let msg = `<b>${event.title}</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const [key, val] of Object.entries(event.fields)) {
      if (val !== undefined && val !== null && val !== '') {
        msg += `• <b>${key}:</b> <code>${String(val)}</code>\n`;
      }
    }
    if (event.footer) {
      msg += `━━━━━━━━━━━━━━━━━━━━\n<i>${event.footer}</i>\n`;
    }
    msg += `🕒 <i>${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}</i>`;

    return this.sendMessage(msg);
  }

  /**
   * 1. New Order Created
   */
  public async notifyNewOrder(order: {
    orderId: string;
    studentName: string;
    packageName: string;
    price: number;
    paymentMethod: string;
  }) {
    return this.notifyEvent({
      title: '📦 طلب جديد في QUERO Solver',
      fields: {
        'رقم الطلب': order.orderId,
        'اسم الطالب': order.studentName,
        'الباقة': order.packageName,
        'المبلغ': `${order.price} ج.م`,
        'طريقة الدفع': order.paymentMethod,
        'الحالة': 'بانتظار تأكيد الدفع ⏳',
      },
      footer: 'يرجى مراجعة إيصال التحويل في لوحة الإدارة.',
    });
  }

  /**
   * 2. Payment Receipt Uploaded
   */
  public async notifyPaymentReceiptUploaded(order: {
    orderId: string;
    studentName: string;
    packageName: string;
    price: number;
    paymentMethod: string;
  }) {
    return this.notifyEvent({
      title: '💳 تم رفع إثبات دفع جديد!',
      fields: {
        'رقم الطلب': order.orderId,
        'الطالب': order.studentName,
        'المبلغ': `${order.price} ج.م`,
        'وسيلة التحويل': order.paymentMethod,
        'الحالة': 'قيد مراجعة الإدارة (Pending Review) 🔍',
      },
      footer: 'افتح لوحة الإدارة لمطابقة الإيصال وتأكيد الطلب.',
    });
  }

  /**
   * 3. Payment Approved
   */
  public async notifyPaymentApproved(order: {
    orderId: string;
    studentName: string;
    packageName: string;
  }) {
    return this.notifyEvent({
      title: '✅ تم اعتماد الدفع وتفعيل الخدمة!',
      fields: {
        'رقم الطلب': order.orderId,
        'الطالب': order.studentName,
        'الباقة': order.packageName,
        'الحالة': 'معتمد وجاهز للتشغيل (Approved) 🚀',
      },
      footer: 'أصبح بإمكان الطالب بدء جلسة الحل الآن.',
    });
  }

  /**
   * 4. Payment Rejected
   */
  public async notifyPaymentRejected(order: {
    orderId: string;
    studentName: string;
    reason: string;
  }) {
    return this.notifyEvent({
      title: '❌ تم رفض إيصال الدفع',
      fields: {
        'رقم الطلب': order.orderId,
        'الطالب': order.studentName,
        'سبب الرفض': order.reason || 'إيصال غير مطابق أو لم يتم تأكيد التحويل',
      },
      footer: 'تم إشعار الطالب لإعادة رفع إيصال صحيح.',
    });
  }

  /**
   * 5. Missing Question Encountered
   */
  public async notifyMissingQuestion(q: {
    questionText: string;
    options: string[];
    subjectName?: string;
    orderId?: string;
  }) {
    return this.notifyEvent({
      title: '❓ رصد سؤال غير مسجل في قاعدة المعرفة!',
      fields: {
        'السؤال': q.questionText.substring(0, 100),
        'المادة': q.subjectName || 'عام',
        'عدد الاختيارات': q.options.length,
        'رقم الطلب': q.orderId || 'غير محدد',
        'الإجراء': 'تم الحفظ في قائمة المراجعة (لم يتم التخمين)',
      },
      footer: 'يمكنك إضافة الإجابة المعتمدة من لوحة الإدارة لتتاح للجميع فوراً.',
    });
  }

  /**
   * 6. Student Session Started
   */
  public async notifySessionStarted(session: {
    sessionId: string;
    studentIdMasked: string;
    course: string;
  }) {
    return this.notifyEvent({
      title: '🤖 بدء جلسة متصفح معزولة جديدة',
      fields: {
        'الجلسة': session.sessionId.substring(0, 8),
        'كود الطالب': session.studentIdMasked,
        'المادة': session.course,
      },
    });
  }

  /**
   * 7. Student Session Completed
   */
  public async notifySessionCompleted(session: {
    sessionId: string;
    studentIdMasked: string;
    stats: {
      totalChapters: number;
      retrievedFromMemory: number;
      missingQuestions?: number;
    };
  }) {
    return this.notifyEvent({
      title: '🏆 اكتملت جلسة المعالجة بنجاح!',
      fields: {
        'الجلسة': session.sessionId.substring(0, 8),
        'كود الطالب': session.studentIdMasked,
        'العناصر المنجزة': session.stats.totalChapters,
        'إجابات مسترجعة فورياً (0ms)': session.stats.retrievedFromMemory,
        'أسئلة غير مسجلة': session.stats.missingQuestions || 0,
      },
      footer: 'تم حصد الماسات وإغلاق المتصفح وعزل الموارد.',
    });
  }

  /**
   * 8. System Alert / Error
   */
  public async notifySystemError(error: {
    context: string;
    message: string;
    sessionId?: string;
  }) {
    return this.notifyEvent({
      title: '⚠️ تنبيه خطأ في النظام',
      fields: {
        'السياق': error.context,
        'الجلسة': error.sessionId ? error.sessionId.substring(0, 8) : 'عام',
        'تفاصيل الخطأ': error.message.substring(0, 150),
      },
    });
  }
}

export const telegramService = TelegramService.getInstance();
