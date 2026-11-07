import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import '../config';
import { db } from '../db';

const JWT_SECRET = process.env.JWT_SECRET!;

export interface UserPermissions {
  can_view_dashboard: number;
  can_view_products: number;
  can_add_product: number;
  can_edit_product: number;
  can_delete_product: number;
  can_add_batch: number;
  can_consume_stock: number;
  can_discard_stock: number;
  can_view_projections: number;
  can_view_movements: number;
  can_view_corrections: number;
  can_make_corrections: number;
  can_manage_categories: number;
}

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    name: string;
    role: string;
    token_version: number;
    must_change_password?: number;
    permissions?: UserPermissions;
  };
}

type AuthenticatedSessionRow = {
  id: number;
  username: string;
  name: string;
  role: string;
  active: number;
  must_change_password: number;
  token_version: number;
} & UserPermissions;

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Acesso não autorizado. Token ausente.' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(401).json({ error: 'Token inválido ou expirado. Faça login novamente.' });
      return;
    }
    const claims = decoded as { id?: number; token_version?: number };
    if (!Number.isSafeInteger(claims.id) || !Number.isSafeInteger(claims.token_version)) {
      res.status(401).json({ error: 'Sessão antiga ou inválida. Faça login novamente.' });
      return;
    }

    try {
      const session = db.prepare(`
        SELECT u.id, u.username, u.name, u.role, u.active, u.must_change_password, u.token_version,
          up.can_view_dashboard, up.can_view_products, up.can_add_product, up.can_edit_product,
          up.can_delete_product, up.can_add_batch, up.can_consume_stock, up.can_discard_stock,
          up.can_view_projections, up.can_view_movements, up.can_view_corrections,
          up.can_make_corrections, up.can_manage_categories
        FROM users u
        LEFT JOIN user_permissions up ON up.user_id = u.id
        WHERE u.id = ?
      `).get(claims.id) as AuthenticatedSessionRow | undefined;

      if (!session || !session.active || claims.token_version !== session.token_version) {
        res.status(401).json({ error: 'Sessão revogada ou conta desativada. Faça login novamente.' });
        return;
      }

      req.user = {
        id: session.id,
        username: session.username,
        name: session.name,
        role: session.role,
        token_version: session.token_version,
        must_change_password: session.must_change_password,
        permissions: {
          can_view_dashboard: session.can_view_dashboard,
          can_view_products: session.can_view_products,
          can_add_product: session.can_add_product,
          can_edit_product: session.can_edit_product,
          can_delete_product: session.can_delete_product,
          can_add_batch: session.can_add_batch,
          can_consume_stock: session.can_consume_stock,
          can_discard_stock: session.can_discard_stock,
          can_view_projections: session.can_view_projections,
          can_view_movements: session.can_view_movements,
          can_view_corrections: session.can_view_corrections,
          can_make_corrections: session.can_make_corrections,
          can_manage_categories: session.can_manage_categories
        }
      };
      next();
    } catch {
      res.status(500).json({ error: 'Não foi possível validar a sessão.' });
    }
  });
}

/**
 * Middleware that checks a specific permission key.
 * Admin role bypasses all checks.
 */
export function requirePermission(permission: keyof UserPermissions) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (req.user.role === 'admin') {
      next();
      return;
    }
    if (!req.user.permissions?.[permission]) {
      res.status(403).json({ error: `Permissão negada: ${permission}` });
      return;
    }
    next();
  };
}

/**
 * Middleware that restricts access to admin role only.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    return;
  }
  next();
}

export { JWT_SECRET };
