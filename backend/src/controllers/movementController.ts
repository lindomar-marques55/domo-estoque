import { Request, Response } from 'express';
import { db } from '../db';

export class MovementController {
  static list(req: Request, res: Response): void {
    const { limit = 50, product_id } = req.query;

    let query = `
      SELECT 
        m.*, 
        p.name as product_name, 
        p.unit as product_unit,
        b.expiration_date as batch_expiration,
        b.brand_notes as batch_brand
      FROM movements m
      JOIN products p ON m.product_id = p.id
      LEFT JOIN batches b ON m.batch_id = b.id
      WHERE 1=1
    `;

    const params: any[] = [];
    if (product_id) {
      query += ` AND m.product_id = ?`;
      params.push(product_id);
    }

    query += ` ORDER BY m.created_at DESC LIMIT ?`;
    params.push(Number(limit));

    const movements = db.prepare(query).all(...params);
    res.json(movements);
  }
}
