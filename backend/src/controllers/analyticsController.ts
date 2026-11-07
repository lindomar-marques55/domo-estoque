import { Request, Response } from 'express';
import { AnalyticsService } from '../services/analyticsService';
import { db } from '../db';

export class AnalyticsController {
  static getDashboard(req: Request, res: Response): void {
    const summary = AnalyticsService.getDashboardSummary();
    res.json(summary);
  }

  static getProjections(req: Request, res: Response): void {
    const days = Number(req.query.period_days) || 30;
    const projections = AnalyticsService.getProductProjections(days);
    res.json(projections);
  }

  static getCategories(req: Request, res: Response): void {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json(categories);
  }
}
