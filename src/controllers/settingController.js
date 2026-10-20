
const supabase = require('../../config/supabase');
const cloudinary = require('../../config/cloudinary');
const { sendOtp } = require('../../config/mailer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const multer = require('multer');
const OTP_TYPE = 'reset_password';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('รองรับเฉพาะไฟล์ JPG, PNG และ WEBP'));
  }
});

function getUser(req) {
  return req.user || req.session?.user || req.session?.account || null;
}

function getUserId(user) {
  return user?.user_id || user?.id || null;
}

function getRole(user) {
  return user?.role || null;
}

function getProfileTable(role) {
  if (role === 'clinic_staff') return 'clinic_staff';
  if (role === 'vet') return 'vets';
  if (role === 'clinic') return 'clinics';
  return null;
}

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => error ? reject(error) : resolve(result)
    );
    stream.end(buffer);
  });
}

async function loadSetting(userId, role) {
  const { data: account, error: accountError } = await supabase
    .from('users')
    .select('user_id, email, role, verified, status, created_at')
    .eq('user_id', userId)
    .eq('role', role)
    .single();

  if (accountError || !account) throw new Error('ไม่พบข้อมูลบัญชีผู้ใช้');

  const table = getProfileTable(role);
  if (!table) throw new Error('ไม่รองรับประเภทบัญชีนี้');

  const idColumn = role === 'clinic_staff'
    ? 'clinic_staff_id'
    : role === 'vet' ? 'vet_id' : 'clinic_id';

  const { data: profile, error: profileError } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', userId)
    .single();

  if (profileError || !profile) throw new Error('ไม่พบข้อมูลโปรไฟล์');

  return { account, profile, table, idColumn };
}

exports.upload = upload;

exports.showSetting = async (req, res) => {
  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);

    if (!userId || !getProfileTable(role)) return res.redirect('/login');

    const { account, profile } = await loadSetting(userId, role);

    res.render('setting', {
      account,
      profile,
      role,
      success: req.session.settingSuccess || null,
      error: req.session.settingError || null,
      activePage: 'settings'
    });

    delete req.session.settingSuccess;
    delete req.session.settingError;
  } catch (error) {
    console.error('showSetting:', error.message);
    res.status(500).send('ไม่สามารถโหลดข้อมูลการตั้งค่าได้');
  }
};

exports.updateProfile = async (req, res) => {
  let uploadedImage = null;

  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);

    if (!userId || !getProfileTable(role)) return res.redirect('/login');
    if (role === 'clinic') {
      return res.status(403).send('บัญชี Clinic ไม่สามารถแก้ไขข้อมูลได้');
    }

    const firstName = String(req.body.first_name || '').trim();
    const lastName = String(req.body.last_name || '').trim();
    const phone = String(req.body.phone || '').trim();

    if (!firstName || !lastName) {
      req.session.settingError = 'กรุณากรอกชื่อและนามสกุล';
      return res.redirect('/settings');
    }

    if (firstName.length > 100 || lastName.length > 100 || phone.length > 20) {
      req.session.settingError = 'ข้อมูลยาวเกินจำนวนตัวอักษรที่กำหนด';
      return res.redirect('/settings');
    }

    const { profile, table } = await loadSetting(userId, role);
    const oldPublicId = profile.profile_image_public_id || null;
    const folder = role === 'vet' ? 'Vet/VetProfile' : 'Staff/StaffProfile';

    const updates = {
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      updated_at: new Date().toISOString()
    };

    if (req.file) {
      uploadedImage = await uploadToCloudinary(req.file.buffer, folder);
      updates.profile_image_url = uploadedImage.secure_url;
      updates.profile_image_public_id = uploadedImage.public_id;
    }

    const { error } = await supabase
      .from(table)
      .update(updates)
      .eq('user_id', userId);

    if (error) {
      if (uploadedImage) {
        await cloudinary.uploader.destroy(uploadedImage.public_id).catch(() => {});
      }
      throw error;
    }

    if (req.file && oldPublicId && oldPublicId !== uploadedImage.public_id) {
      try {
        await cloudinary.uploader.destroy(oldPublicId);
      } catch (error) {
        console.error('ลบรูปเดิมจาก Cloudinary ไม่สำเร็จ:', error.message);
      }
    }

    req.session.settingSuccess = 'บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว';
    res.redirect('/settings');
  } catch (error) {
    console.error('updateProfile:', error.message);
    req.session.settingError = 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองอีกครั้ง';
    res.redirect('/settings');
  }
};

exports.deleteProfileImage = async (req, res) => {
  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);

    if (!userId || !getProfileTable(role)) return res.redirect('/login');
    if (role === 'clinic') return res.status(403).send('ไม่มีสิทธิ์แก้ไขข้อมูล Clinic');

    const { profile, table } = await loadSetting(userId, role);
    const publicId = profile.profile_image_public_id;

    const { error } = await supabase
      .from(table)
      .update({
        profile_image_url: null,
        profile_image_public_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) throw error;

    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (error) {
        console.error('ลบรูปจาก Cloudinary ไม่สำเร็จ:', error.message);
      }
    }

    req.session.settingSuccess = 'ลบรูปโปรไฟล์เรียบร้อยแล้ว';
    res.redirect('/settings');
  } catch (error) {
    console.error('deleteProfileImage:', error.message);
    req.session.settingError = 'ไม่สามารถลบรูปโปรไฟล์ได้';
    res.redirect('/settings');
  }
};

exports.showOtp = (req, res) => {
  const user = getUser(req);
  const userId = getUserId(user);
  const role = getRole(user);

  if (!userId || !['clinic_staff', 'vet', 'clinic'].includes(role)) {
    return res.status(403).send('ไม่มีสิทธิ์เปลี่ยนรหัสผ่าน');
  }

  const otpSession = req.session.passwordOtp;
  const validSession = otpSession &&
    otpSession.userId === userId &&
    otpSession.role === role;

  const step = validSession && otpSession.verified
    ? 'reset'
    : validSession && otpSession.otpId
      ? 'verify'
      : 'request';

  res.render('setting-otp', {
    step,
    email: user.email || '',
    error: null,
    success: null
  });
};

exports.requestOtp = async (req, res) => {
  let otpId = null;

  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);

    if (!userId || !['clinic_staff', 'vet'].includes(role)) {
      return res.status(403).send('ไม่มีสิทธิ์เปลี่ยนรหัสผ่าน');
    }

    const { data: account, error: accountError } = await supabase
      .from('users')
      .select('user_id, email')
      .eq('user_id', userId)
      .eq('role', role)
      .eq('status', 'active')
      .single();

    if (accountError || !account) {
      throw new Error('ไม่พบบัญชีผู้ใช้หรือบัญชีถูกระงับ');
    }

    const now = Date.now();
    const previous = req.session.passwordOtp;

    if (
      previous?.userId === userId &&
      previous?.role === role &&
      previous?.lastSentAt &&
      now - previous.lastSentAt < 60 * 1000
    ) {
      return res.status(429).render('setting-otp', {
        step: 'verify',
        email: account.email,
        error: 'กรุณารอ 60 วินาทีก่อนขอ OTP ใหม่',
        success: null
      });
    }

    const { error: revokeError } = await supabase
      .from('otp')
      .update({
        status: 'revoked',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('type', OTP_TYPE)
      .eq('status', 'pending');

    if (revokeError) throw revokeError;

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(now + 5 * 60 * 1000).toISOString();

    const { data: otpRecord, error: insertError } = await supabase
      .from('otp')
      .insert({
        user_id: userId,
        otp_code: otpCode,
        type: OTP_TYPE,
        status: 'pending',
        expires_at: expiresAt
      })
      .select('otp_id')
      .single();

    if (insertError) throw insertError;

    otpId = otpRecord.otp_id;

    try {
      await sendOtp(account.email, otpCode);
    } catch (mailError) {
      await supabase
        .from('otp')
        .update({
          status: 'revoked',
          updated_at: new Date().toISOString()
        })
        .eq('otp_id', otpId)
        .eq('status', 'pending');

      throw mailError;
    }

    req.session.passwordOtp = {
      userId,
      role,
      otpId,
      lastSentAt: now,
      verified: false
    };

    return res.render('setting-otp', {
      step: 'verify',
      email: account.email,
      error: null,
      success: 'ส่ง OTP ไปยังอีเมลเรียบร้อยแล้ว'
    });
  } catch (error) {
    console.error('requestOtp:', error.message);

    return res.status(500).render('setting-otp', {
      step: 'request',
      email: getUser(req)?.email || '',
      error: 'ส่ง OTP ไม่สำเร็จ กรุณาลองอีกครั้ง',
      success: null
    });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);
    const otpSession = req.session.passwordOtp;
    const otpCode = String(req.body.otp || '').trim();

    if (
      !userId ||
      !['clinic_staff', 'vet'].includes(role) ||
      !otpSession ||
      otpSession.userId !== userId ||
      otpSession.role !== role ||
      !otpSession.otpId ||
      otpSession.verified
    ) {
      delete req.session.passwordOtp;

      return res.status(400).render('setting-otp', {
        step: 'request',
        email: user?.email || '',
        error: 'เซสชัน OTP ไม่ถูกต้อง กรุณาขอรหัสใหม่',
        success: null
      });
    }

    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).render('setting-otp', {
        step: 'verify',
        email: user.email || '',
        error: 'กรุณากรอก OTP 6 หลัก',
        success: null
      });
    }

    const { data: otpRecord, error: otpError } = await supabase
      .from('otp')
      .select('otp_id, user_id, otp_code, type, status, expires_at')
      .eq('otp_id', otpSession.otpId)
      .eq('user_id', userId)
      .eq('type', OTP_TYPE)
      .eq('status', 'pending')
      .maybeSingle();

    if (otpError) throw otpError;

    if (!otpRecord) {
      delete req.session.passwordOtp;

      return res.status(400).render('setting-otp', {
        step: 'request',
        email: user.email || '',
        error: 'OTP ถูกยกเลิกหรือถูกใช้แล้ว กรุณาขอรหัสใหม่',
        success: null
      });
    }

    if (new Date(otpRecord.expires_at).getTime() <= Date.now()) {
      const { error } = await supabase
        .from('otp')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString()
        })
        .eq('otp_id', otpRecord.otp_id)
        .eq('status', 'pending');

      if (error) throw error;

      delete req.session.passwordOtp;

      return res.status(400).render('setting-otp', {
        step: 'request',
        email: user.email || '',
        error: 'OTP หมดอายุแล้ว กรุณาขอรหัสใหม่',
        success: null
      });
    }

    if (otpRecord.otp_code !== otpCode) {
      const attempts = (otpSession.attempts || 0) + 1;
      otpSession.attempts = attempts;

      if (attempts >= 5) {
        await supabase
          .from('otp')
          .update({
            status: 'revoked',
            updated_at: new Date().toISOString()
          })
          .eq('otp_id', otpRecord.otp_id)
          .eq('status', 'pending');

        delete req.session.passwordOtp;

        return res.status(429).render('setting-otp', {
          step: 'request',
          email: user.email || '',
          error: 'กรอก OTP ผิดครบ 5 ครั้ง กรุณาขอรหัสใหม่',
          success: null
        });
      }

      return res.status(400).render('setting-otp', {
        step: 'verify',
        email: user.email || '',
        error: `OTP ไม่ถูกต้อง เหลือโอกาสอีก ${5 - attempts} ครั้ง`,
        success: null
      });
    }

    otpSession.verified = true;
    otpSession.verifiedAt = Date.now();

    return res.render('setting-otp', {
      step: 'reset',
      email: user.email || '',
      error: null,
      success: 'ยืนยัน OTP สำเร็จ กรุณาตั้งรหัสผ่านใหม่'
    });
  } catch (error) {
    console.error('verifyOtp:', error.message);

    return res.status(500).render('setting-otp', {
      step: 'request',
      email: getUser(req)?.email || '',
      error: 'ตรวจสอบ OTP ไม่สำเร็จ กรุณาลองอีกครั้ง',
      success: null
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);
    const otpSession = req.session.passwordOtp;

    if (
      !userId ||
      !['clinic_staff', 'vet'].includes(role) ||
      !otpSession?.verified ||
      otpSession.userId !== userId ||
      otpSession.role !== role ||
      Date.now() - otpSession.verifiedAt > 5 * 60 * 1000
    ) {
      delete req.session.passwordOtp;

      return res.status(403).render('setting-otp', {
        step: 'request',
        email: user?.email || '',
        error: 'การยืนยัน OTP หมดอายุ กรุณาเริ่มใหม่',
        success: null
      });
    }

    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirm_password || '');

    if (password.length < 8 || password.length > 72) {
      return res.status(400).render('setting-otp', {
        step: 'reset',
        email: user.email || '',
        error: 'รหัสผ่านต้องมีความยาว 8–72 ตัวอักษร',
        success: null
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).render('setting-otp', {
        step: 'reset',
        email: user.email || '',
        error: 'รหัสผ่านไม่ตรงกัน',
        success: null
      });
    }

    const { data: otpRecord, error: otpError } = await supabase
      .from('otp')
      .select('otp_id, status, expires_at')
      .eq('otp_id', otpSession.otpId)
      .eq('user_id', userId)
      .eq('type', OTP_TYPE)
      .eq('status', 'pending')
      .maybeSingle();

    if (otpError) throw otpError;

    if (
      !otpRecord ||
      new Date(otpRecord.expires_at).getTime() <= Date.now()
    ) {
      delete req.session.passwordOtp;

      return res.status(400).render('setting-otp', {
        step: 'request',
        email: user.email || '',
        error: 'OTP หมดอายุหรือถูกใช้แล้ว กรุณาขอรหัสใหม่',
        success: null
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('role', role)
      .eq('status', 'active');

    if (updateError) throw updateError;

    const { data: usedOtp, error: usedError } = await supabase
      .from('otp')
      .update({
        status: 'used',
        updated_at: new Date().toISOString()
      })
      .eq('otp_id', otpRecord.otp_id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('otp_id')
      .maybeSingle();

    if (usedError || !usedOtp) {
      throw usedError || new Error('ไม่สามารถยืนยันการใช้ OTP ได้');
    }

    delete req.session.passwordOtp;
    req.session.settingSuccess = 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว';

    return res.redirect('/settings');
  } catch (error) {
    console.error('resetPassword:', error.message);

    return res.status(500).render('setting-otp', {
      step: 'reset',
      email: getUser(req)?.email || '',
      error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองอีกครั้ง',
      success: null
    });
  }
};


exports.updateClinicProfile = async (req, res) => {
  let uploadedImage = null;
  try {
    const user = getUser(req);
    const userId = getUserId(user);
    const role = getRole(user);
    if (!userId || role !== 'clinic') return res.status(403).send('ไม่มีสิทธิ์แก้ไขข้อมูล Clinic');

    const phone = String(req.body.phone || '').trim();
    const mapUrl = String(req.body.google_map_url || '').trim();
    const latitudeText = String(req.body.latitude ?? '').trim();
    const longitudeText = String(req.body.longitude ?? '').trim();

    if (phone.length > 20 || mapUrl.length > 2000) {
      req.session.settingError = 'เบอร์โทรศัพท์หรือ Google Map URL ยาวเกินกำหนด';
      return res.redirect('/settings');
    }

    if (mapUrl && !/^https?:\/\/\S+$/i.test(mapUrl)) {
      req.session.settingError = 'Google Map URL ต้องขึ้นต้นด้วย http:// หรือ https://';
      return res.redirect('/settings');
    }

    const latitude = latitudeText === '' ? null : Number(latitudeText);
    const longitude = longitudeText === '' ? null : Number(longitudeText);

    if (
      (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
      ((latitude === null) !== (longitude === null))
    ) {
      req.session.settingError = 'กรุณาระบุ Latitude และ Longitude ให้ถูกต้องทั้งคู่ หรือเว้นว่างทั้งคู่';
      return res.redirect('/settings');
    }

    const { profile } = await loadSetting(userId, role);
    const updates = {
      phone: phone || null,
      google_map_url: mapUrl || null,
      latitude,
      longitude,
      updated_at: new Date().toISOString()
    };

    const debugEnabled = process.env.DEBUG_CLINIC_SETTINGS === 'true' && req.body.debug_mode === '1';

    if (debugEnabled) {
      const clinicName = String(req.body.clinic_name || '').trim();
      const type = String(req.body.type || '');
      const addressLine = String(req.body.address_line || '').trim();
      const subdistrict = String(req.body.subdistrict || '').trim();
      const district = String(req.body.district || '').trim();
      const province = String(req.body.province || '').trim();
      const postalCode = String(req.body.postal_code || '').trim();
      const openTime = String(req.body.open_time || '').trim();
      const closeTime = String(req.body.close_time || '').trim();

      if (!clinicName || clinicName.length > 255 || !['clinic', 'hospital'].includes(type)) {
        req.session.settingError = 'ชื่อคลินิกหรือประเภทคลินิกไม่ถูกต้อง';
        return res.redirect('/settings');
      }

      if (
        addressLine.length > 5000 ||
        subdistrict.length > 100 ||
        district.length > 100 ||
        province.length > 100 ||
        postalCode.length > 10 ||
        (openTime && !/^\d{2}:\d{2}$/.test(openTime)) ||
        (closeTime && !/^\d{2}:\d{2}$/.test(closeTime))
      ) {
        req.session.settingError = 'ข้อมูลคลินิกไม่ถูกต้องหรือยาวเกินกำหนด';
        return res.redirect('/settings');
      }

      updates.clinic_name = clinicName;
      updates.type = type;
      updates.address_line = addressLine || null;
      updates.subdistrict = subdistrict || null;
      updates.district = district || null;
      updates.province = province || null;
      updates.postal_code = postalCode || null;
      updates.open_time = openTime || null;
      updates.close_time = closeTime || null;
    }

    if (req.file) {
      uploadedImage = await uploadToCloudinary(req.file.buffer, 'Clinic/ClinicProfile');
      updates.profile_image_url = uploadedImage.secure_url;
      updates.profile_image_public_id = uploadedImage.public_id;
    }

    const { error } = await supabase
      .from('clinics')
      .update(updates)
      .eq('user_id', userId);

    if (error) throw error;

    if (
      uploadedImage &&
      profile.profile_image_public_id &&
      profile.profile_image_public_id !== uploadedImage.public_id
    ) {
      try {
        await cloudinary.uploader.destroy(profile.profile_image_public_id);
      } catch (deleteError) {
        console.error('ลบรูป Clinic เดิมจาก Cloudinary ไม่สำเร็จ:', deleteError.message);
      }
    }

    req.session.settingSuccess = 'บันทึกข้อมูล Clinic เรียบร้อยแล้ว';
    return res.redirect('/settings');
  } catch (error) {
    if (uploadedImage) {
      try {
        await cloudinary.uploader.destroy(uploadedImage.public_id);
      } catch (deleteError) {
        console.error('ลบรูปที่อัปโหลดไม่สำเร็จ:', deleteError.message);
      }
    }
    console.error('updateClinicProfile:', error.message);
    req.session.settingError = 'ไม่สามารถบันทึกข้อมูล Clinic ได้ กรุณาลองอีกครั้ง';
    return res.redirect('/settings');
  }
};

