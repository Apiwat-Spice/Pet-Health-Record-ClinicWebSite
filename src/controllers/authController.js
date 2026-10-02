const bcrypt = require('bcrypt');
const supabase = require('../../config/supabase');
// แสดงหน้า Login
exports.showLogin = (req, res) => {
  res.render('login', {
    error: null
  });
};
// แสดงหน้า Register
exports.showRegister = (req, res) => {
  res.render('register', {
    error: null
  });
};
// Login
exports.login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.render('login', {
            error: 'กรุณากรอก Email และ Password'
        });
    }
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('user_id, role, email, password_hash, verified, status')
            .eq('email', email)
            .single();
        if (error || !user) {
            return res.render('login', {
                error: 'Email ไม่ถูกต้อง'
            });
        }
        if (user.status !== 'active') {
            return res.render('login', {
                error: 'บัญชีนี้ถูกปิดใช้งาน'
            });
        }
        if (!user.verified) {
            return res.render('login', {
                error: 'บัญชียังไม่ได้รับการยืนยัน'
            });
        }
        if (user.role !== 'vet' && user.role !== 'clinic' && user.role !== 'clinic_staff') {
            return res.render('login', {
                error: 'ระบบนี้เป็นระบบจัดการภายในสถานพยาบาลสัตว์เท่านั้น (ผู้ใช้งานทั่วไปใช้งานแอปพลิเคชัน Mobile)'
            });
        }
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.render('login', {
                error: 'Password ไม่ถูกต้อง'
            });
        }
        req.session.user = {
            user_id: user.user_id,
            email: user.email,
            role: user.role,
            verified: user.verified,
            status: user.status
        };
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('Login Error:', error);
        return res.render('login', {
            error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
        });
    }
};
// Register
exports.register = async (req, res) => {
    const { username, password, confirmPassword, firstname, lastname, birthdate, nationalId, phone, email } = req.body;
    if (!username || !password || !confirmPassword || !firstname || !lastname || !birthdate || !nationalId || !phone || !email) {
        return res.render('register', {
            error: 'กรุณากรอกข้อมูลให้ครบ'
        });
    }
    if (password !== confirmPassword) {
        return res.render('register', {
            error: 'Password และ Confirm Password ไม่ตรงกัน'
        });
    }
    if (password.length < 6) {
        return res.render('register', {
            error: 'Password ต้องมีอย่างน้อย 6 ตัวอักษร'
        });
    }
    if (!/^\d{13}$/.test(nationalId)) {
        return res.render('register', {
            error: 'เลขบัตรประชาชนต้องมี 13 หลัก'
        });
    }
    if (!/^\d{10}$/.test(phone)) {
        return res.render('register', {
            error: 'เบอร์โทรศัพท์ไม่ถูกต้อง'
        });
    }
    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('user_id, email')
            .eq('email', email)
            .maybeSingle();
        if (existingUser) {
            return res.render('register', {
                error: 'Email นี้ถูกใช้งานแล้ว'
            });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const { data: user, error: userError } = await supabase
            .from('users')
            .insert({
                role: 'vet',
                email: email,
                password_hash: passwordHash,
                verified: false,
                status: 'active'
            })
            .select('user_id, role, email, verified, status')
            .single();
        if (userError) {
            console.error('Register User Error:', userError);
            return res.render('register', {
                error: 'ไม่สามารถสร้างบัญชีได้'
            });
        }
        req.session.register = {
            user_id: user.user_id,
            username: username,
            firstname: firstname,
            lastname: lastname,
            birthdate: birthdate,
            nationalId: nationalId,
            phone: phone,
            email: email,
            role: 'vet',
            clinic_verified: false
        };
        return res.send('Register สำเร็จ รอ Email OTP');
    } catch (error) {
        console.error('Register Error:', error);
        return res.render('register', {
            error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
        });
    }
};