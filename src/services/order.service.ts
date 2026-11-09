import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { ServicePackage, StudentOrder, OrderStatus, PaymentMethod } from '../types/order';
import { telegramService } from './telegram.service';

export class OrderService {
  private static instance: OrderService;
  private readonly ordersFilePath: string;
  private readonly packagesFilePath: string;
  private readonly receiptsDir: string;

  private orders: Map<string, StudentOrder> = new Map();
  private packages: Map<string, ServicePackage> = new Map();

  private constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    this.receiptsDir = path.join(dataDir, 'receipts');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.receiptsDir)) {
      fs.mkdirSync(this.receiptsDir, { recursive: true });
    }

    this.ordersFilePath = path.join(dataDir, 'orders_store.json');
    this.packagesFilePath = path.join(dataDir, 'packages_store.json');

    this.loadFromDisk();
  }

  public static getInstance(): OrderService {
    if (!OrderService.instance) {
      OrderService.instance = new OrderService();
    }
    return OrderService.instance;
  }

  private loadFromDisk() {
    try {
      // 1. Load Packages
      if (fs.existsSync(this.packagesFilePath)) {
        const raw = fs.readFileSync(this.packagesFilePath, 'utf8');
        const list: ServicePackage[] = JSON.parse(raw);
        for (const pkg of list) {
          this.packages.set(pkg.id, pkg);
        }
      } else {
        this.seedDefaultPackages();
      }

      // 2. Load Orders
      if (fs.existsSync(this.ordersFilePath)) {
        const raw = fs.readFileSync(this.ordersFilePath, 'utf8');
        const list: StudentOrder[] = JSON.parse(raw);
        for (const ord of list) {
          this.orders.set(ord.orderId, ord);
        }
        logger.info(`[OrderService] Loaded ${list.length} orders from persistent storage.`);
      }
    } catch (err: any) {
      logger.warn(`[OrderService] Failed to load data from disk: ${err.message}`);
    }
  }

  private seedDefaultPackages() {
    const defaultPackages: ServicePackage[] = [
      {
        id: 'pkg-qureo-js-g10',
        name: 'باقة كيريو جافاسكريبت (الصف الأول الثانوي)',
        grade: 'g10',
        platform: 'QUREO',
        subject: 'كيريو — جافاسكريبت',
        price: 50,
        diamonds: 210,
        estimatedDuration: '15 - 25 دقيقة',
        description: 'حل كامل لجميع الـ 42 فصلاً مع حصد 210 ماسة كاملة دون أي أخطاء.',
        features: [
          '42 فصلاً كاملاً بنسبة إنجاز 100%',
          'حصد 210 💎 ماسة كاملة',
          'استرجاع فوري من قاعدة المعرفة المعتمدة (0ms)',
          'جلسة متصفح معزولة ومؤمنة تماماً',
          'دعم مباشر ومتابعة حية عبر Terminal',
        ],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'pkg-spx-fin-g11',
        name: 'باقة سبريكس — الثقافة المالية (الصف الثاني الثانوي)',
        grade: 'g11',
        platform: 'SPRIX',
        subject: 'سبريكس — الثقافة المالية',
        price: 50,
        diamonds: 180,
        estimatedDuration: '10 - 20 دقيقة',
        description: 'حل ومراجعة الـ 6 وحدات لجميع المستويات والأنشطة التفاعلية والبطاقات المهمة.',
        features: [
          '6 وحدات كاملة من المستوى 1 إلى 9',
          'حل البطاقات والأنشطة التفاعلية والمراجعات',
          'تطابق تام مع الإجابات النموذجية الرسمية',
          'حفظ الأمان وعزل الجلسة',
        ],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'pkg-qureo-py-g11',
        name: 'باقة كيريو — بايثون (الصف الثاني الثانوي)',
        grade: 'g11',
        platform: 'QUREO',
        subject: 'كيريو — بايثون',
        price: 60,
        diamonds: 150,
        estimatedDuration: '15 - 30 دقيقة',
        description: 'حل جميع فصول كود بايثون للأنشطة والتمارين بدقة واحترافية.',
        features: [
          '10 فصول برمجة بايثون كاملة',
          'حل الشيفرات والأنشطة البرمجية المعتمدة',
          'تحكم وحماية متقدمة',
        ],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'pkg-combo-g11',
        name: 'باقة المتفوقين الشاملة — الصف الثاني الثانوي (ثقافة مالية + بايثون)',
        grade: 'g11',
        platform: 'SPX',
        subject: 'ثقافة مالية + بايثون',
        price: 90,
        diamonds: 330,
        estimatedDuration: '25 - 40 دقيقة',
        description: 'باقة متكاملة تجمع مادتي الثقافة المالية وبايثون بخصم خاص للمتفوقين.',
        features: [
          'إنجاز كامل لمادتي الثقافة المالية وبايثون',
          'أولوية تنفيذ فورية وسريعة',
          'توفير 20 ج.م مقارنة بالاشتراك المنفصل',
        ],
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const p of defaultPackages) {
      this.packages.set(p.id, p);
    }
    this.savePackagesToDisk();
  }

  private savePackagesToDisk() {
    try {
      const list = Array.from(this.packages.values());
      fs.writeFileSync(this.packagesFilePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err: any) {
      logger.error(`[OrderService] Failed to save packages: ${err.message}`);
    }
  }

  private saveOrdersToDisk() {
    try {
      const list = Array.from(this.orders.values());
      fs.writeFileSync(this.ordersFilePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err: any) {
      logger.error(`[OrderService] Failed to save orders: ${err.message}`);
    }
  }

  // --- Packages Methods ---

  public getActivePackages(): ServicePackage[] {
    return Array.from(this.packages.values()).filter((p) => p.isActive);
  }

  public getAllPackages(): ServicePackage[] {
    return Array.from(this.packages.values());
  }

  public getPackageById(id: string): ServicePackage | undefined {
    return this.packages.get(id);
  }

  public upsertPackage(pkg: Partial<ServicePackage> & { id: string }): ServicePackage {
    const existing = this.packages.get(pkg.id);
    const now = new Date().toISOString();

    const updated: ServicePackage = {
      id: pkg.id,
      name: pkg.name || existing?.name || 'باقة جديدة',
      grade: pkg.grade || existing?.grade || 'all',
      platform: pkg.platform || existing?.platform || 'SPX',
      subject: pkg.subject || existing?.subject || 'عام',
      price: typeof pkg.price === 'number' ? pkg.price : (existing?.price ?? 50),
      diamonds: typeof pkg.diamonds === 'number' ? pkg.diamonds : (existing?.diamonds ?? 210),
      estimatedDuration: pkg.estimatedDuration || existing?.estimatedDuration || '20 دقيقة',
      description: pkg.description || existing?.description || '',
      features: pkg.features || existing?.features || [],
      isActive: pkg.isActive !== undefined ? pkg.isActive : (existing?.isActive ?? true),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.packages.set(updated.id, updated);
    this.savePackagesToDisk();
    return updated;
  }

  // --- Orders Methods ---

  /**
   * Generates a short, memorable, unique Order ID (e.g. ORD-74921)
   */
  private generateOrderId(): string {
    const num = Math.floor(100000 + Math.random() * 900000);
    return `ORD-${num}`;
  }

  public async createOrder(data: {
    packageId: string;
    studentName: string;
    studentPhone: string;
    paymentMethod?: PaymentMethod;
  }): Promise<StudentOrder> {
    const pkg = this.packages.get(data.packageId);
    if (!pkg) {
      throw new Error('الباقة المحددة غير صالحة أو غير موجودة');
    }

    const orderId = this.generateOrderId();
    const now = new Date().toISOString();

    const isFree = pkg.price === 0;

    const newOrder: StudentOrder = {
      orderId,
      packageId: pkg.id,
      packageName: pkg.name,
      grade: pkg.grade,
      platform: pkg.platform,
      subject: pkg.subject,
      price: pkg.price,
      diamonds: pkg.diamonds,
      studentName: data.studentName.trim(),
      studentPhone: data.studentPhone.trim(),
      status: isFree ? 'APPROVED' : 'PENDING_PAYMENT',
      paymentMethod: isFree ? 'FREE' : (data.paymentMethod || 'INSTAPAY'),
      paymentReviewedAt: isFree ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(orderId, newOrder);
    this.saveOrdersToDisk();

    logger.info(`[OrderService] Created new order ${orderId} for student "${data.studentName}" (${pkg.name})`);

    // Notify Telegram Admin
    telegramService.notifyNewOrder({
      orderId,
      studentName: newOrder.studentName,
      packageName: newOrder.packageName,
      price: newOrder.price,
      paymentMethod: newOrder.paymentMethod || 'INSTAPAY',
    }).catch(() => {});

    return newOrder;
  }

  public getOrder(orderId: string): StudentOrder | undefined {
    return this.orders.get(orderId.trim().toUpperCase());
  }

  public getAllOrders(statusFilter?: OrderStatus): StudentOrder[] {
    const list = Array.from(this.orders.values());
    if (statusFilter) {
      return list.filter((o) => o.status === statusFilter);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Upload payment proof receipt (base64 image data)
   */
  public async uploadPaymentReceipt(
    orderId: string,
    imageBase64: string,
    method: PaymentMethod = 'INSTAPAY'
  ): Promise<StudentOrder> {
    const order = this.getOrder(orderId);
    if (!order) {
      throw new Error('لم يتم العثور على الطلب المحدد');
    }

    // Save image to disk
    const filename = `${order.orderId}_receipt_${Date.now()}.png`;
    const filepath = path.join(this.receiptsDir, filename);

    // Extract clean base64 data
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(cleanBase64, 'base64'));

    order.paymentReceiptUrl = `/api/orders/receipts/${filename}`;
    order.paymentMethod = method;
    order.status = 'PENDING_REVIEW';
    order.updatedAt = new Date().toISOString();

    this.saveOrdersToDisk();

    logger.info(`[OrderService] Receipt uploaded for order ${order.orderId}. Status -> PENDING_REVIEW`);

    // Notify Telegram Admin
    telegramService.notifyPaymentReceiptUploaded({
      orderId: order.orderId,
      studentName: order.studentName,
      packageName: order.packageName,
      price: order.price,
      paymentMethod: method,
    }).catch(() => {});

    return order;
  }

  /**
   * Admin approves payment
   */
  public async approvePayment(orderId: string, notes?: string): Promise<StudentOrder> {
    const order = this.getOrder(orderId);
    if (!order) {
      throw new Error('لم يتم العثور على الطلب');
    }

    order.status = 'APPROVED';
    order.paymentReviewedAt = new Date().toISOString();
    order.paymentReviewNotes = notes || 'تم التحقق من استلام المبلغ بنجاح';
    order.rejectionReason = undefined;
    order.updatedAt = new Date().toISOString();

    this.saveOrdersToDisk();
    logger.info(`[OrderService] Order ${order.orderId} APPROVED by admin.`);

    telegramService.notifyPaymentApproved({
      orderId: order.orderId,
      studentName: order.studentName,
      packageName: order.packageName,
    }).catch(() => {});

    return order;
  }

  /**
   * Admin rejects payment
   */
  public async rejectPayment(orderId: string, reason: string): Promise<StudentOrder> {
    const order = this.getOrder(orderId);
    if (!order) {
      throw new Error('لم يتم العثور على الطلب');
    }

    order.status = 'REJECTED';
    order.rejectionReason = reason || 'إيصال الدفع غير مطابق أو المبلغ لم يصل';
    order.paymentReviewedAt = new Date().toISOString();
    order.updatedAt = new Date().toISOString();

    this.saveOrdersToDisk();
    logger.warn(`[OrderService] Order ${order.orderId} REJECTED: ${reason}`);

    telegramService.notifyPaymentRejected({
      orderId: order.orderId,
      studentName: order.studentName,
      reason: order.rejectionReason,
    }).catch(() => {});

    return order;
  }

  /**
   * Link an active browser session to an order
   */
  public linkSession(orderId: string, sessionId: string): void {
    const order = this.getOrder(orderId);
    if (order) {
      order.sessionId = sessionId;
      order.status = 'IN_PROGRESS';
      order.updatedAt = new Date().toISOString();
      this.saveOrdersToDisk();
    }
  }

  /**
   * Mark order as completed
   */
  public completeOrder(orderId: string): void {
    const order = this.getOrder(orderId);
    if (order) {
      order.status = 'COMPLETED';
      order.updatedAt = new Date().toISOString();
      this.saveOrdersToDisk();
    }
  }

  public getReceiptFilePath(filename: string): string | null {
    const filepath = path.join(this.receiptsDir, filename);
    if (fs.existsSync(filepath)) {
      return filepath;
    }
    return null;
  }
}

export const orderService = OrderService.getInstance();
