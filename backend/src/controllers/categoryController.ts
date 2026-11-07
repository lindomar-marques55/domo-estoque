import { Response } from 'express';
import { db } from '../db';
import { AuthRequest } from '../middleware/authMiddleware';

export class CategoryController {
  static list(req: AuthRequest, res: Response): void {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json(categories);
  }

  static create(req: AuthRequest, res: Response): void {
    const { name, color, icon } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Nome da categoria é obrigatório.' });
      return;
    }

    const trimmedName = name.trim();
    const catColor = color || '#3b82f6';
    const catIcon = icon || 'tag';

    try {
      const result = db.prepare('INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)').run(trimmedName, catIcon, catColor);
      res.status(201).json({
        id: result.lastInsertRowid,
        name: trimmedName,
        icon: catIcon,
        color: catColor
      });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        res.status(400).json({ error: 'Já existe uma categoria com este nome.' });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  }

  static update(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);
    const { name, color, icon } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Nome da categoria é obrigatório.' });
      return;
    }

    const trimmedName = name.trim();
    const catColor = color || '#3b82f6';

    try {
      const result = db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?')
        .run(trimmedName, catColor, id);

      if (result.changes === 0) {
        res.status(404).json({ error: 'Categoria não encontrada.' });
        return;
      }

      res.json({ message: 'Categoria atualizada com sucesso.' });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        res.status(400).json({ error: 'Já existe uma categoria com este nome.' });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  }

  static delete(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);

    try {
      // Set category_id to NULL on products using this category
      db.transaction(() => {
        db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
        db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      })();

      res.json({ message: 'Categoria removida com sucesso.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
