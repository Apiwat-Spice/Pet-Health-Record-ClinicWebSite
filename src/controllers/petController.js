const supabase = require('../../config/supabase');
const cloudinary = require('../../config/cloudinary');
const { Readable } = require('stream');
const crypto = require('crypto');

function getPetFormData(body) {
  return {
    pet_owner_id: body.pet_owner_id,
    pet_name: body.pet_name?.trim() || '',
    animal_type: body.animal_type || '',
    species: body.species?.trim() || null,
    birthdate: body.birthdate || null,
    weight:
      body.weight === '' || body.weight == null ? null : Number(body.weight),
    detail: body.detail?.trim() || null,
    sex: body.sex || 'unknown',
    sterilization: body.sterilization === 'true',
    microchip_number: body.microchip_number?.trim() || null,
    pet_tag: body.pet_tag?.trim() || null,
  };
}

async function getOwners() {
  const { data, error } = await supabase
    .from('pet_owners')
    .select(
      `
      pet_owner_id,
      user_id,
      username,
      first_name,
      last_name,
      profile_image_url,
      verified,
      users (
        email
      )
    `,
    )
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((owner) => ({
    ...owner,
    email: owner.users?.email || '',
  }));
}

function validPet(data) {
  const errors = {};
  if (
    !Number.isSafeInteger(Number(data.pet_owner_id)) ||
    Number(data.pet_owner_id) <= 0
  ) {
    errors.pet_owner_id = 'กรุณาเลือกเจ้าของสัตว์เลี้ยง';
  }
  if (!data.pet_name) errors.pet_name = 'กรุณากรอกชื่อสัตว์เลี้ยง';
  if (
    !['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(
      data.animal_type,
    )
  ) {
    errors.animal_type = 'กรุณาเลือกชนิดสัตว์ให้ถูกต้อง';
  }
  if (!['male', 'female', 'unknown'].includes(data.sex)) {
    errors.sex = 'กรุณาเลือกเพศให้ถูกต้อง';
  }
  if (
    data.weight !== null &&
    (!Number.isFinite(data.weight) || data.weight < 0 || data.weight > 9999.99)
  ) {
    errors.weight = 'น้ำหนักต้องอยู่ระหว่าง 0 ถึง 9999.99 กก.';
  }
  if (
    data.birthdate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(data.birthdate) ||
      data.birthdate > new Date().toISOString().slice(0, 10))
  ) {
    errors.birthdate = 'กรุณาระบุวันเกิดให้ถูกต้อง';
  }
  return errors;
}
async function uploadPetImage(file) {
  if (!file) return null;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'Pet/PetProfile', resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    Readable.from(file.buffer).pipe(stream);
  });
}
async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (error) {
    console.error('Delete pet image error:', error);
  }
}

// แสดงสัตว์เลี้ยงทั้งหมด
exports.showPets = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const { data: pets, error } = await supabase
      .from('pets')
      .select(
        `
  *,
  pet_owners (
    pet_owner_id,
    username,
    first_name,
    last_name,
    users (
      email
    )
  )
`,
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('Pets/Pets', {
      user: req.session.user,
      activePage: 'Pets',
      pets: (pets || []).map((p) => ({
        ...p,
        owner_name:
          [p.pet_owners?.first_name, p.pet_owners?.last_name]
            .filter(Boolean)
            .join(' ') ||
          p.pet_owners?.username ||
          '-',
        owner_username: p.pet_owners?.username || '-',
        owner_email: p.pet_owners?.users?.email || '-',
      })),
      showOwner: true,
      success:
        req.query.success === 'created'
          ? 'เพิ่มสัตว์เลี้ยงสำเร็จ'
          : req.query.success === 'updated'
            ? 'แก้ไขข้อมูลสัตว์เลี้ยงสำเร็จ'
            : req.query.success === 'deleted'
              ? 'ลบสัตว์เลี้ยงสำเร็จ'
              : null,
      error:
        req.query.error === 'duplicate' ? 'เลขไมโครชิปนี้มีในระบบแล้ว' : null,
    });
  } catch (error) {
    console.error('Load pets error:', error);
    res.status(500).send('ไม่สามารถโหลดข้อมูลสัตว์เลี้ยงได้');
  }
};
exports.showSelectPetOwner = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const owners = await getOwners();
    res.render('Pets/Pet_Owner_Select', {
      user: req.session.user,
      activePage: 'Pets',
      owners,
      error: null,
    });
  } catch (error) {
    console.error('Load owners for pet selection error:', error);
    res.status(500).send('ไม่สามารถโหลดรายชื่อเจ้าของได้');
  }
};
exports.showCreatePet = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const owners = await getOwners();
    const ownerId = req.query.owner ? Number(req.query.owner) : null;

    if (ownerId && !owners.some((o) => o.pet_owner_id === ownerId)) {
      return res.status(404).send('ไม่พบเจ้าของสัตว์เลี้ยง');
    }

    if (!ownerId) return res.redirect('/pets/create');

    res.render('Pets/Pet_Form', {
      user: req.session.user,
      activePage: 'Pets',
      pet: null,
      old: { pet_owner_id: ownerId },
      owners,
      ownerId,
      errors: {},
      error: null,
      isAdmin: false,
    });
  } catch (error) {
    console.error('Show create pet error:', error);
    res.status(500).send('ไม่สามารถเปิดฟอร์มเพิ่มสัตว์เลี้ยงได้');
  }
};
exports.createPet = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  let uploadedImage = null;
  const pet = getPetFormData(req.body);
  const errors = validPet(pet);

  try {
    if (Object.keys(errors).length) {
      const owners = await getOwners();
      return res.status(400).render('Pets/Pet_Form', {
        user: req.session.user,
        activePage: 'Pets',
        pet: null,
        old: pet,
        owners,
        ownerId: pet.pet_owner_id,
        errors,
        error: null,
        isAdmin: false,
      });
    }

    const { data: owner, error: ownerError } = await supabase
      .from('pet_owners')
      .select('pet_owner_id')
      .eq('pet_owner_id', Number(pet.pet_owner_id))
      .maybeSingle();

    if (ownerError) throw ownerError;
    if (!owner) return res.status(400).send('ไม่พบเจ้าของสัตว์เลี้ยง');

    uploadedImage = await uploadPetImage(req.file);

    const insertData = {
      ...pet,
      pet_owner_id: Number(pet.pet_owner_id),
      pet_image_url: uploadedImage?.secure_url || null,
      pet_image_public_id: uploadedImage?.public_id || null,
      qr_code: `PET-${crypto.randomUUID()}`.toUpperCase(),
    };

    const { error } = await supabase.from('pets').insert(insertData);
    if (error) throw error;

    return res.redirect('/pets?success=created');
  } catch (error) {
    console.error('Create pet error:', error);
    await deleteCloudinaryImage(uploadedImage?.public_id);

    if (error.code === '23505' || error.code === '23503') {
      return res.redirect('/pets?error=duplicate');
    }
    return res.status(500).send('ไม่สามารถเพิ่มข้อมูลสัตว์เลี้ยงได้');
  }
};
exports.showPetDetail = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const petId = Number(req.params.id);
  if (!Number.isSafeInteger(petId) || petId <= 0)
    return res.status(400).send('รหัสสัตว์เลี้ยงไม่ถูกต้อง');

  try {
    const { data: pet, error } = await supabase
      .from('pets')
      .select('*, pet_owners(*)')
      .eq('pet_id', petId)
      .maybeSingle();

    if (error) throw error;
    if (!pet) return res.status(404).send('ไม่พบข้อมูลสัตว์เลี้ยง');

    res.render('Pets/Pet_Detail', {
      user: req.session.user,
      activePage: 'Pets',
      pet,
      owner: pet.pet_owners || null,
    });
  } catch (error) {
    console.error('Load pet detail error:', error);
    res.status(500).send('ไม่สามารถโหลดรายละเอียดสัตว์เลี้ยงได้');
  }
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
          : req.query.success === 'updated'
            ? 'แก้ไขข้อมูลเจ้าของสัตว์เลี้ยงสำเร็จ'
            : req.query.success === 'deleted'
              ? 'ลบเจ้าของสัตว์เลี้ยงสำเร็จ'
              : null,
      error:
        req.query.error === 'not_found'
          ? 'ไม่พบเจ้าของสัตว์เลี้ยง'
          : req.query.error === 'delete_failed'
            ? 'ไม่สามารถลบเจ้าของสัตว์เลี้ยงได้'
            : null,
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
exports.deletePetOwner = async (req, res) => {
  const petOwnerId = Number(req.params.id);

  if (!Number.isSafeInteger(petOwnerId) || petOwnerId <= 0) {
    return res.redirect('/pet-owners?error=invalid_id');
  }

  try {
    const { data, error } = await supabase.rpc('delete_pet_owner', {
      p_pet_owner_id: petOwnerId,
    });

    if (error) {
      throw error;
    }

    const result = data?.[0];

    if (!result?.deleted) {
      return res.redirect('/pet-owners?error=not_found');
    }

    if (result.profile_image_public_id) {
      try {
        const imageResult = await cloudinary.uploader.destroy(
          result.profile_image_public_id,
          { resource_type: 'image' },
        );

        if (imageResult.result !== 'ok' && imageResult.result !== 'not found') {
          console.error('Cloudinary delete result:', imageResult);
        }
      } catch (imageError) {
        console.error('Cloudinary delete error:', imageError);
      }
    }

    return res.redirect('/pet-owners?success=deleted');
  } catch (error) {
    console.error('Delete PetOwner error:', error);
    return res.redirect('/pet-owners?error=delete_failed');
  }
};
exports.showEditPet = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const petId = Number(req.params.id);
    const [{ data: pet, error }, owners] = await Promise.all([
      supabase.from('pets').select('*').eq('pet_id', petId).maybeSingle(),
      getOwners(),
    ]);

    if (error) throw error;
    if (!pet) return res.status(404).send('ไม่พบข้อมูลสัตว์เลี้ยง');

    res.render('Pets/Pet_Form', {
      user: req.session.user,
      activePage: 'Pets',
      pet,
      old: pet,
      owners,
      ownerId: pet.pet_owner_id,
      errors: {},
      error: null,
      isAdmin: false,
    });
  } catch (error) {
    console.error('Show edit pet error:', error);
    res.status(500).send('ไม่สามารถเปิดฟอร์มแก้ไขได้');
  }
};
exports.updatePet = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  let uploadedImage = null;
  let oldImagePublicId = null;
  const petId = Number(req.params.id);
  const pet = getPetFormData(req.body);
  const errors = validPet(pet);

  try {
    const { data: current, error: currentError } = await supabase
      .from('pets')
      .select('*')
      .eq('pet_id', petId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return res.status(404).send('ไม่พบข้อมูลสัตว์เลี้ยง');

    oldImagePublicId = current.pet_image_public_id;

    if (Object.keys(errors).length) {
      const owners = await getOwners();
      return res.status(400).render('Pets/Pet_Form', {
        user: req.session.user,
        activePage: 'Pets',
        pet: current,
        old: { ...current, ...pet },
        owners,
        ownerId: pet.pet_owner_id,
        errors,
        error: null,
        isAdmin: false,
      });
    }

    if (req.file) uploadedImage = await uploadPetImage(req.file);

    const updateData = {
      ...pet,
      pet_owner_id: Number(pet.pet_owner_id),
      pet_image_url: uploadedImage?.secure_url || current.pet_image_url,
      pet_image_public_id:
        uploadedImage?.public_id || current.pet_image_public_id,
    };

    const { error } = await supabase
      .from('pets')
      .update(updateData)
      .eq('pet_id', petId);

    if (error) throw error;

    if (uploadedImage && oldImagePublicId)
      await deleteCloudinaryImage(oldImagePublicId);
    return res.redirect('/pets?success=updated');
  } catch (error) {
    console.error('Update pet error:', error);
    if (uploadedImage?.public_id)
      await deleteCloudinaryImage(uploadedImage.public_id);
    if (error.code === '23505') return res.redirect('/pets?error=duplicate');
    return res.status(500).send('ไม่สามารถแก้ไขข้อมูลสัตว์เลี้ยงได้');
  }
};
exports.deletePet = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const petId = Number(req.params.id);
  if (!Number.isSafeInteger(petId) || petId <= 0) return res.redirect('/pets');

  try {
    const { data: pet, error: findError } = await supabase
      .from('pets')
      .select('pet_image_public_id')
      .eq('pet_id', petId)
      .maybeSingle();

    if (findError) throw findError;
    if (!pet) return res.redirect('/pets');

    const { error } = await supabase.from('pets').delete().eq('pet_id', petId);
    if (error) throw error;

    await deleteCloudinaryImage(pet.pet_image_public_id);
    return res.redirect('/pets?success=deleted');
  } catch (error) {
    console.error('Delete pet error:', error);
    return res.status(500).send('ไม่สามารถลบข้อมูลสัตว์เลี้ยงได้');
  }
};
exports.showEditPetOwner = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const petOwnerId = Number(req.params.id);
  if (!Number.isSafeInteger(petOwnerId) || petOwnerId <= 0) {
    return res.status(400).send('รหัสเจ้าของสัตว์เลี้ยงไม่ถูกต้อง');
  }

  try {
    const { data: owner, error } = await supabase
      .from('pet_owners')
      .select('*, users(email)')
      .eq('pet_owner_id', petOwnerId)
      .maybeSingle();

    if (error) throw error;
    if (!owner) return res.status(404).send('ไม่พบข้อมูลเจ้าของสัตว์เลี้ยง');

    res.render('Pets/Pet_Owner_Form', {
      user: req.session.user,
      activePage: 'Pet_Owners',
      owner: {
        ...owner,
        email: owner.users?.email || '',
      },
      old: {},
      errors: {},
      error: null,
      isAdmin: req.session.user.role === 'admin',
    });
  } catch (error) {
    console.error('Load PetOwner edit error:', error);
    res.status(500).send('ไม่สามารถโหลดข้อมูลเจ้าของสัตว์เลี้ยงได้');
  }
};
exports.updatePetOwner = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const petOwnerId = Number(req.params.id);
  let uploadedImage = null;
  let current = null;

  if (!Number.isSafeInteger(petOwnerId) || petOwnerId <= 0) {
    return res.status(400).send('รหัสเจ้าของสัตว์เลี้ยงไม่ถูกต้อง');
  }

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

  if (!old.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(old.email)) {
    errors.email = 'กรุณากรอกอีเมลให้ถูกต้อง';
  }
  if (!old.username) errors.username = 'กรุณากรอก Username';
  if (!old.first_name) errors.first_name = 'กรุณากรอกชื่อ';
  if (!old.last_name) errors.last_name = 'กรุณากรอกนามสกุล';

  const allowedGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
  if (old.gender && !allowedGenders.includes(old.gender)) {
    errors.gender = 'กรุณาเลือกเพศให้ถูกต้อง';
  }

  const renderForm = (owner, formErrors, message, status = 400) => {
    return res.status(status).render('Pets/Pet_Owner_Form', {
      user: req.session.user,
      activePage: 'Pet_Owners',
      owner,
      old,
      errors: formErrors,
      error: message,
      isAdmin: req.session.user.role === 'admin',
    });
  };

  try {
    const { data: found, error: findError } = await supabase
      .from('pet_owners')
      .select('*, users(email)')
      .eq('pet_owner_id', petOwnerId)
      .maybeSingle();

    if (findError) throw findError;
    if (!found) return res.status(404).send('ไม่พบข้อมูลเจ้าของสัตว์เลี้ยง');

    current = found;

    const owner = {
      ...current,
      ...old,
      email: old.email,
      profile_image_url: current.profile_image_url,
    };

    if (Object.keys(errors).length) {
      return renderForm(owner, errors, null);
    }

    if (req.file) {
      uploadedImage = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'Pet/PetProfile', resource_type: 'image' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          },
        );
        Readable.from(req.file.buffer).pipe(stream);
      });
    }

    const { error: userError } = await supabase
      .from('users')
      .update({ email: old.email })
      .eq('user_id', current.user_id);

    if (userError) throw userError;

    const updateData = {
      username: old.username,
      first_name: old.first_name,
      last_name: old.last_name,
      gender: old.gender || null,
      id_card: old.id_card || null,
      address_line: old.address_line || null,
      subdistrict: old.subdistrict || null,
      district: old.district || null,
      province: old.province || null,
      postal_code: old.postal_code || null,
    };

    if (uploadedImage) {
      updateData.profile_image_url = uploadedImage.secure_url;
      updateData.profile_image_public_id = uploadedImage.public_id;
    }

    if (req.session.user.role === 'admin') {
      updateData.verified = req.body.verified === 'true';
      updateData.verified_id_card = req.body.verified_id_card === 'true';
    }

    const { error: updateError } = await supabase
      .from('pet_owners')
      .update(updateData)
      .eq('pet_owner_id', petOwnerId);

    if (updateError) throw updateError;

    if (uploadedImage && current.profile_image_public_id) {
      await deleteCloudinaryImage(current.profile_image_public_id);
    }

    return res.redirect('/pet-owners?success=updated');
  } catch (error) {
    console.error('Update PetOwner error:', error);

    if (uploadedImage?.public_id) {
      await deleteCloudinaryImage(uploadedImage.public_id);
    }

    if (error.code === '23505') {
      const duplicateErrors = {};
      if (error.message?.includes('email')) {
        duplicateErrors.email = 'อีเมลนี้มีในระบบแล้ว';
      } else {
        duplicateErrors.username = 'Username นี้มีในระบบแล้ว';
      }

      return renderForm(
        {
          ...current,
          ...old,
          email: old.email,
          profile_image_url: current?.profile_image_url || null,
        },
        duplicateErrors,
        null,
      );
    }

    return res.status(400).render('Pets/Pet_Owner_Form', {
      user: req.session.user,
      activePage: 'Pet_Owners',
      owner: { ...current, ...old, email: old.email },
      old,
      errors: {},
      error:
        'ไม่สามารถแก้ไขข้อมูลเจ้าของสัตว์เลี้ยงได้ กรุณาตรวจสอบชื่อคอลัมน์ในฐานข้อมูล',
      isAdmin: req.session.user.role === 'admin',
    });
  }
};
