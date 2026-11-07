import { db } from './db';

console.log('[Database Cleaner] Executando limpeza de produtos, lotes e histórico...');

try {
  db.transaction(() => {
    db.prepare('DELETE FROM movements').run();
    db.prepare('DELETE FROM adjustments').run();
    db.prepare('DELETE FROM batches').run();
    db.prepare('DELETE FROM products').run();
  })();

  const pCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as any).c;
  const bCount = (db.prepare('SELECT COUNT(*) as c FROM batches').get() as any).c;
  const mCount = (db.prepare('SELECT COUNT(*) as c FROM movements').get() as any).c;
  const aCount = (db.prepare('SELECT COUNT(*) as c FROM adjustments').get() as any).c;

  console.log(`[Database Cleaner] Sucesso! Total restante: Produtos=${pCount}, Lotes=${bCount}, Movimentações=${mCount}, Ajustes=${aCount}`);
} catch (err) {
  console.error('[Database Cleaner] Erro:', err);
}
