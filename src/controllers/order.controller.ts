import { Request, Response } from 'express';
import { orderService } from '../services/order.service';
import { spxAutomationService } from '../services/spx-automation.service';
import { logger } from '../utils/logger';

export class OrderController {
  /**
   * GET /api/packages
   */
  public async getPackages(req: Request, res: Response) {
    try {
      const packages = orderService.getActivePackages();
      return res.json({
        success: true,
        data: packages,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/orders
   */
  public async createOrder(req: Request, res: Response) {
    try {
      const { packageId, studentName, studentPhone, paymentMethod } = req.body;

      if (!packageId || !studentName || !studentPhone) {
        return res.status(400).json({
          success: false,
          message: 'يرجى إكمال بيانات الطلب: اختيار الباقة، اسم الطالب، ورقم الهاتف/الواتساب.',
        });
      }

      const order = await orderService.createOrder({
        packageId,
        studentName,
        studentPhone,
        paymentMethod: paymentMethod || 'INSTAPAY',
      });

      return res.status(201).json({
        success: true,
        message: order.status === 'APPROVED' 
          ? 'تم تفعيل الخدمة مجاناً بنجاح! يمكنك الآن بدء الحل الفوري.' 
          : 'تم إنشاء الطلب بنجاح! يرجى سداد المبلغ ورفع إيصال التحويل للاعتماد.',
        data: order,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/orders/:orderId
   */
  public async getOrderStatus(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const order = orderService.getOrder(orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'لم يتم العثور على أي طلب مسجل بهذا الرقم.',
        });
      }

      // If order has an active session, attach live session state
      let liveSession = null;
      if (order.sessionId) {
        liveSession = spxAutomationService.getSessionState(order.sessionId);
      }

      return res.json({
        success: true,
        data: {
          order,
          session: liveSession,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/orders/:orderId/receipt
   */
  public async uploadReceipt(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const { imageBase64, paymentMethod } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,
          message: 'يرجى تحديد أو التقاط صورة إيصال التحويل.',
        });
      }

      const order = await orderService.uploadPaymentReceipt(
        orderId,
        imageBase64,
        paymentMethod || 'INSTAPAY'
      );

      return res.json({
        success: true,
        message: 'تم استلام إيصال الدفع بنجاح! جاري مراجعته من الإدارة وتفعيل الخدمة فوراً.',
        data: order,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/orders/receipts/:filename
   */
  public async serveReceipt(req: Request, res: Response) {
    try {
      const { filename } = req.params;
      const filePath = orderService.getReceiptFilePath(filename);

      if (!filePath) {
        return res.status(404).json({ success: false, message: 'ملف الإيصال غير موجود' });
      }

      return res.sendFile(filePath);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/orders/:orderId/start-solver
   * Validates payment approval before launching student solver
   */
  public async startSolvingForOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const { studentId, password } = req.body;

      const order = orderService.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'الطلب غير موجود.' });
      }

      // Strict Payment Gate: Service CANNOT run unless Approved by Admin!
      if (order.status !== 'APPROVED' && order.status !== 'IN_PROGRESS') {
        return res.status(403).json({
          success: false,
          message: `لا يمكن بدء الخدمة قبل اعتماد الإدارة للدفع. حالة الطلب الحالية: [${order.status}].`,
        });
      }

      if (!studentId || !password) {
        return res.status(400).json({
          success: false,
          message: 'يرجى إدخال كود الطالب وكلمة المرور لتسجيل الدخول في منصة SPX.',
        });
      }

      // Map package to course
      let course = 'javascript_ar';
      if (order.packageId.includes('fin')) course = 'financial_literacy';
      if (order.packageId.includes('py')) course = 'python_short_en';

      const result = await spxAutomationService.startSession(
        studentId.trim(),
        password.trim(),
        {
          grade: order.grade,
          course,
          orderId: order.orderId,
          maxLessons: order.grade === 'g10' ? 42 : 20,
        }
      );

      // Link session to order
      orderService.linkSession(order.orderId, result.sessionId);

      return res.json({
        success: true,
        message: 'تم تفعيل جلسة المتصفح المستقلة بنجاح وبدء الاتصال بالمنصة.',
        data: {
          sessionId: result.sessionId,
          orderId: order.orderId,
        },
      });
    } catch (err: any) {
      logger.error(`[OrderController] Start solver error: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export const orderController = new OrderController();
