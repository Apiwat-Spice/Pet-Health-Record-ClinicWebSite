const supabase = require('../../config/supabase');

const roomTypes = ['general', 'icu', 'isolation', 'cat_ward', 'dog_ward'];

function renderForm(res, room = {}, error = null) {
  return res.status(error ? 400 : 200).render('ipd/room-form', {
    user: res.locals.user || null,
    activePage: 'ipd-room-create',
    room,
    error,
  });
}

exports.listRooms = async (req, res) => {
  try {
    const { data: rooms, error } = await supabase
      .from('ipd_rooms')
      .select('*')
      .order('room_id', { ascending: false });

    if (error) throw error;

    res.render('ipd/rooms', {
      user: req.user || req.session?.user || req.session?.account || null,
      activePage: 'ipd-room-list',
      rooms: rooms || [],
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดรายการห้อง IPD ได้');
  }
};

exports.showCreateRoom = (req, res) => {
  renderForm(res);
};

exports.createRoom = async (req, res) => {
  const room_code = String(req.body.room_code || '').trim();
  const type = String(req.body.type || 'general');
  const pet_amount = Number(req.body.pet_amount);
  const detail = String(req.body.detail || '').trim() || null;
  const status = String(req.body.status || 'not_full');

  const room = { room_code, type, pet_amount: req.body.pet_amount, detail, status };

  if (!room_code || room_code.length > 50) {
    return renderForm(res, room, 'กรุณากรอกรหัสห้องไม่เกิน 50 ตัวอักษร');
  }

  if (!roomTypes.includes(type)) {
    return renderForm(res, room, 'กรุณาเลือกประเภทห้องให้ถูกต้อง');
  }

  if (!Number.isInteger(pet_amount) || pet_amount <= 0) {
    return renderForm(res, room, 'จำนวนสัตว์ที่รองรับต้องเป็นจำนวนเต็มมากกว่า 0');
  }

  if (!['full', 'not_full'].includes(status)) {
    return renderForm(res, room, 'กรุณาเลือกสถานะห้องให้ถูกต้อง');
  }

  try {
    const { data, error } = await supabase
      .from('ipd_rooms')
      .insert([{ room_code, type, pet_amount, detail, status }])
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return renderForm(res, room, 'รหัสห้องนี้มีอยู่แล้ว กรุณาใช้รหัสห้องอื่น');
      }
      if (error.code === '23514') {
        return renderForm(res, room, 'ข้อมูลไม่ตรงตามเงื่อนไขของฐานข้อมูล');
      }
      throw error;
    }

    return res.redirect(`/ipd/rooms/${data.room_id}`);
  } catch (error) {
    console.error(error);
    return renderForm(res, room, 'เพิ่มห้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
};

exports.roomDetail = async (req, res) => {
  const roomId = req.params.id;

  if (!/^\d+$/.test(roomId)) {
    return res.status(400).send('รหัสห้องไม่ถูกต้อง');
  }

  try {
    const { data: room, error } = await supabase
      .from('ipd_rooms')
      .select('*')
      .eq('room_id', roomId)
      .maybeSingle();

    if (error) throw error;

    if (!room) {
      return res.status(404).send('ไม่พบข้อมูลห้อง IPD');
    }

res.render('ipd/room-detail', {
  user: req.user || req.session?.user || req.session?.account || null,
  activePage: 'ipd-room-list',
  room,
});
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดรายละเอียดห้องได้');
  }
};

exports.listAdmitPlans = async (req, res) => {
  // โหลดรายการ Admit Plans
};

exports.showCreateAdmitPlan = (req, res) => {
  // แสดงฟอร์มสร้าง Admit Plan
};

exports.createAdmitPlan = async (req, res) => {
  // บันทึก Admit Plan
};