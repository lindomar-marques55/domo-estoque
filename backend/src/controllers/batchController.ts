import { Response } from 'express';
import { db } from '../db';
import { AuthRequest } from '../middleware/authMiddleware';

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class BatchController {
  static create(req: AuthRequest, res: Response): void {
    const { product_id, initial_quantity, package_price, unit_price, entry_date, expiration_date, brand_notes } = req.body;

    if (!product_id || !initial_quantity || Number(initial_quantity) <= 0 || !entry_date) {
      res.status(400).json({ error: 'Produto, quantidade inicial e data de entrada são obrigatórios.' });
      return;
    }

    const qty = Number(initial_quantity);

    // Suporta package_price (preço total da embalagem) calculando unit_price = package_price / qty
    // Fallback para unit_price caso enviado diretamente (compatibilidade)
    const pkgPrice = Number(package_price) ?? Number(unit_price) ?? 0;
    const unitPrice = qty > 0 ? Math.round((pkgPrice / qty) * 10000) / 10000 : pkgPrice;
    const totalPrice = Math.round(pkgPrice * 100) / 100;

    const result = db.transaction(() => {
      const batchResult = db.prepare(`
        INSERT INTO batches (
          product_id, initial_quantity, current_quantity, unit_price, total_price, 
          entry_date, expiration_date, brand_notes, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        product_id, qty, qty, unitPrice, totalPrice,
        entry_date, expiration_date || null, brand_notes || null
      );

      db.prepare(`
        INSERT INTO movements (product_id, batch_id, type, quantity, unit_price, notes)
        VALUES (?, ?, 'in', ?, ?, ?)
      `).run(
        product_id, batchResult.lastInsertRowid, qty, unitPrice,
        `Adição de Lote: ${brand_notes || 'Sem observações'}`
      );

      return batchResult.lastInsertRowid;
    })();

    res.status(201).json({ message: 'Lote adicionado com sucesso.', batchId: result });
  }


  static update(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID do lote inválido.' });
      return;
    }

    const { reason } = req.body;
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      res.status(400).json({ error: 'Informe o motivo da alteração para manter o histórico auditável.' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      res.status(400).json({ error: 'O status do lote é calculado automaticamente com base na quantidade.' });
      return;
    }

    const has = (field: string) => Object.prototype.hasOwnProperty.call(req.body, field);
    const changesRequested: Record<string, string | number | null> = {};
    for (const field of ['current_quantity', 'unit_price'] as const) {
      if (!has(field)) continue;
      const raw = req.body[field];
      if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim())) {
        res.status(400).json({ error: field === 'current_quantity' ? 'Quantidade inválida.' : 'Preço unitário inválido.' });
        return;
      }
      const value = Number(raw);
      if (raw === null || raw === '' || !Number.isFinite(value) || value < 0) {
        res.status(400).json({ error: field === 'current_quantity' ? 'Quantidade deve ser um número finito maior ou igual a zero.' : 'Preço unitário deve ser um número finito maior ou igual a zero.' });
        return;
      }
      changesRequested[field] = value;
    }

    if (has('entry_date')) {
      const value = req.body.entry_date;
      if (typeof value !== 'string' || !isValidIsoDate(value)) {
        res.status(400).json({ error: 'Data de entrada inválida. Use o formato AAAA-MM-DD.' });
        return;
      }
      changesRequested.entry_date = value;
    }
    if (has('expiration_date')) {
      const value = req.body.expiration_date;
      if (value === null || value === '') {
        changesRequested.expiration_date = null;
      } else if (typeof value === 'string' && isValidIsoDate(value)) {
        changesRequested.expiration_date = value;
      } else {
        res.status(400).json({ error: 'Data de validade inválida. Use o formato AAAA-MM-DD ou deixe vazia.' });
        return;
      }
    }
    if (has('brand_notes')) {
      const value = req.body.brand_notes;
      if (value !== null && typeof value !== 'string') {
        res.status(400).json({ error: 'Marca / observações deve ser texto ou nulo.' });
        return;
      }
      changesRequested.brand_notes = value === '' ? null : value;
    }
    if (Object.keys(changesRequested).length === 0) {
      res.status(400).json({ error: 'Informe ao menos um campo para alterar.' });
      return;
    }

    try {
      const outcome = db.transaction(() => {
        const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(id) as any;
        if (!batch) return { notFound: true, changeCount: 0 };

        const next = {
          current_quantity: changesRequested.current_quantity ?? batch.current_quantity,
          unit_price: changesRequested.unit_price ?? batch.unit_price,
          entry_date: changesRequested.entry_date ?? batch.entry_date,
          expiration_date: has('expiration_date') ? changesRequested.expiration_date : batch.expiration_date,
          brand_notes: has('brand_notes') ? changesRequested.brand_notes : batch.brand_notes
        };

        const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
        for (const field of Object.keys(changesRequested)) {
          const oldValue = batch[field] ?? null;
          const newValue = (next as any)[field];
          if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
        }

        const nextStatus = Number(next.current_quantity) === 0 ? 'consumed' : 'active';
        if (batch.status !== nextStatus) {
          changes.push({ field: 'status', oldValue: batch.status, newValue: nextStatus });
        }
        if (changes.length === 0) return { notFound: false, changeCount: 0 };

        const totalPrice = Math.round(Number(next.current_quantity) * Number(next.unit_price) * 100) / 100;
        db.prepare(`
          UPDATE batches
          SET current_quantity = ?, unit_price = ?, total_price = ?, entry_date = ?,
              expiration_date = ?, brand_notes = ?, status = ?
          WHERE id = ?
        `).run(next.current_quantity, next.unit_price, totalPrice, next.entry_date,
          next.expiration_date, next.brand_notes, nextStatus, id);

        const insertAdjustment = db.prepare(`
          INSERT INTO adjustments
            (batch_id, product_id, user_id, adjustment_type, field_changed, old_value, new_value, reason)
          VALUES (?, ?, ?, 'correction', ?, ?, ?, ?)
        `);
        for (const change of changes) {
          insertAdjustment.run(id, batch.product_id, req.user!.id, change.field,
            change.oldValue === null ? '' : String(change.oldValue),
            change.newValue === null ? '' : String(change.newValue), reason.trim());
        }
        return { notFound: false, changeCount: changes.length };
      })();

      if (outcome.notFound) {
      res.status(404).json({ error: 'Lote não encontrado.' });
      return;
    }
      if (outcome.changeCount === 0) {
        res.status(400).json({ error: 'Os valores informados não alteram o lote.' });
        return;
      }
      res.json({ message: 'Lote atualizado e alterações registradas no histórico.', adjustmentsCreated: outcome.changeCount });
    } catch {
      res.status(500).json({ error: 'Não foi possível atualizar o lote e registrar o histórico.' });
    }
  }

  static delete(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM batches WHERE id = ?').run(id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Lote não encontrado.' });
      return;
    }
    res.json({ message: 'Lote removido com sucesso.' });
  }

  /**
   * Discard specific batch quantity — recorded as out_waste, NOT counted as consumption.
   */
  static discard(req: AuthRequest, res: Response): void {
    const id = Number(req.params.id);
    const { quantity, reason } = req.body;

    if (!quantity || Number(quantity) <= 0) {
      res.status(400).json({ error: 'Quantidade de descarte inválida.' });
      return;
    }

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(id) as any;
    if (!batch || batch.status !== 'active') {
      res.status(404).json({ error: 'Lote ativo não encontrado.' });
      return;
    }

    const qty = Number(quantity);
    if (qty > batch.current_quantity) {
      res.status(400).json({ error: `Quantidade (${qty}) maior que o disponível no lote (${batch.current_quantity}).` });
      return;
    }

    db.transaction(() => {
      const newQty = Math.round((batch.current_quantity - qty) * 1000) / 1000;
      const newStatus = newQty === 0 ? 'consumed' : 'active';
      db.prepare('UPDATE batches SET current_quantity = ?, status = ? WHERE id = ?')
        .run(newQty, newStatus, id);

      db.prepare(`
        INSERT INTO movements (product_id, batch_id, type, quantity, unit_price, notes)
        VALUES (?, ?, 'out_waste', ?, ?, ?)
      `).run(
        batch.product_id, batch.id, qty, batch.unit_price,
        reason?.trim() || 'Descarte por validade vencida'
      );
    })();

    res.json({ message: 'Descarte registrado com sucesso.' });
  }
}
