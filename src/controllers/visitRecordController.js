const supabase = require('../../config/supabase');

function sendError(req, res, status, message) {
  if (req.get('Accept')?.includes('application/json')) {
    return res.status(status).json({ success: false, message });
  }

  return res.redirect(`/visit-records?error=${encodeURIComponent(message)}`);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
}

exports.showVisitRecords = async (req, res) => {
  if (!req.session?.user) return res.redirect('/login');

  try {
    const { data, error } = await supabase
      .from('appointments')
      .select(
        `
        appointment_id,
        appointment_date,
        appointment_time,
        type,
        title,
        detail,
        status,
        pets (
          pet_id,
          pet_name,
          pet_owners (first_name, last_name, username)
        ),
        vets (first_name, last_name),
        visit_records (
          visit_id,
          visit_date,
          visit_time,
          weight,
          symptoms,
          diagnosis,
          treatment,
          note,
          status
        )
      `,
      )
      .in('status', ['confirmed', 'completed'])
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });

    if (error) throw error;

    const appointments = (data || [])
      .map((a) => {
        const owner = a.pets?.pet_owners;
        const visit = Array.isArray(a.visit_records)
          ? a.visit_records[0] || null
          : a.visit_records || null;

        return {
          ...a,
          pet_name: a.pets?.pet_name || '-',
          owner_name: owner
            ? [owner.first_name, owner.last_name].filter(Boolean).join(' ') ||
              owner.username ||
              '-'
            : '-',
          vet_name:
            [a.vets?.first_name, a.vets?.last_name].filter(Boolean).join(' ') ||
            '-',
          visit_record: visit,
        };
      })
      .filter((a) => a.status === 'confirmed' || !!a.visit_record);

    return res.render('Appointments/VisitRecord', {
      user: req.session.user,
      activePage: 'visit-records',
      appointments,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    console.error('Load visit records error:', error);
    return res.status(500).send('ไม่สามารถโหลดข้อมูล Visit Record ได้');
  }
};

exports.showVisitRecordForm = async (req, res) => {
  if (!req.session?.user) return res.redirect('/login');

  try {
    const appointmentId = Number(req.params.appointmentId);

    if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).send('รหัสนัดหมายไม่ถูกต้อง');
    }

    const { data: appointment, error } = await supabase
      .from('appointments')
      .select(
        `
        appointment_id,
        appointment_date,
        appointment_time,
        type,
        title,
        detail,
        status,
        pets (pet_name),
        vets (first_name, last_name),
        visit_records (*)
      `,
      )
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (error) throw error;
    if (!appointment) return res.status(404).send('ไม่พบนัดหมาย');

    const visitRecord = Array.isArray(appointment.visit_records)
      ? appointment.visit_records[0] || null
      : appointment.visit_records || null;

    if (
      appointment.status !== 'confirmed' &&
      !(appointment.status === 'completed' && visitRecord)
    ) {
      return res.status(400).send('นัดหมายนี้ไม่สามารถบันทึกผลตรวจได้');
    }

    return res.render('Appointments/VisitRecordForm', {
      user: req.session.user,
      activePage: 'visit-records',
      appointment,
      visitRecord,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    console.error('Load visit record form error:', error);
    return res.status(500).send('ไม่สามารถโหลดฟอร์ม Visit Record ได้');
  }
};


exports.saveVisitRecord = async (req, res) => {
  if (!req.session?.user) {
    return sendError(req, res, 401, 'กรุณาเข้าสู่ระบบใหม่');
  }

  try {
    const appointmentId = Number(req.params.appointmentId);
    const body = req.body || {};

    console.log('[VisitRecord] Start saving:', appointmentId);
    console.log('[VisitRecord] Role:', req.session.user.role);
    console.log('[VisitRecord] Request body:', body);

    if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
      return sendError(req, res, 400, 'รหัสนัดหมายไม่ถูกต้อง');
    }

    const visit_date = String(body.visit_date || '').trim();
    const visit_time = String(body.visit_time || '').trim();
    const weight = String(body.weight ?? '').trim();
    const symptoms = String(body.symptoms || '').trim();
    const diagnosis = String(body.diagnosis || '').trim();
    const treatment = String(body.treatment || '').trim();
    const note = String(body.note || '').trim();

    if (
      !visit_date ||
      !visit_time ||
      !weight 
    ) {
      return sendError(req, res, 400, 'กรุณากรอกข้อมูล น้ำหนัก วันที่ และเวลาเข้าตรวจให้ครบถ้วน');
    }

    if (!isValidDate(visit_date) || !isValidTime(visit_time)) {
      return sendError(req, res, 400, 'วันที่หรือเวลาเข้าตรวจไม่ถูกต้อง');
    }

    const parsedWeight = Number(weight);

    if (
      !Number.isFinite(parsedWeight) ||
      parsedWeight <= 0 ||
      parsedWeight > 999999.99 ||
      Math.round(parsedWeight * 100) !== parsedWeight * 100
    ) {
      return sendError(
        req,
        res,
        400,
        'น้ำหนักต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง'
      );
    }

    console.log('[VisitRecord] Checking appointment');

    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select('appointment_id, status')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (appointmentError) throw appointmentError;

    if (!appointment) {
      return sendError(req, res, 404, 'ไม่พบนัดหมายนี้');
    }

    console.log('[VisitRecord] Appointment status:', appointment.status);

    console.log('[VisitRecord] Checking existing record');

    const { data: existing, error: existingError } = await supabase
      .from('visit_records')
      .select('visit_id')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (
      appointment.status !== 'confirmed' &&
      !(appointment.status === 'completed' && existing)
    ) {
      return sendError(
        req,
        res,
        400,
        'นัดหมายนี้ไม่สามารถบันทึกผลตรวจได้'
      );
    }

    const payload = {
      appointment_id: appointmentId,
      clinic_staff_id: null,
      visit_date,
      visit_time,
      weight: parsedWeight,
      symptoms,
      diagnosis,
      treatment,
      note,
      status: 'Ready' 
    };

    console.log('[VisitRecord] Saving to Supabase');

    let savedRecord;
    let saveError;

    if (existing) {
      const result = await supabase
        .from('visit_records')
        .update(payload)
        .eq('appointment_id', appointmentId)
        .select('*')
        .single();

      savedRecord = result.data;
      saveError = result.error;
    } else {
      const result = await supabase
        .from('visit_records')
        .insert(payload)
        .select('*')
        .single();

      savedRecord = result.data;
      saveError = result.error;
    }

    if (saveError) throw saveError;

    console.log('[VisitRecord] Record saved:', savedRecord.visit_id);

    if (appointment.status === 'confirmed') {
      console.log('[VisitRecord] Updating appointment status');

      const { data: updatedAppointment, error: statusError } =
        await supabase
          .from('appointments')
          .update({ status: 'completed' })
          .eq('appointment_id', appointmentId)
          .eq('status', 'confirmed')
          .select('appointment_id')
          .maybeSingle();

      if (statusError) {
        console.error(
          '[VisitRecord] Appointment status update failed:',
          statusError
        );
      } else if (!updatedAppointment) {
        console.warn(
          '[VisitRecord] Record saved, but appointment status was not updated'
        );
      }
    }

    const message = existing
      ? 'แก้ไข Visit Record เรียบร้อยแล้ว'
      : 'บันทึก Visit Record เรียบร้อยแล้ว';

    if (req.get('Accept')?.includes('application/json')) {
      return res.status(200).json({
        success: true,
        message,
        visitRecord: savedRecord
      });
    }

    return res.redirect(
      `/visit-records?success=${encodeURIComponent(message)}`
    );
  } catch (error) {
    console.error('[VisitRecord] Save failed:', error);

    return sendError(
      req,
      res,
      500,
      error.message || 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่'
    );
  }
};
