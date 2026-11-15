const supabase = require('../../config/supabase');

const roomTypes = ['general', 'icu', 'isolation', 'cat_ward', 'dog_ward'];

function renderForm(res, room = {}, error = null, editing = false) {
  return res.status(error ? 400 : 200).render('ipd/room-form', {
    user: res.locals.user || null,
    activePage: 'ipd-room-create',
    room,
    editing,
    error,
  });
}
function isValidAdmitTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;

  const [hour, minute] = time.split(':').map(Number);
  const totalMinutes = hour * 60 + minute;

  return totalMinutes >= 540 && totalMinutes <= 990 && minute % 30 === 0;
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

exports.showEditRoom = async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/rooms');
  }

  try {
    const { data: room, error } = await supabase
      .from('ipd_rooms')
      .select('*')
      .eq('room_id', id)
      .maybeSingle();

    if (error) throw error;

    if (!room) {
      return res.status(404).send('ไม่พบข้อมูลห้อง');
    }

    return renderForm(res, room, null, true);
  } catch (error) {
    console.error(error);
    return res.status(500).send('ไม่สามารถโหลดข้อมูลห้องได้');
  }
};

exports.updateRoom = async (req, res) => {
  const id = Number(req.params.id);
  const room_code = String(req.body.room_code || '').trim();
  const type = String(req.body.type || 'general');
  const pet_amount = Number(req.body.pet_amount);
  const detail = String(req.body.detail || '').trim() || null;

  const room = {
    room_id: id,
    room_code,
    type,
    pet_amount: req.body.pet_amount,
    detail,
  };

  const fail = (message) => renderForm(res, room, message, true);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/rooms');
  }

  if (!room_code || room_code.length > 50) {
    return fail('กรุณากรอกรหัสห้องไม่เกิน 50 ตัวอักษร');
  }

  if (!roomTypes.includes(type)) {
    return fail('กรุณาเลือกประเภทห้องให้ถูกต้อง');
  }

  if (!Number.isInteger(pet_amount) || pet_amount < 1 || pet_amount > 50) {
    return fail('จำนวนสัตว์ที่รองรับต้องเป็นจำนวนเต็มตั้งแต่ 1–50 ตัว');
  }

  try {
    const { data: currentRoom, error: roomError } = await supabase
      .from('ipd_rooms')
      .select('room_id')
      .eq('room_id', id)
      .maybeSingle();

    if (roomError) throw roomError;

    if (!currentRoom) {
      return res.status(404).send('ไม่พบข้อมูลห้อง');
    }

    const { count, error: countError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id', { count: 'exact', head: true })
      .eq('room_id', id)
      .eq('status', 'admitted');

    if (countError) throw countError;

    if (pet_amount < count) {
      return fail(
        `ไม่สามารถกำหนดความจุต่ำกว่าจำนวนสัตว์ที่กำลังพักรักษา (${count} ตัว)`,
      );
    }

    const { error } = await supabase
      .from('ipd_rooms')
      .update({
        room_code,
        type,
        pet_amount,
        detail,
      })
      .eq('room_id', id);

    if (error) {
      if (error.code === '23505') {
        return fail('รหัสห้องนี้มีอยู่แล้ว กรุณาใช้รหัสห้องอื่น');
      }

      if (error.code === '23514') {
        return fail('ข้อมูลไม่ตรงตามเงื่อนไขของฐานข้อมูล');
      }

      throw error;
    }

    return res.redirect(`/ipd/rooms/${id}`);
  } catch (error) {
    console.error(error);
    return fail('แก้ไขข้อมูลห้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
};

exports.createRoom = async (req, res) => {
  const room_code = String(req.body.room_code || '').trim();
  const type = String(req.body.type || 'general');
  const pet_amount = Number(req.body.pet_amount);
  const detail = String(req.body.detail || '').trim() || null;
  const status = String(req.body.status || 'not_full');

  const room = {
    room_code,
    type,
    pet_amount: req.body.pet_amount,
    detail,
    status,
  };

  if (!room_code || room_code.length > 50) {
    return renderForm(res, room, 'กรุณากรอกรหัสห้องไม่เกิน 50 ตัวอักษร');
  }

  if (!roomTypes.includes(type)) {
    return renderForm(res, room, 'กรุณาเลือกประเภทห้องให้ถูกต้อง');
  }

  if (!Number.isInteger(pet_amount) || pet_amount <= 0) {
    return renderForm(
      res,
      room,
      'จำนวนสัตว์ที่รองรับต้องเป็นจำนวนเต็มมากกว่า 0',
    );
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
        return renderForm(
          res,
          room,
          'รหัสห้องนี้มีอยู่แล้ว กรุณาใช้รหัสห้องอื่น',
        );
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

exports.listAdmitPlans = async (req, res) => {
  try {
    const { data: admitPlans, error } = await supabase
      .from('admit_plans')
      .select(
        `
        admit_plan_id,
        room_id,
        pet_id,
        check_in_date,
        check_in_time,
        check_out_date,
        check_out_time,
        note,
        status,
        ipd_rooms(room_code, type),
        pets(
          pet_name,
          animal_type,
          species,
          pet_owners(first_name, last_name, username)
        )
      `,
      )
      .order('check_in_date', { ascending: false })
      .order('check_in_time', { ascending: false });

    if (error) throw error;

    res.render('ipd/admit-plans', {
      user: res.locals.user || req.session?.user || null,
      activePage: 'admit-plans',
      admitPlans: admitPlans || [],
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดรายการ Admit Plans ได้');
  }
};

async function renderAdmitPlanForm(
  req,
  res,
  form = {},
  error = null,
  options = {},
) {
  const [roomsResult, ownersResult, petsResult] = await Promise.all([
    supabase
      .from('ipd_rooms')
      .select('room_id, room_code, type, pet_amount, status')
      .eq('status', 'not_full')
      .order('room_code'),
    supabase
      .from('pet_owners')
      .select('pet_owner_id, username, first_name, last_name')
      .order('first_name'),
    supabase
      .from('pets')
      .select('pet_id, pet_owner_id, pet_name, animal_type, species')
      .order('pet_name'),
  ]);

  if (roomsResult.error) throw roomsResult.error;
  if (ownersResult.error) throw ownersResult.error;
  if (petsResult.error) throw petsResult.error;

  const rooms = roomsResult.data || [];

  if (options.editing && form.room_id) {
    const currentRoomExists = rooms.some(
      (room) => room.room_id === Number(form.room_id),
    );

    if (!currentRoomExists) {
      const { data: currentRoom, error: currentRoomError } = await supabase
        .from('ipd_rooms')
        .select('room_id, room_code, type, pet_amount, status')
        .eq('room_id', form.room_id)
        .maybeSingle();

      if (currentRoomError) throw currentRoomError;
      if (currentRoom) rooms.push(currentRoom);
    }
  }

  return res.status(error ? 400 : 200).render('ipd/admit-plan-form', {
    user: res.locals.user || req.session?.user || null,
    activePage: 'admit-plan-form',
    rooms,
    editing: options.editing || false,
    planId: options.planId || null,
    owners: ownersResult.data || [],
    pets: petsResult.data || [],
    form,
    error,
  });
}

exports.showCreateAdmitPlan = async (req, res) => {
  try {
    await renderAdmitPlanForm(req, res);
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดฟอร์ม Admit Plan ได้');
  }
};

exports.createAdmitPlan = async (req, res) => {
  const room_id = Number(req.body.room_id);
  const pet_owner_id = Number(req.body.pet_owner_id);
  const pet_id = Number(req.body.pet_id);
  const check_in_date = String(req.body.check_in_date || '');
  const check_in_time = String(req.body.check_in_time || '');
  const check_out_date = String(req.body.check_out_date || '');
  const check_out_time = String(req.body.check_out_time || '');
  const note = String(req.body.note || '').trim() || null;

  const form = {
    room_id: req.body.room_id || '',
    pet_owner_id: req.body.pet_owner_id || '',
    pet_id: req.body.pet_id || '',
    check_in_date,
    check_in_time,
    check_out_date,
    check_out_time,
    note,
  };

  const fail = async (message) => {
    try {
      await renderAdmitPlanForm(req, res, form, message);
    } catch (error) {
      console.error(error);
      res.status(500).send('ไม่สามารถโหลดฟอร์ม Admit Plan ได้');
    }
  };

  if (!Number.isInteger(room_id) || room_id <= 0) {
    return fail('กรุณาเลือกห้อง IPD');
  }

  if (!Number.isInteger(pet_owner_id) || pet_owner_id <= 0) {
    return fail('กรุณาเลือกเจ้าของสัตว์เลี้ยง');
  }

  if (!Number.isInteger(pet_id) || pet_id <= 0) {
    return fail('กรุณาเลือกสัตว์เลี้ยง');
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(check_in_date) ||
    !isValidAdmitTime(check_in_time)
  ) {
    return fail('กรุณาระบุวันที่และเวลา Check-in ให้ถูกต้อง');
  }

  if (Boolean(check_out_date) !== Boolean(check_out_time)) {
    return fail('หากกำหนดวันออก ต้องระบุทั้งวันที่และเวลา Check-out');
  }

  if (
    check_out_date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(check_out_date) ||
      !isValidAdmitTime(check_out_time))
  ) {
    return fail('กรุณาระบุวันที่และเวลา Check-out ให้ถูกต้อง');
  }

  if (
    check_out_date &&
    (check_out_date < check_in_date ||
      (check_out_date === check_in_date && check_out_time < check_in_time))
  ) {
    return fail('เวลา Check-out ต้องไม่อยู่ก่อนเวลา Check-in');
  }

  try {
    const [roomResult, petResult] = await Promise.all([
      supabase
        .from('ipd_rooms')
        .select('room_id, status')
        .eq('room_id', room_id)
        .maybeSingle(),
      supabase
        .from('pets')
        .select('pet_id, pet_owner_id')
        .eq('pet_id', pet_id)
        .eq('pet_owner_id', pet_owner_id)
        .maybeSingle(),
    ]);

    if (roomResult.error) throw roomResult.error;
    if (petResult.error) throw petResult.error;

    if (!roomResult.data || roomResult.data.status !== 'not_full') {
      return fail('ไม่พบห้อง หรือห้องนี้ไม่พร้อมรับสัตว์เข้าพัก');
    }

    if (!petResult.data) {
      return fail('ไม่พบสัตว์เลี้ยงของเจ้าของที่เลือก');
    }
    const { data: existingAdmit, error: existingError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id')
      .eq('pet_id', pet_id)
      .eq('status', 'admitted')
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingAdmit) {
      return fail(
        'สัตว์เลี้ยงตัวนี้กำลังพักรักษาอยู่ ไม่สามารถสร้าง Admit Plan ใหม่ได้',
      );
    }
    const { data, error } = await supabase
      .from('admit_plans')
      .insert([
        {
          room_id,
          pet_id,
          check_in_date,
          check_in_time: `${check_in_time}:00`,
          check_out_date: check_out_date || null,
          check_out_time: check_out_time ? `${check_out_time}:00` : null,
          note,
          status: 'planned',
        },
      ])
      .select('admit_plan_id')
      .single();

    if (error) throw error;

    return res.redirect('/ipd/admit-plans');
  } catch (error) {
    console.error(error);
    return fail('บันทึก Admit Plan ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่');
  }
};

exports.checkIn = async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/admit-plans');
  }

  try {
    const { data: plan, error: planError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id, pet_id, room_id, status')
      .eq('admit_plan_id', id)
      .maybeSingle();

    if (planError) throw planError;

    if (!plan || plan.status !== 'planned') {
      return res.redirect('/ipd/admit-plans?error=invalid_plan');
    }

    const { data: existingAdmit, error: existingError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id')
      .eq('pet_id', plan.pet_id)
      .eq('status', 'admitted')
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingAdmit) {
      return res.redirect('/ipd/admit-plans?error=pet_admitted');
    }

    const { data: room, error: roomError } = await supabase
      .from('ipd_rooms')
      .select('pet_amount')
      .eq('room_id', plan.room_id)
      .single();

    if (roomError) throw roomError;

    const { count, error: countError } = await supabase
      .from('admit_plans')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', plan.room_id)
      .eq('status', 'admitted');

    if (countError) throw countError;

    if (count >= room.pet_amount) {
      return res.redirect('/ipd/admit-plans?error=room_full');
    }

    const { error: updateError } = await supabase
      .from('admit_plans')
      .update({ status: 'admitted' })
      .eq('admit_plan_id', id)
      .eq('status', 'planned');

    if (updateError) {
      if (updateError.code === '23505') {
        return res.redirect('/ipd/admit-plans?error=pet_admitted');
      }
      throw updateError;
    }

    return res.redirect('/ipd/admit-plans?success=checkin');
  } catch (error) {
    console.error('Check-in Error:', error);

    return res.redirect('/ipd/admit-plans?error=checkin_failed');
  }
};

exports.checkOut = async (req, res) => {
  const id = Number(req.params.id);
  const detail = String(req.body.EarlyCheckOut_Detail || '').trim();

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/admit-plans');
  }

  if (!detail) {
    return res.status(400).send('กรุณากรอกรายละเอียดก่อน Check-out');
  }

  try {
    const { data: plan, error: planError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id, status')
      .eq('admit_plan_id', id)
      .maybeSingle();

    if (planError) throw planError;

    if (!plan || plan.status !== 'admitted') {
      return res.redirect('/ipd/admit-plans');
    }

    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    const time = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join(':');

    const { error: updateError } = await supabase
      .from('admit_plans')
      .update({
        status: 'discharged',
        check_out_date: date,
        check_out_time: time,
        EarlyCheckOut_Detail: detail,
      })
      .eq('admit_plan_id', id)
      .eq('status', 'admitted');

    if (updateError) throw updateError;

    return res.redirect('/ipd/admit-plans');
  } catch (error) {
    console.error(error);
    return res.status(500).send('ไม่สามารถ Check-out ได้ กรุณาตรวจสอบข้อมูล');
  }
};

exports.roomDetail = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/rooms');
  }
  try {
    const { data: room, error: roomError } = await supabase
      .from('ipd_rooms')
      .select('*')
      .eq('room_id', id)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) return res.status(404).send('ไม่พบข้อมูลห้อง');
    const { data: admittedPets, error: petsError } = await supabase
      .from('admit_plans')
      .select(
        `
        admit_plan_id,
        check_in_date,
        check_in_time,
        check_out_date,
        check_out_time,
        status,
        pets (
          pet_id,
          pet_name,
          animal_type,
          species,
          pet_owners (
            first_name,
            last_name,
            username
          )
        )
      `,
      )
      .eq('room_id', id)
      .in('status', ['planned', 'admitted'])
      .order('check_in_date', { ascending: false });
    if (petsError) throw petsError;
    return res.render('ipd/room-detail', {
      user: res.locals.user || req.session?.user || null,
      activePage: 'ipd-room-list',
      room,
      admittedPets: admittedPets || [],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send('ไม่สามารถโหลดรายละเอียดห้องได้');
  }
};

exports.editAdmitPlan = async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/admit-plans');
  }

  try {
    const { data: plan, error } = await supabase
      .from('admit_plans')
      .select(
        `
        *,
        pets (
          pet_id,
          pet_owner_id,
          pet_name
        )
      `,
      )
      .eq('admit_plan_id', id)
      .maybeSingle();

    if (error) throw error;

    if (!plan) {
      return res.status(404).send('ไม่พบข้อมูล Admit Plan');
    }

    if (plan.status !== 'planned') {
      return res.redirect('/ipd/admit-plans');
    }

    const form = {
      room_id: plan.room_id,
      pet_owner_id: plan.pets?.pet_owner_id || '',
      pet_id: plan.pet_id,
      check_in_date: plan.check_in_date,
      check_in_time: String(plan.check_in_time || '').slice(0, 5),
      check_out_date: plan.check_out_date || '',
      check_out_time: plan.check_out_time
        ? String(plan.check_out_time).slice(0, 5)
        : '',
      note: plan.note || '',
    };

    await renderAdmitPlanForm(req, res, form, null, {
      editing: true,
      planId: id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดข้อมูล Admit Plan ได้');
  }
};

exports.updateAdmitPlan = async (req, res) => {
  const id = Number(req.params.id);
  const room_id = Number(req.body.room_id);
  const pet_owner_id = Number(req.body.pet_owner_id);
  const pet_id = Number(req.body.pet_id);
  const check_in_date = String(req.body.check_in_date || '');
  const check_in_time = String(req.body.check_in_time || '');
  const check_out_date = String(req.body.check_out_date || '');
  const check_out_time = String(req.body.check_out_time || '');
  const note = String(req.body.note || '').trim() || null;

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/admit-plans');
  }

  const form = {
    room_id: req.body.room_id || '',
    pet_owner_id: req.body.pet_owner_id || '',
    pet_id: req.body.pet_id || '',
    check_in_date,
    check_in_time,
    check_out_date,
    check_out_time,
    note,
  };

  const fail = async (message) => {
    try {
      await renderAdmitPlanForm(req, res, form, message, {
        editing: true,
        planId: id,
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('ไม่สามารถโหลดฟอร์ม Admit Plan ได้');
    }
  };

  try {
    const { data: currentPlan, error: planError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id, status')
      .eq('admit_plan_id', id)
      .maybeSingle();

    if (planError) throw planError;

    if (!currentPlan) {
      return res.status(404).send('ไม่พบข้อมูล Admit Plan');
    }

    if (currentPlan.status !== 'planned') {
      return res.redirect('/ipd/admit-plans');
    }

    if (!Number.isInteger(room_id) || room_id <= 0) {
      return fail('กรุณาเลือกห้อง IPD');
    }

    if (!Number.isInteger(pet_owner_id) || pet_owner_id <= 0) {
      return fail('กรุณาเลือกเจ้าของสัตว์เลี้ยง');
    }

    if (!Number.isInteger(pet_id) || pet_id <= 0) {
      return fail('กรุณาเลือกสัตว์เลี้ยง');
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(check_in_date) ||
      !isValidAdmitTime(check_in_time)
    ) {
      return fail('กรุณาระบุวันที่และเวลา Check-in ให้ถูกต้อง');
    }

    if (Boolean(check_out_date) !== Boolean(check_out_time)) {
      return fail('หากกำหนดวันออก ต้องระบุทั้งวันที่และเวลา Check-out');
    }

    if (
      check_out_date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(check_out_date) ||
        !isValidAdmitTime(check_out_time))
    ) {
      return fail('กรุณาระบุวันที่และเวลา Check-out ให้ถูกต้อง');
    }

    if (
      check_out_date &&
      (check_out_date < check_in_date ||
        (check_out_date === check_in_date && check_out_time < check_in_time))
    ) {
      return fail('เวลา Check-out ต้องไม่อยู่ก่อนเวลา Check-in');
    }

    const [roomResult, petResult] = await Promise.all([
      supabase
        .from('ipd_rooms')
        .select('room_id, status')
        .eq('room_id', room_id)
        .maybeSingle(),

      supabase
        .from('pets')
        .select('pet_id, pet_owner_id')
        .eq('pet_id', pet_id)
        .eq('pet_owner_id', pet_owner_id)
        .maybeSingle(),
    ]);

    if (roomResult.error) throw roomResult.error;
    if (petResult.error) throw petResult.error;

    if (!roomResult.data || roomResult.data.status !== 'not_full') {
      return fail('ไม่พบห้อง หรือห้องนี้ไม่พร้อมรับสัตว์เข้าพัก');
    }

    if (!petResult.data) {
      return fail('ไม่พบสัตว์เลี้ยงของเจ้าของที่เลือก');
    }

    const { data: existingAdmit, error: existingError } = await supabase
      .from('admit_plans')
      .select('admit_plan_id')
      .eq('pet_id', pet_id)
      .eq('status', 'admitted')
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingAdmit) {
      return fail('สัตว์เลี้ยงตัวนี้กำลังพักรักษาอยู่ ไม่สามารถเลือกซ้ำได้');
    }

    const { error: updateError } = await supabase
      .from('admit_plans')
      .update({
        room_id,
        pet_id,
        check_in_date,
        check_in_time: `${check_in_time}:00`,
        check_out_date: check_out_date || null,
        check_out_time: check_out_time ? `${check_out_time}:00` : null,
        note,
      })
      .eq('admit_plan_id', id)
      .eq('status', 'planned');

    if (updateError) throw updateError;

    return res.redirect('/ipd/admit-plans');
  } catch (error) {
    console.error(error);
    return fail('แก้ไข Admit Plan ไม่สำเร็จ กรุณาตรวจสอบข้อมูล');
  }
};

exports.cancelAdmitPlan = async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.redirect('/ipd/admit-plans');
  }

  try {
    const { data, error } = await supabase
      .from('admit_plans')
      .update({ status: 'cancelled' })
      .eq('admit_plan_id', id)
      .eq('status', 'planned')
      .select('admit_plan_id')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.redirect('/ipd/admit-plans');
    }

    return res.redirect('/ipd/admit-plans');
  } catch (error) {
    console.error(error);
    return res.status(500).send('ไม่สามารถยกเลิก Admit Plan ได้');
  }
};
