import './config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './db';
import { AuthController } from './controllers/authController';
import { ProductController } from './controllers/productController';
import { BatchController } from './controllers/batchController';
import { MovementController } from './controllers/movementController';
import { AnalyticsController } from './controllers/analyticsController';
import { AdjustmentController } from './controllers/adjustmentController';
import { AdminController } from './controllers/adminController';
import { CategoryController } from './controllers/categoryController';
import { AuthRequest, authenticateToken, requirePermission, requireAdmin } from './middleware/authMiddleware';

dotenv.config();

// Inicializa banco de dados SQLite
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rotas públicas
app.post('/api/auth/login', AuthController.login);

// Todas as outras rotas exigem autenticação
app.use('/api', authenticateToken);
app.use('/api', (req: AuthRequest, res, next) => {
  if (req.user?.must_change_password && !['/auth/me', '/auth/change-password'].includes(req.path)) {
    res.status(403).json({
      error: 'É obrigatório alterar a senha inicial antes de usar o sistema.',
      code: 'PASSWORD_CHANGE_REQUIRED'
    });
    return;
  }
  next();
});

// Auth
app.get('/api/auth/me', AuthController.me);
app.post('/api/auth/change-password', AuthController.changePassword);

// Categorias
app.get('/api/categories', CategoryController.list);
app.post('/api/categories', requirePermission('can_manage_categories'), CategoryController.create);
app.put('/api/categories/:id', requirePermission('can_manage_categories'), CategoryController.update);
app.delete('/api/categories/:id', requirePermission('can_manage_categories'), CategoryController.delete);

// Produtos & FIFO
app.get('/api/products', requirePermission('can_view_products'), ProductController.listAll);
app.get('/api/products/:id', requirePermission('can_view_products'), ProductController.getById);
app.post('/api/products', requirePermission('can_add_product'), ProductController.create);
app.put('/api/products/:id', requirePermission('can_edit_product'), ProductController.update);
app.delete('/api/products/:id', requirePermission('can_delete_product'), ProductController.delete);
app.get('/api/products/:id/fifo-preview', requirePermission('can_consume_stock'), ProductController.fifoPreview);
app.post('/api/products/:id/consume', requirePermission('can_consume_stock'), ProductController.consumeFifo);

// Lotes / Compras
app.post('/api/batches', requirePermission('can_add_batch'), BatchController.create);
app.put('/api/batches/:id', requirePermission('can_edit_product'), BatchController.update);
app.delete('/api/batches/:id', requirePermission('can_delete_product'), BatchController.delete);
app.post('/api/batches/:id/discard', requirePermission('can_discard_stock'), BatchController.discard);

// Movimentações & Projeções
app.get('/api/movements', requirePermission('can_view_movements'), MovementController.list);
app.get('/api/analytics/dashboard', requirePermission('can_view_dashboard'), AnalyticsController.getDashboard);
app.get('/api/analytics/projections', requirePermission('can_view_projections'), AnalyticsController.getProjections);

// Ajustes de Inventário (correções sem afetar consumo)
app.get('/api/adjustments', requirePermission('can_view_corrections'), AdjustmentController.list);
app.post('/api/adjustments', requirePermission('can_make_corrections'), AdjustmentController.create);

// Admin — apenas administradores
app.get('/api/admin/users', requireAdmin, AdminController.listUsers);
app.post('/api/admin/users', requireAdmin, AdminController.createUser);
app.put('/api/admin/users/:id', requireAdmin, AdminController.updateUser);
app.delete('/api/admin/users/:id', requireAdmin, AdminController.deleteUser);

// Servir frontend
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Endpoint não encontrado.' });
    return;
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[DomoEstoque Server] Rodando na porta ${PORT}`);
  console.log(`[DomoEstoque Server] Acesso local: http://localhost:${PORT}`);
});
