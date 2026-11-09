export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export type PaymentMethod = 'FREE' | 'INSTAPAY' | 'VODAFONE_CASH' | 'WALLET' | 'OTHER';

export interface ServicePackage {
  id: string;
  name: string;
  grade: 'g10' | 'g11' | 'all';
  platform: 'QUREO' | 'SPX' | 'SPRIX';
  subject: string;
  price: number;
  diamonds: number;
  estimatedDuration: string;
  description: string;
  features: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentOrder {
  orderId: string;
  packageId: string;
  packageName: string;
  grade: string;
  platform: string;
  subject: string;
  price: number;
  diamonds: number;
  studentName: string;
  studentPhone: string;
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  paymentReceiptUrl?: string;
  paymentReviewedAt?: string;
  paymentReviewNotes?: string;
  rejectionReason?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}
