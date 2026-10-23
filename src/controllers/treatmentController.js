const supabase = require('../../config/supabase');

const getUser = (req) => req.session?.user || req.user || {};
const getUserId = (user) => user.user_id || user.id;
const getRole = (req) => getUser(req).role;
const getMessage = (error) => error?.message || 'เกิดข้อผิดพลาดในการทำงาน';

async function getCurrentVet(req) {
  const user = getUser(req);
  const userId = getUserId(user);
  if (!userId) return null;

  const { data, error } = await supabase
    .from('vets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getPageData(req, vetFilter = '') {
  const role = getRole(req);
  const user = getUser(req);

  let vet = null;
  if (role === 'vet') {
    vet = await getCurrentVet(req);
    if (!vet) throw new Error('ไม่พบข้อมูลสัตวแพทย์');
  }

  let vetQuery = supabase
    .from('vets')
    .select('vet_id, user_id, first_name, last_name, status')
    .eq('status', 'active')
    .order('first_name');

  const { data: vets, error: vetError } = await vetQuery;
  if (vetError) throw vetError;

  let appointmentQuery = supabase
    .from('appointments')
    .select('*')
    .order('appointment_date', { ascending: false })
    .order('appointment_time', { ascending: false });

  if (role === 'vet') {
    appointmentQuery = appointmentQuery.eq('vet_id', vet.vet_id);
  } else if (role === 'clinic' && vetFilter) {
    appointmentQuery = appointmentQuery.eq('vet_id', vetFilter);
  }

  const { data: appointments, error: appointmentError } =
    await appointmentQuery;
  if (appointmentError) throw appointmentError;

  const { data: pets, error: petError } = await supabase
    .from('pets')
    .select('*');

  if (petError) throw petError;

  const { data: owners, error: ownerError } = await supabase
    .from('pet_owners')
    .select('*');

  if (ownerError) throw ownerError;

  const { data: records, error: recordError } = await supabase
    .from('visit_records')
    .select('*');

  if (recordError) throw recordError;

  const petMap = new Map((pets || []).map((p) => [String(p.pet_id), p]));
  const ownerMap = new Map(
    (owners || []).map((o) => [String(o.pet_owner_id), o]),
  );
  const vetMap = new Map((vets || []).map((v) => [String(v.vet_id), v]));
  const recordMap = new Map(
    (records || []).map((r) => [String(r.appointment_id), r]),
  );

  const rows = (appointments || []).map((a) => {
    const pet = petMap.get(String(a.pet_id)) || {};
    const owner = ownerMap.get(String(pet.pet_owner_id)) || {};
    const assignedVet = vetMap.get(String(a.vet_id)) || {};

    return {
      ...a,
      pet,
      pet_name: pet.pet_name  || '-',
      owner_name:
        [owner.first_name, owner.last_name].filter(Boolean).join(' ') || '-',
      vet_name:
        [assignedVet.first_name, assignedVet.last_name]
          .filter(Boolean)
          .join(' ') || '-',
      visit_record: recordMap.get(String(a.appointment_id)) || null,
    };
  });
  console.log(
    'Appointment pet_id:',
    (appointments || []).map((a) => ({
      appointment_id: a.appointment_id,
      pet_id: a.pet_id,
    })),
  );
console.log('Pets data:', JSON.stringify(pets, null, 2));
  return { user, role, vet, vets: vets || [], appointments: rows };
}

exports.index = async (req, res) => {
  try {
    const vetFilter = getRole(req) === 'clinic' ? req.query.vet_id || '' : '';
    const data = await getPageData(req, vetFilter);

    res.render('treatments/index', {
      ...data,
      activePage: 'treatments',
      selectedVet: vetFilter,
      error: null,
    });
  } catch (error) {
    console.error('Treatment index error:', error);
    res.status(500).render('treatments/index', {
      user: getUser(req),
      role: getRole(req),
      vet: null,
      vets: [],
      appointments: [],
      activePage: 'treatments',
      selectedVet: '',
      error: getMessage(error),
    });
  }
};

exports.detail = async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const role = getRole(req);
    const user = getUser(req);

    if (!['vet', 'clinic'].includes(role)) {
      return res.status(403).send('ไม่มีสิทธิ์เข้าถึงหน้านี้');
    }

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (error) throw error;
    if (!appointment) return res.status(404).send('ไม่พบ Appointment');

    if (role === 'vet') {
      const vet = await getCurrentVet(req);
      if (!vet || String(vet.vet_id) !== String(appointment.vet_id)) {
        return res.status(403).send('คุณไม่มีสิทธิ์ดู Appointment นี้');
      }
    }

    const { data: pet, error: petError } = await supabase
      .from('pets')
      .select('*')
      .eq('pet_id', appointment.pet_id)
      .maybeSingle();

    if (petError) throw petError;
    if (!pet) return res.status(404).send('ไม่พบข้อมูลสัตว์');

    const { data: owner, error: ownerError } = await supabase
      .from('pet_owners')
      .select('*')
      .eq('pet_owner_id', pet.pet_owner_id)
      .maybeSingle();

    if (ownerError) throw ownerError;

    const { data: vetData, error: vetError } = await supabase
      .from('vets')
      .select('*')
      .eq('vet_id', appointment.vet_id)
      .maybeSingle();

    if (vetError) throw vetError;

    const { data: record, error: recordError } = await supabase
      .from('visit_records')
      .select('*')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (recordError) throw recordError;

    const { data: history, error: historyError } = await supabase
      .from('visit_records')
      .select('*')
      .order('visit_date', { ascending: false })
      .order('visit_time', { ascending: false });

    if (historyError) throw historyError;

    const { data: allAppointments, error: allAppointmentsError } =
      await supabase.from('appointments').select('*').eq('pet_id', pet.pet_id);

    if (allAppointmentsError) throw allAppointmentsError;

    const appointmentMap = new Map(
      (allAppointments || []).map((a) => [String(a.appointment_id), a]),
    );

    const petHistory = (history || [])
      .filter((r) => appointmentMap.has(String(r.appointment_id)))
      .map((r) => ({
        ...r,
        appointment: appointmentMap.get(String(r.appointment_id)),
      }));

    res.render('treatments/detail', {
      user,
      role,
      activePage: 'treatments',
      appointment,
      pet,
      owner,
      vetData,
      record,
      petHistory,
      error: null,
      success: null,
    });
  } catch (error) {
    console.error('Treatment detail error:', error);
    res.status(500).send(`โหลดข้อมูลการรักษาไม่สำเร็จ: ${getMessage(error)}`);
  }
};

exports.save = async (req, res) => {
  const appointmentId = Number(req.params.id);
  try {
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).send('รหัส Visit Record ไม่ถูกต้อง');
    }
    if (getRole(req) !== 'vet') {
      return res.status(403).send('เฉพาะสัตวแพทย์เท่านั้นที่บันทึกการรักษาได้');
    }
    const vet = await getCurrentVet(req);
    if (!vet) return res.status(403).send('ไม่พบข้อมูลสัตวแพทย์');
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select('appointment_id, vet_id')
      .eq('appointment_id', appointmentId)
      .eq('vet_id', vet.vet_id)
      .maybeSingle();
    if (appointmentError) throw appointmentError;
    if (!appointment) {
      return res.status(403).send('คุณไม่มีสิทธิ์แก้ไข Visit Record นี้');
    }
    const { data: record, error: recordError } = await supabase
      .from('visit_records')
      .select('visit_id, status')
      .eq('appointment_id', appointmentId)
      .maybeSingle();
    if (recordError) throw recordError;
    if (!record) {
      return res.status(404).send('ไม่พบ Visit Record');
    }
    if (record.status !== 'Ready') {
      return res
        .status(403)
        .send('Visit Record นี้ดูได้อย่างเดียว ไม่สามารถแก้ไขได้');
    }
    const { data: updated, error: updateError } = await supabase
      .from('visit_records')
      .update({
        symptoms: String(req.body.symptoms || '').trim() || null,
        diagnosis: String(req.body.diagnosis || '').trim() || null,
        treatment: String(req.body.treatment || '').trim() || null,
        note: String(req.body.note || '').trim() || null,
        status: 'Finish',
      })
      .eq('visit_id', record.visit_id)
      .eq('status', 'Ready')
      .select('visit_id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return res
        .status(409)
        .send('Visit Record ถูกบันทึกหรือปิดไปแล้ว กรุณาโหลดหน้าใหม่');
    }
    return res.redirect(`/treatments/${appointmentId}?saved=1`);
  } catch (error) {
    console.error('Treatment save error:', error);
    return res
      .status(500)
      .send(`บันทึกการรักษาไม่สำเร็จ: ${getMessage(error)}`);
  }
};

exports.complete = async (req, res) => {
  const appointmentId = req.params.id;

  try {
    if (getRole(req) !== 'vet') {
      return res.status(403).send('เฉพาะสัตวแพทย์เท่านั้นที่จบการรักษาได้');
    }

    const vet = await getCurrentVet(req);
    if (!vet) return res.status(403).send('ไม่พบข้อมูลสัตวแพทย์');

    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select('*')
      .eq('appointment_id', appointmentId)
      .eq('vet_id', vet.vet_id)
      .maybeSingle();

    if (appointmentError) throw appointmentError;
    if (!appointment) return res.status(404).send('ไม่พบ Appointment ของคุณ');
    if (appointment.status !== 'confirmed') {
      return res.status(400).send('Appointment นี้ไม่ได้อยู่ในสถานะ Confirmed');
    }

    const { data: record, error: recordError } = await supabase
      .from('visit_records')
      .select('visit_id, note')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (recordError) throw recordError;
    if (!record || !String(record.note || '').trim()) {
      return res.status(400).send('กรุณาบันทึก Note ก่อนจบการรักษา');
    }
    const { data: updatedRecord, error: updateRecordError } = await supabase
      .from('visit_records')
      .update({ status: 'Finish' })
      .eq('visit_id', record.visit_id)
      .neq('status', 'Completed')
      .select('visit_id')
      .maybeSingle();

    if (updateRecordError) throw updateRecordError;

    if (!updatedRecord) {
      return res.status(400).send('Visit Record นี้ถูกปิดแล้ว');
    }

    const { data: updatedAppointment, error: updateAppointmentError } =
      await supabase
        .from('appointments')
        .update({ status: 'completed' })
        .eq('appointment_id', appointmentId)
        .eq('vet_id', vet.vet_id)
        .eq('status', 'confirmed')
        .select('appointment_id')
        .maybeSingle();

    if (updateAppointmentError) {
      console.error('Update appointment status error:', updateAppointmentError);
      return res.status(500).send('เปลี่ยนสถานะ Appointment ไม่สำเร็จ');
    }

    if (!updatedAppointment) {
      return res
        .status(409)
        .send('สถานะ Appointment เปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่');
    }

    return res.redirect('/treatments?completed=1');
  } catch (error) {
    console.error('Treatment complete error:', error);
    res.status(500).send(`จบการรักษาไม่สำเร็จ: ${getMessage(error)}`);
  }
};
