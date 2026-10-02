exports.isAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

exports.isClinic = (req, res, next) => {
    if (req.session.user?.role !== 'clinic') {
        return res.status(403).send('Forbidden');
    }
    next();
};