import { Response } from 'express';
import { db } from '../db';
import { AuthRequest } from '../middleware/authMiddleware';

export class AdjustmentController {
  /**
   * List all adjustments with product/batch info, newest first.
   */
  static list(req: AuthRequest, res: Response): void {
    const adjustments = db.prepare(`
      SELECT
        a.*,
        p.name as product_name,
        p.unit as product_unit,
        u.name as user_name,
        u.username as user_username
      FROM adjustments a
      JOIN products p ON a.product_id = p.id
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 200
    `).all();

    res.json(adjustments);
  }

  /**
   * Create an inventory adjustment.
   * Directly modifies the batch field and logs the change.
   * Does NOT create a movement entry — keeping consumption metrics clean.
   */
  static create(req: AuthRequest, res: Response): void {
    const { batch_id, field_changed, new_value, reason } = req.body;

    if (!batch_id || !field_changed || new_value === undefined || new_value === null || !reason?.trim()) {
      res.status(400).json({ error: 'batch_id, field_changed, new_value e reason são obrigatórios.' });
      return;
    }

    const allowedFields = ['current_quantity', 'unit_price', 'expiration_date', 'brand_notes', 'entry_date'];
    if (!allowedFields.includes(field_changed)) {
      res.status(400).json({ error: `Campo '${field_changed}' não é permitido para ajuste.` });
      return;
    }

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batch_id) as any;
    if (!batch) {
      res.status(404).json({ error: 'Lote não encontrado.' });
      return;
    }

    const old_value = String(batch[field_changed] ?? '');

    // Validate numeric fields
    if (field_changed === 'current_quantity') {
      const qty = Number(new_value);
      if (!Number.isFinite(qty) || qty < 0) {
        res.status(400).json({ error: 'Quantidade inválida. Deve ser >= 0.' });
        return;
      }
    }
    if (field_changed === 'unit_price') {
      const price = Number(new_value);
      if (!Number.isFinite(price) || price < 0) {
        res.status(400).json({ error: 'Preço inválido. Deve ser >= 0.' });
        return;
      }
    }

    try {
      db.transaction(() => {
        // Apply the correction directly to the batch
        if (field_changed === 'current_quantity') {
          const qty = Number(new_value);
          const totalPrice = Math.round(qty * batch.unit_price * 100) / 100;
          const newStatus = qty === 0 ? 'consumed' : 'active';
          db.prepare('UPDATE batches SET current_quantity = ?, total_price = ?, status = ? WHERE id = ?')
            .run(qty, totalPrice, newStatus, batch_id);
          if (batch.status !== newStatus) {
            db.prepare(`
              INSERT INTO adjustments (batch_id, product_id, user_id, adjustment_type, field_changed, old_value, new_value, reason)
              VALUES (?, ?, ?, 'correction', 'status', ?, ?, ?)
            `).run(batch_id, batch.product_id, req.user!.id, batch.status, newStatus, reason.trim());
          }
        } else if (field_changed === 'unit_price') {
          const price = Number(new_value);
          const totalPrice = Math.round(batch.current_quantity * price * 100) / 100;
          db.prepare('UPDATE batches SET unit_price = ?, total_price = ? WHERE id = ?')
            .run(price, totalPrice, batch_id);
        } else {
          // expiration_date, brand_notes, entry_date
          const val = new_value === '' ? null : new_value;
          db.prepare(`UPDATE batches SET ${field_changed} = ? WHERE id = ?`).run(val, batch_id);
        }

        // Log the adjustment
        db.prepare(`
          INSERT INTO adjustments (batch_id, product_id, user_id, adjustment_type, field_changed, old_value, new_value, reason)
          VALUES (?, ?, ?, 'correction', ?, ?, ?, ?)
        `).run(batch_id, batch.product_id, req.user!.id, field_changed, old_value, String(new_value), reason.trim());
      })();

      res.status(201).json({ message: 'Ajuste registrado com sucesso.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
