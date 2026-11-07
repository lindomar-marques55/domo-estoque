import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import '../config';

const dbDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'estoque.db');
console.log(`[Database] Conectando ao banco de dados SQLite em: ${dbPath}`);

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      active INTEGER DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      can_view_dashboard    INTEGER DEFAULT 1,
      can_view_products     INTEGER DEFAULT 1,
      can_add_product       INTEGER DEFAULT 0,
      can_edit_product      INTEGER DEFAULT 0,
      can_delete_product    INTEGER DEFAULT 0,
      can_add_batch         INTEGER DEFAULT 1,
      can_consume_stock     INTEGER DEFAULT 1,
      can_discard_stock     INTEGER DEFAULT 0,
      can_view_projections  INTEGER DEFAULT 1,
      can_view_movements    INTEGER DEFAULT 1,
      can_view_corrections  INTEGER DEFAULT 0,
      can_make_corrections  INTEGER DEFAULT 0,
      can_manage_categories INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      icon TEXT DEFAULT 'package',
      color TEXT DEFAULT '#3b82f6'
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      unit TEXT NOT NULL DEFAULT 'unidade',
      min_stock_alert REAL DEFAULT 0,
      target_days_buffer INTEGER DEFAULT 30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      initial_quantity REAL NOT NULL,
      current_quantity REAL NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      entry_date TEXT NOT NULL,
      expiration_date TEXT,
      brand_notes TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      adjustment_type TEXT NOT NULL,
      field_changed TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // --- Migration: add 'active' column to existing users table if missing ---
  const usersInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
  const hasActive = usersInfo.some(col => col.name === 'active');
  if (!hasActive) {
    db.exec("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1");
    console.log('[Database] Coluna "active" adicionada à tabela users.');
  }

  const hasMustChangePassword = usersInfo.some(col => col.name === 'must_change_password');
  if (!hasMustChangePassword) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    console.log('[Database] Coluna "must_change_password" adicionada à tabela users.');
  }

  const hasTokenVersion = usersInfo.some(col => col.name === 'token_version');
  if (!hasTokenVersion) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
    console.log('[Database] Coluna "token_version" adicionada à tabela users.');
  }

  const permissionColumns = db.prepare('PRAGMA table_info(user_permissions)').all() as any[];
  if (!permissionColumns.some(col => col.name === 'can_manage_categories')) {
    db.exec('ALTER TABLE user_permissions ADD COLUMN can_manage_categories INTEGER NOT NULL DEFAULT 0');
    console.log('[Database] Permissão can_manage_categories adicionada.');
  }

  // --- Seed default categories if empty ---
  const categoryCount = (db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }).count;
  if (categoryCount === 0) {
    const insertCat = db.prepare('INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)');
    const defaultCategories = [
      ['Grãos e Cereais', 'wheat', '#eab308'],
      ['Laticínios e Frios', 'milk', '#3b82f6'],
      ['Carnes e Proteínas', 'drumstick', '#ef4444'],
      ['Hortifrúti', 'apple', '#22c55e'],
      ['Bebidas', 'cup', '#06b6d4'],
      ['Enlatados e Conservas', 'box', '#a855f7'],
      ['Limpeza e Higiene', 'sparkles', '#ec4899'],
      ['Outros', 'tag', '#64748b']
    ];
    defaultCategories.forEach(([name, icon, color]) => insertCat.run(name, icon, color));
    console.log('[Database] Categorias padrão inicializadas.');
  }

  // --- Seed default admin user if no user exists ---
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount === 0) {
    const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (!initialAdminPassword || initialAdminPassword.length < 12 || Buffer.byteLength(initialAdminPassword, 'utf8') > 72) {
      throw new Error('Banco sem usuários: defina INITIAL_ADMIN_PASSWORD (mínimo de 12 caracteres) para criar a conta inicial.');
    }
    const initialAdminUsername = process.env.INITIAL_ADMIN_USERNAME?.trim() || 'admin';
    const hash = bcrypt.hashSync(initialAdminPassword, 12);
    const adminResult = db.prepare('INSERT INTO users (username, password_hash, name, role, active, must_change_password) VALUES (?, ?, ?, ?, 1, 1)').run(
      initialAdminUsername, hash, 'Administrador', 'admin'
    );
    console.log(`[Database] Conta administrativa inicial criada para o usuário "${initialAdminUsername}". A senha foi carregada do ambiente.`);
    db.prepare(`INSERT OR IGNORE INTO user_permissions (user_id,
      can_view_dashboard, can_view_products, can_add_product, can_edit_product, can_delete_product,
      can_add_batch, can_consume_stock, can_discard_stock, can_view_projections, can_view_movements,
      can_view_corrections, can_make_corrections)
      VALUES (?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`)
      .run(adminResult.lastInsertRowid);
  }

  // Replace the credential created by older releases during the first secured startup.
  const legacyAdmin = db.prepare('SELECT id, password_hash FROM users WHERE username = ? AND role = ?')
    .get(process.env.INITIAL_ADMIN_USERNAME?.trim() || 'admin', 'admin') as { id: number; password_hash: string } | undefined;
  if (legacyAdmin && bcrypt.compareSync('admin123', legacyAdmin.password_hash)) {
    const replacementPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (!replacementPassword || replacementPassword.length < 12 || Buffer.byteLength(replacementPassword, 'utf8') > 72) {
      throw new Error('A conta administrativa ainda usa a senha inicial conhecida. Defina INITIAL_ADMIN_PASSWORD (12 a 72 bytes) para substituí-la.');
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(bcrypt.hashSync(replacementPassword, 12), legacyAdmin.id);
    console.log('[Database] Senha inicial conhecida substituída. A troca será obrigatória no primeiro acesso.');
  }

  // --- Migration: create user_permissions for existing users that don't have records ---
  const usersWithoutPerms = db.prepare(`
    SELECT u.id, u.role FROM users u
    LEFT JOIN user_permissions up ON u.id = up.user_id
    WHERE up.user_id IS NULL
  `).all() as any[];

  usersWithoutPerms.forEach(u => {
    const isAdmin = u.role === 'admin';
    db.prepare(`INSERT OR IGNORE INTO user_permissions (user_id,
      can_view_dashboard, can_view_products, can_add_product, can_edit_product, can_delete_product,
      can_add_batch, can_consume_stock, can_discard_stock, can_view_projections, can_view_movements,
      can_view_corrections, can_make_corrections)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(u.id,
        1, 1,
        isAdmin ? 1 : 0, isAdmin ? 1 : 0, isAdmin ? 1 : 0,
        1, 1,
        isAdmin ? 1 : 0,
        1, 1,
        isAdmin ? 1 : 0, isAdmin ? 1 : 0
      );
    console.log(`[Database] Permissões criadas para usuário id=${u.id} (${u.role})`);
  });
}
