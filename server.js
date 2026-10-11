
const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./src/routes/authRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const petRoutes = require('./src/routes/petRoutes');
const appointmentRoutes = require('./src/routes/appointmentRoutes');
const visitRecordRoutes = require('./src/routes/visitRecordRoutes');

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
app.use('/', petRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/visit-records', visitRecordRoutes);
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
