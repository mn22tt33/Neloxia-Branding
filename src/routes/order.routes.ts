import { Router } from 'express';
import { orderController } from '../controllers/order.controller';

export const packageRouter = Router();
packageRouter.get('/', orderController.getPackages.bind(orderController));
packageRouter.get('/:id', (req, res) => {
  const pkg = orderController.getPackages(req, res);
});

export const orderRouter = Router();

// Packages helper inside orders
orderRouter.get('/packages', orderController.getPackages.bind(orderController));

// Create Order
orderRouter.post('/', orderController.createOrder.bind(orderController));

// Serve uploaded receipts
orderRouter.get('/receipts/:filename', orderController.serveReceipt.bind(orderController));

// Get Order Status
orderRouter.get('/:orderId', orderController.getOrderStatus.bind(orderController));

// Upload Payment Receipt
orderRouter.post('/:orderId/receipt', orderController.uploadReceipt.bind(orderController));

// Start Solving for Approved Order
orderRouter.post('/:orderId/start-solver', orderController.startSolvingForOrder.bind(orderController));

export default orderRouter;

