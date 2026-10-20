
const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./src/routes/authRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const petRoutes = require('./src/routes/petRoutes');
const appointmentRoutes = require('./src/routes/appointmentRoutes');
const visitRecordRoutes = require('./src/routes/visitRecordRoutes');
const memberRoutes = require('./src/routes/memberRoutes');
const ipdRoutes = require('./src/routes/ipdRoutes');
const stockRoutes = require('./src/routes/stockRoutes');
const receiptRoutes = require('./src/routes/receiptRoutes');
const settingRoutes = require('./src/routes/settingRoutes');

const requireActiveAccount = require('./src/middleware/requireActiveAccount');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(
    session({
        secret: process.env.JWT_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24
        }
    })
);

// Shared View Variables
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.activePage = '';
    next();
});

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/view'));

// Routes
app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/', requireActiveAccount, petRoutes);
app.use('/appointments', requireActiveAccount, appointmentRoutes);
app.use('/visit-records', requireActiveAccount, visitRecordRoutes);
app.use('/members', requireActiveAccount, memberRoutes);
app.use('/ipd', requireActiveAccount, ipdRoutes);
app.use('/stock', requireActiveAccount, stockRoutes);
app.use('/receipt', requireActiveAccount, receiptRoutes);
app.use('/settings', requireActiveAccount, settingRoutes);

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Logout failed');
        }
        res.redirect('/login');
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
