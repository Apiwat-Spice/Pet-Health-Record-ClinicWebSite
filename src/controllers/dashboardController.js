exports.showDashboard = (req, res) => {
    res.render('dashboard', {
        user: req.session.user,
        activePage: 'dashboard'
    });
};