// @ts-nocheck
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const app = express();

const Database = require('better-sqlite3');
const db = new Database('./database.sqlite');
db.pragma('encoding = "UTF-8"');
db.pragma('case_sensitive_like = OFF');

// ============================================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ (ОДИН РАЗ!)
// ============================================================

// Таблица products (пластинки)
db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    artist TEXT,
    price REAL,
    image TEXT,
    audio TEXT,
    description TEXT,
    genre TEXT,
    year TEXT
)`);

// Таблица players (проигрыватели)
db.exec(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price REAL,
    image TEXT,
    description TEXT
)`);

// Таблица users (пользователи)
db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    avatar TEXT DEFAULT 'default-avatar.png',
    telegram_id INTEGER
)`);

// Таблица carts (корзина)
db.exec(`CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id TEXT,
    quantity INTEGER DEFAULT 1,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, product_id)
)`);

// Таблица favorites (избранное)
db.exec(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, product_id)
)`);

// Таблица site_settings (настройки сайта)
db.exec(`CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT
)`);

// Таблица для рейтинга с комментариями (ОДИН РАЗ с ВСЕМИ полями)
db.exec(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    admin_reply TEXT,
    admin_reply_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE(user_id, product_id)
)`);
console.log("⭐ Таблица рейтинга создана");

// Добавление настроек главной страницы по умолчанию
const homepageSetting = db.prepare("SELECT COUNT(*) as count FROM site_settings WHERE key = ?").get('homepage_products');
if (!homepageSetting || homepageSetting.count === 0) {
    db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)").run('homepage_products', 'last_added');
    console.log("⚙️ Добавлены настройки сайта");
}

// Добавление тестовых проигрывателей
const playersCount = db.prepare("SELECT COUNT(*) as count FROM players").get();
if (playersCount.count === 0) {
    const players = [
        ['Pro-Ject Debut Carbon', 499, 'proigrvatel1.png', 'Высококачественный проигрыватель винила'],
        ['Audio-Technica AT-LP120', 299, 'proigrvatel2.png', 'Профессиональный проигрыватель'],
        ['Rega Planar 3', 899, 'proigrvatel3.png', 'Легендарный британский проигрыватель']
    ];
    const stmt = db.prepare("INSERT INTO players (name, price, image, description) VALUES (?, ?, ?, ?)");
    for (const p of players) stmt.run(p);
    console.log("🎵 Добавлены тестовые проигрыватели");
}

// Добавление тестовых пластинок
const productsCount = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productsCount.count === 0) {
    const products = [
        ['Dark Side of the Moon', 'Pink Floyd', 35, 'dark-side.png', null, 'Легендарный альбом', 'Rock', '1973'],
        ['Abbey Road', 'The Beatles', 40, 'abbey-road.png', null, 'Последний записанный альбом', 'Rock', '1969'],
        ['Thriller', 'Michael Jackson', 45, 'thriller.png', null, 'Самый продаваемый альбом', 'Pop', '1982']
    ];
    const stmt = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const p of products) stmt.run(p);
    console.log("📀 Добавлены тестовые пластинки");
}

// Добавление дополнительных тестовых пластинок
if (productsCount.count < 8) {
    const extraProducts = [
        ['Kind of Blue', 'Miles Davis', 45, 'kind-of-blue.png', null, 'Классический джазовый альбом', 'Jazz', '1959'],
        ['Random Access Memories', 'Daft Punk', 38, 'ram.png', null, 'Электронный шедевр', 'Electronic', '2013'],
        ['The Wall', 'Pink Floyd', 42, 'the-wall.png', null, 'Рок-опера', 'Rock', '1979'],
        ['Back in Black', 'AC/DC', 35, 'back-in-black.png', null, 'Хард-рок', 'Rock', '1980']
    ];
    const stmt = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const p of extraProducts) stmt.run(p);
    console.log("📀 Добавлены дополнительные тестовые пластинки");
}

// Создание администратора
const usersCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
if (usersCount.count === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("admin", hash, "admin");
    console.log("👤 Создан пользователь admin с паролем admin123");
}

// ============================================================
// НАСТРОЙКИ MIDDLEWARE
// ============================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: process.env.SESSION_SECRET || "plastinka-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        secure: false, // для разработки ставим false
        sameSite: 'lax'
    }
}));

// ============================================================
// СОЗДАНИЕ ПАПОК
// ============================================================
const uploadDirs = ['public/uploads', 'public/audio', 'public/photo', 'public/avatars'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Создана папка: ${dir}`);
    }
});

// ============================================================
// НАСТРОЙКА MULTER
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === "image" || file.fieldname === "product_image") cb(null, "public/uploads/");
        else if (file.fieldname === "player_image") cb(null, "public/photo/");
        else if (file.fieldname === "avatar") cb(null, "public/avatars/");
        else cb(null, "public/audio/");
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ============================================================
// MIDDLEWARE ДЛЯ ЗАЩИТЫ
// ============================================================
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Требуется авторизация' });
        return res.redirect("/login");
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") {
        return res.status(403).send("Доступ запрещен");
    }
    next();
};

app.use((req, res, next) => {
    req.isMobile = /mobile|android|iphone|ipad|phone/i.test(req.headers['user-agent'] || '');
    next();
});

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// API ДЛЯ АВАТАРКИ И НАСТРОЕК
// ============================================================
app.post("/api/upload-avatar", requireAuth, upload.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    try {
        db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(req.file.filename, req.session.user.id);
        req.session.user.avatar = req.file.filename;
        res.json({ success: true, avatar: `/avatars/${req.file.filename}` });
    } catch (err) {
        res.status(500).json({ error: "Ошибка сохранения аватара" });
    }
});

app.post("/api/update-profile", requireAuth, express.json(), (req, res) => {
    const { username, currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;
    try {
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        
        if (username && username !== user.username) {
            const existing = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, userId);
            if (existing) return res.json({ success: false, error: "Имя пользователя уже занято" });
        }
        
        if (currentPassword && newPassword) {
            if (!bcrypt.compareSync(currentPassword, user.password)) {
                return res.json({ success: false, error: "Неверный текущий пароль" });
            }
            const hashedPassword = bcrypt.hashSync(newPassword, 10);
            db.prepare("UPDATE users SET username = ?, password = ? WHERE id = ?").run(username || user.username, hashedPassword, userId);
        } else {
            db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username || user.username, userId);
        }
        req.session.user.username = username || user.username;
        res.json({ success: true, username: req.session.user.username });
    } catch (err) {
        res.json({ success: false, error: "Ошибка обновления" });
    }
});

// ============================================================
// API ДЛЯ ИЗБРАННОГО
// ============================================================
app.get("/api/favorites/status/:productId", requireAuth, (req, res) => {
    try {
        const fav = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?").get(req.session.user.id, req.params.productId);
        res.json({ isFavorite: !!fav });
    } catch (err) {
        res.json({ isFavorite: false });
    }
});

app.get("/api/favorites/count", requireAuth, (req, res) => {
    try {
        const result = db.prepare("SELECT COUNT(*) as count FROM favorites WHERE user_id = ?").get(req.session.user.id);
        res.json({ count: result?.count || 0 });
    } catch (err) {
        res.json({ count: 0 });
    }
});

app.get("/api/favorites/list", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    try {
        const products = db.prepare(`
            SELECT f.*, p.name, p.artist, p.price, p.image, p.id as product_db_id
            FROM favorites f
            JOIN products p ON f.product_id = 'product_' || p.id
            WHERE f.user_id = ?
            ORDER BY f.added_at DESC
        `).all(userId);
        
        const players = db.prepare(`
            SELECT f.*, p.name, p.price, p.image, p.id as player_db_id
            FROM favorites f
            JOIN players p ON f.product_id = 'player_' || p.id
            WHERE f.user_id = ?
            ORDER BY f.added_at DESC
        `).all(userId);
        
        const allFavorites = [];
        for (const p of products) {
            allFavorites.push({
                id: p.product_db_id,
                type: 'product',
                name: p.name,
                artist: p.artist,
                price: p.price,
                image: p.image,
                added_at: p.added_at
            });
        }
        for (const p of players) {
            allFavorites.push({
                id: p.player_db_id,
                type: 'player',
                name: p.name,
                artist: 'Проигрыватель',
                price: p.price,
                image: p.image,
                added_at: p.added_at
            });
        }
        allFavorites.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
        res.json({ success: true, favorites: allFavorites });
    } catch (err) {
        console.error("Ошибка получения избранного:", err);
        res.json({ success: false, favorites: [] });
    }
});

app.post("/api/favorites/remove", requireAuth, (req, res) => {
    const { productId, type } = req.body;
    const fullProductId = type === 'product' ? `product_${productId}` : `player_${productId}`;
    try {
        db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(req.session.user.id, fullProductId);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: "Ошибка удаления" });
    }
});

app.post("/api/favorites/toggle", requireAuth, express.json(), (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    if (!id) return res.status(400).json({ error: "ID товара не указан" });
    try {
        const fav = db.prepare("SELECT * FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, id);
        if (fav) {
            db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(userId, id);
            res.json({ success: true, action: "removed" });
        } else {
            db.prepare("INSERT INTO favorites (user_id, product_id) VALUES (?, ?)").run(userId, id);
            res.json({ success: true, action: "added" });
        }
    } catch (err) {
        res.status(500).json({ error: "Ошибка базы данных" });
    }
});

// ============================================================
// API ДЛЯ КОРЗИНЫ
// ============================================================
app.post("/api/cart/add", requireAuth, (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    if (!id) return res.status(400).json({ error: "ID товара не указан" });
    try {
        const existing = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, id);
        if (existing) {
            db.prepare("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?").run(userId, id);
        } else {
            db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)").run(userId, id);
        }
        res.json({ success: true, message: "Товар добавлен в корзину" });
    } catch (err) {
        res.status(500).json({ error: "Ошибка базы данных" });
    }
});

app.post("/api/cart/update", requireAuth, (req, res) => {
    const { product_id, action } = req.body;
    const userId = req.session.user.id;
    try {
        const cartItem = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, product_id);
        if (!cartItem) return res.status(404).json({ error: "Товар не найден" });
        
        let newQuantity = cartItem.quantity;
        if (action === 'increase') newQuantity++;
        else if (action === 'decrease') newQuantity--;
        
        if (newQuantity <= 0) {
            db.prepare("DELETE FROM carts WHERE user_id = ? AND product_id = ?").run(userId, product_id);
        } else {
            db.prepare("UPDATE carts SET quantity = ? WHERE user_id = ? AND product_id = ?").run(newQuantity, userId, product_id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Ошибка обновления" });
    }
});

app.post("/api/cart/remove", requireAuth, (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    try {
        db.prepare("DELETE FROM carts WHERE user_id = ? AND product_id = ?").run(userId, product_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Ошибка удаления" });
    }
});

app.post("/add-to-cart", requireAuth, (req, res) => {
    const productId = req.body.id;
    if (!productId) return res.redirect("/catalog?error=1");
    try {
        const existing = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(req.session.user.id, productId);
        if (existing) {
            db.prepare("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?").run(req.session.user.id, productId);
        } else {
            db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)").run(req.session.user.id, productId);
        }
        res.redirect(req.headers.referer || "/catalog");
    } catch (err) {
        res.redirect("/catalog?error=1");
    }
});

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================
app.get("/login", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Вход · Plastinka</title><style>
body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px}
.login-container{max-width:400px;width:100%;padding:40px;background:#181818;border-radius:16px;text-align:center}
.login-container img{width:200px;margin-bottom:30px}
.login-container h1{color:white;margin-bottom:10px}
.subtitle{color:#888;margin-bottom:30px}
.form-group{margin-bottom:20px;text-align:left}
.form-group label{display:block;margin-bottom:8px;color:#aaa}
.form-group input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#111;color:#fff}
.login-btn{width:100%;padding:14px;background:linear-gradient(45deg,#ff0000,#990000);color:#fff;border:none;border-radius:10px;cursor:pointer}
.register-link{margin-top:20px;color:#aaa}
.register-link a{color:#ff0000;text-decoration:none}
.error-message{background:rgba(255,0,0,0.1);border:1px solid #ff0000;color:#ff0000;padding:10px;border-radius:8px;margin-bottom:20px}
</style></head>
<body>
<div class="login-container">
    <img src="/photo/logo.svg">
    <h1>Добро пожаловать</h1>
    <div class="subtitle">Войдите в свой аккаунт</div>
    ${req.query.error ? '<div class="error-message">❌ Неверное имя пользователя или пароль</div>' : ''}
    ${req.query.registered ? '<div class="error-message" style="background:rgba(0,255,0,0.1);border-color:#00ff00;color:#00ff00;">✅ Регистрация успешна!</div>' : ''}
    <form action="/login" method="POST">
        <div class="form-group"><label>Имя пользователя</label><input type="text" name="username" required></div>
        <div class="form-group"><label>Пароль</label><input type="password" name="password" required></div>
        <button type="submit" class="login-btn">Войти</button>
    </form>
    <div class="register-link">Нет аккаунта? <a href="/register">Зарегистрироваться</a></div>
    <a href="/" style="display:block;margin-top:20px;color:#666;">← Вернуться на главную</a>
</div>
</body></html>`);
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    try {
        const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, role: user.role, avatar: user.avatar };
            return res.redirect("/");
        }
        res.redirect("/login?error=1");
    } catch (err) {
        res.redirect("/login?error=1");
    }
});

app.get("/register", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Регистрация · Plastinka</title><style>
body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px}
.register-container{max-width:400px;width:100%;padding:40px;background:#181818;border-radius:16px;text-align:center}
.register-container img{width:200px;margin-bottom:30px}
.register-container h1{color:white;margin-bottom:10px}
.subtitle{color:#888;margin-bottom:30px}
.form-group{margin-bottom:20px;text-align:left}
.form-group label{display:block;margin-bottom:8px;color:#aaa}
.form-group input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#111;color:#fff}
.register-btn{width:100%;padding:14px;background:linear-gradient(45deg,#ff0000,#990000);color:#fff;border:none;border-radius:10px;cursor:pointer}
.login-link{margin-top:20px;color:#aaa}
.login-link a{color:#ff0000;text-decoration:none}
.error-message{background:rgba(255,0,0,0.1);border:1px solid #ff0000;color:#ff0000;padding:10px;border-radius:8px;margin-bottom:20px}
</style></head>
<body>
<div class="register-container">
    <img src="/photo/logo.svg">
    <h1>Создать аккаунт</h1>
    <div class="subtitle">Присоединяйтесь к Plastinka</div>
    ${req.query.error === 'exists' ? '<div class="error-message">❌ Пользователь с таким именем уже существует</div>' : ''}
    <form action="/register" method="POST">
        <div class="form-group"><label>Имя пользователя</label><input type="text" name="username" required></div>
        <div class="form-group"><label>Пароль</label><input type="password" name="password" required></div>
        <button type="submit" class="register-btn">Зарегистрироваться</button>
    </form>
    <div class="login-link">Уже есть аккаунт? <a href="/login">Войти</a></div>
    <a href="/" style="display:block;margin-top:20px;color:#666;">← Вернуться на главную</a>
</div>
</body></html>`);
});

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    try {
        const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
        if (existing) return res.redirect("/register?error=exists");
        const hash = bcrypt.hashSync(password, 10);
        db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(username, hash, "user");
        res.redirect("/login?registered=1");
    } catch (err) {
        res.redirect("/register?error=exists");
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// ============================================================
// ПРОФИЛЬ
// ============================================================
app.get("/profile", requireAuth, (req, res) => {
    const user = req.session.user;
    try {
        const userData = db.prepare("SELECT avatar FROM users WHERE id = ?").get(user.id);
        const avatar = userData ? userData.avatar : 'default-avatar.png';
        const favs = db.prepare("SELECT COUNT(*) as favs FROM favorites WHERE user_id = ?").get(user.id);
        const favCount = favs ? favs.favs : 0;
        
        res.send(`
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Мой профиль · Plastinka</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f0f;color:#fff;font-family:Arial,sans-serif}
header{position:sticky;top:0;background:#0a0a0a;padding:15px 5%;display:flex;justify-content:space-between;align-items:center}
.logo img{height:50px}
.right-icons{display:flex;gap:20px}
.right-icons a{color:#fff;text-decoration:none}
.right-icons img{height:40px}
.profile-wrapper{max-width:1000px;margin:40px auto;padding:0 20px}
.profile-card{background:#1a1a1a;border-radius:20px;overflow:hidden}
.profile-cover{height:120px;background:linear-gradient(135deg,#ff0000,#990000)}
.profile-avatar-wrapper{text-align:center;margin-top:-60px}
.profile-avatar{width:120px;height:120px;border-radius:50%;border:4px solid #1a1a1a;object-fit:cover}
.profile-name{text-align:center;font-size:28px;margin-top:10px}
.profile-role{text-align:center;color:#ff4444;margin-top:5px}
.profile-stats{display:flex;justify-content:center;gap:40px;padding:20px;background:#222;margin:20px;border-radius:15px}
.stat{text-align:center}
.stat-value{font-size:28px;font-weight:bold;color:#ff4444}
.stat-label{color:#888;font-size:12px}
.profile-menu{margin:20px}
.menu-item{display:flex;align-items:center;gap:15px;padding:15px;background:#222;border-radius:12px;margin-bottom:10px;cursor:pointer}
.menu-item:hover{background:#ff000020}
.admin-panel-btn,.logout-btn{display:block;margin:15px 20px;padding:15px;text-align:center;border-radius:12px;text-decoration:none}
.admin-panel-btn{background:linear-gradient(45deg,#ff0000,#990000);color:white}
.logout-btn{background:#333;color:#ff4444;border:1px solid #ff4444}
.modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:1000;justify-content:center;align-items:center}
.modal-content{background:#1e1e1e;border-radius:20px;padding:30px;max-width:500px;width:90%;position:relative;border:1px solid #ff7a2f}
.modal-close{position:absolute;top:15px;right:15px;background:rgba(255,0,0,0.1);border:none;color:#fff;font-size:30px;cursor:pointer;width:40px;height:40px;border-radius:50%}
.modal-close:hover{background:#ff0000}
.favorite-item{display:flex;align-items:center;gap:15px;padding:12px;background:#222;border-radius:12px;margin-bottom:10px}
.toast-notification{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#4CAF50;color:white;padding:10px 20px;border-radius:8px;z-index:10000;animation:fadeOut 2s forwards}
@keyframes fadeOut{0%{opacity:1}70%{opacity:1}100%{opacity:0;visibility:hidden}}
</style>
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg"></a></div>
    <div class="right-icons">
        <a href="/catalog"><img src="/photo/icon-katalog.png"></a>
        <a href="/profile"><img src="/photo/profile_icon.png"></a>
        <a href="/cart"><img src="/photo/knopka-korzina.svg"></a>
    </div>
</header>

<div class="profile-wrapper">
    <div class="profile-card">
        <div class="profile-cover"></div>
        <div class="profile-avatar-wrapper">
            <img src="/avatars/${avatar}" class="profile-avatar" id="profileAvatar" onclick="openAvatarModal()" onerror="this.src='/avatars/default-avatar.png'">
        </div>
        <h2 class="profile-name">${escapeHtml(user.username)}</h2>
        <div class="profile-role">${user.role === 'admin' ? 'Администратор' : 'Меломан'}</div>
        <div class="profile-stats">
            <div class="stat"><div class="stat-value">0</div><div class="stat-label">Заказов</div></div>
            <div class="stat"><div class="stat-value" id="favCount">${favCount}</div><div class="stat-label">Избранное</div></div>
        </div>
        <div class="profile-menu">
            <div class="menu-item" onclick="openSettingsModal()"><i class="fas fa-user-edit"></i><span>Настройки аккаунта</span><i class="fas fa-chevron-right"></i></div>
            <div class="menu-item" onclick="openFavoritesModal()"><i class="fas fa-heart"></i><span>Избранное</span><i class="fas fa-chevron-right"></i></div>
        </div>
        ${user.role === 'admin' ? '<a href="/admin" class="admin-panel-btn"><i class="fas fa-crown"></i> Админ панель</a>' : ''}
        <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Выйти</a>
    </div>
</div>

<div id="avatarModal" class="modal-overlay">
    <div class="modal-content" style="text-align:center">
        <button class="modal-close" onclick="closeAvatarModal()">&times;</button>
        <h3 style="color:#ff7a2f">📸 Изменить аватар</h3>
        <div style="width:150px;height:150px;margin:20px auto;border-radius:50%;overflow:hidden;border:3px solid #ff7a2f">
            <img src="/avatars/${avatar}" id="avatarPreview" style="width:100%;height:100%;object-fit:cover">
        </div>
        <input type="file" id="avatarFileInput" accept="image/*" style="display:none">
        <button onclick="document.getElementById('avatarFileInput').click()" style="background:rgba(255,122,47,0.2);border:1px solid #ff7a2f;color:#ff7a2f;padding:10px 20px;border-radius:8px;cursor:pointer;width:100%">📁 Выбрать изображение</button>
        <p id="avatarUploadMessage" style="margin-top:10px"></p>
    </div>
</div>

<div id="settingsModal" class="modal-overlay">
    <div class="modal-content">
        <button class="modal-close" onclick="closeSettingsModal()">&times;</button>
        <h3 style="color:#ff7a2f">⚙️ Настройки</h3>
        <form id="settingsForm">
            <div class="form-group" style="margin-bottom:15px">
                <label style="color:#aaa">Имя пользователя</label>
                <input type="text" id="settingsUsername" value="${escapeHtml(user.username)}" style="width:100%;padding:10px;background:#111;border:1px solid #333;color:#fff;border-radius:8px">
            </div>
            <div class="form-group" style="margin-bottom:15px">
                <label style="color:#aaa">Текущий пароль</label>
                <input type="password" id="settingsCurrentPassword" placeholder="Для смены пароля" style="width:100%;padding:10px;background:#111;border:1px solid #333;color:#fff;border-radius:8px">
            </div>
            <div class="form-group" style="margin-bottom:15px">
                <label style="color:#aaa">Новый пароль</label>
                <input type="password" id="settingsNewPassword" placeholder="Новый пароль" style="width:100%;padding:10px;background:#111;border:1px solid #333;color:#fff;border-radius:8px">
            </div>
            <button type="submit" style="width:100%;padding:12px;background:linear-gradient(45deg,#ff0000,#990000);border:none;border-radius:8px;color:white;cursor:pointer">Сохранить</button>
        </form>
        <p id="settingsMessage" style="margin-top:15px;text-align:center"></p>
    </div>
</div>

<div id="favoritesModal" class="modal-overlay">
    <div class="modal-content" style="max-width:600px;max-height:80vh;overflow-y:auto">
        <button class="modal-close" onclick="closeFavoritesModal()">&times;</button>
        <h3 style="color:#ff7a2f"><i class="fas fa-heart"></i> Избранное</h3>
        <div id="favoritesList">Загрузка...</div>
    </div>
</div>

<script>
async function openAvatarModal() {
    document.getElementById('avatarModal').style.display = 'flex';
    document.getElementById('avatarUploadMessage').innerHTML = '';
}

function closeAvatarModal() {
    document.getElementById('avatarModal').style.display = 'none';
    document.getElementById('avatarFileInput').value = '';
}

document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    try {
        const res = await fetch('/api/upload-avatar', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            document.getElementById('profileAvatar').src = data.avatar + '?t=' + Date.now();
            document.getElementById('avatarPreview').src = data.avatar + '?t=' + Date.now();
            document.getElementById('avatarUploadMessage').innerHTML = '<span style="color:#4CAF50;">✅ Аватар обновлен!</span>';
            setTimeout(closeAvatarModal, 1500);
        } else {
            document.getElementById('avatarUploadMessage').innerHTML = '<span style="color:#ff4444;">❌ Ошибка</span>';
        }
    } catch(err) {
        document.getElementById('avatarUploadMessage').innerHTML = '<span style="color:#ff4444;">❌ Ошибка</span>';
    }
});

function openSettingsModal() { document.getElementById('settingsModal').style.display = 'flex'; }
function closeSettingsModal() { document.getElementById('settingsModal').style.display = 'none'; }

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('settingsUsername').value;
    const currentPassword = document.getElementById('settingsCurrentPassword').value;
    const newPassword = document.getElementById('settingsNewPassword').value;
    const res = await fetch('/api/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, currentPassword, newPassword })
    });
    const data = await res.json();
    if (data.success) {
        document.getElementById('settingsMessage').innerHTML = '<span style="color:#4CAF50;">✅ Сохранено!</span>';
        setTimeout(() => { closeSettingsModal(); location.reload(); }, 1500);
    } else {
        document.getElementById('settingsMessage').innerHTML = '<span style="color:#ff4444;">❌ ' + data.error + '</span>';
    }
});

function openFavoritesModal() {
    document.getElementById('favoritesModal').style.display = 'flex';
    loadFavoritesList();
}
function closeFavoritesModal() { document.getElementById('favoritesModal').style.display = 'none'; }

async function loadFavoritesList() {
    const container = document.getElementById('favoritesList');
    try {
        const res = await fetch('/api/favorites/list');
        const data = await res.json();
        if (!data.success || data.favorites.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#666"><i class="fas fa-heart-broken" style="font-size:40px"></i><br>Нет избранных товаров<br><a href="/catalog" style="color:#ff7a2f">Перейти в каталог →</a></div>';
            return;
        }
        let html = '';
        for (const item of data.favorites) {
            const imgPath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image;
            html += '<div class="favorite-item">' +
                '<img src="' + imgPath + '" style="width:60px;height:60px;object-fit:cover;border-radius:8px" onerror="this.src=\'/photo/plastinka-audio.png\'">' +
                '<div style="flex:1"><div><strong>' + escapeHtml(item.name) + '</strong></div><div style="color:#aaa">' + escapeHtml(item.artist) + '</div><div style="color:#ff7a2f">$' + item.price + '</div></div>' +
                '<button onclick="removeFromFav(' + item.id + ', \'' + item.type + '\')" style="background:#ff444420;border:none;color:#ff4444;padding:8px 12px;border-radius:8px;cursor:pointer"><i class="fas fa-trash"></i></button>' +
                '</div>';
        }
        container.innerHTML = html;
    } catch(err) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ff4444">❌ Ошибка загрузки</div>';
    }
}

async function removeFromFav(productId, type) {
    const res = await fetch('/api/favorites/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, type })
    });
    const data = await res.json();
    if (data.success) {
        showToast('Удалено из избранного');
        loadFavoritesList();
        updateFavCount();
    } else {
        showToast('Ошибка удаления', true);
    }
}

async function updateFavCount() {
    const res = await fetch('/api/favorites/count');
    const data = await res.json();
    const favSpan = document.getElementById('favCount');
    if (favSpan) favSpan.textContent = data.count;
}

function showToast(msg, isError) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.background = isError ? '#f44336' : '#4CAF50';
    toast.innerHTML = (isError ? '❌ ' : '✅ ') + msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
</script>
</body>
</html>
        `);
    } catch (err) {
        console.error("Ошибка профиля:", err);
        res.status(500).send("Ошибка загрузки профиля");
    }
});

// ============================================================
// КОРЗИНА
// ============================================================
app.get("/cart", requireAuth, (req, res) => {
    const user = req.session.user;
    try {
        const cartItems = db.prepare("SELECT * FROM carts WHERE user_id = ?").all(user.id);
        
        if (cartItems.length === 0) {
            res.send(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Корзина · Plastinka</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f0f;color:#fff;font-family:Arial,sans-serif}
header{position:sticky;top:0;background:#0a0a0a;padding:15px 5%;display:flex;justify-content:space-between;align-items:center}
.logo img{height:50px}
.right-icons{display:flex;gap:20px}
.right-icons a{color:#fff;text-decoration:none}
.right-icons img{height:40px}
.empty-cart{text-align:center;padding:100px 20px}
.empty-cart-icon{font-size:80px;margin-bottom:20px}
.empty-cart h2{margin-bottom:10px}
.empty-cart-btn{display:inline-block;background:linear-gradient(45deg,#ff0000,#990000);color:white;padding:12px 30px;border-radius:30px;text-decoration:none;margin-top:20px}
</style>
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg"></a></div>
    <div class="right-icons">
        <a href="/catalog"><img src="/photo/icon-katalog.png"></a>
        <a href="/profile"><img src="/photo/profile_icon.png"></a>
        <a href="/cart"><img src="/photo/knopka-korzina.svg"></a>
    </div>
</header>
<div class="empty-cart">
    <div class="empty-cart-icon">🛒</div>
    <h2>Корзина пуста</h2>
    <p>Добавьте товары из каталога</p>
    <a href="/catalog" class="empty-cart-btn">Перейти в каталог</a>
</div>
</body></html>
            `);
            return;
        }
        
        let items = [];
        let totalPrice = 0;
        
        for (const item of cartItems) {
            const parts = item.product_id.split('_');
            const type = parts[0];
            const id = parts[1];
            
            if (type === 'player') {
                const player = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
                if (player) {
                    items.push({ ...item, type: 'player', name: player.name, artist: 'Проигрыватель', price: player.price, image: player.image });
                    totalPrice += player.price * item.quantity;
                }
            } else {
                const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
                if (product) {
                    items.push({ ...item, type: 'product', name: product.name, artist: product.artist, price: product.price, image: product.image });
                    totalPrice += product.price * item.quantity;
                }
            }
        }
        
        let itemsHtml = '';
        for (const item of items) {
            const imgPath = item.type === 'player' ? `/photo/${item.image}` : `/uploads/${item.image}`;
            itemsHtml += `
                <div style="display:flex;align-items:center;gap:15px;background:#1a1a1a;padding:15px;border-radius:12px;margin-bottom:10px">
                    <img src="${imgPath}" style="width:80px;height:80px;object-fit:cover;border-radius:8px" onerror="this.src='/photo/plastinka-audio.png'">
                    <div style="flex:1">
                        <div><strong>${escapeHtml(item.name)}</strong></div>
                        <div style="color:#aaa">${escapeHtml(item.artist)}</div>
                        <div style="color:#ff7a2f">$${item.price}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px">
                        <button onclick="updateQty('${item.product_id}', 'decrease')" style="width:30px;height:30px;border-radius:50%;background:#333;border:none;color:#fff;cursor:pointer">-</button>
                        <span>${item.quantity}</span>
                        <button onclick="updateQty('${item.product_id}', 'increase')" style="width:30px;height:30px;border-radius:50%;background:#333;border:none;color:#fff;cursor:pointer">+</button>
                    </div>
                    <button onclick="removeItem('${item.product_id}')" style="background:#ff444420;border:none;color:#ff4444;padding:8px;border-radius:8px;cursor:pointer"><i class="fas fa-trash"></i></button>
                </div>
            `;
        }
        
        res.send(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Корзина · Plastinka</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f0f;color:#fff;font-family:Arial,sans-serif}
header{position:sticky;top:0;background:#0a0a0a;padding:15px 5%;display:flex;justify-content:space-between;align-items:center}
.logo img{height:50px}
.right-icons{display:flex;gap:20px}
.right-icons a{color:#fff;text-decoration:none}
.right-icons img{height:40px}
.cart-container{max-width:800px;margin:40px auto;padding:0 20px}
.cart-title{font-size:28px;margin-bottom:20px}
.cart-items{margin-bottom:20px}
.cart-total{background:#1a1a1a;padding:20px;border-radius:12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.total-price{font-size:28px;color:#ff7a2f}
.checkout-btn{width:100%;padding:15px;background:linear-gradient(45deg,#ff0000,#990000);border:none;border-radius:12px;color:white;font-size:18px;cursor:pointer}
</style>
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg"></a></div>
    <div class="right-icons">
        <a href="/catalog"><img src="/photo/icon-katalog.png"></a>
        <a href="/profile"><img src="/photo/profile_icon.png"></a>
        <a href="/cart"><img src="/photo/knopka-korzina.svg"></a>
    </div>
</header>
<div class="cart-container">
    <h1 class="cart-title">Корзина</h1>
    <div class="cart-items">${itemsHtml}</div>
    <div class="cart-total">
        <span>Итого:</span>
        <span class="total-price">$${totalPrice}</span>
    </div>
    <button class="checkout-btn" onclick="checkout()">Оформить заказ</button>
</div>
<script>
async function updateQty(id, action) {
    const res = await fetch('/api/cart/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: id, action })
    });
    if (res.ok) location.reload();
}

async function removeItem(id) {
    if (!confirm('Удалить товар?')) return;
    const res = await fetch('/api/cart/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: id })
    });
    if (res.ok) location.reload();
}

async function checkout() {
    if (confirm('Подтвердите заказ')) {
        alert('✅ Заказ оформлен! Спасибо за покупку!');
        // Очистка корзины после заказа
        const items = document.querySelectorAll('.cart-items > div');
        for (const item of items) {
            const btn = item.querySelector('button:last-child');
            if (btn) btn.click();
        }
        setTimeout(() => { window.location.href = '/'; }, 500);
    }
}
</script>
</body></html>
        `);
    } catch (err) {
        console.error("Ошибка корзины:", err);
        res.status(500).send("Ошибка загрузки корзины");
    }
});

// ============================================================
// ===================== ГЛАВНАЯ СТРАНИЦА =====================
// ============================================================

function generateStarRatingHTML(rating, votesCount) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let starsHtml = '';
    
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) {
            starsHtml += '<i class="fas fa-star star filled"></i>';
        } else if (i === fullStars + 1 && hasHalfStar) {
            starsHtml += '<i class="fas fa-star-half-alt star filled"></i>';
        } else {
            starsHtml += '<i class="far fa-star star"></i>';
        }
    }
    
    return `<div class="rating-stars">${starsHtml}<span class="rating-value">${rating}</span><span class="votes-count">(${votesCount})</span></div>`;
}

app.get("/", (req, res) => {
    const user = req.session.user;
    const showNotification = req.query.added === '1';
    
    try {
        const setting = db.prepare("SELECT value FROM site_settings WHERE key = 'homepage_products'").get();
        const homepageMode = setting ? setting.value : 'last_added';
        
        let productsQuery = "SELECT * FROM products";
        switch(homepageMode) {
            case 'popular':
                productsQuery = "SELECT * FROM products ORDER BY id DESC LIMIT 6";
                break;
            case 'all':
                productsQuery = "SELECT * FROM products LIMIT 12";
                break;
            default:
                productsQuery = "SELECT * FROM products ORDER BY id DESC LIMIT 6";
        }
        
        let products = db.prepare(productsQuery).all();
        
        for (const product of products) {
            const rating = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(product.id);
            product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
            product.votes_count = rating?.votes_count || 0;
        }
        
        const players = db.prepare("SELECT * FROM players").all();
        
        if (req.isMobile) {
            let content = `
                <h2 class="section-title">Новинки</h2>
                <div class="products-grid">
            `;
            for (const product of products) {
                content += `
                    <div class="product-card" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name)}" data-product-artist="${escapeHtml(product.artist)}" data-product-price="${product.price}" data-product-image="/uploads/${product.image}" data-product-description="${escapeHtml(product.description || 'Нет описания')}" data-product-genre="${escapeHtml(product.genre || 'Rock')}" data-product-year="${escapeHtml(product.year || '1970')}" data-product-audio="${product.audio || ''}">
                        <div class="product-image">
                            <img src="/uploads/${product.image}" alt="${escapeHtml(product.name)}">
                            <div class="vinyl-overlay">
                                <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                            </div>
                        </div>
                        <div class="product-info">
                            <div class="product-name">${escapeHtml(product.name)}</div>
                            <div class="product-artist">${escapeHtml(product.artist)}</div>
                            <div class="rating-stars" data-product-id="${product.id}" data-rating="${product.avg_rating}">
                                ${generateStarRatingHTML(product.avg_rating, product.votes_count)}
                            </div>
                            <div class="product-price">$${product.price}</div>
                            <div class="product-actions">
                                <button class="action-btn" onclick="event.stopPropagation(); addToCartMobile('product_${product.id}')">
                                    <i class="fas fa-shopping-cart"></i>
                                </button>
                                <button class="action-btn" onclick="event.stopPropagation(); toggleFavoriteMobile('product_${product.id}')">
                                    <i class="fas fa-heart"></i>
                                </button>
                            </div>
                        </div>
                    </div>`;
            }
            content += `</div>`;
            if (!user) content += `<div class="auth-prompt"><p>Войдите, чтобы добавлять товары в избранное и корзину</p><a href="/login" class="auth-btn">Войти</a></div>`;
            
            content += `
                <div id="productModal" class="modal-overlay" style="display:none;">
                    <div class="modal-content">
                        <button class="modal-close" onclick="closeProductModal()">&times;</button>
                        <img src="" alt="Пластинка" class="modal-player-image" id="productModalImage">
                        <h2 class="modal-title" id="productModalTitle"></h2>
                        <p class="modal-artist" id="productModalArtist"></p>
                        <div class="modal-tags" id="productModalTags"></div>
                        <div class="rating-section" id="modalRatingSection">
                            <div class="rating-label">Средняя оценка:</div>
                            <div class="rating-stars-large" id="modalRatingStars"></div>
                            <div class="rating-votes" id="modalRatingVotes"></div>
                        </div>
                        <div class="comments-list" id="modalCommentsList"></div>
                        <p class="modal-description" id="productModalDescription"></p>
                        <div class="modal-price" id="productModalPrice"></div>
                        <div class="modal-actions">
                            <button onclick="addToCartFromModal()" class="modal-add-to-cart" style="flex:1;">В корзину</button>
                            <button onclick="toggleFavoriteFromModal()" class="modal-fav-btn"><i class="fas fa-heart"></i></button>
                        </div>
                        <button onclick="openReviewModal()" class="modal-review-btn" id="modalReviewBtn">✍️ Оставить отзыв</button>
                        <div id="productModalAudio" style="display:none;"></div>
                        <button onclick="playModalPreview()" class="modal-play-btn" id="productModalPlayBtn" style="display:none;"><i class="fas fa-play"></i> Прослушать</button>
                    </div>
                </div>
                <div id="reviewModal" class="modal-overlay" style="display:none;">
                    <div class="modal-content review-modal-content">
                        <button class="modal-close" onclick="closeReviewModal()">&times;</button>
                        <h3 class="review-title">⭐ Оцените пластинку</h3>
                        <div class="review-stars" id="reviewStars">
                            <i class="far fa-star" data-rating="1"></i>
                            <i class="far fa-star" data-rating="2"></i>
                            <i class="far fa-star" data-rating="3"></i>
                            <i class="far fa-star" data-rating="4"></i>
                            <i class="far fa-star" data-rating="5"></i>
                        </div>
                        <textarea id="reviewComment" placeholder="Напишите ваш отзыв (необязательно)..." rows="4"></textarea>
                        <button onclick="submitReview()" class="submit-review-btn">Отправить отзыв</button>
                        <p id="reviewAuthMessage" style="display:none; color:#ff7a2f; margin-top:12px;">🔒 <a href="/login" style="color:#ff7a2f;">Войдите в аккаунт</a>, чтобы оставить отзыв</p>
                    </div>
                </div>
                
                <script>
                let currentModalProductId = null;
                let currentModalProductRealId = null;
                let currentSelectedRating = null;
                
                function closeProductModal() {
                    document.getElementById('productModal').style.display = 'none';
                    document.getElementById('modalCommentSection').style.display = 'none';
                }
                
                function openReviewModal() {
                    const isLoggedIn = ${!!req.session.user};
                    if (!isLoggedIn) {
                        document.getElementById('reviewAuthMessage').style.display = 'block';
                        return;
                    }
                    document.getElementById('reviewModal').style.display = 'flex';
                }
                
                function closeReviewModal() {
                    document.getElementById('reviewModal').style.display = 'none';
                    document.getElementById('reviewComment').value = '';
                    document.querySelectorAll('#reviewStars i').forEach(star => {
                        star.className = 'far fa-star';
                    });
                }
                
                document.querySelectorAll('#reviewStars i').forEach(star => {
                    star.addEventListener('click', function() {
                        const rating = this.dataset.rating;
                        document.querySelectorAll('#reviewStars i').forEach((s, idx) => {
                            if (idx < rating) {
                                s.className = 'fas fa-star';
                            } else {
                                s.className = 'far fa-star';
                            }
                        });
                        window.selectedReviewRating = rating;
                    });
                });
                
                async function submitReview() {
                    const isLoggedIn = ${!!req.session.user};
                    if (!isLoggedIn) {
                        alert('Войдите в аккаунт, чтобы оставить отзыв');
                        return;
                    }
                    
                    const rating = window.selectedReviewRating;
                    const comment = document.getElementById('reviewComment').value;
                    const productId = currentModalProductRealId;
                    
                    if (!rating) {
                        alert('Выберите оценку');
                        return;
                    }
                    
                    const response = await fetch('/api/rating/' + productId, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rating: parseInt(rating), comment: comment || '' })
                    });
                    const data = await response.json();
                    
                    if (data.success) {
                        alert('Спасибо за отзыв!');
                        closeReviewModal();
                        // Обновляем звезды в модалке
                        const starsContainer = document.getElementById('modalRatingStars');
                        if (starsContainer && data.avg_rating) {
                            renderStarsInModalMobile('modalRatingStars', parseFloat(data.avg_rating), productId);
                            document.getElementById('modalRatingVotes').textContent = '(' + data.votes_count + ' оценок)';
                        }
                        // Обновляем комментарии
                        if (data.comments) {
                            renderCommentsMobile(data.comments, 'modalCommentsList');
                        }
                        // Обновляем звезды на карточке товара
                        const cardStars = document.querySelector('.rating-stars[data-product-id="' + productId + '"]');
                        if (cardStars && data.avg_rating) {
                            updateCardRatingMobile(cardStars, parseFloat(data.avg_rating), data.votes_count);
                        }
                    } else {
                        alert('Ошибка при сохранении оценки');
                    }
                }
                
                function renderStarsInModalMobile(containerId, rating, productId) {
                    const container = document.getElementById(containerId);
                    if (!container) return;
                    
                    let starsHtml = '';
                    const fullStars = Math.floor(rating);
                    const hasHalfStar = rating % 1 >= 0.5;
                    
                    for (let i = 1; i <= 5; i++) {
                        if (i <= fullStars) {
                            starsHtml += '<i class="fas fa-star star filled" data-value="' + i + '"></i>';
                        } else if (i === fullStars + 1 && hasHalfStar) {
                            starsHtml += '<i class="fas fa-star-half-alt star filled" data-value="' + i + '"></i>';
                        } else {
                            starsHtml += '<i class="far fa-star star" data-value="' + i + '"></i>';
                        }
                    }
                    container.innerHTML = starsHtml;
                }
                
                function renderCommentsMobile(comments, containerId) {
                    const container = document.getElementById(containerId);
                    if (!container) return;
                    
                    if (!comments || comments.length === 0) {
                        container.innerHTML = '<div class="no-comments">📝 Пока нет комментариев. Будьте первым!</div>';
                        return;
                    }
                    
                    let html = '';
                    for (let i = 0; i < comments.length; i++) {
                        const c = comments[i];
                        let stars = '';
                        for (let s = 1; s <= 5; s++) {
                            if (s <= c.rating) {
                                stars += '<i class="fas fa-star" style="color:#ff7a2f; font-size:10px;"></i>';
                            } else {
                                stars += '<i class="far fa-star" style="color:#555; font-size:10px;"></i>';
                            }
                        }
                        html += '<div class="comment-item">' +
                            '<div class="comment-header">' +
                            '<span class="comment-user">' + escapeHtml(c.username) + '</span>' +
                            '<span class="comment-date">' + new Date(c.created_at).toLocaleDateString() + '</span>' +
                            '</div>' +
                            '<div><span class="comment-rating">' + stars + '</span></div>' +
                            '<div class="comment-text">' + escapeHtml(c.comment) + '</div>' +
                            '</div>';
                    }
                    container.innerHTML = html;
                }
                
                function updateCardRatingMobile(container, rating, votesCount) {
                    let starsHtml = '';
                    const fullStars = Math.floor(rating);
                    const hasHalfStar = rating % 1 >= 0.5;
                    for (let i = 1; i <= 5; i++) {
                        if (i <= fullStars) {
                            starsHtml += '<i class="fas fa-star star filled"></i>';
                        } else if (i === fullStars + 1 && hasHalfStar) {
                            starsHtml += '<i class="fas fa-star-half-alt star filled"></i>';
                        } else {
                            starsHtml += '<i class="far fa-star star"></i>';
                        }
                    }
                    starsHtml += '<span class="rating-value">' + rating + '</span>';
                    starsHtml += '<span class="votes-count">(' + votesCount + ')</span>';
                    container.innerHTML = starsHtml;
                    container.dataset.rating = rating;
                }
                
                document.querySelectorAll('.product-card').forEach(card => {
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.action-btn')) return;
                        currentModalProductRealId = card.dataset.productId;
                        currentModalProductId = 'product_' + card.dataset.productId;
                        document.getElementById('productModalImage').src = card.dataset.productImage;
                        document.getElementById('productModalTitle').textContent = card.dataset.productName;
                        document.getElementById('productModalArtist').textContent = card.dataset.productArtist;
                        document.getElementById('productModalTags').innerHTML = '<span class="modal-tag">' + card.dataset.productGenre + '</span><span class="modal-tag">' + card.dataset.productYear + '</span>';
                        document.getElementById('productModalDescription').textContent = card.dataset.productDescription;
                        document.getElementById('productModalPrice').innerHTML = card.dataset.productPrice + ' <span>$</span>';
                        
                        if (card.dataset.productAudio && card.dataset.productAudio !== '') {
                            document.getElementById('productModalPlayBtn').style.display = 'flex';
                        } else {
                            document.getElementById('productModalPlayBtn').style.display = 'none';
                        }
                        
                        fetch('/api/rating/' + card.dataset.productId)
                            .then(r => r.json())
                            .then(data => {
                                renderStarsInModalMobile('modalRatingStars', parseFloat(data.avg_rating), card.dataset.productId);
                                document.getElementById('modalRatingVotes').textContent = '(' + data.votes_count + ' оценок)';
                                renderCommentsMobile(data.comments, 'modalCommentsList');
                            });
                        
                        fetch('/api/favorites/check/' + currentModalProductId)
                            .then(r => r.json())
                            .then(data => {
                                const favBtn = document.querySelector('#productModal .modal-fav-btn');
                                if (data.isFavorite) {
                                    favBtn.style.color = '#ff0000';
                                    favBtn.style.background = 'rgba(255, 0, 0, 0.2)';
                                } else {
                                    favBtn.style.color = '#fff';
                                    favBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                                }
                            });
                        
                        document.getElementById('productModal').style.display = 'flex';
                    });
                });
                
                function addToCartFromModal() {
                    if (currentModalProductId) {
                        fetch('/api/cart/add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: currentModalProductId })
                        }).then(() => {
                            showToastMobile('Товар добавлен в корзину', false);
                            closeProductModal();
                        });
                    }
                }
                
                function toggleFavoriteFromModal() {
                    if (currentModalProductId) {
                        fetch('/api/favorites/toggle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: currentModalProductId })
                        }).then(() => {
                            const favBtn = document.querySelector('#productModal .modal-fav-btn');
                            if (favBtn.style.color === 'rgb(255, 0, 0)') {
                                favBtn.style.color = '#fff';
                                favBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                                showToastMobile('Удалено из избранного', false);
                            } else {
                                favBtn.style.color = '#ff0000';
                                favBtn.style.background = 'rgba(255, 0, 0, 0.2)';
                                showToastMobile('Добавлено в избранное', false);
                            }
                        });
                    }
                }
                
                function playModalPreview() {
                    const audioFile = currentModalProductRealId;
                    if (audioFile) {
                        const audio = new Audio('/audio/' + audioFile);
                        audio.play();
                    }
                }
                
                function showToastMobile(message, isError) {
                    const toast = document.createElement('div');
                    toast.className = 'toast-notification';
                    toast.innerHTML = '<div style="display:flex;align-items:center;gap:8px">' + 
                        '<span>' + (isError ? '❌' : '✅') + '</span>' + 
                        '<span>' + message + '</span>' + 
                        '</div>';
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }
                
                function escapeHtml(str) {
                    if (!str) return '';
                    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                }
                </script>
            `;
            res.send(renderMobilePage('Главная', content, user, 'home', showNotification));
        } else {
            let productHTML = "";
            for (const product of products) {
                productHTML += `
<div class="benefit" 
     data-product-id="${product.id}"
     data-product-name="${escapeHtml(product.name)}"
     data-product-artist="${escapeHtml(product.artist)}"
     data-product-price="${product.price}"
     data-product-image="/uploads/${product.image}"
     data-product-description="${escapeHtml(product.description || 'Нет описания')}"
     data-product-genre="${escapeHtml(product.genre || 'Rock')}"
     data-product-year="${escapeHtml(product.year || '1970')}">
    <div class="image-container">
        <img src="/uploads/${product.image}" class="graf">
        <img src="/photo/plastinka-audio.png" class="plastinka">
        ${product.audio ? `<audio class="album-audio" src="/audio/${product.audio}" preload="auto"></audio>` : ""}
    </div>
    <div class="benefit-info">
        <div class="album-nazv-container">
            <span class="album-nazv">${escapeHtml(product.name)}</span>
        </div>
        <div class="album-title-container">
            <span class="album-title">${escapeHtml(product.artist)}</span>
        </div>
        <div class="rating-stars" data-product-id="${product.id}" data-rating="${product.avg_rating}">
            ${generateStarRatingHTML(product.avg_rating, product.votes_count)}
        </div>
        <div class="album-bottom">
            <span class="album-price">${product.price}$</span>
            <form action="/add-to-cart" method="POST" class="add-to-cart-form">
                <input type="hidden" name="id" value="product_${product.id}">
                <button type="submit" class="add-to-cart">
                    <img src="/photo/b_plus.svg" class="cart-icon">
                </button>
            </form>
        </div>
    </div>
</div>`;
            }

            let carouselItems = "";
            for (let i = 0; i < 20; i++) {
                for (const player of players) {
                    carouselItems += `
                        <div class="card" 
                             data-player-id="${player.id}"
                             data-name="${escapeHtml(player.name)}"
                             data-price="${player.price}"
                             data-image="/photo/${player.image}"
                             data-description="${escapeHtml(player.description || 'Высококачественный проигрыватель винила')}">
                            <div class="circle orange"></div>
                            <img src="/photo/${player.image}" alt="${player.name}" class="player-image">
                            <button class="view-btn">Смотреть</button>
                        </div>`;
                }
            }

            res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Plastinka</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
@import url('https://fonts.googleapis.com/css2?family=Rubik+Mono+One&display=swap');

.rating-stars {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
}
.rating-stars .star {
    font-size: 16px;
    transition: all 0.2s ease;
    color: #444;
}
.rating-stars .star.filled {
    color: #ff7a2f;
}
.rating-stars .rating-value {
    font-size: 12px;
    color: #ff7a2f;
    margin-left: 6px;
    font-weight: bold;
}
.rating-stars .votes-count {
    font-size: 10px;
    color: #666;
    margin-left: 4px;
}

.rating-stars-large {
    display: inline-flex;
    gap: 10px;
    margin: 10px 0;
}
.rating-stars-large .star {
    font-size: 28px;
    transition: all 0.2s ease;
    color: #444;
}
.rating-stars-large .star.filled {
    color: #ff7a2f;
}
.rating-section {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: 15px 0;
    padding: 10px;
    background: rgba(255,122,47,0.1);
    border-radius: 12px;
}
.rating-label {
    font-size: 14px;
    color: #ff7a2f;
    font-weight: bold;
}
.rating-votes {
    font-size: 12px;
    color: #888;
}
.comments-list {
    margin: 15px 0;
    padding: 10px;
    background: rgba(0,0,0,0.3);
    border-radius: 12px;
    max-height: 200px;
    overflow-y: auto;
}
.comment-item {
    padding: 10px;
    border-bottom: 1px solid #333;
    margin-bottom: 8px;
}
.comment-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
    font-size: 12px;
}
.comment-user {
    color: #ff7a2f;
    font-weight: bold;
}
.comment-date {
    color: #666;
}
.comment-rating {
    color: #ff7a2f;
    font-size: 12px;
    margin-right: 10px;
}
.comment-text {
    font-size: 13px;
    color: #ccc;
    line-height: 1.4;
}
.no-comments {
    text-align: center;
    color: #666;
    padding: 10px;
    font-size: 12px;
}

.notification {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #4CAF50, #45a049);
    color: white;
    padding: 14px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 12px;
    transform: translateX(400px);
    animation: slideInRight 0.3s forwards, slideOutRight 0.3s 2.7s forwards;
    border-left: 4px solid #fff;
}
@keyframes slideInRight {
    to { transform: translateX(0); }
}
@keyframes slideOutRight {
    to { transform: translateX(400px); }
}

@keyframes rotate {
from { transform: rotate(0deg); }
to { transform: rotate(360deg); }
}
.image-container { position: relative; cursor: pointer; aspect-ratio: 1; overflow: hidden; }
.image-container .graf { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease; }
.image-container .plastinka { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.3s ease; animation: rotate 5s linear infinite; animation-play-state: paused; }
.image-container:hover .graf { transform: translateX(50%); }
.image-container:hover .plastinka { opacity: 1; animation-play-state: running; }

header {
    position: sticky;
    top: 0;
    z-index: 1000;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 5%;
    background: #0a0a0a;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    min-height: 80px;
}

.logo {
    flex-shrink: 0;
    width: auto;
    z-index: 2;
}
.logo img {
    height: 50px;
    width: auto;
    display: block;
}

.search-bar-desktop {
    position: absolute;
    left: 40%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 500px;
    min-width: 250px;
    background: #1a1a1a;
    border-radius: 40px;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid #333;
    transition: border-color 0.2s;
    z-index: 1;
}

.search-bar-desktop:hover,
.search-bar-desktop:focus-within {
    border-color: #ff0000;
    background: #111;
}

.search-bar-desktop i {
    color: #ff0000;
    font-size: 18px;
}

.search-bar-desktop input {
    flex: 1;
    background: transparent;
    border: none;
    color: white;
    font-size: 16px;
    outline: none;
}

.search-bar-desktop input::placeholder {
    color: #888;
}

.search-dropdown {
    display: none;
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    right: 0;
    background: #1a1a1a;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    z-index: 1000;
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid #333;
}

.search-dropdown.show {
    display: block;
}

.search-result-item-dropdown {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid #333;
    cursor: pointer;
    transition: background 0.2s;
}

.search-result-item-dropdown:hover {
    background: #252525;
}

.search-result-image {
    width: 50px;
    height: 50px;
    object-fit: cover;
    border-radius: 8px;
}

.search-result-info {
    flex: 1;
}

.search-result-name {
    font-weight: bold;
    font-size: 14px;
    color: white;
}

.search-result-artist {
    font-size: 12px;
    color: #888;
}

.search-result-price {
    color: #ff0000;
    font-weight: bold;
    font-size: 14px;
}

.search-result-actions {
    display: flex;
    gap: 8px;
}

.search-cart-btn, .search-detail-btn {
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
}

.search-cart-btn {
    background: linear-gradient(45deg, #ff0000, #990000);
    color: white;
}

.search-detail-btn {
    background: #333;
    color: white;
}

.search-cart-btn:hover, .search-detail-btn:hover {
    transform: translateY(-1px);
    opacity: 0.9;
}

.search-no-results {
    padding: 20px;
    text-align: center;
    color: #888;
}

.search-catalog-btn {
    width: 100%;
    padding: 12px;
    background: linear-gradient(45deg, #ff0000, #640000);
    color: white;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
    transition: all 0.2s;
}

.search-catalog-btn:hover {
    background: linear-gradient(45deg, #670000, #c80000);
    transform: translateY(-2px);
}

.right-icons {
    display: flex;
    gap: 20px;
    align-items: center;
    flex-shrink: 0;
    margin-left: auto;
    z-index: 2;
}

.right-icons a {
    display: flex;
    align-items: center;
    transition: all 0.25s ease;
    line-height: 0;
}

.right-icons a:hover {
    transform: scale(1.1);
    filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.5));
}

.right-icons img {
    height: 40px;
    width: auto;
    display: block;
}

@media (max-width: 700px) {
    header { padding: 10px 4%; }
    .logo img { height: 40px; }
    .search-bar-desktop { max-width: 350px; }
    .right-icons { gap: 15px; }
    .right-icons img { height: 36px; }
}
@media (max-width: 550px) {
    header { justify-content: center; }
    .search-bar-desktop { flex: 1 1 100%; max-width: 100%; order: 1; margin: 5px 0; }
    .right-icons { justify-content: center; }
}
@media (max-width: 480px) {
    .logo img { height: 36px; }
    .right-icons img { height: 34px; }
    .right-icons { gap: 12px; }
}

.player-carousel, .player-carousel2 { width: 100%; overflow: hidden; background: #1e1e1e; padding: 60px 0; position: relative; }
.player-carousel .carousel-track { display: flex; gap: 40px; width: max-content; animation: scrollLeft 60s linear infinite; will-change: transform; align-items: center; }
.player-carousel2 .carousel-track2 { display: flex; gap: 40px; width: max-content; animation: scrollRight 60s linear infinite; will-change: transform; align-items: center; }
.player-carousel:hover .carousel-track, .player-carousel2:hover .carousel-track2 { animation-play-state: paused; }
@keyframes scrollLeft { 0% { transform: translateX(0); } 100% { transform: translateX(calc(-50%)); } }
@keyframes scrollRight { 0% { transform: translateX(-50%); } 100% { transform: translateX(0); } }
.player-carousel .card, .player-carousel2 .card { position: relative; width: 280px; height: 350px; background: transparent; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform 0.3s ease; cursor: pointer; }
.player-carousel .card:hover, .player-carousel2 .card:hover { transform: translateY(-10px); z-index: 10; }
.player-carousel .circle, .player-carousel2 .circle { position: absolute; width: 260px; height: 260px; border-radius: 50%; transition: transform 0.4s ease; }
.player-carousel .card:hover .circle, .player-carousel2 .card:hover .circle { transform: scale(1.1); }
.player-carousel .orange, .player-carousel2 .orange { background: #ff7a2f; }
.player-carousel .player-image, .player-carousel2 .player-image { position: relative; width: 240px; height: auto; z-index: 2; pointer-events: none; object-fit: contain; transition: transform 0.3s ease; }
.player-carousel .view-btn, .player-carousel2 .view-btn { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(20px); background: linear-gradient(45deg, #D74307, #ff6b2b); color: white; border: none; border-radius: 30px; padding: 10px 25px; font-size: 14px; font-weight: bold; cursor: pointer; opacity: 0; visibility: hidden; transition: all 0.3s ease; z-index: 10; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 5px 15px rgba(215, 67, 7, 0.3); white-space: nowrap; }
.player-carousel .card:hover .view-btn, .player-carousel2 .card:hover .view-btn { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }
.player-carousel::before, .player-carousel::after, .player-carousel2::before, .player-carousel2::after { content: ''; position: absolute; top: 0; width: 150px; height: 100%; z-index: 10; pointer-events: none; }
.player-carousel::before, .player-carousel2::before { left: 0; background: linear-gradient(90deg, #1e1e1e 0%, transparent 100%); }
.player-carousel::after, .player-carousel2::after { right: 0; background: linear-gradient(-90deg, #1e1e1e 0%, transparent 100%); }

.modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(5px); z-index: 1000; justify-content: center; align-items: center; }
.modal-overlay.active { display: flex; }
.modal-content { background: linear-gradient(145deg, #2a2a2a, #1e1e1e); border-radius: 20px; padding: 30px; max-width: 380px; width: 90%; position: relative; border: 1px solid #ff7a2f; box-shadow: 0 20px 40px rgba(255, 122, 47, 0.2); animation: modalAppear 0.3s ease; max-height: 85vh; overflow-y: auto; }
.modal-content::-webkit-scrollbar { width: 6px; }
.modal-content::-webkit-scrollbar-track { background: #1a1a1a; border-radius: 10px; }
.modal-content::-webkit-scrollbar-thumb { background: #ff7a2f; border-radius: 10px; }
.modal-content::-webkit-scrollbar-thumb:hover { background: #ff0000; }
@keyframes modalAppear { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
.modal-close { position: absolute; top: 15px; right: 15px; background: none; border: none; color: #fff; font-size: 30px; cursor: pointer; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(255, 0, 0, 0.1); transition: 0.3s; }
.modal-close:hover { background: #ff0000; transform: rotate(90deg); }
.modal-player-image { width: 100%; max-height: 300px; object-fit: contain; margin-bottom: 20px; border-radius: 12px; }
.modal-title { font-size: 24px; color: #ff7a2f; margin-bottom: 10px; font-weight: bold; }
.modal-description { color: #ccc; line-height: 1.6; margin-bottom: 20px; font-size: 14px; }
.modal-price { font-size: 28px; color: #fff; font-weight: bold; margin-bottom: 25px; }
.modal-price span { color: #ff7a2f; font-size: 18px; }
.modal-add-to-cart { width: 100%; padding: 12px; background: linear-gradient(45deg, #ff7a2f, #ff0000); border: none; border-radius: 10px; color: white; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }

.catalog-title a { color: inherit; text-decoration: none; transition: 0.3s; }
.catalog-title a:hover { color: #ff0000; }

.modal-artist { color: #aaa; font-size: 16px; margin-bottom: 15px; }
.modal-tags { display: flex; gap: 10px; margin-bottom: 20px; }
.modal-tag { background: rgba(255, 122, 47, 0.2); padding: 5px 12px; border-radius: 20px; font-size: 12px; color: #ff7a2f; }
.modal-actions { display: flex; gap: 15px; margin-bottom: 15px; }
.modal-fav-btn { width: 50px; background: rgba(255, 255, 255, 0.1); border: 1px solid #ff0000; border-radius: 10px; color: #ff0000; font-size: 20px; cursor: pointer; transition: 0.3s; }
.modal-fav-btn:hover { background: #ff0000; color: white; }
.modal-play-btn { width: 100%; padding: 10px; background: rgba(255, 255, 255, 0.1); border: 1px solid #ff7a2f; border-radius: 10px; color: #ff7a2f; font-size: 14px; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 8px; }
.benefit { cursor: pointer; }
.modal-review-btn { width: 100%; margin: 10px 0; padding: 10px; background: rgba(255,122,47,0.2); border: 1px solid #ff7a2f; border-radius: 10px; color: #ff7a2f; font-size: 14px; cursor: pointer; transition: 0.3s; }

@media (max-width: 768px) {
    .player-carousel .card, .player-carousel2 .card { width: 220px; height: 280px; }
    .player-carousel .circle, .player-carousel2 .circle { width: 200px; height: 200px; }
    .player-carousel .player-image, .player-carousel2 .player-image { width: 180px; }
    .player-carousel .carousel-track, .player-carousel2 .carousel-track2 { gap: 30px; }
    .player-carousel::before, .player-carousel::after, .player-carousel2::before, .player-carousel2::after { width: 80px; }
    .modal-content { padding: 20px; }
    .modal-title { font-size: 22px; }
    .modal-price { font-size: 24px; }
    .rating-stars-large .star { font-size: 22px; }
}
@media (max-width: 480px) {
    .player-carousel .card, .player-carousel2 .card { width: 180px; height: 230px; }
    .player-carousel .circle, .player-carousel2 .circle { width: 160px; height: 160px; }
    .player-carousel .player-image, .player-carousel2 .player-image { width: 140px; }
    .player-carousel .carousel-track, .player-carousel2 .carousel-track2 { gap: 20px; }
    .player-carousel .view-btn, .player-carousel2 .view-btn { padding: 6px 15px; font-size: 12px; bottom: 10px; }
    .player-carousel::before, .player-carousel::after, .player-carousel2::before, .player-carousel2::after { width: 50px; }
}
</style>
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg" alt="Plastinka"></a></div>
    <div class="search-bar-desktop" style="position: relative;">
        <i class="fas fa-search"></i>
        <input type="text" id="desktop-search-input" placeholder="Поиск пластинок..." autocomplete="off">
        <div id="search-dropdown" class="search-dropdown"></div>
    </div>
    <div class="right-icons">
        <a href="/catalog" class="catalog-btn">
            <img src="/photo/icon-katalog.png" alt="Каталог">
        </a>
        <a href="/profile" class="profile-btn">
            <img src="/photo/profile_icon.png" alt="Профиль">
        </a>
        <a href="/cart" class="cart-btn">
            <img src="/photo/knopka-korzina.svg" alt="Корзина">
        </a>
    </div>
</header>
<section class="hero"></section>
<section class="catalog-title-section"><h2 class="catalog-title"><a href="/catalog">КАТАЛОГ</a></h2></section>
<section class="benefits"><div class="benefits-grid">${productHTML || '<p style="text-align: center; color: #aaa; grid-column: 1/-1;">Товаров пока нет</p>'}</div></section>
<section class="catalog-title-section"><h2 class="catalog-title">ПРОИГРЫВАТЕЛИ</h2></section>
<section class="player-carousel"><div class="carousel-track">${carouselItems || '<p style="color: white; padding: 20px;">Проигрывателей пока нет</p>'}</div></section>
<section class="player-carousel2"><div class="carousel-track2">${carouselItems || '<p style="color: white; padding: 20px;">Проигрывателей пока нет</p>'}</div></section>
<div class="modal-overlay" id="playerModal"><div class="modal-content"><button class="modal-close" id="closeModal">&times;</button><img src="" alt="Проигрыватель" class="modal-player-image" id="modalImage"><h2 class="modal-title" id="modalTitle"></h2><p class="modal-description" id="modalDescription"></p><div class="modal-price" id="modalPrice"></div><form id="addToCartForm" method="POST" action="/add-to-cart"><input type="hidden" name="id" id="modalProductId" value=""><button type="submit" class="modal-add-to-cart" id="modalAddToCart">Добавить в корзину</button></form></div></div>
<div class="modal-overlay" id="productModalDesktop"><div class="modal-content"><button class="modal-close" id="closeProductModalDesktop">&times;</button><img src="" alt="Пластинка" class="modal-player-image" id="productModalImageDesktop"><h2 class="modal-title" id="productModalTitleDesktop"></h2><p class="modal-artist" id="productModalArtistDesktop"></p><div class="modal-tags" id="productModalTagsDesktop"></div><div class="rating-section" id="modalRatingSectionDesktop"><div class="rating-label">Средняя оценка:</div><div class="rating-stars-large" id="modalRatingStarsDesktop"></div><div class="rating-votes" id="modalRatingVotesDesktop"></div></div><div class="comment-section" id="modalCommentSectionDesktop" style="display:none;"><textarea id="modalCommentDesktop" placeholder="Напишите свой отзыв..." rows="3" style="width:100%; background:#111; border:1px solid #333; color:white; border-radius:8px; padding:10px; margin:10px 0;"></textarea><button onclick="submitRatingWithCommentDesktop()" class="submit-rating-btn" style="background:linear-gradient(45deg,#ff7a2f,#ff0000); border:none; color:white; padding:8px 16px; border-radius:8px; cursor:pointer;">Отправить оценку</button></div><div class="comments-list" id="modalCommentsListDesktop"></div><p class="modal-description" id="productModalDescriptionDesktop"></p><div class="modal-price" id="productModalPriceDesktop"></div><div class="modal-actions"><button onclick="addToCartFromModalDesktop()" class="modal-add-to-cart" style="flex:1;" id="productModalAddToCartDesktop"><i class="fas fa-shopping-cart"></i> В корзину</button><button onclick="toggleFavoriteFromModalDesktop()" class="modal-fav-btn" id="productModalFavBtnDesktop"><i class="fas fa-heart"></i></button></div><div id="productModalAudioDesktop" style="display:none;"></div><button onclick="playModalPreviewDesktop()" class="modal-play-btn" id="productModalPlayBtnDesktop" style="display:none;"><i class="fas fa-play"></i> Прослушать</button></div></div>
<section class="kurt"><div class="red-block"></div><div class="image-block left"><img src="/photo/left.png" alt="left"></div><div class="image-block right"><img src="/photo/right.png" alt="right"></div></section>
<section class="catalog-title-section2"><h3 class="catalog-title2">Для тех, для кого музыка <br> стала жизнью</h3></section>
<section class="music-section"><img src="/photo/figura.svg" class="figura" alt="figura"><div class="images-container"><img src="/photo/image 6.png" class="image" alt="image1"><img src="/photo/image 2.png" class="image" alt="image2"><img src="/photo/image 3.png" class="image" alt="image3"><img src="/photo/image 4.png" class="image" alt="image4"><img src="/photo/image 5.png" class="image" alt="image5"><img src="/photo/image 6.png" class="image" alt="image6"></div></section>
<footer><img src="/photo/logo-2.svg" class="footer-logo" alt="Plastinka"></footer>

<script>
let currentPlayingAudio = null;
let currentPlayingPlastinka = null;
let currentProductId = null;
let searchTimeout = null;
let currentModalProductId = null;
let currentSelectedRating = null;

function showToast(message, isError) {
    const toast = document.createElement('div');
    toast.className = 'notification';
    toast.innerHTML = '<div class="notification-icon">' + (isError ? '❌' : '✅') + '</div>' +
        '<div class="notification-content">' +
        '<span class="notification-title">' + (isError ? 'Ошибка' : 'Успешно') + '</span>' +
        '<span class="notification-message">' + message + '</span>' +
        '</div><div class="notification-progress"></div>';
    document.body.appendChild(toast);
    setTimeout(function() { if (toast && toast.remove) toast.remove(); }, 3000);
}

function renderComments(comments, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!comments || comments.length === 0) {
        container.innerHTML = '<div class="no-comments">📝 Пока нет комментариев. Будьте первым!</div>';
        return;
    }
    let html = '';
    for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        var stars = '';
        for (var s = 1; s <= 5; s++) {
            if (s <= c.rating) stars += '<i class="fas fa-star" style="color:#ff7a2f; font-size:10px;"></i>';
            else stars += '<i class="far fa-star" style="color:#555; font-size:10px;"></i>';
        }
        html += '<div class="comment-item"><div class="comment-header"><span class="comment-user">' + escapeHtml(c.username) + '</span><span class="comment-date">' + new Date(c.created_at).toLocaleDateString() + '</span></div><div><span class="comment-rating">' + stars + '</span></div><div class="comment-text">' + escapeHtml(c.comment) + '</div></div>';
    }
    container.innerHTML = html;
}

function renderStarsInModal(containerId, rating, productId, isLarge) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let starsHtml = '';
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) starsHtml += '<i class="fas fa-star star filled" data-value="' + i + '"></i>';
        else if (i === fullStars + 1 && hasHalfStar) starsHtml += '<i class="fas fa-star-half-alt star filled" data-value="' + i + '"></i>';
        else starsHtml += '<i class="far fa-star star" data-value="' + i + '"></i>';
    }
    container.innerHTML = starsHtml;
    const isLoggedIn = ${!!req.session.user};
    if (isLoggedIn) {
        const stars = container.querySelectorAll('.star');
        for (var j = 0; j < stars.length; j++) {
            var star = stars[j];
            star.style.cursor = 'pointer';
            star.addEventListener('mouseenter', function() {
                var value = parseInt(this.dataset.value);
                for (var k = 0; k < stars.length; k++) {
                    if (k < value) stars[k].classList.add('hover');
                    else stars[k].classList.remove('hover');
                }
            });
            star.addEventListener('mouseleave', function() {
                for (var k = 0; k < stars.length; k++) stars[k].classList.remove('hover');
            });
            star.addEventListener('click', function() {
                var value = parseInt(this.dataset.value);
                var commentSection = document.getElementById('modalCommentSectionDesktop');
                if (commentSection) commentSection.style.display = 'block';
                currentSelectedRating = value;
                for (var k = 0; k < stars.length; k++) {
                    if (k < value) stars[k].classList.add('filled');
                    else stars[k].classList.remove('filled');
                }
            });
        }
    }
}

function updateCardRating(container, rating) {
    var stars = container.querySelectorAll('.star');
    var fullStars = Math.floor(rating);
    var hasHalfStar = rating % 1 >= 0.5;
    for (var i = 0; i < stars.length; i++) {
        if (i < fullStars) stars[i].classList.add('filled');
        else if (i === fullStars && hasHalfStar) stars[i].classList.add('filled');
        else stars[i].classList.remove('filled');
    }
    var ratingValue = container.querySelector('.rating-value');
    if (ratingValue) ratingValue.textContent = rating;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function openProductModal(id, name, artist, price, image, description, genre, year, audio) {
    currentProductId = 'product_' + id;
    currentModalProductId = id;
    document.getElementById('productModalImageDesktop').src = image;
    document.getElementById('productModalTitleDesktop').textContent = name;
    document.getElementById('productModalArtistDesktop').textContent = artist;
    document.getElementById('productModalTagsDesktop').innerHTML = '<span class="modal-tag">' + genre + '</span><span class="modal-tag">' + year + '</span>';
    document.getElementById('productModalDescriptionDesktop').textContent = description;
    document.getElementById('productModalPriceDesktop').innerHTML = price + ' <span>$</span>';
    
    fetch('/api/rating/' + id).then(function(response) { return response.json(); }).then(function(data) {
        renderStarsInModal('modalRatingStarsDesktop', parseFloat(data.avg_rating), id, true);
        var votesSpan = document.getElementById('modalRatingVotesDesktop');
        if (votesSpan) votesSpan.textContent = '(' + data.votes_count + ' оценок)';
        renderComments(data.comments, 'modalCommentsListDesktop');
    });
    
    if (audio) {
        document.getElementById('productModalAudioDesktop').innerHTML = audio;
        document.getElementById('productModalPlayBtnDesktop').style.display = 'flex';
    } else {
        document.getElementById('productModalAudioDesktop').innerHTML = '';
        document.getElementById('productModalPlayBtnDesktop').style.display = 'none';
    }
    
    document.getElementById('modalCommentSectionDesktop').style.display = 'none';
    document.getElementById('modalCommentDesktop').value = '';
    currentSelectedRating = null;
    document.getElementById('productModalDesktop').classList.add('active');
    
    var track = document.querySelector('.player-carousel .carousel-track');
    var track2 = document.querySelector('.player-carousel2 .carousel-track2');
    if (track) track.style.animationPlayState = 'paused';
    if (track2) track2.style.animationPlayState = 'paused';
    updateFavoriteStatusDesktop(id);
}

function openPlayerModal(id, name, price, image, description) {
    document.getElementById('modalImage').src = image;
    document.getElementById('modalTitle').textContent = name;
    document.getElementById('modalDescription').textContent = description;
    document.getElementById('modalPrice').innerHTML = price + ' <span>$</span>';
    document.getElementById('modalProductId').value = 'player_' + id;
    document.getElementById('playerModal').classList.add('active');
    var track = document.querySelector('.player-carousel .carousel-track');
    var track2 = document.querySelector('.player-carousel2 .carousel-track2');
    if (track) track.style.animationPlayState = 'paused';
    if (track2) track2.style.animationPlayState = 'paused';
}

function performSearch(query) {
    var searchDropdown = document.getElementById('search-dropdown');
    if (!searchDropdown) return;
    if (query.length < 1) {
        searchDropdown.innerHTML = '';
        searchDropdown.classList.remove('show');
        return;
    }
    searchDropdown.innerHTML = '<div class="search-no-results">🔍 Поиск...</div>';
    searchDropdown.classList.add('show');
    fetch('/api/search?q=' + encodeURIComponent(query)).then(function(response) { return response.json(); }).then(function(data) {
        if (!data.results || data.results.length === 0) {
            searchDropdown.innerHTML = '<div class="search-no-results">🔍 Ничего не найдено</div><button class="search-catalog-btn" onclick="window.location.href=\'/catalog\'">📀 Поиск в каталоге</button>';
            return;
        }
        var html = '';
        for (var i = 0; i < data.results.length; i++) {
            var item = data.results[i];
            var imagePath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image;
            var productId = item.type + '_' + item.id;
            html += '<div class="search-result-item-dropdown" data-type="' + item.type + '" data-id="' + item.id + '">' +
                '<img src="' + imagePath + '" class="search-result-image" onerror="this.src=\'/photo/plastinka-audio.png\'">' +
                '<div class="search-result-info"><div class="search-result-name">' + escapeHtml(String(item.name)) + '</div><div class="search-result-artist">' + escapeHtml(String(item.artist)) + '</div></div>' +
                '<span class="search-result-price">$' + item.price + '</span>' +
                '<div class="search-result-actions"><button class="search-cart-btn" data-id="' + productId + '">🛒</button><button class="search-detail-btn" data-id="' + item.id + '" data-type="' + item.type + '" data-name="' + escapeHtml(String(item.name)) + '" data-artist="' + escapeHtml(String(item.artist)) + '" data-price="' + item.price + '" data-image="' + imagePath + '" data-description="' + escapeHtml(String(item.description || 'Нет описания')) + '" data-genre="' + (item.genre || 'Rock') + '" data-year="' + (item.year || '1970') + '" data-audio="' + (item.audio || '') + '">📋</button></div>' +
                '</div>';
        }
        html += '<button class="search-catalog-btn" onclick="window.location.href=\'/catalog\'">Поиск в каталоге →</button>';
        searchDropdown.innerHTML = html;
        
        var cartBtns = searchDropdown.querySelectorAll('.search-cart-btn');
        for (var j = 0; j < cartBtns.length; j++) {
            cartBtns[j].addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.getAttribute('data-id');
                fetch('/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }).then(function() { showToast('Товар добавлен в корзину', false); });
            });
        }
        
        var detailBtns = searchDropdown.querySelectorAll('.search-detail-btn');
        for (var k = 0; k < detailBtns.length; k++) {
            detailBtns[k].addEventListener('click', function(e) {
                e.stopPropagation();
                searchDropdown.classList.remove('show');
                if (this.getAttribute('data-type') === 'product') {
                    openProductModal(this.getAttribute('data-id'), this.getAttribute('data-name'), this.getAttribute('data-artist'), this.getAttribute('data-price'), this.getAttribute('data-image'), this.getAttribute('data-description'), this.getAttribute('data-genre'), this.getAttribute('data-year'), this.getAttribute('data-audio'));
                } else {
                    openPlayerModal(this.getAttribute('data-id'), this.getAttribute('data-name'), this.getAttribute('data-price'), this.getAttribute('data-image'), this.getAttribute('data-description'));
                }
            });
        }
        
        var items = searchDropdown.querySelectorAll('.search-result-item-dropdown');
        for (var m = 0; m < items.length; m++) {
            items[m].addEventListener('click', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                var detailBtn = this.querySelector('.search-detail-btn');
                if (detailBtn) detailBtn.click();
            });
        }
    }).catch(function(error) {
        console.error('Ошибка:', error);
        searchDropdown.innerHTML = '<div class="search-no-results">❌ Ошибка поиска</div><button class="search-catalog-btn" onclick="window.location.href=\'/catalog\'">📀 Поиск в каталоге</button>';
    });
}

document.addEventListener('DOMContentLoaded', function() {
    var searchInput = document.getElementById('desktop-search-input');
    var searchDropdown = document.getElementById('search-dropdown');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            var query = this.value;
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function() { performSearch(query); }, 300);
        });
        searchInput.addEventListener('focus', function() { var query = this.value; if (query.length >= 1) performSearch(query); });
        searchInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') { var query = encodeURIComponent(this.value); if (query) window.location.href = '/search-page?q=' + query; } });
    }
    document.addEventListener('click', function(e) { if (searchDropdown && !searchDropdown.contains(e.target) && e.target !== searchInput) { searchDropdown.classList.remove('show'); } });
    
    var ratingContainers = document.querySelectorAll('.rating-stars');
    for (var r = 0; r < ratingContainers.length; r++) {
        var container = ratingContainers[r];
        var productId = container.dataset.productId;
        fetch('/api/rating/' + productId).then(function(response) { return response.json(); }).then(function(data) {
            if (data.avg_rating) {
                updateCardRating(container, parseFloat(data.avg_rating));
                var ratingValue = container.querySelector('.rating-value');
                if (ratingValue) ratingValue.textContent = data.avg_rating;
                var votesSpan = container.querySelector('.votes-count');
                if (votesSpan) votesSpan.textContent = '(' + data.votes_count + ')';
            }
        });
    }
});

document.querySelectorAll('.benefit').forEach(function(benefit) {
    var imageContainer = benefit.querySelector('.image-container');
    var audio = benefit.querySelector('.album-audio');
    var plastinka = benefit.querySelector('.plastinka');
    if (imageContainer && audio && plastinka) {
        imageContainer.addEventListener('mouseenter', function(e) {
            e.stopPropagation();
            if (currentPlayingAudio && currentPlayingAudio !== audio) { currentPlayingAudio.pause(); currentPlayingAudio.currentTime = 0; if (currentPlayingPlastinka) currentPlayingPlastinka.style.animationPlayState = 'paused'; }
            audio.currentTime = 0;
            audio.play().catch(function(err) { console.log('Audio play error:', err); });
            plastinka.style.animationPlayState = 'running';
            currentPlayingAudio = audio;
            currentPlayingPlastinka = plastinka;
        });
        imageContainer.addEventListener('mouseleave', function(e) {
            e.stopPropagation();
            audio.pause();
            audio.currentTime = 0;
            plastinka.style.animationPlayState = 'paused';
            if (currentPlayingAudio === audio) { currentPlayingAudio = null; currentPlayingPlastinka = null; }
        });
    }
    benefit.addEventListener('click', function(e) {
        if (e.target.closest('.add-to-cart-form')) return;
        openProductModal(this.dataset.productId, this.dataset.productName, this.dataset.productArtist, this.dataset.productPrice, this.dataset.productImage, this.dataset.productDescription, this.dataset.productGenre, this.dataset.productYear, '');
    });
});

async function updateFavoriteStatusDesktop(productId) {
    try {
        const response = await fetch('/api/favorites/status/product_' + productId);
        const data = await response.json();
        const favBtn = document.getElementById('productModalFavBtnDesktop');
        if (favBtn) {
            if (data.isFavorite) {
                favBtn.style.color = '#ff0000';
                favBtn.style.background = 'rgba(255, 0, 0, 0.2)';
                favBtn.style.border = '1px solid #ff0000';
            } else {
                favBtn.style.color = '#fff';
                favBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                favBtn.style.border = '1px solid #ff0000';
            }
        }
    } catch (error) { console.error('Ошибка проверки статуса избранного:', error); }
}

function addToCartFromModalDesktop() { 
    fetch('/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: currentProductId }) }).then(function() { showToast('Товар добавлен в корзину', false); closeProductModalDesktop(); }); 
}
function toggleFavoriteFromModalDesktop() { 
    const fullProductId = 'product_' + currentModalProductId;
    fetch('/api/favorites/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: fullProductId }) }).then(function(response) { return response.json(); }).then(function(data) { 
        if (data.success) {
            const favBtn = document.getElementById('productModalFavBtnDesktop');
            if (favBtn && favBtn.style.color === 'rgb(255, 0, 0)') { showToast('Удалено из избранного', false); }
            else { showToast('Добавлено в избранное', false); }
            if (currentModalProductId) { updateFavoriteStatusDesktop(currentModalProductId); }
        }
    }).catch(function(error) { console.error('Ошибка:', error); showToast('Ошибка при изменении избранного', true); }); 
}

function playModalPreviewDesktop() { 
    var audioFile = document.getElementById('productModalAudioDesktop').innerText; 
    if (audioFile) { var audio = new Audio('/audio/' + audioFile); audio.play(); } 
}

function closeProductModalDesktop() {
    document.getElementById('productModalDesktop').classList.remove('active');
    var track = document.querySelector('.player-carousel .carousel-track');
    var track2 = document.querySelector('.player-carousel2 .carousel-track2');
    if (track) track.style.animationPlayState = 'running';
    if (track2) track2.style.animationPlayState = 'running';
}

function submitRatingWithCommentDesktop() {
    var comment = document.getElementById('modalCommentDesktop').value;
    var productId = currentModalProductId;
    var rating = currentSelectedRating;
    if (!rating) { showToast('⭐ Сначала выберите оценку!', true); return; }
    fetch('/api/rating/' + productId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: rating, comment: comment || '' }) })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (data.success) {
            showToast('⭐ Спасибо за оценку и отзыв!', false);
            renderStarsInModal('modalRatingStarsDesktop', parseFloat(data.avg_rating), productId, true);
            var votesSpan = document.getElementById('modalRatingVotesDesktop');
            if (votesSpan) votesSpan.textContent = '(' + data.votes_count + ' оценок)';
            renderComments(data.comments, 'modalCommentsListDesktop');
            document.getElementById('modalCommentSectionDesktop').style.display = 'none';
            document.getElementById('modalCommentDesktop').value = '';
            currentSelectedRating = null;
            var productCardStars = document.querySelector('.rating-stars[data-product-id="' + productId + '"]');
            if (productCardStars) { updateCardRating(productCardStars, parseFloat(data.avg_rating)); }
        }
    })
    .catch(function(error) { console.error('Ошибка:', error); showToast('Ошибка при сохранении оценки', true); });
}

var modalDesktop = document.getElementById('productModalDesktop');
var closeProductBtn = document.getElementById('closeProductModalDesktop');
if (modalDesktop && closeProductBtn) {
    closeProductBtn.addEventListener('click', closeProductModalDesktop);
    modalDesktop.addEventListener('click', function(e) { if (e.target === modalDesktop) closeProductModalDesktop(); });
}

var track = document.querySelector('.player-carousel .carousel-track');
var track2 = document.querySelector('.player-carousel2 .carousel-track2');
if (track) { track.addEventListener('mouseenter', function() { track.style.animationPlayState = 'paused'; }); track.addEventListener('mouseleave', function() { track.style.animationPlayState = 'running'; }); }
if (track2) { track2.addEventListener('mouseenter', function() { track2.style.animationPlayState = 'paused'; }); track2.addEventListener('mouseleave', function() { track2.style.animationPlayState = 'running'; }); }

var modal = document.getElementById('playerModal');
var closeBtn = document.getElementById('closeModal');
function closeModal() { modal.classList.remove('active'); if (track) track.style.animationPlayState = 'running'; if (track2) track2.style.animationPlayState = 'running'; }
if (closeBtn) closeBtn.addEventListener('click', closeModal);
if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

var viewBtns = document.querySelectorAll('.view-btn');
for (var i = 0; i < viewBtns.length; i++) {
    viewBtns[i].addEventListener('click', function(e) { e.stopPropagation(); var card = this.closest('.card'); if (!card) return; openPlayerModal(card.dataset.playerId, card.dataset.name, card.dataset.price, card.dataset.image, card.dataset.description); });
}

document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal && modal.classList.contains('active')) closeModal(); if (e.key === 'Escape' && document.getElementById('productModalDesktop') && document.getElementById('productModalDesktop').classList.contains('active')) closeProductModalDesktop(); });

var addToCartForm = document.getElementById('addToCartForm');
if (addToCartForm) { addToCartForm.addEventListener('submit', function() { setTimeout(closeModal, 100); }); }

function addToCartMobile(id) { fetch('/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }).then(function() { showToastMobile('Товар добавлен в корзину', false); }); }
function toggleFavoriteMobile(id) { fetch('/api/favorites/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }).then(function() { showToastMobile('Добавлено в избранное', false); }); }
function showToastMobile(message, isError) { const toast = document.createElement('div'); toast.className = 'toast-notification'; toast.innerHTML = '<div style="display:flex;align-items:center;gap:8px">' + '<span>' + (isError ? '❌' : '✅') + '</span>' + '<span>' + message + '</span>' + '</div>'; document.body.appendChild(toast); setTimeout(function() { if (toast && toast.remove) toast.remove(); }, 3000); }
</script>
</body>
</html>`);
        }
    } catch (err) {
        console.error("Ошибка главной страницы:", err);
        res.status(500).send("Ошибка загрузки главной страницы");
    }
});

// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Сервер запущен на порту ${PORT}`);
        console.log(`👤 Админ: admin / admin123`);
    });
}

module.exports = app;