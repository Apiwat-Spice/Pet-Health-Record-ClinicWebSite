const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_APP_PASSWORD
  }
});

async function sendOtp(email, otp) {
  return transporter.sendMail({
    from: `"WebClinic" <${process.env.MAIL_USER}>`,
    to: email,
    subject: 'รหัส OTP สำหรับเปลี่ยนรหัสผ่าน WebClinic',
    text: `รหัส OTP ของคุณคือ ${otp}\nรหัสนี้มีอายุ 5 นาที และห้ามเปิดเผยให้ผู้อื่นทราบ`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:12px">
        <h2 style="color:#315f85">WebClinic</h2>
        <p>รหัส OTP สำหรับยืนยันการเปลี่ยนรหัสผ่านของคุณคือ</p>
        <h1 style="letter-spacing:8px;color:#315f85">${otp}</h1>
        <p>รหัสนี้มีอายุ 5 นาที และใช้ได้ครั้งเดียว</p>
        <p style="color:#777">หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลนี้</p>
      </div>
    `
  });
}

async function sendMemberRemovedNotice(email, firstName, lastName, role) {
  const fullName = `${firstName} ${lastName}`;

  return transporter.sendMail({
    from: `"WebClinic" <${process.env.MAIL_USER}>`,
    to: email,
    subject: 'แจ้งเตือนการลบบัญชีสมาชิก WebClinic',
    text: `เรียน ${fullName}\n\nบัญชี WebClinic ของคุณในตำแหน่ง ${role} ถูกลบออกจากระบบโดยผู้ดูแลคลินิกแล้ว\n\nหากคุณมีข้อสงสัย กรุณาติดต่อคลินิกของคุณ\n\nWebClinic`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:12px">
        <h2 style="color:#315f85">WebClinic</h2>
        <p>เรียน ${fullName}</p>
        <p>ขอแจ้งให้ทราบว่าบัญชีสมาชิกของคุณถูกลบออกจากระบบแล้ว</p>
        <div style="background:#f8d7da;padding:16px;border-radius:8px;color:#842029">
          <strong>รายละเอียดบัญชีที่ถูกลบ</strong>
          <p class="mb-1">ชื่อ: ${fullName}</p>
          <p class="mb-1">ตำแหน่ง: ${role}</p>
          <p class="mb-0">อีเมล: ${email}</p>
        </div>
        <p style="margin-top:20px">หากคุณมีข้อสงสัย กรุณาติดต่อคลินิกของคุณ</p>
        <p style="color:#777">อีเมลฉบับนี้ส่งโดยระบบ WebClinic อัตโนมัติ</p>
      </div>
    `
  });
}

module.exports = { sendOtp, sendMemberRemovedNotice };