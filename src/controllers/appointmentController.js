const supabase = require('../../config/supabase');

const REDIRECT_URL = '/appointments';
const ALLOWED_ROLES = ['clinic', 'clinic_staff'];
const ACTIVE_STATUSES = ['pending', 'confirmed'];
const CALENDAR_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

const STATUS_COLORS = {
  pending: '#ffc107',
  confirmed: '#198754',
  cancelled: '#dc3545',
  completed: '#6c757d',
};

function redirectWithMessage(res, type, message) {
  return res.redirect(`${REDIRECT_URL}?${type}=${encodeURIComponent(message)}`);
}

function hasPermission(user) {
  return ALLOWED_ROLES.includes(user?.role);
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseAppointmentDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const dateTime = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (
    dateTime.getFullYear() !== Number(year) ||
    dateTime.getMonth() !== Number(month) - 1 ||
    dateTime.getDate() !== Number(day) ||
    dateTime.getHours() !== Number(hour) ||
    dateTime.getMinutes() !== Number(minute)
  ) {
    return null;
  }
  return {
    dateTime,
    appointment_date: `${year}-${month}-${day}`,
    appointment_time: `${hour}:${minute}:00`,
  };
}

async function getAppointmentForUpdate(id) {
  const { data, error } = await supabase
    .from('appointments')
    .select(
      'appointment_id, pet_id, vet_id, appointment_date, appointment_time, status',
    )
    .eq('appointment_id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getClinicStaffId(user) {
  if (user.role === 'clinic') return null;
  if (user.role !== 'clinic_staff') throw new Error('FORBIDDEN');

  const { data, error } = await supabase
    .from('clinic_staff')
    .select('clinic_staff_id')
    .eq('user_id', user.user_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('CLINIC_STAFF_NOT_FOUND');

  return data.clinic_staff_id;
}

async function getActiveVet(vetId) {
  const { data, error } = await supabase
    .from('vets')
    .select('vet_id, first_name, last_name, vet_class')
    .eq('vet_id', vetId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getAppointmentConflict({
  appointmentDate,
  appointmentTime,
  petId,
  vetId,
  excludeAppointmentId = null,
}) {
  const { data, error } = await supabase
    .from('appointments')
    .select('appointment_id, pet_id, vet_id, appointment_time')
    .eq('appointment_date', appointmentDate)
    .in('status', ACTIVE_STATUSES)
    .or(`pet_id.eq.${petId},vet_id.eq.${vetId}`);

  if (error) throw error;

  const requestedMinutes =
    Number(appointmentTime.slice(0, 2)) * 60 +
    Number(appointmentTime.slice(3, 5));

  return (data || []).some((appointment) => {
    if (
      excludeAppointmentId &&
      Number(appointment.appointment_id) === excludeAppointmentId
    ) {
      return false;
    }

    const existingMinutes =
      Number(String(appointment.appointment_time).slice(0, 2)) * 60 +
      Number(String(appointment.appointment_time).slice(3, 5));

    const overlaps = Math.abs(existingMinutes - requestedMinutes) < 30;

    return (
      overlaps &&
      (Number(appointment.pet_id) === petId ||
        Number(appointment.vet_id) === vetId)
    );
  });
}

exports.showAppointments = async (req, res) => {
  if (!req.session?.user) return res.redirect('/login');

  try {
    const { data, error } = await supabase
      .from('appointments')
      .select(
        `
        appointment_id, pet_id, vet_id, clinic_staff_id,
        appointment_date, appointment_time, type, title, detail,
        status, status_detail,
        pets (
          pet_name,
          pet_owners (first_name, last_name, username)
        ),
        vets (first_name, last_name)
      `,
      )
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });

    if (error) throw error;

    const { data: vets, error: vetError } = await supabase
      .from('vets')
      .select('vet_id, first_name, last_name, vet_class')
      .eq('status', 'active')
      .order('first_name', { ascending: true });

    if (vetError) throw vetError;

    const { data: busyAppointments, error: busyError } = await supabase
      .from('appointments')
      .select(
        'appointment_id, pet_id, vet_id, appointment_date, appointment_time',
      )
      .in('status', ACTIVE_STATUSES)
      .not('vet_id', 'is', null);

    if (busyError) throw busyError;

    const { data: pets, error: petsError } = await supabase
      .from('pets')
      .select('pet_id, pet_name')
      .order('pet_name', { ascending: true });

    if (petsError) throw petsError;

    const appointments = (data || []).map((appointment) => ({
      ...appointment,
      pet_name: appointment.pets?.pet_name || '-',
      owner_name:
        [
          appointment.pets?.pet_owners?.first_name,
          appointment.pets?.pet_owners?.last_name,
        ]
          .filter(Boolean)
          .join(' ') ||
        appointment.pets?.pet_owners?.username ||
        '-',
      vet_name:
        [appointment.vets?.first_name, appointment.vets?.last_name]
          .filter(Boolean)
          .join(' ') || '-',
    }));

    return res.render('Appointments/Appointment', {
      user: req.session.user,
      activePage: 'appointments',
      appointments,
      vets: vets || [],
      busyAppointments: busyAppointments || [],
      pets: pets || [],
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    console.error('Load appointments error:', error);

    return res.status(500).render('Appointments/Appointment', {
      user: req.session.user,
      activePage: 'appointments',
      appointments: [],
      vets: [],
      busyAppointments: [],
      pets: [],
      error: 'ไม่สามารถโหลดข้อมูลนัดหมายได้ กรุณาตรวจสอบ Supabase',
      success: null,
    });
  }
};

exports.getAppointmentCalendarEvents = async (req, res) => {
  if (!req.session?.user) return res.status(401).json([]);

  try {
    const { start, end } = req.query;

    let query = supabase
      .from('appointments')
      .select(
        `
        appointment_id, pet_id, vet_id,
        appointment_date, appointment_time,
        title, type, status,
        pets(pet_name),
        vets(first_name, last_name)
      `,
      )
      .in('status', CALENDAR_STATUSES)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });

    if (start) {
      query = query.gte('appointment_date', start.slice(0, 10));
    }

    if (end) {
      query = query.lt('appointment_date', end.slice(0, 10));
    }

    const { data, error } = await query;

    if (error) throw error;

    const events = (data || []).map((appointment) => {
      const color = STATUS_COLORS[appointment.status] || '#6c757d';
      const vetName = appointment.vets
        ? `${appointment.vets.first_name} ${appointment.vets.last_name}`
        : 'ยังไม่ระบุสัตวแพทย์';

      return {
        id: String(appointment.appointment_id),
        title: `${appointment.pets?.pet_name || 'สัตว์เลี้ยง'} - ${vetName}`,
        start: `${appointment.appointment_date}T${String(appointment.appointment_time).slice(0, 8)}`,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          pet_id: appointment.pet_id,
          vet_id: appointment.vet_id,
          status: appointment.status,
          type: appointment.type,
          detail: appointment.title,
        },
      };
    });

    return res.json(events);
  } catch (error) {
    console.error('getAppointmentCalendarEvents error:', error);
    return res.status(500).json({
      message: 'ไม่สามารถโหลดปฏิทินนัดหมายได้',
    });
  }
};

exports.createAppointment = async (req, res) => {
  const user = req.session?.user;

  if (!user) return res.redirect('/login');

  if (!hasPermission(user)) {
    return res.status(403).send('ไม่มีสิทธิ์สร้างนัดหมาย');
  }

  try {
    const { pet_id, vet_id, appointment_datetime, type, title, detail } =
      req.body;

    const petId = parsePositiveInteger(pet_id);
    const vetId = parsePositiveInteger(vet_id);
    const dateTime = parseAppointmentDateTime(appointment_datetime);

    console.log({
      pet_id,
      petId,
      vet_id,
      vetId,
      appointment_datetime,
      dateTime,
    });

    if (!petId || !vetId || !dateTime) {
      return redirectWithMessage(
        res,
        'error',
        'กรุณาตรวจสอบสัตว์เลี้ยง สัตวแพทย์ และวันเวลานัด โดยเลือกเวลาเป็นช่วงละ 30 นาที',
      );
    }
    const appointmentDate = new Date(dateTime.dateTime);
    const today = new Date();
    appointmentDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (appointmentDate < today) {
      return redirectWithMessage(
        res,
        'error',
        'ไม่สามารถเลือกวันที่ผ่านมาแล้วได้',
      );
    }

    const { data: pet, error: petError } = await supabase
      .from('pets')
      .select('pet_id')
      .eq('pet_id', petId)
      .maybeSingle();

    if (petError) throw petError;

    if (!pet) {
      return redirectWithMessage(res, 'error', 'ไม่พบสัตว์เลี้ยงที่เลือก');
    }

    const vet = await getActiveVet(vetId);

    if (!vet) {
      return redirectWithMessage(res, 'error', 'ไม่พบสัตวแพทย์ที่เปิดใช้งาน');
    }

    const hasConflict = await getAppointmentConflict({
      appointmentDate: dateTime.appointment_date,
      appointmentTime: dateTime.appointment_time,
      petId,
      vetId,
    });

    if (hasConflict) {
      return redirectWithMessage(
        res,
        'error',
        'วันและเวลานี้ชนกับนัดหมายเดิมของสัตวแพทย์หรือสัตว์เลี้ยง กรุณาเลือกเวลาอื่น',
      );
    }

    const clinicStaffId = await getClinicStaffId(user);

    const { error: insertError } = await supabase.from('appointments').insert({
      pet_id: petId,
      vet_id: vetId,
      clinic_staff_id: clinicStaffId,
      appointment_date: dateTime.appointment_date,
      appointment_time: dateTime.appointment_time,
      type: type || 'Appointment',
      title: String(title || '').trim() || null,
      detail: String(detail || '').trim() || null,
      status: 'confirmed',
    });

    if (insertError) throw insertError;

    return redirectWithMessage(res, 'success', 'เพิ่มนัดหมายเรียบร้อยแล้ว');
  } catch (error) {
    console.error('createAppointment error:', error);

    if (error.message === 'CLINIC_STAFF_NOT_FOUND') {
      return res.status(403).send('ไม่พบข้อมูลเจ้าหน้าที่คลินิกของผู้ใช้');
    }

    if (error.message === 'FORBIDDEN') {
      return res.status(403).send('ไม่มีสิทธิ์ดำเนินการ');
    }

    return redirectWithMessage(
      res,
      'error',
      'บันทึกนัดหมายไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่',
    );
  }
};

exports.confirmAppointment = async (req, res) => {
  if (!req.session?.user) return res.redirect('/login');

  const user = req.session.user;

  if (!hasPermission(user)) {
    return res.status(403).send('ไม่มีสิทธิ์ดำเนินการ');
  }

  const appointmentId = parsePositiveInteger(req.body.appointment_id);
  const vetId = parsePositiveInteger(req.body.vet_id);

  if (!appointmentId || !vetId) {
    return res.status(400).send('กรุณาเลือกนัดหมายและสัตวแพทย์ให้ถูกต้อง');
  }

  try {
    const appointment = await getAppointmentForUpdate(appointmentId);

    if (!appointment) {
      return res.status(404).send('ไม่พบรายการนัดหมาย');
    }

    if (appointment.status !== 'pending') {
      return res.status(400).send('นัดหมายนี้ไม่ได้อยู่ในสถานะ Pending');
    }

    const vet = await getActiveVet(vetId);

    if (!vet) {
      return res.status(400).send('สัตวแพทย์ไม่ถูกต้องหรือไม่พร้อมให้บริการ');
    }

    const hasConflict = await getAppointmentConflict({
      appointmentDate: appointment.appointment_date,
      appointmentTime: String(appointment.appointment_time).slice(0, 8),
      petId: appointment.pet_id,
      vetId,
      excludeAppointmentId: appointmentId,
    });

    if (hasConflict) {
      return res
        .status(409)
        .send(
          'สัตวแพทย์หรือสัตว์เลี้ยงมีนัดหมายในช่วงเวลานี้ กรุณาเลือกเวลาอื่น',
        );
    }

    const clinicStaffId = await getClinicStaffId(user);

    const { data: updated, error: updateError } = await supabase
      .from('appointments')
      .update({
        status: 'confirmed',
        vet_id: vetId,
        clinic_staff_id: clinicStaffId,
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending')
      .select('appointment_id')
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
      return res
        .status(409)
        .send('สถานะนัดหมายเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่');
    }

    return res.redirect(REDIRECT_URL);
  } catch (error) {
    console.error('Confirm appointment error:', error);

    if (error.message === 'FORBIDDEN') {
      return res.status(403).send('ไม่มีสิทธิ์ดำเนินการ');
    }

    if (error.message === 'CLINIC_STAFF_NOT_FOUND') {
      return res.status(400).send('ไม่พบข้อมูล Clinic Staff ของบัญชีนี้');
    }

    return res.status(500).send('ไม่สามารถยืนยันนัดหมายได้');
  }
};

exports.cancelAppointment = async (req, res) => {
  if (!req.session?.user) return res.redirect('/login');

  const user = req.session.user;

  if (!hasPermission(user)) {
    return res.status(403).send('ไม่มีสิทธิ์ดำเนินการ');
  }

  const appointmentId = parsePositiveInteger(req.body.appointment_id);
  const statusDetail = String(req.body.status_detail || '').trim();

  if (!appointmentId) {
    return res.status(400).send('รายการนัดหมายไม่ถูกต้อง');
  }

  if (!statusDetail) {
    return res.status(400).send('กรุณาระบุเหตุผลในการยกเลิกนัดหมาย');
  }

  try {
    const appointment = await getAppointmentForUpdate(appointmentId);

    if (!appointment) {
      return res.status(404).send('ไม่พบรายการนัดหมาย');
    }

    if (appointment.status !== 'confirmed') {
      return res.status(400).send('สามารถยกเลิกได้เฉพาะนัดหมายที่ยืนยันแล้ว');
    }

    const clinicStaffId = await getClinicStaffId(user);

    const { data: updated, error } = await supabase
      .from('appointments')
      .update({
        status: 'cancelled',
        status_detail: statusDetail,
        clinic_staff_id: clinicStaffId,
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'confirmed')
      .select('appointment_id')
      .maybeSingle();

    if (error) throw error;

    if (!updated) {
      return res
        .status(409)
        .send('สถานะนัดหมายเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่');
    }

    return res.redirect(REDIRECT_URL);
  } catch (error) {
    console.error('Cancel appointment error:', error);

    if (error.message === 'FORBIDDEN') {
      return res.status(403).send('ไม่มีสิทธิ์ดำเนินการ');
    }

    if (error.message === 'CLINIC_STAFF_NOT_FOUND') {
      return res.status(400).send('ไม่พบข้อมูล Clinic Staff ของบัญชีนี้');
    }

    return res.status(500).send('ไม่สามารถยกเลิกนัดหมายได้');
  }
};
