
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

module.exports = { sendOtp };
