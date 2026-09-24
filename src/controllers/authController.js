// แสดงหน้า Login
exports.showLogin = (req, res) => {
  res.render('login', {
    error: null
  });
};
// Login
exports.login = (req, res) => {
  const { email, password } = req.body;
  console.log('Login:', {
    email,
    password
  });
  // TODO: เชื่อม Supabase ตรวจสอบ User
  if (!email || !password) {
    return res.render('login', {
      error: 'กรุณากรอก Email และ Password'
    });
  }
  // Mockup
  res.send(`Login สำเร็จ: ${email}`);
};
// แสดงหน้า Register
exports.showRegister = (req, res) => {
  res.render('register', {
    error: null
  });
};
// Register
exports.register = (req, res) => {
  const {
    name,
    email,
    password,
    confirmPassword
  } = req.body;
  console.log('Register:', {
    name,
    email
  });
  if (!name || !email || !password || !confirmPassword) {
    return res.render('register', {
      error: 'กรุณากรอกข้อมูลให้ครบ'
    });
  }
  if (password !== confirmPassword) {
    return res.render('register', {
      error: 'Password และ Confirm Password ไม่ตรงกัน'
    });
  }
  // TODO: บันทึก User ลง Supabase
  res.send(`Register สำเร็จ: ${email}`);
};