import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { JWT_SECRET, AuthRequest } from '../middleware/authMiddleware';

export class AuthController {
  static login(req: Request, res: Response): void {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user) {
      res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      return;
    }

    if (!user.active) {
      res.status(403).json({ error: 'Usuário desativado. Contate o administrador.' });
      return;
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      return;
    }

    // Load permissions (admin gets full set, users get their assigned set)
    const perms = db.prepare('SELECT * FROM user_permissions WHERE user_id = ?').get(user.id) as any;
    const permissions = user.role === 'admin'
      ? {
          can_view_dashboard: 1, can_view_products: 1, can_add_product: 1,
          can_edit_product: 1, can_delete_product: 1, can_add_batch: 1,
          can_consume_stock: 1, can_discard_stock: 1, can_view_projections: 1,
          can_view_movements: 1, can_view_corrections: 1, can_make_corrections: 1,
          can_manage_categories: 1
        }
      : perms || {};

    const token = jwt.sign(
      { id: user.id, token_version: user.token_version },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        must_change_password: user.must_change_password,
        permissions
      }
    });
  }

  static me(req: AuthRequest, res: Response): void {
    res.json({ user: req.user });
  }

  static changePassword(req: AuthRequest, res: Response): void {
    const { current_password, new_password } = req.body;
    if (typeof current_password !== 'string' || typeof new_password !== 'string') {
      res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
      return;
    }
    if (new_password.length < 12 || Buffer.byteLength(new_password, 'utf8') > 72) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' });
      return;
    }

    const user = db.prepare('SELECT id, password_hash, must_change_password FROM users WHERE id = ? AND active = 1')
      .get(req.user!.id) as { id: number; password_hash: string; must_change_password: number } | undefined;
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      res.status(401).json({ error: 'Senha atual incorreta.' });
      return;
    }
    if (bcrypt.compareSync(new_password, user.password_hash)) {
      res.status(400).json({ error: 'A nova senha precisa ser diferente da senha atual.' });
      return;
    }

    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(new_password, 12), user.id);
    res.json({ message: 'Senha alterada. Entre novamente com a nova senha.' });
  }
}
