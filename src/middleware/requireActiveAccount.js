const supabase = require('../../config/supabase');

module.exports = async function requireActiveAccount(req, res, next) {
  try {
    const user = req.user || req.session?.user || req.session?.account;
    const userId = user?.user_id || user?.id;

    if (!userId) {
      return res.redirect('/login');
    }

    const { data: account, error } = await supabase
      .from('users')
      .select('user_id, status')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('requireActiveAccount:', error.message);
      return res.status(503).send('ไม่สามารถตรวจสอบสถานะบัญชีได้ กรุณาลองใหม่');
    }

    if (!account || account.status !== 'active') {
      if (req.session) {
        return req.session.destroy((sessionError) => {
          if (sessionError) {
            console.error('Session destroy:', sessionError.message);
          }
          res.clearCookie('connect.sid');
          return res.redirect('/login?error=account_disabled');
        });
      }

      return res.redirect('/login?error=account_disabled');
    }

    next();
  } catch (error) {
    console.error('requireActiveAccount:', error.message);
    return res.status(500).send('เกิดข้อผิดพลาดในการตรวจสอบบัญชี');
  }
};
