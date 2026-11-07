import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { AuthRequest } from '../middleware/authMiddleware';

export class AdminController {
  /**
   * List all users with their permissions.
   */
  static listUsers(req: AuthRequest, res: Response): void {
    const users = db.prepare(`
      SELECT
        u.id, u.username, u.name, u.role, u.active, u.created_at,
        up.can_view_dashboard, up.can_view_products, up.can_add_product,
        up.can_edit_product, up.can_delete_product, up.can_add_batch,
        up.can_consume_stock, up.can_discard_stock, up.can_view_projections,
        up.can_view_movements, up.can_view_corrections, up.can_make_corrections,
        up.can_manage_categories
      FROM users u
      LEFT JOIN user_permissions up ON u.id = up.user_id
      ORDER BY u.created_at ASC
    `).all();

    res.json(users);
  }

  /**
   * Create a new user with initial permissions.
   */
  static createUser(req: Request, res: Response): void {
    const { username, password, name, permissions } = req.body;

    if (!username?.trim() || !password?.trim() || !name?.trim()) {
      res.status(400).json({ error: 'username, password e name são obrigatórios.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    try {
      const hash = bcrypt.hashSync(password.trim(), 10);
      const result = db.transaction(() => {
        const userResult = db.prepare(
          'INSERT INTO users (username, password_hash, name, role, active) VALUES (?, ?, ?, ?, 1)'
        ).run(username.trim(), hash, name.trim(), 'user');

        const userId = userResult.lastInsertRowid;
        const p = permissions || {};

        db.prepare(`INSERT INTO user_permissions (
          user_id, can_view_dashboard, can_view_products, can_add_product,
          can_edit_product, can_delete_product, can_add_batch, can_consume_stock,
          can_discard_stock, can_view_projections, can_view_movements,
          can_view_corrections, can_make_corrections, can_manage_categories
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(userId,
            p.can_view_dashboard ?? 1,
            p.can_view_products ?? 1,
            p.can_add_product ?? 0,
            p.can_edit_product ?? 0,
            p.can_delete_product ?? 0,
            p.can_add_batch ?? 1,
            p.can_consume_stock ?? 1,
            p.can_discard_stock ?? 0,
            p.can_view_projections ?? 1,
            p.can_view_movements ?? 1,
            p.can_view_corrections ?? 0,
            p.can_make_corrections ?? 0,
            p.can_manage_categories ?? 0
          );

        return userId;
      })();

      res.status(201).json({ message: 'Usuário criado com sucesso.', userId: result });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        res.status(400).json({ error: 'Nome de usuário já está em uso.' });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  }

  /**
   * Update a user's permissions and basic info.
   */
  static updateUser(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);
    const { name, password, active, permissions } = req.body;

    // Prevent admin from deactivating themselves
    if (req.user?.id === id && active === 0) {
      res.status(400).json({ error: 'Você não pode desativar sua própria conta.' });
      return;
    }

    try {
      db.transaction(() => {
        // Update user info
        if (name?.trim()) {
          db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), id);
        }
        if (password?.trim() && password.trim().length >= 6) {
          const hash = bcrypt.hashSync(password.trim(), 10);
          db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, id);
        }
        if (active !== undefined) {
          db.prepare('UPDATE users SET active = ?, token_version = token_version + 1 WHERE id = ?').run(active ? 1 : 0, id);
        }

        // Update permissions if provided
        if (permissions) {
          const p = permissions;
          db.prepare(`UPDATE user_permissions SET
            can_view_dashboard = ?, can_view_products = ?, can_add_product = ?,
            can_edit_product = ?, can_delete_product = ?, can_add_batch = ?,
            can_consume_stock = ?, can_discard_stock = ?, can_view_projections = ?,
            can_view_movements = ?, can_view_corrections = ?, can_make_corrections = ?,
            can_manage_categories = ?
            WHERE user_id = ?`)
            .run(
              p.can_view_dashboard ? 1 : 0,
              p.can_view_products ? 1 : 0,
              p.can_add_product ? 1 : 0,
              p.can_edit_product ? 1 : 0,
              p.can_delete_product ? 1 : 0,
              p.can_add_batch ? 1 : 0,
              p.can_consume_stock ? 1 : 0,
              p.can_discard_stock ? 1 : 0,
              p.can_view_projections ? 1 : 0,
              p.can_view_movements ? 1 : 0,
              p.can_view_corrections ? 1 : 0,
              p.can_make_corrections ? 1 : 0,
              p.can_manage_categories ? 1 : 0,
              id
            );
        }
      })();

      res.json({ message: 'Usuário atualizado com sucesso.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Delete a user (admin cannot delete themselves).
   */
  static deleteUser(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);

    if (req.user?.id === id) {
      res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
      return;
    }

    const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
    if (!targetUser) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (targetUser.role === 'admin') {
      res.status(403).json({ error: 'Não é possível excluir outro administrador.' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ message: 'Usuário excluído com sucesso.' });
  }
}
