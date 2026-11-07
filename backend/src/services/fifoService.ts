import { db } from '../db';

export interface BatchRecord {
  id: number;
  product_id: number;
  initial_quantity: number;
  current_quantity: number;
  unit_price: number;
  total_price: number;
  entry_date: string;
  expiration_date: string | null;
  brand_notes: string | null;
  status: string;
}

export interface FifoPreviewItem {
  batch_id: number;
  entry_date: string;
  expiration_date: string | null;
  brand_notes: string | null;
  current_quantity: number;
  quantity_to_deduct: number;
  remaining_after: number;
  unit_price: number;
}

export class FifoService {
  /**
   * Preview how a FIFO consumption will affect active batches without mutating database
   */
  static previewConsumption(productId: number, quantityToConsume: number): {
    possible: boolean;
    totalAvailable: number;
    items: FifoPreviewItem[];
  } {
    const batches = db.prepare(`
      SELECT * FROM batches 
      WHERE product_id = ? AND current_quantity > 0 AND status = 'active'
      ORDER BY 
        CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END,
        expiration_date ASC,
        entry_date ASC,
        id ASC
    `).all(productId) as BatchRecord[];

    const totalAvailable = batches.reduce((sum, b) => sum + b.current_quantity, 0);

    if (quantityToConsume > totalAvailable) {
      return { possible: false, totalAvailable, items: [] };
    }

    let remainingNeeded = quantityToConsume;
    const items: FifoPreviewItem[] = [];

    for (const batch of batches) {
      if (remainingNeeded <= 0) break;

      const deduct = Math.min(batch.current_quantity, remainingNeeded);
      items.push({
        batch_id: batch.id,
        entry_date: batch.entry_date,
        expiration_date: batch.expiration_date,
        brand_notes: batch.brand_notes,
        current_quantity: batch.current_quantity,
        quantity_to_deduct: deduct,
        remaining_after: batch.current_quantity - deduct,
        unit_price: batch.unit_price
      });

      remainingNeeded -= deduct;
    }

    return { possible: true, totalAvailable, items };
  }

  /**
   * Execute FIFO consumption atomically within a transaction
   */
  static executeConsumption(
    productId: number,
    quantityToConsume: number,
    type: 'out_consumption' | 'out_waste' | 'adjustment' = 'out_consumption',
    notes?: string
  ) {
    return db.transaction(() => {
      const preview = this.previewConsumption(productId, quantityToConsume);
      if (!preview.possible) {
        throw new Error(
          `Quantidade solicitada (${quantityToConsume}) é maior que o estoque total disponível (${preview.totalAvailable}).`
        );
      }

      const updateBatchStmt = db.prepare(`
        UPDATE batches 
        SET current_quantity = ?, status = ?
        WHERE id = ?
      `);

      const insertMovementStmt = db.prepare(`
        INSERT INTO movements (product_id, batch_id, type, quantity, unit_price, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of preview.items) {
        const newStatus = item.remaining_after === 0 ? 'consumed' : 'active';
        updateBatchStmt.run(item.remaining_after, newStatus, item.batch_id);

        insertMovementStmt.run(
          productId,
          item.batch_id,
          type,
          item.quantity_to_deduct,
          item.unit_price,
          notes || (type === 'out_waste' ? 'Descarte / Validade Vencida' : 'Consumo Doméstico FIFO')
        );
      }

      return {
        success: true,
        consumedQuantity: quantityToConsume,
        affectedBatchesCount: preview.items.length,
        items: preview.items
      };
    })();
  }
}
