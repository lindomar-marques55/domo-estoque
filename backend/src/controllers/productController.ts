import { Request, Response } from 'express';
import { db } from '../db';
import { FifoService } from '../services/fifoService';

export class ProductController {
  static listAll(req: Request, res: Response): void {
    const { category_id, search } = req.query;

    let query = `
      SELECT 
        p.*, 
        c.name as category_name,
        c.icon as category_icon,
        c.color as category_color,
        COALESCE(SUM(b.current_quantity), 0) as total_stock,
        (
          SELECT expiration_date 
          FROM batches 
          WHERE product_id = p.id AND current_quantity > 0 AND status = 'active' AND expiration_date IS NOT NULL
          ORDER BY expiration_date ASC LIMIT 1
        ) as earliest_expiration,
        (
          SELECT COUNT(*) 
          FROM batches 
          WHERE product_id = p.id AND current_quantity > 0 AND status = 'active'
        ) as active_batches_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN batches b ON p.id = b.product_id AND b.status = 'active'
      WHERE 1=1
    `;

    const params: any[] = [];

    if (category_id) {
      query += ` AND p.category_id = ?`;
      params.push(category_id);
    }

    if (search) {
      query += ` AND p.name LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY p.id ORDER BY p.name ASC`;

    const products = db.prepare(query).all(...params);
    res.json(products);
  }

  static getById(req: Request, res: Response): void {
    const id = Number(req.params.id);
    const product = db.prepare(`
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE p.id = ?
    `).get(id) as any;

    if (!product) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    const batches = db.prepare(`
      SELECT * FROM batches 
      WHERE product_id = ? 
      ORDER BY 
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END,
        expiration_date ASC
    `).all(id);

    res.json({ product, batches });
  }

  static create(req: Request, res: Response): void {
    const { name, category_id, unit, initial_quantity, package_price, unit_price, expiration_date, brand_notes } = req.body;

    if (!name || !name.trim() || !unit) {
      res.status(400).json({ error: 'Nome do produto e unidade de medida são obrigatórios.' });
      return;
    }

    const qty = Number(initial_quantity) || 0;

    // Suporta package_price (preço total da embalagem) calculando unit_price = package_price / qty
    // Fallback para unit_price caso enviado diretamente (compatibilidade)
    const pkgPrice = Number(package_price) ?? Number(unit_price) ?? 0;
    const unitPrice = qty > 0 ? Math.round((pkgPrice / qty) * 10000) / 10000 : pkgPrice;

    try {
      const productId = db.transaction(() => {
        // 1. Inserir produto
        const productResult = db.prepare(`
          INSERT INTO products (name, category_id, unit, min_stock_alert, target_days_buffer)
          VALUES (?, ?, ?, 0, 30)
        `).run(name.trim(), category_id || null, unit);

        const newProductId = productResult.lastInsertRowid;

        // 2. Se informou quantidade > 0, grava o lote inicial de estoque imediatamente
        if (qty > 0) {
          const entryDate = new Date().toISOString().split('T')[0];
          const totalPrice = Math.round(pkgPrice * 100) / 100;

          const batchResult = db.prepare(`
            INSERT INTO batches (
              product_id, initial_quantity, current_quantity, unit_price, total_price, 
              entry_date, expiration_date, brand_notes, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
          `).run(
            newProductId, qty, qty, unitPrice, totalPrice, entryDate,
            expiration_date || null, brand_notes || null
          );

          // 3. Movimentação de entrada inicial
          db.prepare(`
            INSERT INTO movements (product_id, batch_id, type, quantity, unit_price, notes)
            VALUES (?, ?, 'in', ?, ?, ?)
          `).run(
            newProductId, batchResult.lastInsertRowid, qty, unitPrice,
            `Estoque Inicial: ${brand_notes || 'Cadastro de Produto'}`
          );
        }

        return newProductId;
      })();

      res.status(201).json({ message: 'Produto cadastrado com sucesso!', productId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static update(req: Request, res: Response): void {
    const id = Number(req.params.id);
    const { name, category_id, unit } = req.body;

    if (!name || !name.trim() || !unit) {
      res.status(400).json({ error: 'Nome e unidade são obrigatórios.' });
      return;
    }

    const stmt = db.prepare(`
      UPDATE products 
      SET name = ?, category_id = ?, unit = ?
      WHERE id = ?
    `);

    const result = stmt.run(name.trim(), category_id || null, unit, id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    res.json({ message: 'Produto atualizado com sucesso.' });
  }

  static delete(req: Request, res: Response): void {
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Produto não encontrado.' });
      return;
    }

    res.json({ message: 'Produto removido com sucesso.' });
  }

  static fifoPreview(req: Request, res: Response): void {
    const productId = Number(req.params.id);
    const quantity = Number(req.query.quantity);

    if (isNaN(quantity) || quantity <= 0) {
      res.status(400).json({ error: 'Quantidade para prévia deve ser um número positivo.' });
      return;
    }

    const preview = FifoService.previewConsumption(productId, quantity);
    res.json(preview);
  }

  static consumeFifo(req: Request, res: Response): void {
    const productId = Number(req.params.id);
    const { quantity, type, notes } = req.body;

    if (!quantity || Number(quantity) <= 0) {
      res.status(400).json({ error: 'Quantidade a ser consumida deve ser um número positivo.' });
      return;
    }

    try {
      const result = FifoService.executeConsumption(
        productId,
        Number(quantity),
        type || 'out_consumption',
        notes
      );
      res.json({ message: 'Baixa de estoque efetuada com sucesso (FIFO).', result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}
