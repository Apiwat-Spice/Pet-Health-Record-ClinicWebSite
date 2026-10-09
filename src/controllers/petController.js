const supabase = require('../../config/supabase');
const cloudinary = require('../../config/cloudinary');
const { Readable } = require('stream');

exports.showPets = (req, res) => {
  res.render('Pets/Pets', {
    user: req.session.user,
    activePage: 'Pets',
  });
};

exports.showPetOwners = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const { data: owners, error } = await supabase
      .from('pet_owners')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('Pets/Pet_Owners', {
      user: req.session.user,
      activePage: 'Pet_Owners',
      owners: owners || [],
      success:
        req.query.success === 'created'
          ? 'เพิ่มเจ้าของสัตว์เลี้ยงสำเร็จ'
          : null,
      error: null,
    });
  } catch (error) {
    console.error('Load pet owners error:', error);
    res.status(500).send('ไม่สามารถโหลดข้อมูลเจ้าของสัตว์เลี้ยงได้');
  }
};

exports.showCreatePetOwner = (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  res.render('Pets/Pet_Owner_Form', {
    user: req.session.user,
    activePage: 'Pet_Owners',
    owner: null,
    old: {},
    errors: {},
    error: null,
    isAdmin: false,
  });
};

exports.createPetOwner = async (req, res) => {
  let uploadedImage = null;

  const user = req.session.user;

  const old = {
    email: req.body.email?.trim() || '',
    username: req.body.username?.trim() || '',
    first_name: req.body.first_name?.trim() || '',
    last_name: req.body.last_name?.trim() || '',
    gender: req.body.gender || '',
    id_card: req.body.id_card?.trim() || '',
    address_line: req.body.address_line?.trim() || '',
    subdistrict: req.body.subdistrict?.trim() || '',
    district: req.body.district?.trim() || '',
    province: req.body.province?.trim() || '',
    postal_code: req.body.postal_code?.trim() || '',
  };

  const errors = {};

  if (!user) {
    return res.redirect('/login');
  }

  if (!old.email) {
    errors.email = 'กรุณากรอกอีเมล';
  }

  if (!old.username) {
    errors.username = 'กรุณากรอก Username';
  }

  if (!old.first_name) {
    errors.first_name = 'กรุณากรอกชื่อ';
  }

  if (!old.last_name) {
    errors.last_name = 'กรุณากรอกนามสกุล';
  }

  const allowedGenders = ['male', 'female', 'other', 'prefer_not_to_say'];

  if (old.gender && !allowedGenders.includes(old.gender)) {
    errors.gender = 'กรุณาเลือกเพศให้ถูกต้อง';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('Pets/Pet_Owner_Form', {
      user,
      activePage: 'Pet_Owners',
      owner: null,
      old,
      errors,
      error: null,
      isAdmin: false,
    });
  }

  try {
    if (req.file) {
      uploadedImage = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'Petowner/PetownerProfile',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          },
        );

        Readable.from(req.file.buffer).pipe(stream);
      });
    }
    console.log('Uploaded image URL:', uploadedImage?.secure_url);
    console.log('Uploaded image ID:', uploadedImage?.public_id);

    const { data, error } = await supabase.rpc('create_pet_owner', {
      p_email: old.email,
      p_username: old.username,
      p_first_name: old.first_name,
      p_last_name: old.last_name,
      p_gender: old.gender || null,
      p_id_card: old.id_card || null,
      p_address_line: old.address_line || null,
      p_subdistrict: old.subdistrict || null,
      p_district: old.district || null,
      p_province: old.province || null,
      p_postal_code: old.postal_code || null,
      p_profile_image_url: uploadedImage?.secure_url || null,
      p_profile_image_public_id: uploadedImage?.public_id || null,
    });

    if (error) {
      throw error;
    }

    return res.redirect('/pet-owners?success=created');
  } catch (error) {
    console.error('Create PetOwner error:', error);

    if (uploadedImage?.public_id) {
      try {
        await cloudinary.uploader.destroy(uploadedImage.public_id);
      } catch (deleteError) {
        console.error('Delete Cloudinary image error:', deleteError);
      }
    }

    let message = 'ไม่สามารถบันทึกข้อมูล PetOwner ได้';

    if (error.code === '23505' || error.code === '23503') {
      message = 'อีเมลหรือ Username ซ้ำ หรือข้อมูลที่เชื่อมโยงไม่ถูกต้อง';
    } else if (error.message?.includes('create_pet_owner')) {
      message =
        'ไม่สามารถเรียกใช้งานฟังก์ชันสร้าง PetOwner ได้ กรุณาตรวจสอบ Function ใน Supabase';
    }

    return res.status(400).render('Pets/Pet_Owner_Form', {
      user,
      activePage: 'Pet_Owners',
      owner: null,
      old,
      errors: {},
      error: message,
      isAdmin: false,
    });
  }
};
