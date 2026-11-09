
const supabase = require('../../config/supabase');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

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

function isStockExpired(stock, today) {
  return (
    stock.expires_status === 'expired' ||
    (stock.expires_at && stock.expires_at < today)
  );
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
      status,
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
    .in('status', ['Finish', 'Completed'])
    .order('visit_date', { ascending: false });

  if (visitError) throw visitError;

  const rawVisits = visitRows || [];

  const petIds = [
    ...new Set(
      rawVisits
        .map((visit) => getAppointment(visit).pet_id)
        .filter(Boolean)
    ),
  ];

  let pets = [];

  if (petIds.length) {
    const { data, error } = await supabase
      .from('pets')
      .select('pet_id, pet_name')
      .in('pet_id', petIds);

    if (error) throw error;

    pets = data || [];
  }

  const petMap = new Map(
    pets.map((pet) => [String(pet.pet_id), pet])
  );

  const visits = rawVisits.map((visit) => {
    const appointment = getAppointment(visit);
    const pet = petMap.get(String(appointment.pet_id));

    return {
      ...visit,
      appointment,
      pet_name: pet?.pet_name || '-',
    };
  });

  const visitIds = visits.map((visit) => visit.visit_id);

  let transactions = [];

  if (visitIds.length) {
    const { data, error } = await supabase
      .from('transactions')
      .select('transaction_id, visit_id, total_price, created_at')
      .in('visit_id', visitIds);

    if (error) throw error;

    transactions = data || [];
  }

  const transactionIds = transactions.map(
    (transaction) => transaction.transaction_id
  );

  let receipts = [];
  let items = [];

  if (transactionIds.length) {
    const [receiptResult, itemResult] = await Promise.all([
      supabase
        .from('receipts')
        .select(`
          receipt_id,
          transaction_id,
          payment_status,
          created_at,
          updated_at
        `)
        .in('transaction_id', transactionIds),

      supabase
        .from('transaction_items')
        .select(`
          transaction_item_id,
          transaction_id,
          stock_id,
          quantity,
          unit_price,
          subtotal
        `)
        .in('transaction_id', transactionIds),
    ]);

    if (receiptResult.error) throw receiptResult.error;
    if (itemResult.error) throw itemResult.error;

    receipts = receiptResult.data || [];
    items = itemResult.data || [];
  }

  const { data: stockRows, error: stockError } = await supabase
    .from('stock')
    .select(`
      stock_id,
      name,
      category,
      quantity,
      price,
      type_unit,
      expires_status,
      expires_at
    `)
    .order('name', { ascending: true });

  if (stockError) throw stockError;

  const allStocks = stockRows || [];

  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Bangkok',
  });

  const availableStocks = allStocks.filter(
    (stock) => !isStockExpired(stock, today)
  );

  const stockMap = new Map(
    allStocks.map((stock) => [String(stock.stock_id), stock])
  );

  const transactionMap = new Map(
    transactions.map((transaction) => [
      String(transaction.visit_id),
      transaction,
    ])
  );

  const receiptMap = new Map(
    receipts.map((receipt) => [
      String(receipt.transaction_id),
      receipt,
    ])
  );

  const itemMap = new Map();

  for (const item of items) {
    const key = String(item.transaction_id);

    if (!itemMap.has(key)) {
      itemMap.set(key, []);
    }

    const stock = stockMap.get(String(item.stock_id));

    itemMap.get(key).push({
      ...item,
      stock_name: stock?.name || 'ไม่พบสินค้า',
      type_unit: stock?.type_unit || '',
    });
  }

  const enrichedVisits = visits.map((visit) => {
    const transaction =
      transactionMap.get(String(visit.visit_id)) || null;

    const receipt = transaction
      ? receiptMap.get(String(transaction.transaction_id)) || null
      : null;

    return {
      ...visit,
      transaction: transaction
        ? {
            ...transaction,
            receipt_id: receipt?.receipt_id || null,
          }
        : null,
      receipt,
    };
  });

  const selectedId = selectedVisitId
    ? String(selectedVisitId)
    : String(
        enrichedVisits.find((visit) => !visit.receipt)?.visit_id ||
        enrichedVisits[0]?.visit_id ||
        ''
      );

  const selectedVisit =
    enrichedVisits.find(
      (visit) => String(visit.visit_id) === selectedId
    ) || null;

  const selectedTransaction = selectedVisit?.transaction || null;

  const selectedItems = selectedTransaction
    ? itemMap.get(String(selectedTransaction.transaction_id)) || []
    : [];

  const receiptList = receipts
    .map((receipt) => {
      const transaction = transactions.find(
        (item) =>
          String(item.transaction_id) === String(receipt.transaction_id)
      );

      const visit = enrichedVisits.find(
        (item) =>
          String(item.visit_id) === String(transaction?.visit_id)
      );

      return {
        ...receipt,
        transaction,
        visit,
        items: itemMap.get(String(receipt.transaction_id)) || [],
      };
    })
    .filter((receipt) => receipt.transaction && receipt.visit)
    .sort(
      (a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );

  return {
    visits: enrichedVisits,
    stocks: allStocks,
    availableStocks,
    receipts: receiptList,
    selectedVisit,
    selectedVisitId: selectedId,
    selectedTransaction,
    selectedItems,
  };
}

async function getCreateReceipt(req, res) {
  try {
    const data = await getReceiptPageData(req.query.visit_id);

    data.creatableVisits = data.visits.filter(
      (visit) => visit.status === 'Finish' && !visit.receipt
    );

    const success = req.session?.receiptSuccess;
    const error = req.session?.receiptError;

    if (req.session) {
      delete req.session.receiptSuccess;
      delete req.session.receiptError;
    }

    return res.render('Appointments/ReceiptCreate', {
      user: getUser(req),
      activePage: 'receipt',
      success,
      error,
      ...data,
    });
  } catch (error) {
    console.error('Load create receipt error:', error);

    return res.status(500).send(
      'ไม่สามารถโหลดหน้าสร้าง Receipt ได้: ' + error.message
    );
  }
}

async function getReceipt(req, res) {
  try {
    let visitId = req.query.visit_id;

    const receiptId =
      req.query.receipt_id || req.params.receiptId;

    if (!visitId && receiptId) {
      const id = Number(receiptId);

      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).send('รหัส Receipt ไม่ถูกต้อง');
      }

      const { data: receipt, error } = await supabase
        .from('receipts')
        .select('transaction_id')
        .eq('receipt_id', id)
        .maybeSingle();

      if (error) throw error;

      if (!receipt) {
        return res.status(404).send('ไม่พบ Receipt');
      }

      const { data: transaction, error: transactionError } =
        await supabase
          .from('transactions')
          .select('visit_id')
          .eq('transaction_id', receipt.transaction_id)
          .maybeSingle();

      if (transactionError) throw transactionError;

      if (!transaction) {
        return res.status(404).send('ไม่พบข้อมูล Transaction');
      }

      visitId = transaction.visit_id;
    }

    const data = await getReceiptPageData(visitId);

    if (visitId && !data.selectedVisit) {
      return res.status(404).send('ไม่พบข้อมูล Visit Record');
    }

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
      ...data,
    });
  } catch (error) {
    console.error('Load receipt error:', error);

    return res.status(500).send(
      'ไม่สามารถโหลดหน้า Receipt ได้: ' + error.message
    );
  }
}

async function saveReceipt(req, res) {
  const user = getUser(req);
  const visitId = String(req.body.visit_id || '').trim();

  try {
    if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
      return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
    }

    const parsedVisitId = Number(visitId);

    if (!Number.isSafeInteger(parsedVisitId) || parsedVisitId <= 0) {
      throw new Error('รหัส Visit Record ไม่ถูกต้อง');
    }

    const { data: visit, error: visitError } = await supabase
      .from('visit_records')
      .select('visit_id, status')
      .eq('visit_id', parsedVisitId)
      .maybeSingle();

    if (visitError) throw visitError;

    if (!visit) {
      throw new Error('ไม่พบ Visit Record');
    }

    if (visit.status === 'Completed') {
      throw new Error(
        'Visit Record นี้ทำ Receipt แล้ว ไม่สามารถแก้ไขรายการได้'
      );
    }

    if (visit.status !== 'Finish') {
      throw new Error(
        'Visit Record ต้องมีสถานะ Finish ก่อนจึงสามารถสร้าง Receipt ได้'
      );
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

    const normalizedItems = items.map((item) => ({
      stock_id: Number(item.stock_id),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
    }));

    if (
      normalizedItems.some(
        (item) =>
          !Number.isSafeInteger(item.stock_id) ||
          item.stock_id <= 0 ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.unit_price) ||
          item.unit_price < 0 ||
          Math.round(item.unit_price * 100) !== item.unit_price * 100
      )
    ) {
      throw new Error(
        'กรุณาตรวจสอบสินค้า จำนวน และราคาต่อหน่วย'
      );
    }

    if (
      new Set(normalizedItems.map((item) => item.stock_id)).size !==
      normalizedItems.length
    ) {
      throw new Error(
        'ไม่สามารถเลือกสินค้าชนิดเดียวกันซ้ำหลายแถวได้'
      );
    }

    const stockIds = normalizedItems.map(
      (item) => item.stock_id
    );

    const { data: selectedStocks, error: stockError } =
      await supabase
        .from('stock')
        .select(`
          stock_id,
          name,
          quantity,
          expires_status,
          expires_at
        `)
        .in('stock_id', stockIds);

    if (stockError) throw stockError;

    if (
      !selectedStocks ||
      selectedStocks.length !== stockIds.length
    ) {
      throw new Error('ไม่พบสินค้าที่เลือกในคลัง');
    }

    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Bangkok',
    });

    for (const item of normalizedItems) {
      const stock = selectedStocks.find(
        (s) => String(s.stock_id) === String(item.stock_id)
      );

      if (!stock) {
        throw new Error('ไม่พบสินค้าที่เลือกในคลัง');
      }

      if (isStockExpired(stock, today)) {
        throw new Error(
          `สินค้า "${stock.name}" หมดอายุแล้ว ไม่สามารถนำมาออก Receipt ได้`
        );
      }

      if (item.quantity > Number(stock.quantity)) {
        throw new Error(
          `สินค้า "${stock.name}" มีจำนวนคงเหลือไม่เพียงพอ`
        );
      }
    }

    const { error } = await supabase.rpc('save_receipt_atomic', {
      p_visit_id: parsedVisitId,
      p_items: normalizedItems,
      p_clinic_staff_id: clinicStaffId,
    });

    if (error) throw error;

    const { data: updatedVisit, error: statusError } =
      await supabase
        .from('visit_records')
        .update({ status: 'Completed' })
        .eq('visit_id', parsedVisitId)
        .eq('status', 'Finish')
        .select('visit_id');

    if (statusError) throw statusError;

    if (!updatedVisit || updatedVisit.length === 0) {
      throw new Error(
        'สร้าง Receipt สำเร็จ แต่เปลี่ยนสถานะ Visit Record ไม่สำเร็จ กรุณาตรวจสอบสถานะ'
      );
    }

    if (req.session) {
      req.session.receiptSuccess =
        'บันทึก Receipt และปรับปรุงคลังสินค้าเรียบร้อยแล้ว';
    }

    return res.redirect('/receipt');
  } catch (error) {
    console.error('Save receipt error:', error);

    if (req.session) {
      req.session.receiptError =
        error.message || 'ไม่สามารถบันทึก Receipt ได้';
    }

    return res.redirect(
      '/receipt/create' +
      (visitId ? '?visit_id=' + encodeURIComponent(visitId) : '')
    );
  }
}

async function updatePaymentStatus(req, res) {
  const user = getUser(req);

  try {
    if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
      return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
    }

    const receiptId = Number(req.params.receiptId);
    const paymentStatus = String(
      req.body.payment_status || ''
    );

    if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
      throw new Error('รหัส Receipt ไม่ถูกต้อง');
    }

    if (!['pending', 'paid'].includes(paymentStatus)) {
      throw new Error('สถานะชำระเงินไม่ถูกต้อง');
    }

    const { error } = await supabase.rpc(
      'update_receipt_payment_atomic',
      {
        p_receipt_id: receiptId,
        p_payment_status: paymentStatus,
      }
    );

    if (error) throw error;

    if (req.session) {
      req.session.receiptSuccess =
        paymentStatus === 'paid'
          ? 'เปลี่ยนสถานะเป็นจ่ายแล้วเรียบร้อย'
          : 'เปลี่ยนสถานะเป็นยังไม่จ่ายเรียบร้อย';
    }

    return res.redirect('/receipt');
  } catch (error) {
    console.error('Update receipt payment error:', error);

    if (req.session) {
      req.session.receiptError =
        error.message || 'เปลี่ยนสถานะไม่สำเร็จ';
    }

    return res.redirect('/receipt');
  }
}
async function downloadReceiptPdf(req, res) {
  try {
    const receiptId = Number(req.params.receiptId);

    if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
      return res.status(400).send('รหัส Receipt ไม่ถูกต้อง');
    }

    // 1. ดึงข้อมูล Receipt
    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .select('receipt_id, transaction_id, payment_status, created_at')
      .eq('receipt_id', receiptId)
      .maybeSingle();

    if (receiptError) throw receiptError;

    if (!receipt) {
      return res.status(404).send('ไม่พบ Receipt');
    }

    // 2. ดึงข้อมูล Transaction
    const { data: transaction, error: transactionError } =
      await supabase
        .from('transactions')
        .select('transaction_id, visit_id, total_price, created_at')
        .eq('transaction_id', receipt.transaction_id)
        .maybeSingle();

    if (transactionError) throw transactionError;

    if (!transaction) {
      return res.status(404).send('ไม่พบข้อมูล Transaction');
    }

    // 3. ดึงข้อมูล Visit Record และ Appointment
    const { data: visit, error: visitError } = await supabase
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
        appointments (
          appointment_id,
          pet_id,
          appointment_date,
          appointment_time,
          title,
          type
        )
      `)
      .eq('visit_id', transaction.visit_id)
      .maybeSingle();

    if (visitError) throw visitError;

    if (!visit) {
      return res.status(404).send('ไม่พบข้อมูล Visit Record');
    }

    const appointment = getAppointment(visit);

    // 4. ดึงข้อมูลสัตว์เลี้ยง
    let pet = null;

    if (appointment.pet_id) {
      const { data, error } = await supabase
        .from('pets')
        .select('pet_id, pet_name')
        .eq('pet_id', appointment.pet_id)
        .maybeSingle();

      if (error) throw error;

      pet = data;
    }

    // 5. ดึงรายการสินค้าใน Receipt
    const { data: items, error: itemsError } = await supabase
      .from('transaction_items')
      .select(`
        transaction_item_id,
        stock_id,
        quantity,
        unit_price,
        subtotal
      `)
      .eq('transaction_id', transaction.transaction_id);

    if (itemsError) throw itemsError;

    const stockIds = [
      ...new Set((items || []).map((item) => item.stock_id).filter(Boolean)),
    ];

    let stocks = [];

    if (stockIds.length) {
      const { data, error } = await supabase
        .from('stock')
        .select('stock_id, name, type_unit')
        .in('stock_id', stockIds);

      if (error) throw error;

      stocks = data || [];
    }

    const stockMap = new Map(
      stocks.map((stock) => [String(stock.stock_id), stock])
    );

    const receiptItems = (items || []).map((item) => ({
      ...item,
      stock_name:
        stockMap.get(String(item.stock_id))?.name || 'ไม่พบสินค้า',
      type_unit:
        stockMap.get(String(item.stock_id))?.type_unit || '',
    }));

    // 6. ตรวจสอบฟอนต์ภาษาไทย
const fontPath = path.join(
  process.cwd(),
  'src',
  'public',
  'fonts',
  'NotoSansThai-Regular.ttf'
);

    if (!fs.existsSync(fontPath)) {
      throw new Error(
        'ไม่พบไฟล์ฟอนต์ภาษาไทย กรุณาตรวจสอบไฟล์ src/public/fonts/NotoSansThai-Regular.ttf'
      );
    }

    // 7. สร้าง PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="receipt-${receiptId}.pdf"`
    );

    res.setHeader('Cache-Control', 'no-store');

    doc.on('error', (error) => {
      console.error('PDF generation error:', error);

      if (!res.destroyed) {
        res.destroy(error);
      }
    });

    doc.pipe(res);

    doc.registerFont('Thai', fontPath);
    doc.font('Thai');

    const pageWidth = doc.page.width;
    const left = 40;
    const right = pageWidth - 40;

    const formatDate = (value) => {
      if (!value) return '-';

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) return '-';

      return date.toLocaleDateString('th-TH', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Bangkok'
      });
    };

    const formatMoney = (value) =>
      Number(value || 0).toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

    const line = (y) => {
      doc.moveTo(left, y).lineTo(right, y).strokeColor('#cccccc').stroke();
    };

    // หัวใบเสร็จ
    doc.fontSize(22).text('ใบเสร็จรับเงิน', {
      align: 'center'
    });

    doc.moveDown(0.5);

    doc.fontSize(11);
    doc.text(`เลขที่ใบเสร็จ: ${receipt.receipt_id}`, left);
    doc.text(`วันที่ออกใบเสร็จ: ${formatDate(receipt.created_at)}`);
    doc.text(
      `สถานะการชำระเงิน: ${
        receipt.payment_status === 'paid' ? 'ชำระเงินแล้ว' : 'ยังไม่ชำระเงิน'
      }`
    );

    doc.moveDown(0.8);
    line(doc.y);
    doc.moveDown(0.8);

    // ข้อมูลสัตว์เลี้ยงและการเข้ารับบริการ
    doc.fontSize(14).text('ข้อมูลการเข้ารับบริการ');
    doc.moveDown(0.4);

    doc.fontSize(11);
    doc.text(`สัตว์เลี้ยง: ${pet?.pet_name || '-'}`);
    doc.text(`วันที่เข้ารับบริการ: ${formatDate(appointment.appointment_date || visit.visit_date)}`);
    doc.text(`เวลา: ${appointment.appointment_time || visit.visit_time || '-'}`);
    doc.text(`ประเภทบริการ: ${appointment.title || appointment.type || '-'}`);
    doc.text(`น้ำหนัก: ${visit.weight ? `${visit.weight} กก.` : '-'}`);

    doc.moveDown(0.8);
    line(doc.y);
    doc.moveDown(0.8);

    // รายการสินค้า
    doc.fontSize(14).text('รายการสินค้าและบริการ');
    doc.moveDown(0.6);

    const columns = {
      name: left,
      quantity: 320,
      price: 390,
      subtotal: 475
    };

    const drawTableHeader = () => {
      const y = doc.y;

      doc.fontSize(10);
      doc.text('รายการ', columns.name, y, { width: 260 });
      doc.text('จำนวน', columns.quantity, y, { width: 60, align: 'center' });
      doc.text('ราคา/หน่วย', columns.price, y, { width: 75, align: 'right' });
      doc.text('รวม', columns.subtotal, y, { width: 80, align: 'right' });

      doc.moveDown(0.6);
      line(doc.y);
      doc.moveDown(0.5);
    };

    drawTableHeader();

    if (!receiptItems.length) {
      doc.fontSize(11).text('ไม่มีรายการสินค้า', left);
    } else {
      receiptItems.forEach((item) => {
        const y = doc.y;

        if (y > doc.page.height - 100) {
          doc.addPage();
          drawTableHeader();
        }

        const currentY = doc.y;

        doc.fontSize(10);
        doc.text(item.stock_name, columns.name, currentY, {
          width: 260
        });
        doc.text(
          `${item.quantity} ${item.type_unit || ''}`,
          columns.quantity,
          currentY,
          { width: 60, align: 'center' }
        );
        doc.text(
          formatMoney(item.unit_price),
          columns.price,
          currentY,
          { width: 75, align: 'right' }
        );
        doc.text(
          formatMoney(item.subtotal),
          columns.subtotal,
          currentY,
          { width: 80, align: 'right' }
        );

        doc.moveDown(0.8);
      });
    }

    doc.moveDown(0.8);
    line(doc.y);
    doc.moveDown(0.8);

    const total = Number(
      transaction.total_price ??
      receiptItems.reduce(
        (sum, item) => sum + Number(item.subtotal || 0),
        0
      )
    );

    doc.fontSize(14).text(
      `ยอดรวมสุทธิ: ${formatMoney(total)} บาท`,
      {
        align: 'right'
      }
    );

    doc.moveDown(2);

    doc.fontSize(10).text('ขอบคุณที่ใช้บริการ', {
      align: 'center'
    });

    doc.end();
  } catch (error) {
    console.error('Download Receipt PDF error:', error);

    if (!res.headersSent) {
      return res.status(500).send(
        'ไม่สามารถดาวน์โหลด Receipt PDF ได้: ' + error.message
      );
    }

    if (!res.destroyed) {
      res.destroy(error);
    }
  }
}

module.exports = {
  requireRole,
  getReceipt,
  getCreateReceipt,
  saveReceipt,
  updatePaymentStatus,
  downloadReceiptPdf,
};
