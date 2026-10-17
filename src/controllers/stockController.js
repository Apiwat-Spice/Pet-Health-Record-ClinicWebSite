const supabase = require('../../config/supabase');

async function getOverview(req, res) {
  try {
    const { data: stocks, error } = await supabase
      .from('stock')
      .select('*')
      .order('name', { ascending: true })
      .order('expires_at', { ascending: true, nullsFirst: false });

    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    const items = (stocks || []).map(stock => ({
      ...stock,
      current_expired: stock.expires_at
        ? stock.expires_at < today
        : stock.expires_status === 'expired'
    }));

    res.render('Stock/overview', {
      user: req.user || req.session?.user || req.session?.account,
      activePage: 'stock-overview',
      stocks: items,
      success: req.session.stockSuccess || null,
      error: req.session.stockError || null
    });

    delete req.session.stockSuccess;
    delete req.session.stockError;
  } catch (error) {
    console.error('Get stock overview error:', error);
    res.status(500).send('ไม่สามารถโหลดรายการสินค้าได้');
  }
}

async function getCreate(req, res) {
  try {
    const { data: stocks, error } = await supabase
      .from('stock')
      .select('name, company, category, type_unit')
      .order('name', { ascending: true });

    if (error) throw error;

    res.render('Stock/create', {
      user: req.user || req.session?.user || req.session?.account,
      activePage: 'stock-overview',
      stocks: stocks || [],
      formData: {},
      error: null
    });
  } catch (error) {
    console.error('Get stock form error:', error);
    res.status(500).send('ไม่สามารถโหลดแบบฟอร์มสินค้าได้');
  }
}

async function createStock(req, res) {
  const user = req.user || req.session?.user || req.session?.account;

  const formData = {
    name: String(req.body.name || '').trim(),
    company: String(req.body.company || '').trim(),
    category: String(req.body.category || '').trim(),
    quantity: req.body.quantity,
    price: req.body.price,
    type_unit: String(req.body.type_unit || '').trim(),
    buy_unit: req.body.buy_unit,
    expires_status: req.body.expires_status,
    expires_at: req.body.expires_at || null,
    note: String(req.body.note || '').trim()
  };

  try {
    if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
      return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
    }

    let clinicStaffId = null;

    if (user.role === 'clinic_staff') {
      clinicStaffId = user.clinic_staff_id;

      if (!clinicStaffId) {
        throw new Error('ไม่พบรหัส Clinic Staff ของผู้ใช้งาน ไม่สามารถทำรายการได้');
      }
    }

    const quantity = Number(formData.quantity);
    const price = Number(formData.price);
    const buyUnit = Number(formData.buy_unit);

    if (!formData.name || !formData.category || !formData.type_unit) {
      throw new Error('กรุณากรอกชื่อสินค้า หมวดหมู่ และหน่วยนับ');
    }

    if (
      formData.quantity === '' ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      formData.price === '' ||
      !Number.isFinite(price) ||
      price < 0 ||
      formData.buy_unit === '' ||
      !Number.isFinite(buyUnit) ||
      buyUnit < 0
    ) {
      throw new Error('จำนวนสินค้าที่เพิ่มต้องมากกว่า 0 และราคาและหน่วยซื้อต้องไม่ติดลบ');
    }

    if (!['not_expired', 'expired'].includes(formData.expires_status)) {
      throw new Error('สถานะวันหมดอายุไม่ถูกต้อง');
    }

    if (formData.expires_at && !/^\d{4}-\d{2}-\d{2}$/.test(formData.expires_at)) {
      throw new Error('รูปแบบวันหมดอายุไม่ถูกต้อง');
    }

    if (formData.expires_at) {
      const expiryDate = new Date(`${formData.expires_at}T00:00:00Z`);

      if (
        Number.isNaN(expiryDate.getTime()) ||
        expiryDate.toISOString().slice(0, 10) !== formData.expires_at
      ) {
        throw new Error('วันหมดอายุไม่ถูกต้อง');
      }

      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Bangkok'
      });

      if (formData.expires_at < today) {
        formData.expires_status = 'expired';
      } else {
        formData.expires_status = 'not_expired';
      }
    }

    const { data, error } = await supabase.rpc('create_stock_with_transaction', {
      p_name: formData.name,
      p_company: formData.company || null,
      p_category: formData.category,
      p_quantity: quantity,
      p_price: price,
      p_type_unit: formData.type_unit,
      p_buy_unit: buyUnit,
      p_expires_status: formData.expires_status,
      p_expires_at: formData.expires_at,
      p_note: formData.note || null,
      p_clinic_staff_id: clinicStaffId,
      p_transaction_note: 'เพิ่มสินค้าเข้าคลัง'
    });

    if (error) throw error;

    req.session.stockSuccess = 'เพิ่มสินค้าและบันทึก Transaction In เรียบร้อยแล้ว';
    return res.redirect('/stock/overview');
  } catch (error) {
    console.error('Create stock transaction error:', error);

    const { data: stocks, error: loadError } = await supabase
      .from('stock')
      .select('name, company, category, type_unit')
      .order('name', { ascending: true });

    if (loadError) {
      return res.status(500).send('ไม่สามารถโหลดแบบฟอร์มสินค้าได้');
    }

    return res.status(400).render('Stock/create', {
      user,
      activePage: 'stock-overview',
      stocks: stocks || [],
      formData,
      error: error.message || 'ไม่สามารถเพิ่มสินค้าได้'
    });
  }
}
module.exports = {
  getOverview,
  getCreate,
  createStock
};
