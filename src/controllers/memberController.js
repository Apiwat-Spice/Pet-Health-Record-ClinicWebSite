const supabase = require('../../config/supabase');
const cloudinary = require('../../config/cloudinary');
const bcrypt = require('bcryptjs');
const { Readable } = require('stream');

function currentUser(req) {
  return req.user || req.session?.user || req.session?.account || null;
}

function requireClinic(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'clinic') {
    return res.status(403).send('ไม่มีสิทธิ์เข้าถึงหน้านี้');
  }
  next();
}

function memberConfig(type) {
  const configs = {
    'clinic-staff': {
      table: 'clinic_staff',
      id: 'clinic_staff_id',
      role: 'clinic_staff',
      page: 'clinic-staff',
      folder: 'Staff/StaffProfile',
      title: 'Clinic Staff',
    },
    vets: {
      table: 'vets',
      id: 'vet_id',
      role: 'vet',
      page: 'vets',
      folder: 'Vet/VetProfile',
      title: 'Vet',
    },
  };
  return configs[type] || null;
}

function uploadImage(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    Readable.from(buffer).pipe(stream);
  });
}

async function deleteImage(publicId) {
  if (!publicId) return;
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
  });
  if (!['ok', 'not found'].includes(result.result)) {
    throw new Error(`ลบรูปจาก Cloudinary ไม่สำเร็จ: ${result.result}`);
  }
}

function renderError(res, cfg, member, message, status = 400) {
  return res.status(status).render(`member/${cfg.page}-form`, {
    user: res.locals.user || null,
    activePage: cfg.page === 'clinic-staff' ? 'clinic-staff-form' : 'vet-form',
    member,
    error: message,
  });
}

async function getMembers(cfg) {
  const { data: members, error } = await supabase
    .from(cfg.table)
    .select('*')
    .order(cfg.id, { ascending: false });

  if (error) throw error;

  const userIds = [...new Set((members || []).map((member) => member.user_id))];
  if (!userIds.length) return [];

  const { data: users, error: userError } = await supabase
    .from('users')
    .select('user_id, email')
    .in('user_id', userIds);

  if (userError) throw userError;

  const userMap = new Map(
    (users || []).map((user) => [String(user.user_id), user]),
  );

  return (members || []).map((member) => ({
    ...member,
    email: userMap.get(String(member.user_id))?.email || '',
  }));
}

exports.requireClinic = requireClinic;

exports.listClinicStaff = async (req, res) => {
  try {
    res.render('member/clinic-staff', {
      user: currentUser(req),
      activePage: 'clinic-staff',
      members: await getMembers(memberConfig('clinic-staff')),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดรายชื่อ Clinic Staff ได้');
  }
};

exports.listVets = async (req, res) => {
  try {
    res.render('member/vets', {
      user: currentUser(req),
      activePage: 'vets',
      members: await getMembers(memberConfig('vets')),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดรายชื่อ Vet ได้');
  }
};

exports.showCreate = (type) => (req, res) => {
  const cfg = memberConfig(type);
  if (!cfg) return res.status(404).send('ไม่พบประเภทสมาชิก');

  res.render(`member/${cfg.page}-form`, {
    user: currentUser(req),
    activePage: cfg.page === 'clinic-staff' ? 'clinic-staff-form' : 'vet-form',
    member: null,
  });
};

exports.showEdit = (type) => async (req, res) => {
  const cfg = memberConfig(type);
  if (!cfg) return res.status(404).send('ไม่พบประเภทสมาชิก');

  try {
    const { data: member, error } = await supabase
      .from(cfg.table)
      .select('*')
      .eq(cfg.id, req.params.id)
      .single();

    if (error || !member) {
      return res.status(404).send('ไม่พบข้อมูลสมาชิก');
    }

    const { data: account, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('user_id', member.user_id)
      .single();

    if (userError) throw userError;

    res.render(`member/${cfg.page}-form`, {
      user: currentUser(req),
      activePage:
        cfg.page === 'clinic-staff' ? 'clinic-staff-form' : 'vet-form',
      member: { ...member, email: account.email },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('ไม่สามารถโหลดข้อมูลสมาชิกได้');
  }
};

exports.create = (type) => async (req, res) => {
  const cfg = memberConfig(type);
  if (!cfg) return res.status(404).send('ไม่พบประเภทสมาชิก');

  let uploaded = null;
  let createdUserId = null;

  try {
    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body.password || '');
    const phone = String(req.body.phone || '').trim() || null;
    const status = ['active', 'inactive'].includes(req.body.status)
      ? req.body.status
      : 'active';

    if (!first_name || !last_name || !email || password.length < 8) {
      return renderError(
        res,
        cfg,
        { ...req.body, first_name, last_name, email, phone, status },
        'กรุณากรอกชื่อ นามสกุล อีเมล และรหัสผ่านอย่างน้อย 8 ตัวอักษร',
      );
    }

    const { data: account, error: userError } = await supabase
      .from('users')
      .insert({
        role: cfg.role,
        email,
        password_hash: await bcrypt.hash(password, 10),
        verified: true,
        status,
      })
      .select('user_id')
      .single();


if (userError) {
  if (userError.code === '23505' && userError.message.includes('users_email_key')) {
    return renderError(
      res,
      cfg,
      { ...req.body, first_name, last_name, email, phone, status },
      'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น',
    );
  }

  throw userError;
}

createdUserId = account.user_id;

    createdUserId = account.user_id;

    if (req.file) {
      uploaded = await uploadImage(req.file.buffer, cfg.folder);
    }

    const profile = {
      user_id: createdUserId,
      first_name,
      last_name,
      phone,
      status,
      profile_image_url: uploaded?.secure_url || null,
      profile_image_public_id: uploaded?.public_id || null,
    };

    if (type === 'vets') {
      profile.vet_class = Number(req.body.vet_class) === 2 ? 2 : 1;
    }

    const { error: profileError } = await supabase
      .from(cfg.table)
      .insert(profile);

    if (profileError) throw profileError;

    return res.redirect(`/members/${type}?success=created`);
  } catch (error) {
    console.error(error);

    if (uploaded?.public_id) {
      await deleteImage(uploaded.public_id).catch(console.error);
    }

    if (createdUserId) {
      await supabase.from('users').delete().eq('user_id', createdUserId);
    }

    return renderError(
      res,
      cfg,
      { ...req.body },
      error.code === '23505' ? 'อีเมลนี้ถูกใช้งานแล้ว' : 'เพิ่มสมาชิกไม่สำเร็จ',
    );
  }
};

exports.update = (type) => async (req, res) => {
  const cfg = memberConfig(type);
  if (!cfg) return res.status(404).send('ไม่พบประเภทสมาชิก');

  let uploaded = null;

  try {
    const { data: oldMember, error: findError } = await supabase
      .from(cfg.table)
      .select('*')
      .eq(cfg.id, req.params.id)
      .single();

    if (findError || !oldMember) {
      return res.status(404).send('ไม่พบข้อมูลสมาชิก');
    }

    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const phone = String(req.body.phone || '').trim() || null;
    const status = ['active', 'inactive'].includes(req.body.status)
      ? req.body.status
      : 'active';

    if (!first_name || !last_name || !email) {
      return renderError(
        res,
        cfg,
        { ...oldMember, ...req.body, email },
        'กรุณากรอกชื่อ นามสกุล และอีเมล',
      );
    }

    if (req.file) {
      uploaded = await uploadImage(req.file.buffer, cfg.folder);
    }

    const { error: accountError } = await supabase
      .from('users')
      .update({ email, status })
      .eq('user_id', oldMember.user_id);

    if (accountError) throw accountError;

    const changes = { first_name, last_name, phone, status };

    if (uploaded) {
      changes.profile_image_url = uploaded.secure_url;
      changes.profile_image_public_id = uploaded.public_id;
    }

    if (type === 'vets') {
      changes.vet_class = Number(req.body.vet_class) === 2 ? 2 : 1;
    }

    const { error: profileError } = await supabase
      .from(cfg.table)
      .update(changes)
      .eq(cfg.id, req.params.id);

    if (profileError) throw profileError;

    if (uploaded && oldMember.profile_image_public_id) {
      await deleteImage(oldMember.profile_image_public_id).catch((error) =>
        console.error('ลบรูปเดิมไม่สำเร็จ:', error.message),
      );
    }

    return res.redirect(`/members/${type}?success=updated`);
  } catch (error) {
    console.error(error);

    if (uploaded?.public_id) {
      await deleteImage(uploaded.public_id).catch(console.error);
    }

    return res
      .status(error.code === '23505' ? 409 : 500)
      .send(
        error.code === '23505'
          ? 'อีเมลนี้ถูกใช้งานแล้ว'
          : 'แก้ไขข้อมูลสมาชิกไม่สำเร็จ',
      );
  }
};

exports.remove = (type) => async (req, res) => {
  const cfg = memberConfig(type);
  if (!cfg) return res.status(404).send('ไม่พบประเภทสมาชิก');

  try {
    const { data: member, error: findError } = await supabase
      .from(cfg.table)
      .select('*')
      .eq(cfg.id, req.params.id)
      .single();

    if (findError || !member) {
      return res.status(404).send('ไม่พบข้อมูลสมาชิก');
    }

    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('user_id', member.user_id);

    if (deleteError) throw deleteError;

    if (member.profile_image_public_id) {
      await deleteImage(member.profile_image_public_id).catch((error) =>
        console.error('ลบรูปจาก Cloudinary ไม่สำเร็จ:', error.message),
      );
    }

    res.redirect(`/members/${type}?success=deleted`);
  } catch (error) {
    console.error(error);
    res.status(500).send('ลบสมาชิกไม่สำเร็จ');
  }
};
