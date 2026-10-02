exports.showPets = (req, res) => {
    res.render('Pets/Pets', { user: req.session.user,activePage: 'Pets' });
};

exports.showPetOwners = (req, res) => {
    res.render('Pets/Pet_Owners', { user: req.session.user,activePage: 'Pet_Owners' });
};