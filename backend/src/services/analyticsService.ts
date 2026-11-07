import { db } from '../db';

// Fixed historical window used to calculate the daily consumption rate
const HISTORY_WINDOW_DAYS = 30;

export class AnalyticsService {
  static getProductProjections(targetPeriodDays: number = 30) {
    const products = db.prepare(`
      SELECT 
        p.*, 
        c.name as category_name,
        COALESCE(SUM(b.current_quantity), 0) as current_stock,
        CASE
          WHEN COALESCE(SUM(b.current_quantity), 0) > 0
          THEN ROUND(SUM(b.current_quantity * b.unit_price) / SUM(b.current_quantity), 2)
          ELSE 0
        END as average_unit_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN batches b ON p.id = b.product_id AND b.status = 'active'
      GROUP BY p.id
    `).all() as any[];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_WINDOW_DAYS);
    const cutoffIso = cutoffDate.toISOString();

    const consumptionMap = new Map<number, number>();
    const movementRows = db.prepare(`
      SELECT product_id, SUM(quantity) as total_consumed
      FROM movements
      WHERE type = 'out_consumption' AND created_at >= ?
      GROUP BY product_id
    `).all(cutoffIso) as { product_id: number; total_consumed: number }[];

    movementRows.forEach(row => {
      consumptionMap.set(row.product_id, row.total_consumed);
    });

    const todayStr = new Date().toISOString().split('T')[0];

    return products.map(product => {
      const totalConsumedIn30d = consumptionMap.get(product.id) || 0;
      const dailyConsumptionRate = totalConsumedIn30d / HISTORY_WINDOW_DAYS;

      const currentStock = Number(product.current_stock);
      const avgPrice = Number(product.average_unit_price);

      const targetStockNeeded = Math.round((dailyConsumptionRate * targetPeriodDays) * 100) / 100;
      const restockRecommended = Math.max(0, Math.round((targetStockNeeded - currentStock) * 100) / 100);
      const surplusStock = currentStock > targetStockNeeded
        ? Math.round((currentStock - targetStockNeeded) * 100) / 100
        : 0;

      const earliestBatch = db.prepare(`
        SELECT expiration_date FROM batches 
        WHERE product_id = ? AND current_quantity > 0 AND status = 'active' AND expiration_date IS NOT NULL
        ORDER BY expiration_date ASC LIMIT 1
      `).get(product.id) as { expiration_date: string } | undefined;

      const earliestExpiration = earliestBatch ? earliestBatch.expiration_date : null;
      let daysUntilExpiration: number | null = null;
      let isExpired = false;

      if (earliestExpiration) {
        const expDate = new Date(earliestExpiration);
        const today = new Date(todayStr);
        const diffTime = expDate.getTime() - today.getTime();
        daysUntilExpiration = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (daysUntilExpiration < 0) isExpired = true;
      }

      return {
        product_id: product.id,
        name: product.name,
        category_name: product.category_name || 'Sem Categoria',
        unit: product.unit,
        current_stock: currentStock,
        average_unit_price: avgPrice,
        min_stock_alert: product.min_stock_alert,
        history_window_days: HISTORY_WINDOW_DAYS,
        target_period_days: targetPeriodDays,
        total_consumed_in_history: totalConsumedIn30d,
        daily_consumption_rate: Math.round(dailyConsumptionRate * 1000) / 1000,
        target_stock_needed: targetStockNeeded,
        restock_recommended: restockRecommended,
        surplus_stock: surplusStock,
        is_low_stock: currentStock <= product.min_stock_alert,
        earliest_expiration: earliestExpiration,
        days_until_expiration: daysUntilExpiration,
        is_expired: isExpired
      };
    });
  }

  static getDashboardSummary() {
    const todayStr = new Date().toISOString().split('T')[0];

    const totalProducts = (db.prepare('SELECT COUNT(*) as count FROM products').get() as any).count;

    const inventoryValuation = (db.prepare(`
      SELECT COALESCE(SUM(current_quantity * unit_price), 0) as total_value
      FROM batches WHERE status = 'active'
    `).get() as any).total_value;

    const expiredBatchesCount = (db.prepare(`
      SELECT COUNT(DISTINCT product_id) as count
      FROM batches 
      WHERE status = 'active' AND current_quantity > 0 AND expiration_date < ?
    `).get(todayStr) as any).count;

    const in7DaysDate = new Date();
    in7DaysDate.setDate(in7DaysDate.getDate() + 7);
    const in7DaysStr = in7DaysDate.toISOString().split('T')[0];

    const expiringSoonCount = (db.prepare(`
      SELECT COUNT(DISTINCT product_id) as count
      FROM batches 
      WHERE status = 'active' AND current_quantity > 0 
      AND expiration_date >= ? AND expiration_date <= ?
    `).get(todayStr, in7DaysStr) as any).count;

    const projections = this.getProductProjections(30);
    const lowStockCount = projections.filter(p => p.is_low_stock).length;

    const criticalExpirations = db.prepare(`
      SELECT 
        b.id as batch_id, b.product_id,
        p.name as product_name, p.unit,
        b.current_quantity, b.expiration_date, b.brand_notes
      FROM batches b
      JOIN products p ON b.product_id = p.id
      WHERE b.status = 'active' AND b.current_quantity > 0 AND b.expiration_date IS NOT NULL
      AND b.expiration_date <= ?
      ORDER BY b.expiration_date ASC
    `).all(in7DaysStr) as any[];

    return {
      total_products: totalProducts,
      total_inventory_value_brl: Math.round(inventoryValuation * 100) / 100,
      expired_products_count: expiredBatchesCount,
      expiring_soon_count: expiringSoonCount,
      low_stock_count: lowStockCount,
      critical_expirations: criticalExpirations
    };
  }
}
