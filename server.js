const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();
const authRoutes = require('./src/routes/authRoutes');
const app = express();
const PORT = process.env.PORT || 3000;
// ===============================
// Middleware
// ===============================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// ===============================
// Session
// ===============================
app.use(
    session({
        secret: process.env.JWT_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 // 1 วัน
        }
    })
);
// ===============================
// EJS
// ===============================
app.set('view engine', 'ejs');
app.set(
    'views',
    path.join(__dirname, 'src/view')
);
// ===============================
// Routes
// ===============================
app.use('/', authRoutes);
// ===============================
// Home
// ===============================
app.get('/', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.redirect('/dashboard');
});
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('dashboard', {
        user: req.session.user
    });
});
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Logout failed');
        }
        res.redirect('/login');
    });
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});