// Veritabanı snake_case alanlarını API camelCase formatına dönüştürücü yardımcılar

function toCamelMaterial(m) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    unit: m.unit,
    qty: parseFloat(m.qty) || 0,
    minQty: parseFloat(m.min_qty) || 0,
    unitCost: parseFloat(m.unit_cost) || 0,
    defaultSupplierId: m.default_supplier_id,
    defaultSupplierName: m.default_supplier_name || null,
    isLowStock: (parseFloat(m.qty) || 0) <= (parseFloat(m.min_qty) || 0),
  };
}

function toCamelStockMovement(sm) {
  if (!sm) return null;
  return {
    id: sm.id,
    materialId: sm.material_id,
    materialName: sm.material_name || null,
    materialUnit: sm.material_unit || null,
    type: sm.type,
    qty: parseFloat(sm.qty) || 0,
    date: sm.date,
    userId: sm.user_id,
    userName: sm.user_name || null,
    reason: sm.reason || '',
    refPurchaseId: sm.ref_purchase_id,
  };
}

function toCamelNeed(n) {
  if (!n) return null;
  return {
    id: n.id,
    materialId: n.material_id,
    name: n.name,
    qty: parseFloat(n.qty) || 0,
    estimatedPrice: parseFloat(n.estimated_price) || 0,
    supplierId: n.supplier_id,
    supplierName: n.supplier_name || null,
    note: n.note || '',
    status: n.status,
    requestedBy: n.requested_by,
    requestedByName: n.requested_by_name || null,
    requestedDate: n.requested_date,
  };
}

function toCamelSupplier(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contact_person || '',
    phone: s.phone || '',
    email: s.email || '',
    paymentTerms: s.payment_terms || '',
    address: s.address || '',
    notes: s.notes || '',
    createdAt: s.created_at,
  };
}

function toCamelPurchase(p) {
  if (!p) return null;
  return {
    id: p.id,
    materialId: p.material_id,
    materialName: p.material_name || null,
    materialUnit: p.material_unit || null,
    qty: parseFloat(p.qty) || 0,
    unitPrice: parseFloat(p.unit_price) || 0,
    totalPrice: parseFloat(p.total_price) || 0,
    supplierId: p.supplier_id,
    supplierName: p.supplier_name || p.supplier_text || null,
    supplierText: p.supplier_text || '',
    projectId: p.project_id,
    projectName: p.project_name || null,
    date: p.date,
    buyerId: p.buyer_id,
    buyerName: p.buyer_name || null,
    note: p.note || '',
  };
}

function toCamelMaintenance(r) {
  if (!r) return null;
  return {
    id: r.id,
    trackingNo: r.tracking_no,
    assetId: r.asset_id,
    assetName: r.asset_name || null,
    assetCode: r.asset_code || null,
    groupId: r.group_id || null,
    groupName: r.group_name || null,
    dueDate: r.due_date,
    type: r.type,
    startDate: r.start_date,
    endDate: r.end_date,
    completedBy: r.completed_by,
    completedByName: r.completed_by_name || null,
    checklistResults: r.checklist_results || [],
    notes: r.notes || '',
    extraCost: parseFloat(r.extra_cost) || 0,
    materialsCost: parseFloat(r.materials_cost) || 0,
    totalCost: (parseFloat(r.extra_cost) || 0) + (parseFloat(r.materials_cost) || 0),
    usedMaterials: r.used_materials || [],
  };
}

function toCamelFault(f) {
  if (!f) return null;
  return {
    id: f.id,
    trackingNo: f.tracking_no,
    assetId: f.asset_id,
    assetName: f.asset_name || null,
    assetCode: f.asset_code || null,
    location: f.location || null,
    title: f.title,
    description: f.description || '',
    reportedBy: f.reported_by,
    reportedByName: f.reported_by_name || null,
    reportedDate: f.reported_date,
    priority: f.priority,
    status: f.status,
    assignedTo: f.assigned_to,
    assignedToName: f.assigned_to_name || null,
    resolvedDate: f.resolved_date,
    notes: f.notes || '',
    externalServiceCost: parseFloat(f.external_service_cost) || 0,
    materialsCost: parseFloat(f.materials_cost) || 0,
    totalCost: (parseFloat(f.external_service_cost) || 0) + (parseFloat(f.materials_cost) || 0),
    usedMaterials: f.used_materials || [],
    attachments: f.attachments || [],
  };
}

function toCamelInspection(r) {
  if (!r) return null;
  return {
    id: r.id,
    trackingNo: r.tracking_no,
    groupId: r.group_id,
    groupName: r.group_name || null,
    contractor: r.contractor || '',
    startDate: r.start_date,
    endDate: r.end_date,
    notes: r.notes || '',
    serviceCost: parseFloat(r.service_cost) || 0,
    completedBy: r.completed_by,
    completedByName: r.completed_by_name || null,
    assetIds: r.asset_ids || [],
    assets: r.assets || [],
    certificates: r.certificates || [],
  };
}

function toCamelExtMaint(r) {
  if (!r) return null;
  return {
    id: r.id,
    trackingNo: r.tracking_no,
    groupId: r.group_id,
    groupName: r.group_name || null,
    contractor: r.contractor || '',
    startDate: r.start_date,
    endDate: r.end_date,
    notes: r.notes || '',
    serviceCost: parseFloat(r.service_cost) || 0,
    completedBy: r.completed_by,
    completedByName: r.completed_by_name || null,
    assetIds: r.asset_ids || [],
    assets: r.assets || [],
    certificates: r.certificates || [],
  };
}

function toCamelProject(p) {
  if (!p) return null;
  return {
    id: p.id,
    trackingNo: p.tracking_no,
    name: p.name,
    description: p.description || '',
    ownerUserId: p.owner_user_id,
    ownerUserName: p.owner_user_name || null,
    priority: p.priority,
    status: p.status,
    startDate: p.start_date,
    targetEndDate: p.target_end_date,
    actualEndDate: p.actual_end_date,
    budgetAmount: parseFloat(p.budget_amount) || 0,
    budget: parseFloat(p.budget_amount) || 0,
    createdDate: p.created_date,
    spentAmount: parseFloat(p.spent_amount) || 0,
    tasksCount: parseInt(p.tasks_count, 10) || 0,
    tasksCompletedCount: parseInt(p.tasks_completed_count, 10) || 0,
  };
}

function toCamelSettings(s) {
  if (!s) return null;
  return {
    companyName: s.company_name || 'Fabrika Adı',
    logoStorageKey: s.logo_storage_key || null,
    footerNote: s.footer_note || '',
    pageSize: s.page_size || 'A4',
    orientation: s.orientation || 'portrait',
    maint: s.maint_settings || {},
    fault: s.fault_settings || {},
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(val) {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

function safeUuid(val) {
  return isUuid(val) ? val : null;
}

module.exports = {
  isUuid,
  safeUuid,
  UUID_REGEX,
  toCamelMaterial,
  toCamelStockMovement,
  toCamelNeed,
  toCamelSupplier,
  toCamelPurchase,
  toCamelMaintenance,
  toCamelFault,
  toCamelInspection,
  toCamelExtMaint,
  toCamelProject,
  toCamelSettings,
};

