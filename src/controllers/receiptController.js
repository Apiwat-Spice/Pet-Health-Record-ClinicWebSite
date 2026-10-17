const supabase = require('../../config/supabase');

function getUser(req) {
  return req.user || req.session?.user || req.session?.account || null;
}

function getClinicStaffId(user) {
  if (user.role === 'clinic') return null;
  if (user.role === 'clinic_staff' && user.clinic_staff_id) {
    return user.clinic_staff_id;
  }
  throw new Error('ไม่พบรหัส Clinic Staff ของผู้ใช้งาน ไม่สามารถทำรายการได้');
}

function requireRole(req, res, next) {
  const user = getUser(req);
  if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
    return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
  }
  next();
}

function getAppointment(visit) {
  if (!visit?.appointments) return {};
  return Array.isArray(visit.appointments)
    ? visit.appointments[0] || {}
    : visit.appointments;
}

async function getReceiptPageData(selectedVisitId) {
  const { data: visitRows, error: visitError } = await supabase
    .from('visit_records')
    .select(`
      visit_id,
      appointment_id,
      visit_date,
      visit_time,
      weight,
      symptoms,
      diagnosis,
      treatment,
      note,
      appointments!inner (
        appointment_id,
        pet_id,
        appointment_date,
        appointment_time,
        status,
        title,
        type
      )
    `)
    .eq('appointments.status', 'completed')
    .order('visit_date', { ascending: false });

  if (visitError) throw visitError;

  const rawVisits = visitRows || [];
  const petIds = [...new Set(rawVisits.map(v => getAppointment(v).pet_id).filter(Boolean))];

  let pets = [];
  if (petIds.length) {
    const { data, error } = await supabase
      .from('pets')
      .select('pet_id, pet_name')
      .in('pet_id', petIds);
    if (error) throw error;
    pets = data || [];
  }

  const petMap = new Map(pets.map(p => [String(p.pet_id), p]));
  const visits = rawVisits.map(v => {
    const appointment = getAppointment(v);
    const pet = petMap.get(String(appointment.pet_id));
    return {
      ...v,
      appointment,
      pet_name: pet?.pet_name || '-'
    };
  });

  const visitIds = visits.map(v => v.visit_id);
  let transactions = [];

  if (visitIds.length) {
    const { data, error } = await supabase
      .from('transactions')
      .select('transaction_id, visit_id, total_price, created_at')
      .in('visit_id', visitIds);
    if (error) throw error;
    transactions = data || [];
  }

  const transactionIds = transactions.map(t => t.transaction_id);
  let receipts = [];
  let items = [];

  if (transactionIds.length) {
    const [receiptResult, itemResult] = await Promise.all([
      supabase
        .from('receipts')
        .select('receipt_id, transaction_id, payment_status, created_at, updated_at')
        .in('transaction_id', transactionIds),
      supabase
        .from('transaction_items')
        .select('transaction_item_id, transaction_id, stock_id, quantity, unit_price, subtotal')
        .in('transaction_id', transactionIds)
    ]);

    if (receiptResult.error) throw receiptResult.error;
    if (itemResult.error) throw itemResult.error;

    receipts = receiptResult.data || [];
    items = itemResult.data || [];
  }

  const stockIds = [...new Set(items.map(i => i.stock_id))];
  let stockRows = [];

  const { data: allStocks, error: stockError } = await supabase
    .from('stock')
    .select('stock_id, name, category, quantity, price, type_unit, expires_status, expires_at')
    .order('name', { ascending: true });

  if (stockError) throw stockError;
  stockRows = allStocks || [];

  const stockMap = new Map(stockRows.map(s => [String(s.stock_id), s]));
  const transactionMap = new Map(transactions.map(t => [String(t.visit_id), t]));
  const receiptMap = new Map(receipts.map(r => [String(r.transaction_id), r]));

  const itemMap = new Map();
  for (const item of items) {
    const key = String(item.transaction_id);
    if (!itemMap.has(key)) itemMap.set(key, []);
    itemMap.get(key).push({
      ...item,
      stock_name: stockMap.get(String(item.stock_id))?.name || 'ไม่พบสินค้า',
      type_unit: stockMap.get(String(item.stock_id))?.type_unit || ''
    });
  }

  const enrichedVisits = visits.map(v => {
    const transaction = transactionMap.get(String(
      transactions.find(t => String(t.visit_id) === String(v.visit_id))?.visit_id
    ));
    const actualTransaction = transactions.find(
      t => String(t.visit_id) === String(v.visit_id)
    ) || null;
    const receipt = actualTransaction
      ? receiptMap.get(String(actualTransaction.transaction_id)) || null
      : null;

    return {
      ...v,
      transaction: actualTransaction,
      receipt
    };
  });

  const selectedId = selectedVisitId
    ? String(selectedVisitId)
    : String(
        enrichedVisits.find(v => !v.transaction)?.visit_id ||
        enrichedVisits[0]?.visit_id ||
        ''
      );

  const selectedVisit = enrichedVisits.find(v => String(v.visit_id) === selectedId) || null;
  const selectedTransaction = selectedVisit?.transaction || null;
  const selectedItems = selectedTransaction
    ? itemMap.get(String(selectedTransaction.transaction_id)) || []
    : [];

  const receiptList = receipts.map(receipt => {
    const transaction = transactions.find(
      t => String(t.transaction_id) === String(receipt.transaction_id)
    );
    const visit = enrichedVisits.find(
      v => String(v.visit_id) === String(transaction?.visit_id)
    );

    return {
      ...receipt,
      transaction,
      visit,
      items: itemMap.get(String(receipt.transaction_id)) || []
    };
  }).filter(r => r.transaction && r.visit)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return {
    visits: enrichedVisits,
    stocks: stockRows,
    receipts: receiptList,
    selectedVisit,
    selectedVisitId: selectedId,
    selectedTransaction,
    selectedItems
  };
}

async function getReceipt(req, res) {
  try {
    const data = await getReceiptPageData(req.query.visit_id);
    const success = req.session?.receiptSuccess;
    const error = req.session?.receiptError;

    if (req.session) {
      delete req.session.receiptSuccess;
      delete req.session.receiptError;
    }

    return res.render('Appointments/Receipt', {
      user: getUser(req),
      activePage: 'receipt',
      success,
      error,
      ...data
    });
  } catch (error) {
    console.error('Load receipt error:', error);
    return res.status(500).send('ไม่สามารถโหลดหน้า Receipt ได้: ' + error.message);
  }
}

async function saveReceipt(req, res) {
  const user = getUser(req);
  const visitId = String(req.body.visit_id || '').trim();

  try {
    if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
      return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
    }

    const clinicStaffId = getClinicStaffId(user);
    let items;

    try {
      items = JSON.parse(req.body.items_json || '[]');
    } catch {
      throw new Error('รูปแบบรายการสินค้าไม่ถูกต้อง');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ');
    }

    const normalizedItems = items.map(item => ({
      stock_id: Number(item.stock_id),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price)
    }));

    if (normalizedItems.some(item =>
      !Number.isSafeInteger(item.stock_id) || item.stock_id <= 0 ||
      !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      !Number.isFinite(item.unit_price) || item.unit_price < 0 ||
      Math.round(item.unit_price * 100) !== item.unit_price * 100
    )) {
      throw new Error('กรุณาตรวจสอบสินค้า จำนวน และราคาต่อหน่วย');
    }

    if (new Set(normalizedItems.map(item => item.stock_id)).size !== normalizedItems.length) {
      throw new Error('ไม่สามารถเลือกสินค้าชนิดเดียวกันซ้ำหลายแถวได้');
    }

    const { error } = await supabase.rpc('save_receipt_atomic', {
      p_visit_id: Number(visitId),
      p_items: normalizedItems,
      p_clinic_staff_id: clinicStaffId
    });

    if (error) throw error;

    if (req.session) {
      req.session.receiptSuccess = 'บันทึก Receipt และปรับปรุงคลังสินค้าเรียบร้อยแล้ว';
    }
    return res.redirect('/receipt?visit_id=' + encodeURIComponent(visitId));
  } catch (error) {
    console.error('Save receipt error:', error);
    if (req.session) {
      req.session.receiptError = error.message || 'ไม่สามารถบันทึก Receipt ได้';
    }
    return res.redirect('/receipt' + (visitId ? '?visit_id=' + encodeURIComponent(visitId) : ''));
  }
}

async function updatePaymentStatus(req, res) {
  const user = getUser(req);

  try {
    if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
      return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
    }

    const receiptId = Number(req.params.receiptId);
    const paymentStatus = String(req.body.payment_status || '');

    if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
      throw new Error('รหัส Receipt ไม่ถูกต้อง');
    }

    if (!['pending', 'paid'].includes(paymentStatus)) {
      throw new Error('สถานะชำระเงินไม่ถูกต้อง');
    }

    const { error } = await supabase.rpc('update_receipt_payment_atomic', {
      p_receipt_id: receiptId,
      p_payment_status: paymentStatus
    });

    if (error) throw error;

    if (req.session) {
      req.session.receiptSuccess = paymentStatus === 'paid'
        ? 'เปลี่ยนสถานะเป็นจ่ายแล้วเรียบร้อย'
        : 'เปลี่ยนสถานะเป็นยังไม่จ่ายเรียบร้อย';
    }

    return res.redirect('/receipt');
  } catch (error) {
    console.error('Update receipt payment error:', error);
    if (req.session) req.session.receiptError = error.message || 'เปลี่ยนสถานะไม่สำเร็จ';
    return res.redirect('/receipt');
  }
}

module.exports = {
  requireRole,
  getReceipt,
  saveReceipt,
  updatePaymentStatus
};