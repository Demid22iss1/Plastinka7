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
// ГЛАВНАЯ (упрощенная версия)
// ============================================================
app.get("/", (req, res) => {
    const user = req.session.user;
    const products = db.prepare("SELECT * FROM products ORDER BY id DESC LIMIT 6").all();
    
    let productsHtml = '';
    for (const p of products) {
        productsHtml += `
            <div style="background:#1a1a1a;border-radius:12px;padding:15px;text-align:center">
                <img src="/uploads/${p.image}" style="width:100%;height:150px;object-fit:cover;border-radius:8px" onerror="this.src='/photo/plastinka-audio.png'">
                <h3>${escapeHtml(p.name)}</h3>
                <p>${escapeHtml(p.artist)}</p>
                <p style="color:#ff7a2f;font-size:20px">$${p.price}</p>
                <form action="/add-to-cart" method="POST">
                    <input type="hidden" name="id" value="product_${p.id}">
                    <button type="submit" style="background:#ff0000;border:none;padding:8px 20px;border-radius:20px;color:#fff;cursor:pointer">В корзину</button>
                </form>
            </div>
        `;
    }
    
    res.send(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Plastinka</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f0f;color:#fff;font-family:Arial,sans-serif}
header{position:sticky;top:0;background:#0a0a0a;padding:15px 5%;display:flex;justify-content:space-between;align-items:center}
.logo img{height:50px}
.right-icons{display:flex;gap:20px}
.right-icons a{color:#fff;text-decoration:none}
.right-icons img{height:40px}
.hero{height:300px;background:linear-gradient(45deg,#ff0000,#990000);display:flex;align-items:center;justify-content:center}
.hero h1{font-size:48px}
.products{max-width:1200px;margin:40px auto;padding:0 20px}
.products h2{margin-bottom:20px}
.products-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
.btn-primary{display:inline-block;background:#ff0000;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none}
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
<div class="hero">
    <h1>Plastinka</h1>
</div>
<div class="products">
    <h2>Новинки</h2>
    <div class="products-grid">${productsHtml || '<p>Товаров пока нет</p>'}</div>
    <div style="text-align:center;margin-top:30px">
        <a href="/catalog" class="btn-primary">Смотреть весь каталог →</a>
    </div>
</div>
</body></html>
    `);
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