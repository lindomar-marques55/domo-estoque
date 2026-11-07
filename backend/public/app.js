// State Management
let token = localStorage.getItem('domo_token');
let user = JSON.parse(localStorage.getItem('domo_user') || 'null');
let categories = [];
let products = [];
let usersList = [];

const API_BASE = '/api';

// Helper API Fetcher
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  if (res.status === 401) {
    logout();
    alert('Sessão expirada ou inválida. Por favor, faça login novamente.');
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const data = await res.json();
  if (!res.ok) {
    if (data.error && (data.error.includes('expirado') || data.error.includes('inválido'))) {
      logout();
      alert('Sessão expirada. Por favor, faça login novamente.');
    }
    throw new Error(data.error || 'Ocorreu um erro na requisição.');
  }
  return data;
}

// Check permission helper (Admin bypasses all)
function hasPermission(permKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!(user.permissions && user.permissions[permKey]);
}

// Formatters
function formatCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function formatDate(isoStr) {
  if (!isoStr) return 'Sem validade';
  const parts = isoStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return new Date(isoStr).toLocaleDateString('pt-BR');
}

function getTodayIso() {
  return new Date().toISOString().split('T')[0];
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupEventListeners();

  if (token && user) {
    try {
      const session = await apiFetch('/auth/me');
      user = session.user;
      localStorage.setItem('domo_user', JSON.stringify(user));
    } catch {
      return;
    }
    if (user.must_change_password) {
      showPasswordChange();
      return;
    }
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('user-display-name').textContent = user.name || user.username;
    applyPermissionsUI();
    await initApp();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }
});

function applyPermissionsUI() {
  if (!user) return;
  const isAdmin = user.role === 'admin';

  const navAdmin = document.getElementById('nav-admin');
  if (navAdmin) navAdmin.style.display = isAdmin ? 'flex' : 'none';

  const navDash = document.getElementById('nav-dash');
  if (navDash) navDash.style.display = hasPermission('can_view_dashboard') ? 'flex' : 'none';

  const navProd = document.getElementById('nav-prod');
  if (navProd) navProd.style.display = (hasPermission('can_view_products') || hasPermission('can_manage_categories')) ? 'flex' : 'none';

  const navProj = document.getElementById('nav-proj');
  if (navProj) navProj.style.display = hasPermission('can_view_projections') ? 'flex' : 'none';

  const navMov = document.getElementById('nav-mov');
  if (navMov) navMov.style.display = hasPermission('can_view_movements') ? 'flex' : 'none';

  const navCorr = document.getElementById('nav-corr');
  if (navCorr) navCorr.style.display = hasPermission('can_view_corrections') ? 'flex' : 'none';

  const btnAddProd = document.getElementById('btn-open-new-product');
  if (btnAddProd) btnAddProd.style.display = hasPermission('can_add_product') ? 'inline-flex' : 'none';

  const btnAdj = document.getElementById('btn-open-adjustment-modal');
  if (btnAdj) btnAdj.style.display = hasPermission('can_make_corrections') ? 'inline-flex' : 'none';

  const btnManageCategories = document.getElementById('btn-open-manage-categories');
  if (btnManageCategories) btnManageCategories.style.display = hasPermission('can_manage_categories') ? 'inline-flex' : 'none';

  const btnNewCategory = document.getElementById('btn-open-new-category');
  if (btnNewCategory) btnNewCategory.style.display = hasPermission('can_manage_categories') ? 'inline-flex' : 'none';
}

async function initApp() {
  try {
    await loadCategories();
    if (hasPermission('can_view_dashboard')) await loadDashboard();
    if (hasPermission('can_view_products')) await loadProducts();
  } catch (err) {
    console.error('Erro na inicialização:', err);
  }
}

// Authentication Functions
async function login(username, password) {
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const data = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(async r => {
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || 'Falha no login');
      return res;
    });

    token = data.token;
    user = data.user;
    localStorage.setItem('domo_token', token);
    localStorage.setItem('domo_user', JSON.stringify(user));

    if (user.must_change_password) {
      showPasswordChange();
      return;
    }

    document.getElementById('user-display-name').textContent = user.name || user.username;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('password-change-panel').style.display = 'none';
    applyPermissionsUI();

    if (hasPermission('can_view_dashboard')) {
      switchToTab('view-dashboard');
    } else if (hasPermission('can_view_products') || hasPermission('can_manage_categories')) {
      switchToTab('view-products');
    }

    await initApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

function showPasswordChange() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('password-change-panel').style.display = 'block';
  document.getElementById('current-password').focus();
}

async function submitPasswordChange() {
  const errorEl = document.getElementById('password-change-error');
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmation = document.getElementById('confirm-password').value;
  errorEl.style.display = 'none';

  if (newPassword !== confirmation) {
    errorEl.textContent = 'A confirmação não corresponde à nova senha.';
    errorEl.style.display = 'block';
    return;
  }

  const username = user?.username || '';
  try {
    const data = await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    logout();
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('password-change-panel').style.display = 'none';
    const loginError = document.getElementById('login-error');
    loginError.textContent = data.message;
    loginError.style.color = 'var(--accent-success)';
    loginError.style.display = 'block';
    document.getElementById('login-user').value = username;
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
    document.getElementById('change-password-form').reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
}

function logout() {
  token = null;
  user = null;
  localStorage.removeItem('domo_token');
  localStorage.removeItem('domo_user');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('password-change-panel').style.display = 'none';
}

function switchToTab(targetView) {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(b => b.classList.remove('active'));

  const btn = document.querySelector(`[data-target="${targetView}"]`);
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  const targetEl = document.getElementById(targetView);
  if (targetEl) targetEl.classList.add('active');

  if (targetView === 'view-dashboard') loadDashboard();
  if (targetView === 'view-products') loadProducts();
  if (targetView === 'view-projections') loadProjections(Number(document.getElementById('projection-period-select').value) || 30);
  if (targetView === 'view-movements') loadMovements();
  if (targetView === 'view-corrections') loadCorrections();
  if (targetView === 'view-admin') loadUsers();
}

// Navigation Tabs
function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-target');
      switchToTab(targetView);
    });
  });
}

// Event Listeners Setup
function setupEventListeners() {
  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    login(document.getElementById('login-user').value, document.getElementById('login-pass').value);
  });

  document.getElementById('change-password-form').addEventListener('submit', async e => {
    e.preventDefault();
    await submitPasswordChange();
  });

  document.getElementById('btn-logout').addEventListener('click', logout);

  document.getElementById('search-product').addEventListener('input', renderProducts);
  document.getElementById('filter-category').addEventListener('change', renderProducts);

  document.getElementById('btn-open-manage-categories').addEventListener('click', () => {
    openManageCategoriesModal();
  });

  document.getElementById('btn-open-new-product').addEventListener('click', () => {
    document.getElementById('form-product').reset();
    document.getElementById('product-id').value = '';
    document.getElementById('modal-product-title').textContent = 'Cadastrar Novo Produto';
    document.getElementById('group-prod-initial-qty').style.display = 'block';
    document.getElementById('group-prod-unit-price').style.display = 'block';
    document.getElementById('group-prod-exp-date').style.display = 'block';
    document.getElementById('group-prod-notes').style.display = 'block';
    openModal('modal-product');
  });

  document.getElementById('form-product').addEventListener('submit', async e => {
    e.preventDefault();
    await saveProduct();
  });

  document.getElementById('form-category').addEventListener('submit', async e => {
    e.preventDefault();
    await saveCategory();
  });

  document.getElementById('form-manage-category').addEventListener('submit', async e => {
    e.preventDefault();
    await saveManageCategory();
  });

  document.getElementById('form-batch').addEventListener('submit', async e => {
    e.preventDefault();
    await saveBatch();
  });

  document.getElementById('form-fifo').addEventListener('submit', async e => {
    e.preventDefault();
    await executeFifo();
  });

  document.getElementById('form-discard').addEventListener('submit', async e => {
    e.preventDefault();
    await executeDiscard();
  });

  document.getElementById('btn-open-adjustment-modal').addEventListener('click', () => {
    openAdjustmentModal();
  });

  document.getElementById('form-adjustment').addEventListener('submit', async e => {
    e.preventDefault();
    await executeAdjustment();
  });

  document.getElementById('btn-open-new-user').addEventListener('click', () => {
    openNewUserModal();
  });

  document.getElementById('form-user').addEventListener('submit', async e => {
    e.preventDefault();
    await saveUser();
  });

  document.getElementById('fifo-quantity').addEventListener('input', debounce(updateFifoPreview, 300));

  document.getElementById('projection-period-select').addEventListener('change', e => {
    loadProjections(Number(e.target.value));
  });

  document.getElementById('adj-product-id').addEventListener('change', async e => {
    await populateAdjustmentBatches(e.target.value);
  });
}

// Data Loaders for Categories
async function loadCategories(selectId = null) {
  categories = await apiFetch('/categories');
  const selFilter = document.getElementById('filter-category');
  const selProduct = document.getElementById('product-category');

  selFilter.innerHTML = '<option value="">Todas as Categorias</option>';
  selProduct.innerHTML = '';

  if (categories.length === 0) {
    selProduct.innerHTML = '<option value="">Nenhuma categoria. Clique em + Nova Categoria</option>';
    return;
  }

  categories.forEach(c => {
    selFilter.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    selProduct.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });

  if (selectId) {
    selProduct.value = selectId;
  }
}

function openCategoryModal() {
  if (!hasPermission('can_manage_categories')) return;
  document.getElementById('form-category').reset();
  openModal('modal-category');
}

async function saveCategory() {
  if (!hasPermission('can_manage_categories')) return;
  const name = document.getElementById('cat-name-input').value;
  const color = document.getElementById('cat-color-input').value;

  try {
    const newCat = await apiFetch('/categories', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    });

    closeModal('modal-category');
    await loadCategories(newCat.id);
  } catch (err) {
    alert(err.message);
  }
}

// Manage Categories Modal Functions
function openManageCategoriesModal() {
  if (!hasPermission('can_manage_categories')) return;
  resetManageCategoryForm();
  renderManageCategoriesTable();
  openModal('modal-manage-categories');
}

function renderManageCategoriesTable() {
  const tbody = document.getElementById('tbody-categories-list');
  tbody.innerHTML = '';

  if (categories.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--text-muted);">Nenhuma categoria cadastrada.</td></tr>`;
    return;
  }

  categories.forEach(c => {
    tbody.innerHTML += `
      <tr>
        <td>
          <span style="display:inline-block; width:20px; height:20px; border-radius:4px; background:${c.color || '#3b82f6'}; vertical-align:middle;"></span>
        </td>
        <td><strong>${c.name}</strong></td>
        <td>
          <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="editManageCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}', '${c.color}')">✏️ Editar</button>
          <button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="deleteManageCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}')">🗑️ Excluir</button>
        </td>
      </tr>
    `;
  });
}

function editManageCategory(id, name, color) {
  document.getElementById('manage-cat-id').value = id;
  document.getElementById('manage-cat-name').value = name;
  document.getElementById('manage-cat-color').value = color || '#3b82f6';
  document.getElementById('manage-cat-title').textContent = `✏️ Editar Categoria: ${name}`;
  document.getElementById('btn-cancel-manage-cat').style.display = 'inline-flex';
}

function resetManageCategoryForm() {
  document.getElementById('form-manage-category').reset();
  document.getElementById('manage-cat-id').value = '';
  document.getElementById('manage-cat-title').textContent = '➕ Adicionar Nova Categoria';
  document.getElementById('btn-cancel-manage-cat').style.display = 'none';
}

async function saveManageCategory() {
  if (!hasPermission('can_manage_categories')) return;
  const id = document.getElementById('manage-cat-id').value;
  const name = document.getElementById('manage-cat-name').value;
  const color = document.getElementById('manage-cat-color').value;

  try {
    if (id) {
      await apiFetch(`/categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, color })
      });
    } else {
      await apiFetch('/categories', {
        method: 'POST',
        body: JSON.stringify({ name, color })
      });
    }

    resetManageCategoryForm();
    await loadCategories();
    renderManageCategoriesTable();
    if (hasPermission('can_view_products')) await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteManageCategory(id, name) {
  if (!hasPermission('can_manage_categories')) return;
  if (!confirm(`Tem certeza que deseja excluir a categoria "${name}"? Os produtos vinculados ficarão sem categoria.`)) return;

  try {
    await apiFetch(`/categories/${id}`, { method: 'DELETE' });
    await loadCategories();
    renderManageCategoriesTable();
    if (hasPermission('can_view_products')) await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

async function loadDashboard() {
  const summary = await apiFetch('/analytics/dashboard');
  document.getElementById('dash-total-products').textContent = summary.total_products;
  document.getElementById('dash-total-value').textContent = formatCurrency(summary.total_inventory_value_brl);
  document.getElementById('dash-expiring-soon').textContent = summary.expiring_soon_count;
  document.getElementById('dash-expired-count').textContent = summary.expired_products_count;

  const bannerContainer = document.getElementById('dashboard-critical-container');
  bannerContainer.innerHTML = '';

  if (summary.expired_products_count > 0) {
    bannerContainer.innerHTML += `
      <div class="alert-banner danger">
        <span>🚨 Atenção! Há <strong>${summary.expired_products_count} produto(s) com lotes VENCIDOS</strong> no estoque!</span>
        <button class="btn btn-secondary" onclick="switchToTab('view-products')">Ver Vencidos</button>
      </div>
    `;
  } else if (summary.expiring_soon_count > 0) {
    bannerContainer.innerHTML += `
      <div class="alert-banner warning">
        <span>⚠️ Atenção! Há <strong>${summary.expiring_soon_count} produto(s) vencendo nos próximos 7 dias</strong>.</span>
        <button class="btn btn-secondary" onclick="switchToTab('view-products')">Ver Lotes Próximos</button>
      </div>
    `;
  }

  const tbody = document.getElementById('tbody-dashboard-critical');
  tbody.innerHTML = '';

  if (summary.critical_expirations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Nenhum produto vencido ou prestes a vencer nos próximos 7 dias. 🎉</td></tr>`;
    return;
  }

  const todayStr = getTodayIso();
  summary.critical_expirations.forEach(item => {
    const isExpired = item.expiration_date < todayStr;
    const badgeClass = isExpired ? 'badge-danger' : 'badge-warning';
    const statusText = isExpired ? 'VENCIDO' : 'Vence em breve';

    let actionBtns = '';
    if (hasPermission('can_consume_stock')) {
      actionBtns += `<button class="btn btn-warning" style="padding:0.3rem 0.6rem; font-size:0.75rem;" onclick="openFifoModal(${item.product_id}, '${item.product_name}', '${item.unit}')">⚡ Baixa FIFO</button> `;
    }
    if (hasPermission('can_discard_stock') && isExpired) {
      actionBtns += `<button class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.75rem;" onclick="openDiscardModal(${item.product_id}, '${item.product_name}')">🗑️ Descartar</button>`;
    }

    tbody.innerHTML += `
      <tr>
        <td><strong>${item.product_name}</strong> ${item.brand_notes ? `<br><small style="color:var(--text-muted);">${item.brand_notes}</small>` : ''}</td>
        <td><strong>${item.current_quantity} ${item.unit}</strong></td>
        <td>${formatDate(item.expiration_date)}</td>
        <td><span class="${badgeClass}">${statusText}</span></td>
        <td>${actionBtns || '<span style="color:var(--text-muted);">Apenas leitura</span>'}</td>
      </tr>
    `;
  });
}

async function loadProducts() {
  products = await apiFetch('/products');
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  const searchVal = document.getElementById('search-product').value.toLowerCase();
  const categoryVal = document.getElementById('filter-category').value;

  const filtered = products.filter(p => {
    const matchName = p.name.toLowerCase().includes(searchVal);
    const matchCategory = !categoryVal || String(p.category_id) === String(categoryVal);
    return matchName && matchCategory;
  });

  grid.innerHTML = '';
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">Nenhum produto encontrado.</div>`;
    return;
  }

  const todayStr = getTodayIso();

  filtered.forEach(p => {
    let expBadge = `<span class="expiration-tag badge-ok">✅ Sem validade crítica</span>`;
    let isHasExpired = false;

    if (p.earliest_expiration) {
      const expDate = new Date(p.earliest_expiration);
      const today = new Date(todayStr);
      const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        expBadge = `<span class="expiration-tag badge-danger">🚨 VENCIDO (${formatDate(p.earliest_expiration)})</span>`;
        isHasExpired = true;
      } else if (diffDays <= 7) {
        expBadge = `<span class="expiration-tag badge-warning">⚠️ Vence em ${diffDays} dias (${formatDate(p.earliest_expiration)})</span>`;
      } else {
        expBadge = `<span class="expiration-tag badge-ok">📅 Vence ${formatDate(p.earliest_expiration)}</span>`;
      }
    }

    const categoryColor = p.category_color || '#3b82f6';

    let actionButtons = '';
    if (hasPermission('can_consume_stock')) {
      actionButtons += `<button class="btn btn-warning" onclick="openFifoModal(${p.id}, '${p.name}', '${p.unit}')">⚡ Baixa (FIFO)</button>`;
    }
    if (hasPermission('can_add_batch')) {
      actionButtons += `<button class="btn btn-primary" onclick="openAddBatchModal(${p.id}, '${p.name}')">➕ Comprar</button>`;
    }
    if (hasPermission('can_discard_stock') && isHasExpired) {
      actionButtons += `<button class="btn btn-danger" onclick="openDiscardModal(${p.id}, '${p.name}')" title="Descartar produto vencido sem contar como consumo">🗑️ Descartar</button>`;
    }

    grid.innerHTML += `
      <div class="product-card glass">
        <div>
          <div class="product-header">
            <div>
              <div class="product-title">${p.name}</div>
              <span class="category-badge" style="background: ${categoryColor}25; color: ${categoryColor}; border: 1px solid ${categoryColor}40;">
                ${p.category_name || 'Sem Categoria'}
              </span>
            </div>
            <button style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;" onclick="viewProductBatches(${p.id}, '${p.name}')" title="Ver lotes do produto">🔍 Lotes</button>
          </div>

          <div class="stock-box">
            <span class="stock-label">Em Estoque</span>
            <span class="stock-value">${p.total_stock} <small style="font-size: 0.9rem;">${p.unit}</small></span>
          </div>

          ${expBadge}
        </div>

        <div class="product-actions">
          ${actionButtons || '<span style="color:var(--text-muted); font-size:0.8rem;">Modo Apenas Leitura</span>'}
        </div>
      </div>
    `;
  });
}

// Projections View (includes Preço Médio do Estoque Atual)
async function loadProjections(periodDays = 30) {
  const projections = await apiFetch(`/analytics/projections?period_days=${periodDays}`);
  const tbody = document.getElementById('tbody-projections');
  tbody.innerHTML = '';

  if (projections.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Nenhum produto cadastrado.</td></tr>`;
    return;
  }

  projections.forEach(item => {
    const needed = item.target_stock_needed;
    const restock = item.restock_recommended;
    const surplus = item.surplus_stock || 0;
    const hasConsumption = item.daily_consumption_rate > 0;
    const avgPrice = item.average_unit_price || 0;

    let restockText;
    if (!hasConsumption) {
      restockText = `<span style="color:var(--text-muted); font-size:0.8rem;">Sem histórico de consumo</span>`;
    } else if (restock > 0) {
      restockText = `<span style="color:#f87171; font-weight:700;">+ ${restock} ${item.unit} ⚠️</span>`;
    } else {
      restockText = `<span style="color:#34d399; font-weight:600;">Suficiente ✅ (sobra ${surplus} ${item.unit})</span>`;
    }

    const neededDisplay = hasConsumption
      ? `<strong style="color: #60a5fa;">${needed} ${item.unit}</strong>`
      : `<span style="color:var(--text-muted);">—</span>`;

    const avgPriceDisplay = item.current_stock > 0
      ? `<strong>${formatCurrency(avgPrice)}</strong>`
      : `<span style="color:var(--text-muted);">—</span>`;

    tbody.innerHTML += `
      <tr>
        <td><strong>${item.name}</strong><br><small style="color:var(--text-muted);">${item.category_name}</small></td>
        <td><strong>${item.current_stock} ${item.unit}</strong></td>
        <td style="color: #34d399;">${avgPriceDisplay}</td>
        <td>${hasConsumption ? `${item.daily_consumption_rate} ${item.unit}/dia` : '<span style="color:var(--text-muted);">—</span>'}</td>
        <td>${neededDisplay}</td>
        <td>${item.target_period_days} dias</td>
        <td>${restockText}</td>
      </tr>
    `;
  });
}

// Movements View
async function loadMovements() {
  const movements = await apiFetch('/movements?limit=100');
  const tbody = document.getElementById('tbody-movements');
  tbody.innerHTML = '';

  const typeLabels = {
    'in': '<span class="badge-ok">➕ Entrada (Compra)</span>',
    'out_consumption': '<span style="color:#60a5fa; font-weight:600;">⚡ Consumo FIFO</span>',
    'out_waste': '<span class="badge-danger">🗑️ Descarte (Vencido)</span>',
    'adjustment': '<span class="badge-warning">🔧 Ajuste</span>'
  };

  movements.forEach(m => {
    tbody.innerHTML += `
      <tr>
        <td>${new Date(m.created_at).toLocaleString('pt-BR')}</td>
        <td><strong>${m.product_name}</strong></td>
        <td>${typeLabels[m.type] || m.type}</td>
        <td><strong>${m.quantity} ${m.product_unit}</strong></td>
        <td>${formatCurrency(m.unit_price)}</td>
        <td>${m.notes || '-'}</td>
      </tr>
    `;
  });
}

// Corrections View
async function loadCorrections() {
  const corrections = await apiFetch('/adjustments');
  const tbody = document.getElementById('tbody-corrections');
  tbody.innerHTML = '';

  if (corrections.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">Nenhuma correção registrada no banco.</td></tr>`;
    return;
  }

  const fieldNames = {
    'current_quantity': 'Quantidade Atual',
    'unit_price': 'Preço Unitário',
    'expiration_date': 'Data de Validade',
    'brand_notes': 'Marca / Observação',
    'entry_date': 'Data de Entrada',
    'status': 'Status do Lote'
  };

  corrections.forEach(c => {
    tbody.innerHTML += `
      <tr>
        <td>${new Date(c.created_at).toLocaleString('pt-BR')}</td>
        <td><strong>${c.user_name || c.user_username || 'Sistema'}</strong></td>
        <td><strong>${c.product_name}</strong></td>
        <td>#${c.batch_id}</td>
        <td><span class="badge-info">${fieldNames[c.field_changed] || c.field_changed}</span></td>
        <td style="color: #f87171;">${c.old_value || '<i>vazio</i>'}</td>
        <td style="color: #34d399; font-weight: 700;">${c.new_value}</td>
        <td>${c.reason}</td>
      </tr>
    `;
  });
}

// Users / Admin View
async function loadUsers() {
  if (user?.role !== 'admin') return;
  usersList = await apiFetch('/admin/users');
  const tbody = document.getElementById('tbody-users');
  tbody.innerHTML = '';

  usersList.forEach(u => {
    const isSelf = user.id === u.id;
    const statusBadge = u.active
      ? '<span class="badge-ok">Ativo ✅</span>'
      : '<span class="badge-danger">Inativo ❌</span>';
    const roleBadge = u.role === 'admin'
      ? '<span style="color:#a855f7; font-weight:700;">👑 Admin</span>'
      : '<span style="color:#60a5fa;">Comum</span>';

    let permsSummary = 'Todas (Administrador)';
    if (u.role !== 'admin') {
      const activePerms = [];
      if (u.can_add_product) activePerms.push('Criar Prod.');
      if (u.can_edit_product) activePerms.push('Editar Prod.');
      if (u.can_delete_product) activePerms.push('Excluir Prod.');
      if (u.can_add_batch) activePerms.push('Comprar');
      if (u.can_consume_stock) activePerms.push('Baixa FIFO');
      if (u.can_discard_stock) activePerms.push('Descartar');
      if (u.can_make_corrections) activePerms.push('Correções');
      if (u.can_manage_categories) activePerms.push('Categorias');
      permsSummary = activePerms.length > 0 ? activePerms.join(', ') : 'Apenas Leitura';
    }

    let actions = '';
    if (u.role !== 'admin') {
      actions += `<button class="btn btn-secondary" style="padding:0.3rem 0.5rem;" onclick="openEditUserModal(${u.id})">✏️ Permissões</button> `;
      actions += `<button class="btn ${u.active ? 'btn-warning' : 'btn-primary'}" style="padding:0.3rem 0.5rem;" onclick="toggleUserStatus(${u.id}, ${u.active})">${u.active ? 'Desativar' : 'Ativar'}</button> `;
      actions += `<button class="btn btn-danger" style="padding:0.3rem 0.5rem;" onclick="deleteUser(${u.id})">🗑️</button>`;
    } else if (isSelf) {
      actions = '<span style="color:var(--text-muted); font-size:0.8rem;">Sua conta</span>';
    } else {
      actions = '<span style="color:var(--text-muted); font-size:0.8rem;">Admin</span>';
    }

    tbody.innerHTML += `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.name}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td style="font-size:0.8rem;">${permsSummary}</td>
        <td>${actions}</td>
      </tr>
    `;
  });
}

// Modal Handlers & Actions
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function saveProduct() {
  const id = document.getElementById('product-id').value;
  const payload = {
    name: document.getElementById('product-name').value,
    category_id: document.getElementById('product-category').value,
    unit: document.getElementById('product-unit').value,
    initial_quantity: Number(document.getElementById('product-initial-qty').value) || 0,
    package_price: Number(document.getElementById('product-unit-price').value) || 0,
    expiration_date: document.getElementById('product-exp-date').value || null,
    brand_notes: document.getElementById('product-brand-notes').value || ''
  };

  try {
    if (id) {
      await apiFetch(`/products/${id}`, { method: 'PUT', body: JSON.stringify({
        name: payload.name,
        category_id: payload.category_id,
        unit: payload.unit
      }) });
    } else {
      await apiFetch('/products', { method: 'POST', body: JSON.stringify(payload) });
    }

    closeModal('modal-product');
    await loadProducts();
    if (hasPermission('can_view_dashboard')) await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function openAddBatchModal(productId, productName) {
  document.getElementById('form-batch').reset();
  document.getElementById('batch-product-id').value = productId;
  document.getElementById('batch-product-name').value = productName;
  document.getElementById('batch-entry-date').value = getTodayIso();
  openModal('modal-batch');
}

async function saveBatch() {
  const payload = {
    product_id: Number(document.getElementById('batch-product-id').value),
    initial_quantity: Number(document.getElementById('batch-quantity').value),
    package_price: Number(document.getElementById('batch-price').value),
    entry_date: document.getElementById('batch-entry-date').value,
    expiration_date: document.getElementById('batch-expiration-date').value || null,
    brand_notes: document.getElementById('batch-notes').value
  };

  try {
    await apiFetch('/batches', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('modal-batch');
    await loadProducts();
    if (hasPermission('can_view_dashboard')) await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function openFifoModal(productId, productName, unit) {
  document.getElementById('form-fifo').reset();
  document.getElementById('fifo-product-id').value = productId;
  document.getElementById('fifo-product-name').value = productName;
  document.getElementById('fifo-unit-label').textContent = unit;
  document.getElementById('fifo-preview-container').style.display = 'none';
  openModal('modal-fifo');
}

async function updateFifoPreview() {
  const productId = document.getElementById('fifo-product-id').value;
  const qty = Number(document.getElementById('fifo-quantity').value);
  const container = document.getElementById('fifo-preview-container');
  const list = document.getElementById('fifo-preview-list');

  if (!qty || qty <= 0) {
    container.style.display = 'none';
    return;
  }

  try {
    const preview = await apiFetch(`/products/${productId}/fifo-preview?quantity=${qty}`);
    if (!preview.possible) {
      container.style.display = 'block';
      list.innerHTML = `<div style="color: var(--accent-danger); font-size:0.85rem;">⚠️ Quantidade solicitada (${qty}) é maior que o estoque total (${preview.totalAvailable}).</div>`;
      return;
    }

    container.style.display = 'block';
    list.innerHTML = preview.items.map(item => `
      <div class="fifo-item">
        <span>Lote #${item.batch_id} (${item.brand_notes || 'Sem marca'}) - Validade: ${formatDate(item.expiration_date)}</span>
        <strong>-${item.quantity_to_deduct} (${item.remaining_after} restam)</strong>
      </div>
    `).join('');

  } catch (err) {
    console.error('Erro na prévia FIFO:', err);
  }
}

async function executeFifo() {
  const productId = document.getElementById('fifo-product-id').value;
  const quantity = Number(document.getElementById('fifo-quantity').value);
  const type = document.getElementById('fifo-type').value;

  try {
    await apiFetch(`/products/${productId}/consume`, {
      method: 'POST',
      body: JSON.stringify({ quantity, type })
    });

    closeModal('modal-fifo');
    await loadProducts();
    if (hasPermission('can_view_dashboard')) await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

// Discard Modal Flow
async function openDiscardModal(productId, productName) {
  document.getElementById('form-discard').reset();
  document.getElementById('discard-product-id').value = productId;
  document.getElementById('discard-product-name').value = productName;

  const productData = await apiFetch(`/products/${productId}`);
  const batchSelect = document.getElementById('discard-batch-id');
  batchSelect.innerHTML = '';

  const activeBatches = (productData.batches || []).filter(b => b.status === 'active' && b.current_quantity > 0);
  if (activeBatches.length === 0) {
    alert('Nenhum lote ativo encontrado para descarte.');
    return;
  }

  activeBatches.forEach(b => {
    batchSelect.innerHTML += `
      <option value="${b.id}">Lote #${b.id} - ${b.current_quantity} ${productData.product.unit} (Validade: ${formatDate(b.expiration_date)} - ${b.brand_notes || 'Sem marca'})</option>
    `;
  });

  openModal('modal-discard');
}

async function executeDiscard() {
  const batchId = document.getElementById('discard-batch-id').value;
  const quantity = Number(document.getElementById('discard-quantity').value);
  const reason = document.getElementById('discard-reason').value;

  try {
    await apiFetch(`/batches/${batchId}/discard`, {
      method: 'POST',
      body: JSON.stringify({ quantity, reason })
    });

    closeModal('modal-discard');
    await loadProducts();
    if (hasPermission('can_view_dashboard')) await loadDashboard();
    alert('Descarte por validade registrado com sucesso!');
  } catch (err) {
    alert(err.message);
  }
}

// Adjustment / Correction Modal Flow
async function openAdjustmentModal() {
  document.getElementById('form-adjustment').reset();
  const prodSelect = document.getElementById('adj-product-id');
  prodSelect.innerHTML = '<option value="">Selecione um produto...</option>';

  products.forEach(p => {
    prodSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
  });

  document.getElementById('adj-batch-id').innerHTML = '<option value="">Primeiro selecione o produto</option>';
  openModal('modal-adjustment');
}

async function populateAdjustmentBatches(productId) {
  const batchSelect = document.getElementById('adj-batch-id');
  batchSelect.innerHTML = '';

  if (!productId) {
    batchSelect.innerHTML = '<option value="">Primeiro selecione o produto</option>';
    return;
  }

  const productData = await apiFetch(`/products/${productId}`);
  const allBatches = productData.batches || [];

  if (allBatches.length === 0) {
    batchSelect.innerHTML = '<option value="">Nenhum lote encontrado</option>';
    return;
  }

  allBatches.forEach(b => {
    batchSelect.innerHTML += `
      <option value="${b.id}">Lote #${b.id} [${b.status}] - Qtde Atual: ${b.current_quantity} (Preço: ${formatCurrency(b.unit_price)}, Val: ${formatDate(b.expiration_date)})</option>
    `;
  });
}

async function executeAdjustment() {
  const batch_id = Number(document.getElementById('adj-batch-id').value);
  const field_changed = document.getElementById('adj-field').value;
  const new_value = document.getElementById('adj-new-value').value;
  const reason = document.getElementById('adj-reason').value;

  try {
    await apiFetch('/adjustments', {
      method: 'POST',
      body: JSON.stringify({ batch_id, field_changed, new_value, reason })
    });

    closeModal('modal-adjustment');
    await loadProducts();
    if (hasPermission('can_view_corrections')) await loadCorrections();
    alert('Correção de registro aplicada com sucesso!');
  } catch (err) {
    alert(err.message);
  }
}

// User Management Modal Flow
function openNewUserModal() {
  document.getElementById('form-user').reset();
  document.getElementById('user-id').value = '';
  document.getElementById('modal-user-title').textContent = 'Novo Usuário do Sistema';
  document.getElementById('user-username-input').disabled = false;
  document.getElementById('user-pass-input').required = true;
  document.getElementById('user-pass-label').textContent = 'Senha (mínimo 6 caracteres)';

  document.getElementById('perm-view-dash').checked = true;
  document.getElementById('perm-view-prod').checked = true;
  document.getElementById('perm-add-prod').checked = false;
  document.getElementById('perm-edit-prod').checked = false;
  document.getElementById('perm-del-prod').checked = false;
  document.getElementById('perm-add-batch').checked = true;
  document.getElementById('perm-consume-stock').checked = true;
  document.getElementById('perm-discard-stock').checked = false;
  document.getElementById('perm-view-proj').checked = true;
  document.getElementById('perm-view-mov').checked = true;
  document.getElementById('perm-view-corr').checked = false;
  document.getElementById('perm-make-corr').checked = false;
  document.getElementById('perm-manage-categories').checked = false;

  openModal('modal-user');
}

function openEditUserModal(userId) {
  const target = usersList.find(u => u.id === userId);
  if (!target) return;

  document.getElementById('user-id').value = target.id;
  document.getElementById('modal-user-title').textContent = `Editar Permissões: ${target.username}`;
  document.getElementById('user-name-input').value = target.name;
  document.getElementById('user-username-input').value = target.username;
  document.getElementById('user-username-input').disabled = true;
  document.getElementById('user-pass-input').value = '';
  document.getElementById('user-pass-input').required = false;
  document.getElementById('user-pass-label').textContent = 'Nova Senha (deixe em branco para manter a atual)';

  document.getElementById('perm-view-dash').checked = !!target.can_view_dashboard;
  document.getElementById('perm-view-prod').checked = !!target.can_view_products;
  document.getElementById('perm-add-prod').checked = !!target.can_add_product;
  document.getElementById('perm-edit-prod').checked = !!target.can_edit_product;
  document.getElementById('perm-del-prod').checked = !!target.can_delete_product;
  document.getElementById('perm-add-batch').checked = !!target.can_add_batch;
  document.getElementById('perm-consume-stock').checked = !!target.can_consume_stock;
  document.getElementById('perm-discard-stock').checked = !!target.can_discard_stock;
  document.getElementById('perm-view-proj').checked = !!target.can_view_projections;
  document.getElementById('perm-view-mov').checked = !!target.can_view_movements;
  document.getElementById('perm-view-corr').checked = !!target.can_view_corrections;
  document.getElementById('perm-make-corr').checked = !!target.can_make_corrections;
  document.getElementById('perm-manage-categories').checked = !!target.can_manage_categories;

  openModal('modal-user');
}

async function saveUser() {
  const id = document.getElementById('user-id').value;
  const permissions = {
    can_view_dashboard: document.getElementById('perm-view-dash').checked ? 1 : 0,
    can_view_products: document.getElementById('perm-view-prod').checked ? 1 : 0,
    can_add_product: document.getElementById('perm-add-prod').checked ? 1 : 0,
    can_edit_product: document.getElementById('perm-edit-prod').checked ? 1 : 0,
    can_delete_product: document.getElementById('perm-del-prod').checked ? 1 : 0,
    can_add_batch: document.getElementById('perm-add-batch').checked ? 1 : 0,
    can_consume_stock: document.getElementById('perm-consume-stock').checked ? 1 : 0,
    can_discard_stock: document.getElementById('perm-discard-stock').checked ? 1 : 0,
    can_view_projections: document.getElementById('perm-view-proj').checked ? 1 : 0,
    can_view_movements: document.getElementById('perm-view-mov').checked ? 1 : 0,
    can_view_corrections: document.getElementById('perm-view-corr').checked ? 1 : 0,
    can_make_corrections: document.getElementById('perm-make-corr').checked ? 1 : 0,
    can_manage_categories: document.getElementById('perm-manage-categories').checked ? 1 : 0
  };

  const payload = {
    name: document.getElementById('user-name-input').value,
    username: document.getElementById('user-username-input').value,
    password: document.getElementById('user-pass-input').value,
    permissions
  };

  try {
    if (id) {
      await apiFetch(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    }

    closeModal('modal-user');
    await loadUsers();
    alert('Usuário salvo com sucesso!');
  } catch (err) {
    alert(err.message);
  }
}

async function toggleUserStatus(userId, currentActive) {
  try {
    await apiFetch(`/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ active: currentActive ? 0 : 1 })
    });
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteUser(userId) {
  if (!confirm('Tem certeza que deseja excluir este usuário?')) return;
  try {
    await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function viewProductBatches(productId, productName) {
  const data = await apiFetch(`/products/${productId}`);
  document.getElementById('batches-detail-title').textContent = `Lotes: ${productName}`;
  const tbody = document.getElementById('tbody-batches-detail');
  tbody.innerHTML = '';

  data.batches.forEach(b => {
    const statusTag = b.status === 'active' 
      ? '<span class="badge-ok">Ativo</span>' 
      : '<span style="color:var(--text-muted);">Consumido</span>';

    let rowActions = '';
    if (hasPermission('can_discard_stock') && b.status === 'active' && b.current_quantity > 0) {
      rowActions += `<button class="btn btn-danger" style="padding:0.2rem 0.4rem; font-size:0.75rem;" onclick="closeModal('modal-batches-detail'); openDiscardModal(${productId}, '${productName}')">🗑️ Descartar</button>`;
    }

    tbody.innerHTML += `
      <tr>
        <td>#${b.id}</td>
        <td>${formatDate(b.entry_date)}</td>
        <td>${formatDate(b.expiration_date)}</td>
        <td>${b.initial_quantity}</td>
        <td><strong>${b.current_quantity}</strong></td>
        <td>${formatCurrency(b.unit_price)}</td>
        <td>${statusTag}</td>
        <td>${rowActions || '-'}</td>
      </tr>
    `;
  });

  openModal('modal-batches-detail');
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
