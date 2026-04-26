// @ts-nocheck
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const app = express();

// Замена sqlite3 на better-sqlite3
const Database = require('better-sqlite3');
const db = new Database('./database.sqlite');
db.pragma('encoding = "UTF-8"');
db.pragma('case_sensitive_like = OFF');

// ============================================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ (СИНХРОННО)
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
    avatar TEXT DEFAULT 'default-avatar.png'
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

// Таблица для рейтинга с комментариями
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
console.log("⭐ Таблица рейтинга с комментариями создана");

// Добавление настроек главной страницы по умолчанию
const homepageSetting = db.prepare("SELECT COUNT(*) as count FROM site_settings WHERE key = ?").get('homepage_products');
if (!homepageSetting || homepageSetting.count === 0) {
    db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)").run('homepage_products', 'last_added');
    console.log("⚙️ Добавлены настройки сайта");
}




// Добавление дополнительных тестовых пластинок
const productsCount2 = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productsCount2.count < 8) {
    const extraProducts = [
        ['Kind of Blue', 'Miles Davis', 45, 'kind-of-blue.png', null, 'Классический джазовый альбом', 'Jazz', '1959'],
        ['Random Access Memories', 'Daft Punk', 38, 'ram.png', null, 'Электронный шедевр', 'Electronic', '2013'],
        ['The Wall', 'Pink Floyd', 42, 'the-wall.png', null, 'Рок-опера', 'Rock', '1979'],
        ['Back in Black', 'AC/DC', 35, 'back-in-black.png', null, 'Хард-рок', 'Rock', '1980'],
        ['The Velvet Underground', 'The Velvet Underground', 40, 'velvet.png', null, 'Альтернативный рок', 'Rock', '1967'],
        ['A Love Supreme', 'John Coltrane', 50, 'love-supreme.png', null, 'Джаз', 'Jazz', '1965'],
        ['Discovery', 'Daft Punk', 36, 'discovery.png', null, 'Французский хаус', 'Electronic', '2001'],
        ['Lateralus', 'Tool', 44, 'lateralus.png', null, 'Прогрессивный метал', 'Rock', '2001']
    ];
    const stmt = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const p of extraProducts) stmt.run(p);
    console.log("📀 Добавлены дополнительные тестовые пластинки");
}



// Добавление колонки telegram_id в таблицу users
try {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_id INTEGER`);
    console.log("✅ Добавлена колонка telegram_id");
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.log("⚠️ Колонка telegram_id уже существует или ошибка:", err.message);
    }
}

// Telegram авторизация API (синхронная версия)
app.post("/api/telegram-auth", express.json(), (req, res) => {
    const { id, first_name, last_name, username, photo_url } = req.body;
    if (!id) return res.json({ success: false, error: "No telegram id" });
    try {
        const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(id);
        if (user) {
            req.session.user = { id: user.id, username: user.username, role: user.role, avatar: user.avatar, telegram_id: id };
            res.json({ success: true, isNew: false });
        } else {
            const newUsername = username || `tg_user_${id}`;
            const defaultPassword = Math.random().toString(36).substring(2, 15);
            const hash = bcrypt.hashSync(defaultPassword, 10);
            const avatarFile = photo_url ? null : 'default-avatar.png';
            const info = db.prepare("INSERT INTO users (username, password, role, telegram_id, avatar) VALUES (?, ?, 'user', ?, ?)").run(newUsername, hash, id, avatarFile || 'default-avatar.png');
            req.session.user = { id: info.lastInsertRowid, username: newUsername, role: 'user', avatar: avatarFile || 'default-avatar.png', telegram_id: id };
            res.json({ success: true, isNew: true });
        }
    } catch (err) {
        console.error("Ошибка регистрации Telegram пользователя:", err);
        res.json({ success: false, error: err.message });
    }
});

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
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================
// СОЗДАНИЕ ПАПОК ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
// ============================================================
const uploadDirs = ['public/uploads', 'public/audio', 'public/photo', 'public/avatars'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Создана папка: ${dir}`);
    }
});

// ============================================================
// НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
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
// MIDDLEWARE ДЛЯ ЗАЩИТЫ МАРШРУТОВ
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
        return res.status(403).send(`
<!DOCTYPE html>
<html>
<head><title>Доступ запрещен</title><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{background:#0f0f0f;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;text-align:center}
.error-container{max-width:500px;padding:40px;background:#181818;border-radius:16px;box-shadow:0 0 40px rgba(255,0,0,0.15)}
h1{color:#ff0000;margin-bottom:20px} a{color:#fff;text-decoration:none;padding:10px 20px;background:linear-gradient(45deg,#ff0000,#990000);border-radius:8px;display:inline-block}
a:hover{transform:translateY(-2px);box-shadow:0 10px 20px rgba(255,0,0,0.3)}</style></head>
<body><div class="error-container"><h1>🚫 Доступ запрещен</h1><p>Страница только для администраторов.</p><a href="/">Вернуться на главную</a></div></body></html>
        `);
    }
    next();
};

// Определение мобильного устройства
app.use((req, res, next) => {
    req.isMobile = /mobile|android|iphone|ipad|phone/i.test(req.headers['user-agent'] || '');
    next();
});

// ============================================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ (ТАБЛИЦЫ И ТЕСТОВЫЕ ДАННЫЕ) - СИНХРОННО
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
    avatar TEXT DEFAULT 'default-avatar.png'
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

// Таблица для рейтинга с комментариями
db.exec(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE(user_id, product_id)
)`);
console.log("⭐ Таблица рейтинга с комментариями создана");

// Добавление колонки admin_reply
try {
    db.exec(`ALTER TABLE ratings ADD COLUMN admin_reply TEXT`);
    console.log("✅ Добавлена колонка admin_reply");
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.log("⚠️ Ошибка добавления admin_reply:", err.message);
    }
}

// Добавление колонки admin_reply_at
try {
    db.exec(`ALTER TABLE ratings ADD COLUMN admin_reply_at DATETIME`);
    console.log("✅ Добавлена колонка admin_reply_at");
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.log("⚠️ Ошибка добавления admin_reply_at:", err.message);
    }
}

// Добавление колонки telegram_id в таблицу users
try {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_id INTEGER`);
    console.log("✅ Добавлена колонка telegram_id");
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.log("⚠️ Колонка telegram_id уже существует или ошибка:", err.message);
    }
}


// Добавление тестовых проигрывателей
const playersCount = db.prepare("SELECT COUNT(*) as count FROM players").get();
if (playersCount.count === 0) {
    const players = [
        ['Pro-Ject Debut Carbon', 499, 'proigrvatel1.png', 'Высококачественный проигрыватель винила с углеволокновым тонармом. Обеспечивает чистое и детальное звучание.'],
        ['Audio-Technica AT-LP120', 299, 'proigrvatel2.png', 'Профессиональный проигрыватель с прямым приводом. Идеален для диджеев и аудиофилов.'],
        ['Rega Planar 3', 899, 'proigrvatel3.png', 'Легендарный британский проигрыватель. Ручная сборка, высокое качество звучания.']
    ];
    const stmt = db.prepare("INSERT INTO players (name, price, image, description) VALUES (?, ?, ?, ?)");
    for (const p of players) stmt.run(p);
    console.log("🎵 Добавлены тестовые проигрыватели");
}

// Добавление тестовых пластинок
const productsCount = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productsCount.count === 0) {
    const products = [
        ['Dark Side of the Moon', 'Pink Floyd', 35, 'dark-side.png', 'dark-side.mp3', 'Легендарный альбом', 'Rock', '1973'],
        ['Abbey Road', 'The Beatles', 40, 'abbey-road.png', 'abbey-road.mp3', 'Последний записанный альбом', 'Rock', '1969'],
        ['Thriller', 'Michael Jackson', 45, 'thriller.png', 'thriller.mp3', 'Самый продаваемый альбом', 'Pop', '1982']
    ];
    const stmt = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const p of products) stmt.run(p);
    console.log("📀 Добавлены тестовые пластинки");
}



// Создание администратора
const usersCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
if (usersCount.count === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("admin", hash, "admin");
    console.log("👤 Создан пользователь admin с паролем admin123");
}

// ============================================================
// API ДЛЯ АВАТАРКИ И НАСТРОЕК ПОЛЬЗОВАТЕЛЯ
// ============================================================
app.post("/api/upload-avatar", requireAuth, upload.single("avatar"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Файл не загружен" });
    }
    try {
        db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(req.file.filename, req.session.user.id);
        req.session.user.avatar = req.file.filename;
        res.json({ success: true, avatar: `/avatars/${req.file.filename}` });
    } catch (err) {
        res.status(500).json({ error: "Ошибка сохранения аватара" });
    }
});

app.get("/api/favorites/status/:productId", requireAuth, (req, res) => {
    const productId = req.params.productId;
    const userId = req.session.user.id;
    try {
        const fav = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, productId);
        res.json({ isFavorite: !!fav });
    } catch (err) {
        res.json({ isFavorite: false });
    }
});

app.get("/api/favorites/check/:productId", requireAuth, (req, res) => {
    const productId = req.params.productId;
    const userId = req.session.user.id;
    try {
        const fav = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, productId);
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
    const userId = req.session.user.id;
    const { productId, type } = req.body;
    const fullProductId = type === 'product' ? `product_${productId}` : `player_${productId}`;
    try {
        db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(userId, fullProductId);
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

app.get("/api/user-avatar", requireAuth, (req, res) => {
    try {
        const user = db.prepare("SELECT avatar FROM users WHERE id = ?").get(req.session.user.id);
        res.json({ avatar: `/avatars/${user?.avatar || 'default-avatar.png'}` });
    } catch (err) {
        res.json({ avatar: "/avatars/default-avatar.png" });
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
// API ДЛЯ РЕЙТИНГА (СИНХРОННО)
// ============================================================
app.get("/api/rating/:productId", (req, res) => {
    const productId = req.params.productId;
    try {
        const ratingData = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(productId);
        const comments = db.prepare(`SELECT r.rating, r.comment, r.created_at, u.username 
            FROM ratings r JOIN users u ON r.user_id = u.id 
            WHERE r.product_id = ? AND r.comment IS NOT NULL AND r.comment != '' 
            ORDER BY r.created_at DESC LIMIT 10`).all(productId);
        res.json({
            avg_rating: ratingData?.avg_rating ? parseFloat(ratingData.avg_rating).toFixed(1) : 0,
            votes_count: ratingData?.votes_count || 0,
            comments: comments || []
        });
    } catch (err) {
        res.json({ avg_rating: 0, votes_count: 0, comments: [] });
    }
});

app.get("/api/rating/user/:productId", requireAuth, (req, res) => {
    const productId = req.params.productId;
    try {
        const result = db.prepare(`SELECT rating, comment FROM ratings WHERE user_id = ? AND product_id = ?`).get(req.session.user.id, productId);
        res.json({ user_rating: result?.rating || null, user_comment: result?.comment || null });
    } catch (err) {
        res.json({ user_rating: null, user_comment: null });
    }
});

app.post("/api/rating/:productId", requireAuth, express.json(), (req, res) => {
    const productId = req.params.productId;
    const userId = req.session.user.id;
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Оценка должна быть от 1 до 5" });
    try {
        const product = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
        if (!product) return res.status(404).json({ error: "Товар не найден" });
        const existing = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND product_id = ?").get(userId, productId);
        if (existing) {
            db.prepare(`UPDATE ratings SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(rating, comment || null, existing.id);
        } else {
            db.prepare(`INSERT INTO ratings (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)`).run(userId, productId, rating, comment || null);
        }
        const ratingData = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(productId);
        const comments = db.prepare(`SELECT r.rating, r.comment, r.created_at, u.username 
            FROM ratings r JOIN users u ON r.user_id = u.id 
            WHERE r.product_id = ? AND r.comment IS NOT NULL AND r.comment != '' 
            ORDER BY r.created_at DESC LIMIT 10`).all(productId);
        res.json({
            success: true,
            avg_rating: ratingData?.avg_rating ? parseFloat(ratingData.avg_rating).toFixed(1) : 0,
            votes_count: ratingData?.votes_count || 0,
            comments: comments || []
        });
    } catch (err) {
        res.status(500).json({ error: "Ошибка сохранения оценки" });
    }
});

// ============================================================
// API ДЛЯ ПОИСКА
// ============================================================
app.get("/api/search", (req, res) => {
    const query = req.query.q || '';
    if (query.length < 1) return res.json({ results: [] });
    const searchPattern = `%${query}%`;
    try {
        const products = db.prepare(`SELECT id, name, artist, price, image, audio, description, genre, year, 'product' as type 
            FROM products WHERE name LIKE ? OR artist LIKE ? LIMIT 10`).all(searchPattern, searchPattern);
        const players = db.prepare(`SELECT id, name, 'Проигрыватель' as artist, price, image, description, 'player' as type 
            FROM players WHERE name LIKE ? LIMIT 5`).all(searchPattern);
        res.json({ results: [...products, ...players] });
    } catch (err) {
        res.json({ results: [] });
    }
});

app.get("/search-page", (req, res) => {
    res.redirect(`/search?q=${encodeURIComponent(req.query.q || '')}`);
});

// ============================================================
// ===================== ГЛАВНАЯ СТРАНИЦА =====================
// ============================================================
function generateStarRatingHTML(rating, votesCount) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) starsHtml += '<i class="fas fa-star star filled"></i>';
        else if (i === fullStars + 1 && hasHalfStar) starsHtml += '<i class="fas fa-star-half-alt star filled"></i>';
        else starsHtml += '<i class="far fa-star star"></i>';
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
            case 'popular': productsQuery = "SELECT * FROM products ORDER BY id DESC LIMIT 6"; break;
            case 'all': productsQuery = "SELECT * FROM products LIMIT 12"; break;
            default: productsQuery = "SELECT * FROM products ORDER BY id DESC LIMIT 6";
        }
        let products = db.prepare(productsQuery).all();
        for (const product of products) {
            const rating = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(product.id);
            product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
            product.votes_count = rating?.votes_count || 0;
        }
        const players = db.prepare("SELECT * FROM players").all();
        
        if (req.isMobile) {
            let content = `<h2 class="section-title">Новинки</h2><div class="products-grid">`;
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
                </div>`;
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
            
            // Остальной HTML для десктопной версии (слишком большой, но структура та же)
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
    cursor: pointer;
    transition: all 0.2s ease;
    color: #444;
    border-radius: 50%;
}
.rating-stars .star.filled {
    color: #ff7a2f;
    text-shadow: 0 0 4px rgba(255,122,47,0.5);
}
.rating-stars .star.hover {
    color: #ffaa66;
    transform: scale(1.1);
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
    cursor: pointer;
    transition: all 0.2s ease;
    color: #444;
    border-radius: 50%;
}
.rating-stars-large .star.filled {
    color: #ff7a2f;
    text-shadow: 0 0 6px rgba(255,122,47,0.5);
}
.rating-stars-large .star.hover {
    color: #ffaa66;
    transform: scale(1.15);
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
.comment-section {
    margin: 15px 0;
    padding: 15px;
    background: rgba(255,255,255,0.05);
    border-radius: 12px;
}
.comment-section textarea {
    font-family: inherit;
    resize: vertical;
}
.submit-rating-btn {
    background: linear-gradient(45deg, #ff7a2f, #ff0000);
    border: none;
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: 0.2s;
    font-weight: bold;
    margin-top: 10px;
}
.submit-rating-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(255,122,47,0.3);
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
    font-weight: 500;
    backdrop-filter: blur(10px);
}
@keyframes slideInRight {
    to { transform: translateX(0); }
}
@keyframes slideOutRight {
    to { transform: translateX(400px); }
}
.notification-icon { font-size: 20px; }
.notification-content { display: flex; flex-direction: column; }
.notification-title { font-size: 14px; font-weight: bold; margin-bottom: 2px; }
.notification-message { font-size: 12px; opacity: 0.9; }
.notification-progress { position: absolute; bottom: 0; left: 0; height: 3px; background: rgba(255,255,255,0.5); animation: progress 3s linear forwards; border-radius: 0 0 0 12px; }
@keyframes progress { from { width: 100%; } to { width: 0%; } }

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
    header {
        padding: 10px 4%;
    }
    .logo img {
        height: 40px;
    }
    .search-bar-desktop {
        max-width: 350px;
    }
    .right-icons {
        gap: 15px;
    }
    .right-icons img {
        height: 36px;
    }
}

@media (max-width: 550px) {
    header {
        justify-content: center;
    }
    .search-bar-desktop {
        flex: 1 1 100%;
        max-width: 100%;
        order: 1;
        margin: 5px 0;
    }
    .right-icons {
        justify-content: center;
    }
}

@media (max-width: 480px) {
    .logo img {
        height: 36px;
    }
    .right-icons img {
        height: 34px;
    }
    .right-icons {
        gap: 12px;
    }
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
.modal-add-to-cart { width: 100%; padding: 12px; background: linear-gradient(45deg, #ff7a2f, #ff0000); border: none; border-radius: 10px; color: white; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; }
.modal-add-to-cart:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(255, 122, 47, 0.3); }

.catalog-title a { color: inherit; text-decoration: none; transition: 0.3s; }
.catalog-title a:hover { color: #ff0000; }

.modal-artist { color: #aaa; font-size: 16px; margin-bottom: 15px; }
.modal-tags { display: flex; gap: 10px; margin-bottom: 20px; }
.modal-tag { background: rgba(255, 122, 47, 0.2); padding: 5px 12px; border-radius: 20px; font-size: 12px; color: #ff7a2f; }
.modal-actions { display: flex; gap: 15px; margin-bottom: 15px; }
.modal-fav-btn { width: 50px; background: rgba(255, 255, 255, 0.1); border: 1px solid #ff0000; border-radius: 10px; color: #ff0000; font-size: 20px; cursor: pointer; transition: 0.3s; }
.modal-fav-btn:hover { background: #ff0000; color: white; }
.modal-play-btn { width: 100%; padding: 10px; background: rgba(255, 255, 255, 0.1); border: 1px solid #ff7a2f; border-radius: 10px; color: #ff7a2f; font-size: 14px; cursor: pointer; transition: 0.3s; }
.benefit { cursor: pointer; }

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
let currentUserRating = null;
let currentSelectedRating = null;
let currentFavoriteStatus = false;
let currentFavoriteBtn = null;

function showToast(message, isError) {
    const toast = document.createElement('div');
    toast.className = 'notification';
    toast.innerHTML = '<div class=\"notification-icon\">' + (isError ? '❌' : '✅') + '</div>' +
        '<div class=\"notification-content\">' +
        '<span class=\"notification-title\">' + (isError ? 'Ошибка' : 'Успешно') + '</span>' +
        '<span class=\"notification-message\">' + message + '</span>' +
        '</div><div class=\"notification-progress\"></div>';
    document.body.appendChild(toast);
    setTimeout(function() { 
        if (toast && toast.remove) toast.remove(); 
    }, 3000);
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

function renderStarsInModal(containerId, rating, productId, isLarge) {
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
    
    const isLoggedIn = ${!!req.session.user};
    if (isLoggedIn) {
        const stars = container.querySelectorAll('.star');
        for (var j = 0; j < stars.length; j++) {
            var star = stars[j];
            star.style.cursor = 'pointer';
            star.addEventListener('mouseenter', function() {
                var value = parseInt(this.dataset.value);
                for (var k = 0; k < stars.length; k++) {
                    if (k < value) {
                        stars[k].classList.add('hover');
                    } else {
                        stars[k].classList.remove('hover');
                    }
                }
            });
            star.addEventListener('mouseleave', function() {
                for (var k = 0; k < stars.length; k++) {
                    stars[k].classList.remove('hover');
                }
            });
            star.addEventListener('click', function() {
                var value = parseInt(this.dataset.value);
                var commentSection = document.getElementById('modalCommentSectionDesktop');
                if (commentSection) commentSection.style.display = 'block';
                currentSelectedRating = value;
                for (var k = 0; k < stars.length; k++) {
                    if (k < value) {
                        stars[k].classList.add('filled');
                    } else {
                        stars[k].classList.remove('filled');
                    }
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
        if (i < fullStars) {
            stars[i].classList.add('filled');
        } else if (i === fullStars && hasHalfStar) {
            stars[i].classList.add('filled');
        } else {
            stars[i].classList.remove('filled');
        }
    }
    var ratingValue = container.querySelector('.rating-value');
    if (ratingValue) ratingValue.textContent = rating;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function openProductModal(id, name, artist, price, image, description, genre, year, audio) {
    currentProductId = 'product_' + id;
    currentModalProductId = id;
    document.getElementById('productModalImageDesktop').src = image;
    document.getElementById('productModalTitleDesktop').textContent = name;
    document.getElementById('productModalArtistDesktop').textContent = artist;
    document.getElementById('productModalTagsDesktop').innerHTML = '<span class=\"modal-tag\">' + genre + '</span><span class=\"modal-tag\">' + year + '</span>';
    document.getElementById('productModalDescriptionDesktop').textContent = description;
    document.getElementById('productModalPriceDesktop').innerHTML = price + ' <span>$</span>';
    
    fetch('/api/rating/' + id)
        .then(function(response) { return response.json(); })
        .then(function(data) {
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
    
    searchDropdown.innerHTML = '<div class=\"search-no-results\">🔍 Поиск...</div>';
    searchDropdown.classList.add('show');
    
    fetch('/api/search?q=' + encodeURIComponent(query))
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (!data.results || data.results.length === 0) {
                searchDropdown.innerHTML = '<div class=\"search-no-results\">🔍 Ничего не найдено</div>' +
                    '<button class=\"search-catalog-btn\" onclick=\"window.location.href=\\'/catalog\\'\">📀 Поиск в каталоге</button>';
                return;
            }
            
            var html = '';
            for (var i = 0; i < data.results.length; i++) {
                var item = data.results[i];
                var imagePath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image;
                var productId = item.type + '_' + item.id;
                
                html += '<div class=\"search-result-item-dropdown\" data-type=\"' + item.type + '\" data-id=\"' + item.id + '\">';
                html += '<img src=\"' + imagePath + '\" class=\"search-result-image\" onerror=\"this.src=\\'/photo/plastinka-audio.png\\'\">';
                html += '<div class=\"search-result-info\">';
                html += '<div class=\"search-result-name\">' + escapeHtml(String(item.name)) + '</div>';
                html += '<div class=\"search-result-artist\">' + escapeHtml(String(item.artist)) + '</div>';
                html += '</div>';
                html += '<span class=\"search-result-price\">$' + item.price + '</span>';
                html += '<div class=\"search-result-actions\">';
                html += '<button class=\"search-cart-btn\" data-id=\"' + productId + '\">🛒</button>';
                html += '<button class=\"search-detail-btn\" data-id=\"' + item.id + '\" data-type=\"' + item.type + '\" data-name=\"' + escapeHtml(String(item.name)) + '\" data-artist=\"' + escapeHtml(String(item.artist)) + '\" data-price=\"' + item.price + '\" data-image=\"' + imagePath + '\" data-description=\"' + escapeHtml(String(item.description || 'Нет описания')) + '\" data-genre=\"' + (item.genre || 'Rock') + '\" data-year=\"' + (item.year || '1970') + '\" data-audio=\"' + (item.audio || '') + '\">📋</button>';
                html += '</div>';
                html += '</div>';
            }
            html += '<button class=\"search-catalog-btn\" onclick=\"window.location.href=\\'/catalog\\'\">Поиск в каталоге →</button>';
            searchDropdown.innerHTML = html;
            
            var cartBtns = searchDropdown.querySelectorAll('.search-cart-btn');
            for (var j = 0; j < cartBtns.length; j++) {
                cartBtns[j].addEventListener('click', function(e) {
                    e.stopPropagation();
                    var id = this.getAttribute('data-id');
                    fetch('/api/cart/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: id })
                    }).then(function() { showToast('Товар добавлен в корзину', false); });
                });
            }
            
            var detailBtns = searchDropdown.querySelectorAll('.search-detail-btn');
            for (var k = 0; k < detailBtns.length; k++) {
                detailBtns[k].addEventListener('click', function(e) {
                    e.stopPropagation();
                    searchDropdown.classList.remove('show');
                    
                    if (this.getAttribute('data-type') === 'product') {
                        openProductModal(
                            this.getAttribute('data-id'),
                            this.getAttribute('data-name'),
                            this.getAttribute('data-artist'),
                            this.getAttribute('data-price'),
                            this.getAttribute('data-image'),
                            this.getAttribute('data-description'),
                            this.getAttribute('data-genre'),
                            this.getAttribute('data-year'),
                            this.getAttribute('data-audio')
                        );
                    } else {
                        openPlayerModal(
                            this.getAttribute('data-id'),
                            this.getAttribute('data-name'),
                            this.getAttribute('data-price'),
                            this.getAttribute('data-image'),
                            this.getAttribute('data-description')
                        );
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
        })
        .catch(function(error) {
            console.error('Ошибка:', error);
            searchDropdown.innerHTML = '<div class=\"search-no-results\">❌ Ошибка поиска</div>' +
                '<button class=\"search-catalog-btn\" onclick=\"window.location.href=\\'/catalog\\'\">📀 Поиск в каталоге</button>';
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
        
        searchInput.addEventListener('focus', function() {
            var query = this.value;
            if (query.length >= 1) performSearch(query);
        });
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                var query = encodeURIComponent(this.value);
                if (query) window.location.href = '/search-page?q=' + query;
            }
        });
    }
    
    document.addEventListener('click', function(e) {
        if (searchDropdown && !searchDropdown.contains(e.target) && e.target !== searchInput) {
            searchDropdown.classList.remove('show');
        }
    });
    
    var ratingContainers = document.querySelectorAll('.rating-stars');
    for (var r = 0; r < ratingContainers.length; r++) {
        var container = ratingContainers[r];
        var productId = container.dataset.productId;
        fetch('/api/rating/' + productId)
            .then(function(response) { return response.json(); })
            .then(function(data) {
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
            if (currentPlayingAudio && currentPlayingAudio !== audio) { 
                currentPlayingAudio.pause(); 
                currentPlayingAudio.currentTime = 0; 
                if (currentPlayingPlastinka) currentPlayingPlastinka.style.animationPlayState = 'paused'; 
            }
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
            if (currentPlayingAudio === audio) { 
                currentPlayingAudio = null; 
                currentPlayingPlastinka = null; 
            }
        });
    }
    
    benefit.addEventListener('click', function(e) {
        if (e.target.closest('.add-to-cart-form')) return;
        openProductModal(
            this.dataset.productId,
            this.dataset.productName,
            this.dataset.productArtist,
            this.dataset.productPrice,
            this.dataset.productImage,
            this.dataset.productDescription,
            this.dataset.productGenre,
            this.dataset.productYear,
            ''
        );
    });
});

async function updateFavoriteStatusDesktop(productId) {
    try {
        console.log('Checking favorite status for productId:', productId);
        console.log('URL:', '/api/favorites/status/product_' + productId);
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
    } catch (error) {
        console.error('Ошибка проверки статуса избранного:', error);
    }
}

function addToCartFromModalDesktop() { 
    fetch('/api/cart/add', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ id: currentProductId }) 
    }).then(function() { 
        showToast('Товар добавлен в корзину', false);
        closeProductModalDesktop(); 
    }); 
}
function toggleFavoriteFromModalDesktop() { 
    const fullProductId = 'product_' + currentModalProductId;
    fetch('/api/favorites/toggle', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ id: fullProductId }) 
    }).then(function(response) { 
        return response.json();
    }).then(function(data) { 
        if (data.success) {
            const favBtn = document.getElementById('productModalFavBtnDesktop');
            if (favBtn && favBtn.style.color === 'rgb(255, 0, 0)') {
                showToast('Удалено из избранного', false);
            } else {
                showToast('Добавлено в избранное', false);
            }
            if (currentModalProductId) {
                updateFavoriteStatusDesktop(currentModalProductId);
            }
        }
    }).catch(function(error) {
        console.error('Ошибка:', error);
        showToast('Ошибка при изменении избранного', true);
    }); 
}

function playModalPreviewDesktop() { 
    var audioFile = document.getElementById('productModalAudioDesktop').innerText; 
    if (audioFile) { 
        var audio = new Audio('/audio/' + audioFile); 
        audio.play(); 
    } 
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
    
    if (!rating) {
        showToast('⭐ Сначала выберите оценку!', true);
        return;
    }
    
    fetch('/api/rating/' + productId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: rating, comment: comment || '' })
    })
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
            if (productCardStars) {
                updateCardRating(productCardStars, parseFloat(data.avg_rating));
            }
        }
    })
    .catch(function(error) {
        console.error('Ошибка:', error);
        showToast('Ошибка при сохранении оценки', true);
    });
}

var modalDesktop = document.getElementById('productModalDesktop');
var closeProductBtn = document.getElementById('closeProductModalDesktop');
if (modalDesktop && closeProductBtn) {
    closeProductBtn.addEventListener('click', closeProductModalDesktop);
    modalDesktop.addEventListener('click', function(e) {
        if (e.target === modalDesktop) closeProductModalDesktop();
    });
}

var track = document.querySelector('.player-carousel .carousel-track');
var track2 = document.querySelector('.player-carousel2 .carousel-track2');
if (track) { 
    track.addEventListener('mouseenter', function() { track.style.animationPlayState = 'paused'; }); 
    track.addEventListener('mouseleave', function() { track.style.animationPlayState = 'running'; }); 
}
if (track2) { 
    track2.addEventListener('mouseenter', function() { track2.style.animationPlayState = 'paused'; }); 
    track2.addEventListener('mouseleave', function() { track2.style.animationPlayState = 'running'; }); 
}

var modal = document.getElementById('playerModal');
var closeBtn = document.getElementById('closeModal');

function closeModal() { 
    modal.classList.remove('active'); 
    if (track) track.style.animationPlayState = 'running'; 
    if (track2) track2.style.animationPlayState = 'running'; 
}

if (closeBtn) closeBtn.addEventListener('click', closeModal);
if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

var viewBtns = document.querySelectorAll('.view-btn');
for (var i = 0; i < viewBtns.length; i++) {
    viewBtns[i].addEventListener('click', function(e) { 
        e.stopPropagation(); 
        var card = this.closest('.card'); 
        if (!card) return; 
        openPlayerModal(
            card.dataset.playerId,
            card.dataset.name,
            card.dataset.price,
            card.dataset.image,
            card.dataset.description
        );
    });
}

document.addEventListener('keydown', function(e) { 
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) closeModal(); 
    if (e.key === 'Escape' && document.getElementById('productModalDesktop') && document.getElementById('productModalDesktop').classList.contains('active')) closeProductModalDesktop(); 
});

var addToCartForm = document.getElementById('addToCartForm');
if (addToCartForm) {
    addToCartForm.addEventListener('submit', function() { setTimeout(closeModal, 100); });
}

function addToCartMobile(id) {
    fetch('/api/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
    }).then(function() { showToastMobile('Товар добавлен в корзину', false); });
}

function toggleFavoriteMobile(id) {
    fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
    }).then(function() { showToastMobile('Добавлено в избранное', false); });
}

function showToastMobile(message, isError) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = '<div style="display:flex;align-items:center;gap:8px">' + 
        '<span>' + (isError ? '❌' : '✅') + '</span>' + 
        '<span>' + message + '</span>' + 
        '</div>';
    document.body.appendChild(toast);
    setTimeout(function() { 
        if (toast && toast.remove) toast.remove(); 
    }, 3000);
}
</script>
</body>
</html>`); // Здесь должен быть полный HTML из вашего оригинального файла
        }
    } catch (err) {
        console.error("Ошибка главной страницы:", err);
        res.status(500).send("Ошибка загрузки главной страницы");
    }
});

// ============================================================
// ===================== АДМИН ПАНЕЛЬ (НАСТРОЙКИ) =============
// ============================================================
app.get("/admin/settings", requireAdmin, (req, res) => {
    try {
        const setting = db.prepare("SELECT value FROM site_settings WHERE key = 'homepage_products'").get();
        const currentMode = setting ? setting.value : 'last_added';
        res.send(`
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Настройки главной страницы</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box;}body{background:linear-gradient(135deg,#0a0a0a 0%,#0f0f0f 100%);min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#fff;}
.settings-container{max-width:700px;margin:60px auto;padding:0 20px;}.settings-card{background:rgba(24,24,24,0.95);backdrop-filter:blur(10px);border-radius:24px;border:1px solid rgba(255,0,0,0.2);overflow:hidden;}
.settings-header{background:linear-gradient(135deg,#1a1a1a 0%,#0f0f0f 100%);padding:32px;border-bottom:1px solid rgba(255,0,0,0.2);position:relative;}
.settings-header::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#ff0000,#ff4444,#ff0000);}
.settings-header h1{font-size:28px;font-weight:700;background:linear-gradient(135deg,#fff 0%,#ff4444 100%);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:8px;}
.settings-header p{color:#888;font-size:14px;}
.settings-body{padding:32px;}
.setting-option{background:#0a0a0a;border:1px solid #333;border-radius:16px;padding:20px;margin-bottom:16px;cursor:pointer;transition:all 0.2s ease;}
.setting-option:hover{border-color:#ff0000;transform:translateX(5px);}
.setting-option.selected{border-color:#ff0000;background:rgba(255,0,0,0.05);}
.setting-option input[type="radio"]{display:none;}
.setting-option label{display:flex;align-items:center;gap:15px;cursor:pointer;}
.option-icon{width:50px;height:50px;border-radius:12px;background:rgba(255,0,0,0.1);display:flex;align-items:center;justify-content:center;font-size:24px;color:#ff0000;}
.option-content{flex:1;}
.option-title{font-size:18px;font-weight:bold;margin-bottom:5px;}
.option-desc{font-size:13px;color:#888;}
.save-btn{width:100%;padding:16px;background:linear-gradient(135deg,#ff0000,#cc0000);border:none;border-radius:14px;color:white;font-size:16px;font-weight:bold;cursor:pointer;margin-top:20px;transition:0.2s;}
.save-btn:hover{transform:translateY(-2px);box-shadow:0 10px 25px rgba(255,0,0,0.3);}
.back-link{display:inline-block;margin-top:20px;color:#aaa;text-decoration:none;text-align:center;width:100%;}
.back-link:hover{color:#ff0000;}
.success-message{background:rgba(76,175,80,0.1);border:1px solid #4CAF50;color:#4CAF50;padding:12px;border-radius:8px;margin-bottom:20px;text-align:center;}
.admin-nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding:10px 20px;background:rgba(0,0,0,0.5);border-radius:12px;}
.back-to-site{color:#ff0000;text-decoration:none;display:inline-flex;align-items:center;gap:8px;}
@media(max-width:600px){.settings-container{margin:20px auto;}.settings-header{padding:24px;}.settings-header h1{font-size:24px;}.settings-body{padding:24px;}}
</style>
</head>
<body><div class="settings-container"><div class="admin-nav"><a href="/admin" class="back-to-site"><i class="fas fa-arrow-left"></i> ← Вернуться в админ-панель</a><a href="/" class="back-to-site"><i class="fas fa-home"></i> На сайт</a></div><div class="settings-card"><div class="settings-header"><h1><i class="fas fa-sliders-h"></i> Настройка главной страницы</h1><p>Выберите, какие пластинки отображать на главной</p></div><div class="settings-body">${req.query.saved ? '<div class="success-message"><i class="fas fa-check-circle"></i> Настройки сохранены!</div>' : ''}<form action="/admin/settings" method="POST"><div class="setting-option ${currentMode === 'last_added' ? 'selected' : ''}"><input type="radio" name="homepage_products" value="last_added" id="last_added" ${currentMode === 'last_added' ? 'checked' : ''}><label for="last_added"><div class="option-icon"><i class="fas fa-clock"></i></div><div class="option-content"><div class="option-title">Последние добавленные</div><div class="option-desc">Показывать 6 последних добавленных пластинок</div></div></label></div><div class="setting-option ${currentMode === 'popular' ? 'selected' : ''}"><input type="radio" name="homepage_products" value="popular" id="popular" ${currentMode === 'popular' ? 'selected' : ''}><label for="popular"><div class="option-icon"><i class="fas fa-fire"></i></div><div class="option-content"><div class="option-title">Популярные</div><div class="option-desc">Показывать самые популярные пластинки</div></div></label></div><div class="setting-option ${currentMode === 'all' ? 'selected' : ''}"><input type="radio" name="homepage_products" value="all" id="all" ${currentMode === 'all' ? 'selected' : ''}><label for="all"><div class="option-icon"><i class="fas fa-list"></i></div><div class="option-content"><div class="option-title">Все пластинки</div><div class="option-desc">Показывать все пластинки (до 12 штук)</div></div></label></div><button type="submit" class="save-btn"><i class="fas fa-save"></i> Сохранить настройки</button></form><a href="/admin" class="back-link"><i class="fas fa-arrow-left"></i> Вернуться в админ панель</a></div></div></div></body></html>
        `);
    } catch (err) {
        res.status(500).send("Ошибка загрузки настроек");
    }
});

app.post("/admin/settings", requireAdmin, (req, res) => {
    const { homepage_products } = req.body;
    try {
        db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)").run('homepage_products', homepage_products);
        res.redirect("/admin/settings?saved=1");
    } catch (err) {
        console.error("Ошибка сохранения настроек:", err);
        res.redirect("/admin/settings?error=1");
    }
});

// ============================================================
// ===================== ПРОФИЛЬ ==============================
// ============================================================
app.get("/profile", requireAuth, (req, res) => {
    const user = req.session.user;
    try {
        const userData = db.prepare("SELECT avatar FROM users WHERE id = ?").get(user.id);
        const avatar = userData ? userData.avatar : 'default-avatar.png';
        
        if (req.isMobile) {
            const favs = db.prepare("SELECT COUNT(*) as favs FROM favorites WHERE user_id = ?").get(user.id);
            const content = `
                <div class="profile-header">
                    <div class="avatar-container" onclick="openAvatarModal()">
                        <img src="/avatars/${avatar}" class="profile-avatar" id="profileAvatar">
                        <div class="avatar-overlay"><i class="fas fa-camera"></i></div>
                    </div>
                    <h2 class="profile-name">${escapeHtml(user.username)}</h2>
                    <p class="profile-role">${user.role === 'admin' ? 'Администратор' : 'Покупатель'}</p>
                </div>
                <div class="profile-stats">
                    <div class="stat"><div class="stat-value">0</div><div class="stat-label">Заказов</div></div>
                    <div class="stat"><div class="stat-value">${favs ? favs.favs : 0}</div><div class="stat-label">Избранное</div></div>
                </div>
                <div class="profile-menu">
                    <div class="menu-item" onclick="openSettingsModal(event)"><i class="fas fa-user-edit"></i><span>Настройки аккаунта</span><i class="fas fa-chevron-right arrow"></i></div>
                    <div class="menu-item" onclick="openFavoritesModal()"><i class="fas fa-heart"></i><span>Избранное</span><i class="fas fa-chevron-right arrow"></i></div>
                    <div class="menu-item" onclick="openSettingsModal(event)"><i class="fas fa-credit-card"></i><span>Способы оплаты</span><i class="fas fa-chevron-right arrow"></i></div>
                </div>
                ${user.role === 'admin' ? '<a href="/admin" class="admin-panel-btn"><i class="fas fa-crown"></i> Админ панель</a>' : ''}
                <a href="/logout" class="logout-btn">Выйти</a>
                
                <!-- Модальное окно для аватарки -->
                <div id="avatarModal" class="modal-overlay" style="display:none;">
                    <div class="modal-content" style="max-width:450px; text-align:center;">
                        <button class="modal-close" onclick="closeAvatarModal()">&times;</button>
                        <h3 style="color:#ff7a2f; margin-bottom:20px;">📸 Изменить аватар</h3>
                        <div style="margin-bottom:20px;">
                            <div style="width:200px; height:200px; margin:0 auto; overflow:hidden; border-radius:50%; border:3px solid #ff7a2f;">
                                <img src="/avatars/${avatar}" id="avatarPreview" style="width:100%; height:100%; object-fit:cover;">
                            </div>
                        </div>
                        <input type="file" id="avatarFileInput" accept="image/*" style="display:none;" onchange="loadImageForCrop()">
                        <button type="button" onclick="document.getElementById('avatarFileInput').click()" style="background:rgba(255,122,47,0.2); border:1px solid #ff7a2f; color:#ff7a2f; padding:10px 20px; border-radius:8px; cursor:pointer; width:100%; margin-bottom:10px;">📁 Выбрать изображение</button>
                        <div id="cropContainer" style="display:none; margin-top:15px;">
                            <div style="width:100%; height:300px; margin-bottom:10px;">
                                <img id="cropImage" style="max-width:100%; max-height:100%;">
                            </div>
                            <button onclick="cropAndUpload()" class="submit-review-btn" style="margin-top:5px;">✂️ Обрезать и загрузить</button>
                        </div>
                        <p id="avatarUploadMessage" style="margin-top:10px; font-size:12px;"></p>
                    </div>
                </div>
                
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.js"></script>
                <script>
                let cropper = null;
                function openAvatarModal() { document.getElementById('avatarModal').style.display = 'flex'; document.getElementById('cropContainer').style.display = 'none'; }
                function closeAvatarModal() { document.getElementById('avatarModal').style.display = 'none'; if(cropper) cropper.destroy(); }
                function loadImageForCrop() { /* ... */ }
                function cropAndUpload() { /* ... */ }
                function openSettingsModal(e) { e.preventDefault(); document.getElementById('settingsModal').style.display = 'flex'; }
                function closeSettingsModal() { document.getElementById('settingsModal').style.display = 'none'; }
                async function loadFavoritesList() { /* ... */ }
                function openFavoritesModal() { document.getElementById('favoritesModal').style.display = 'flex'; loadFavoritesList(); }
                function closeFavoritesModal() { document.getElementById('favoritesModal').style.display = 'none'; }
                async function removeFromFavoritesModal(productId, type) { /* ... */ }
                function viewProduct(productId, type) { openProductModal(productId, type); }
                async function updateFavCount() { /* ... */ }
                </script>
                <style>
                    .favorite-item:hover { background: rgba(255,255,255,0.1); border-color: #ff7a2f; transform: translateX(5px); }
                    .modal-content::-webkit-scrollbar { width: 8px; }
                    .modal-content::-webkit-scrollbar-track { background: #1a1a1a; border-radius: 4px; }
                    .modal-content::-webkit-scrollbar-thumb { background: #ff7a2f; border-radius: 4px; }
                    .modal-content::-webkit-scrollbar-thumb:hover { background: #ff0000; }
                    .toast-notification { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: #4CAF50; color: white; padding: 10px 20px; border-radius: 8px; z-index: 10000; animation: fadeOut 2s forwards; font-size: 14px; white-space: nowrap; }
                    @keyframes fadeOut { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
                </style>
            `;
            res.send(renderMobilePage('Профиль', content, user, 'profile'));
        } else {
            const favCount = db.prepare("SELECT COUNT(*) as favs FROM favorites WHERE user_id = ?").get(user.id);
            // Десктопная версия профиля
            res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Мой профиль · Plastinka</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.css">
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg" alt="Plastinka"></a></div>
    <div class="search-bar-desktop"><i class="fas fa-search"></i><input type="text" id="desktop-search-input" placeholder="Поиск пластинок..."></div>
    <div class="right-icons"><a href="/catalog"><img src="/photo/icon-katalog.png"></a><a href="/profile"><img src="/photo/profile_icon.png"></a><a href="/cart"><img src="/photo/knopka-korzina.svg"></a></div>
</header>
<div class="profile-wrapper">
    <div class="profile-card">
        <div class="profile-cover"></div>
        <div class="profile-avatar-wrapper">
            <div class="avatar-container">
                <img src="/avatars/${avatar}" class="profile-avatar" id="profileAvatar" onclick="openAvatarModal()">
                <div class="avatar-overlay" onclick="openAvatarModal()"><i class="fas fa-camera"></i></div>
            </div>
            <h2 class="profile-name">${escapeHtml(user.username)}</h2>
            <div class="profile-role">${user.role === 'admin' ? 'Администратор' : '🎧 Меломан'}</div>
        </div>
        <div class="profile-stats">
            <div class="stat"><div class="stat-value">0</div><div class="stat-label">Заказов</div></div>
            <div class="stat"><div class="stat-value">${favCount}</div><div class="stat-label">Избранное</div></div>
        </div>
        <div class="profile-menu">
            <div class="menu-item" onclick="openSettingsModal()"><i class="fas fa-user-edit"></i><span>Настройки аккаунта</span><i class="fas fa-chevron-right arrow"></i></div>
            <div class="menu-item" onclick="window.location='/favorites'"><i class="fas fa-heart"></i><span>Избранное</span><i class="fas fa-chevron-right arrow"></i></div>
        </div>
        ${user.role === 'admin' ? '<a href="/admin" class="admin-panel-btn"><i class="fas fa-crown"></i> Админ панель</a>' : ''}
        <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Выйти</a>
    </div>
</div>
<footer><img src="/photo/logo-2.svg" class="footer-logo" alt="Plastinka"></footer>

<!-- Модалки (аватар, настройки, избранное) – скопируйте из вашего существующего кода -->
<div id="avatarModal" class="modal-overlay" style="display:none;">
    <div class="modal-content" style="text-align:center;">
        <button class="modal-close" onclick="closeAvatarModal()">&times;</button>
        <h3 style="color:#ff7a2f; margin-bottom:20px;">📸 Изменить аватар</h3>
        <div style="margin-bottom:20px;"><div style="width:150px; height:150px; margin:0 auto; overflow:hidden; border-radius:50%; border:3px solid #ff7a2f;"><img src="/avatars/${avatar}" id="avatarPreview" style="width:100%; height:100%; object-fit:cover;"></div></div>
        <input type="file" id="avatarFileInput" accept="image/*" style="display:none;" onchange="loadImageForCrop()">
        <button type="button" onclick="document.getElementById('avatarFileInput').click()" style="background:rgba(255,122,47,0.2); border:1px solid #ff7a2f; color:#ff7a2f; padding:10px 20px; border-radius:8px; cursor:pointer; width:100%; margin-bottom:10px;">📁 Выбрать изображение</button>
        <div id="cropContainer" style="display:none; margin-top:15px;"><div style="width:100%; height:300px; margin-bottom:10px;"><img id="cropImage" style="max-width:100%; max-height:100%;"></div><button onclick="cropAndUpload()" class="submit-review-btn" style="margin-top:5px;">✂️ Обрезать и загрузить</button></div>
        <p id="avatarUploadMessage" style="margin-top:10px; font-size:12px;"></p>
    </div>
</div>
<div id="settingsModal" class="modal-overlay" style="display:none;">
    <div class="modal-content">
        <button class="modal-close" onclick="closeSettingsModal()">&times;</button>
        <h3 style="color:#ff7a2f; margin-bottom:20px;">⚙️ Настройки аккаунта</h3>
        <form id="settingsForm">
            <input type="text" id="settingsUsername" value="${escapeHtml(user.username)}" placeholder="Имя пользователя" style="width:100%; padding:10px; margin-bottom:10px; background:#111; border:1px solid #333; border-radius:8px; color:white;">
            <input type="password" id="settingsCurrentPassword" placeholder="Текущий пароль (для смены)" style="width:100%; padding:10px; margin-bottom:10px; background:#111; border:1px solid #333; border-radius:8px; color:white;">
            <input type="password" id="settingsNewPassword" placeholder="Новый пароль" style="width:100%; padding:10px; margin-bottom:10px; background:#111; border:1px solid #333; border-radius:8px; color:white;">
            <button type="submit" class="modal-add-to-cart">Сохранить изменения</button>
        </form>
        <p id="settingsMessage" style="margin-top:10px; text-align:center;"></p>
    </div>
</div>
<div id="favoritesModal" class="modal-overlay" style="display:none;">
    <div class="modal-content" style="max-width:600px; max-height:80vh; overflow-y:auto;">
        <button class="modal-close" onclick="closeFavoritesModal()">&times;</button>
        <h3 style="color:#ff7a2f; text-align:center;"><i class="fas fa-heart"></i> Моё избранное</h3>
        <div id="favoritesList" style="display:flex; flex-direction:column; gap:15px;"><div style="text-align:center; padding:40px; color:#666;"><i class="fas fa-spinner fa-spin"></i><br>Загрузка...</div></div>
    </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.js"></script>
<script src="/main.js"></script>
</body>
</html>`); // Здесь должен быть полный HTML десктопного профиля
        }
    } catch (err) {
        res.status(500).send("Ошибка загрузки профиля");
    }
});

// ============================================================
// API ДЛЯ МОДАЛЬНОГО ОКНА ТОВАРА
// ============================================================
app.get("/api/product/:id", requireAuth, (req, res) => {
    const id = req.params.id;
    const type = req.query.type || 'product';
    const table = type === 'product' ? 'products' : 'players';
    try {
        const item = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!item) return res.status(404).json({ error: 'Товар не найден' });
        res.json(item);
    } catch (err) {
        res.status(404).json({ error: 'Товар не найден' });
    }
});

app.get("/api/product-rating/:id", requireAuth, (req, res) => {
    const productId = req.params.id;
    const type = req.query.type || 'product';
    const productIdentifier = type === 'product' ? `product_${productId}` : `player_${productId}`;
    try {
        const data = db.prepare("SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?").get(productIdentifier);
        res.json({ avg_rating: data?.avg_rating || 0, votes_count: data?.votes_count || 0 });
    } catch (err) {
        res.json({ avg_rating: 0, votes_count: 0 });
    }
});

app.get("/api/product-comments/:id", requireAuth, (req, res) => {
    const productId = req.params.id;
    const type = req.query.type || 'product';
    const productIdentifier = type === 'product' ? `product_${productId}` : `player_${productId}`;
    try {
        const rows = db.prepare(`SELECT r.*, u.username FROM ratings r JOIN users u ON r.user_id = u.id WHERE r.product_id = ? ORDER BY r.created_at DESC`).all(productIdentifier);
        res.json(rows || []);
    } catch (err) {
        res.json([]);
    }
});

app.get("/api/check-favorite/:id", requireAuth, (req, res) => {
    const productId = req.params.id;
    const type = req.query.type || 'product';
    const userId = req.session.user.id;
    const productIdentifier = type === 'product' ? `product_${productId}` : `player_${productId}`;
    try {
        const row = db.prepare("SELECT id FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, productIdentifier);
        res.json({ isFavorite: !!row });
    } catch (err) {
        res.json({ isFavorite: false });
    }
});

app.post("/api/toggle-favorite", requireAuth, express.json(), (req, res) => {
    const { product_id, type } = req.body;
    const userId = req.session.user.id;
    try {
        const row = db.prepare("SELECT id FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, product_id);
        if (row) {
            db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(userId, product_id);
            res.json({ success: true, isFavorite: false });
        } else {
            db.prepare("INSERT INTO favorites (user_id, product_id, added_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(userId, product_id);
            res.json({ success: true, isFavorite: true });
        }
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post("/api/add-to-cart", requireAuth, express.json(), (req, res) => {
    const { product_id, quantity } = req.body;
    const userId = req.session.user.id;
    try {
        const row = db.prepare("SELECT id, quantity FROM carts WHERE user_id = ? AND product_id = ?").get(userId, product_id);
        if (row) {
            db.prepare("UPDATE carts SET quantity = quantity + ? WHERE id = ?").run(quantity || 1, row.id);
        } else {
            db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)").run(userId, product_id, quantity || 1);
        }
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post("/api/submit-rating", requireAuth, express.json(), (req, res) => {
    const { product_id, product_type, rating, comment } = req.body;
    const userId = req.session.user.id;
    const productIdentifier = product_type === 'product' ? `product_${product_id}` : `player_${product_id}`;
    try {
        const existing = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND product_id = ?").get(userId, productIdentifier);
        if (existing) {
            db.prepare("UPDATE ratings SET rating = ?, comment = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?").run(rating, comment || '', existing.id);
        } else {
            db.prepare("INSERT INTO ratings (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)").run(userId, productIdentifier, rating, comment || '');
        }
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============================================================
// ===================== КАТАЛОГ ==============================
// ============================================================
function buildCatalogQuery(genre, minPrice, maxPrice, sort, search) {
    let sql = "SELECT * FROM products WHERE 1=1";
    const params = [];
    if (search && search.trim()) {
        sql += " AND (name LIKE ? OR artist LIKE ?)";
        const searchTerm = `%${search.trim()}%`;
        params.push(searchTerm, searchTerm);
    }
    if (genre && genre !== 'all') { sql += " AND genre = ?"; params.push(genre); }
    if (minPrice) { sql += " AND price >= ?"; params.push(parseFloat(minPrice)); }
    if (maxPrice) { sql += " AND price <= ?"; params.push(parseFloat(maxPrice)); }
    switch(sort) {
        case 'price_asc': sql += " ORDER BY price ASC"; break;
        case 'price_desc': sql += " ORDER BY price DESC"; break;
        case 'name_asc': sql += " ORDER BY name ASC"; break;
        case 'name_desc': sql += " ORDER BY name DESC"; break;
        case 'artist_asc': sql += " ORDER BY artist ASC"; break;
        case 'artist_desc': sql += " ORDER BY artist DESC"; break;
        case 'year_desc': sql += " ORDER BY year DESC"; break;
        case 'year_asc': sql += " ORDER BY year ASC"; break;
        default: sql += " ORDER BY id DESC";
    }
    return { sql, params };
}

const DEFAULT_COVER = "/uploads/666.png";

app.get("/catalog", (req, res) => {
    const user = req.session.user;
    const { genre, minPrice, maxPrice, sort, search } = req.query;
    const { sql, params } = buildCatalogQuery(genre, minPrice, maxPrice, sort, search);
    
    try {
        let products = db.prepare(sql).all(...params);
        for (const product of products) {
            const rating = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(product.id);
            product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
            product.votes_count = rating?.votes_count || 0;
        }
        
        // Генерация HTML товаров (используем те же классы, что на главной)
        let productHTML = '';
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
        
        // Форма фильтров (десктоп)
        const genresResult = db.prepare("SELECT DISTINCT genre FROM products WHERE genre IS NOT NULL AND genre != ''").all();
        const filterForm = `
        <div class="filter-bar" style="margin: 20px auto; max-width: 1200px; padding: 0 20px;">
            <form method="GET" action="/catalog" style="display: flex; gap: 10px; flex-wrap: wrap; background: #1a1a1a; padding: 15px; border-radius: 12px;">
                <input type="text" name="search" placeholder="Поиск..." value="${escapeHtml(search || '')}" style="flex: 2; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: white;">
                <select name="genre" style="flex: 1; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: white;">
                    <option value="all">Все жанры</option>
                    ${genresResult.map(g => `<option value="${g.genre}" ${genre === g.genre ? 'selected' : ''}>${g.genre}</option>`).join('')}
                </select>
                <input type="number" name="minPrice" placeholder="Цена от" value="${minPrice || ''}" style="width: 110px; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: white;">
                <input type="number" name="maxPrice" placeholder="Цена до" value="${maxPrice || ''}" style="width: 110px; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: white;">
                <button type="submit" class="add-to-cart" style="background: linear-gradient(45deg,#ff0000,#990000); border: none; padding: 0 20px; border-radius: 8px; color: white; cursor: pointer;">Фильтр</button>
            </form>
        </div>`;
        
        // Десктопная страница (копируем структуру с главной)
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Каталог · Plastinka</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
/* Все стили из главной страницы (скопируйте их из вашего десктопного шаблона) */
/* ... (я не буду дублировать 300 строк, но вы можете вынести общий CSS в отдельный файл) ... */
/* Для краткости предполагаем, что style.css уже содержит все необходимые стили */
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
        <a href="/catalog"><img src="/photo/icon-katalog.png" alt="Каталог"></a>
        <a href="/profile"><img src="/photo/profile_icon.png" alt="Профиль"></a>
        <a href="/cart"><img src="/photo/knopka-korzina.svg" alt="Корзина"></a>
    </div>
</header>
<section class="catalog-title-section"><h2 class="catalog-title">КАТАЛОГ</h2></section>
${filterForm}
<section class="benefits"><div class="benefits-grid">${productHTML || '<p style="text-align: center; color: #aaa; grid-column: 1/-1;">Товаров пока нет</p>'}</div></section>
<footer><img src="/photo/logo-2.svg" class="footer-logo" alt="Plastinka"></footer>
<!-- Скрипты для поиска и модалок (скопируйте из главной страницы) -->
<script>
// Скопируйте все JS-функции из главной страницы (search, модалки, корзина, избранное и т.д.)
// Особенно важны: performSearch, addToCartFromModalDesktop, toggleFavoriteFromModalDesktop и т.п.
// Для экономии места я не буду их дублировать – они уже есть у вас в глобальном скрипте.
</script>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        console.error("Ошибка каталога:", err);
        res.status(500).send("Ошибка загрузки каталога");
    }
});

// ============================================================
// АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
// ============================================================

app.get("/login", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Вход · Plastinka</title><link rel="stylesheet" href="/style.css"><style>body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px}.login-container{max-width:400px;width:100%;padding:40px;background:#181818;border-radius:16px;box-shadow:0 0 40px rgba(255,0,0,0.15);text-align:center}.login-container img{width:200px;margin-bottom:30px}.login-container h1{margin-bottom:10px}.subtitle{color:#888;margin-bottom:30px}.form-group{margin-bottom:20px;text-align:left}.form-group label{display:block;margin-bottom:8px;color:#aaa}.form-group input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;box-sizing:border-box}.login-btn{width:100%;padding:14px;border:none;background:linear-gradient(45deg,#ff0000,#990000);color:#fff;border-radius:10px;font-weight:bold;cursor:pointer}.register-link{margin-top:20px;color:#aaa}.register-link a{color:#ff0000;text-decoration:none}.error-message{background:rgba(255,0,0,0.1);border:1px solid #ff0000;color:#ff0000;padding:10px;border-radius:8px;margin-bottom:20px}</style></head><body><div class="login-container"><img src="/photo/logo.svg"><h1 style="color: white;">Добро пожаловать</h1><div class="subtitle">Войдите в свой аккаунт</div>${req.query.error?'<div class="error-message">❌ Неверное имя пользователя или пароль</div>':''}${req.query.registered?'<div class="error-message" style="background:rgba(0,255,0,0.1);border-color:#00ff00;color:#00ff00;">✅ Регистрация успешна! Теперь вы можете войти</div>':''}<form action="/login" method="POST"><div class="form-group"><label>Имя пользователя</label><input type="text" name="username" required></div><div class="form-group"><label>Пароль</label><input type="password" name="password" required></div><button type="submit" class="login-btn">Войти</button></form><div class="register-link">Нет аккаунта? <a href="/register">Зарегистрироваться</a></div><a href="/" style="display:block;margin-top:20px;color:#666;">← Вернуться на главную</a></div></body></html>`);
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    try {
        const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, role: user.role, avatar: user.avatar };
            res.redirect("/");
        } else {
            res.redirect("/login?error=1");
        }
    } catch (err) {
        res.redirect("/login?error=1");
    }
});

app.get("/register", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Регистрация · Plastinka</title><link rel="stylesheet" href="/style.css"><style>body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px}.register-container{max-width:400px;width:100%;padding:40px;background:#181818;border-radius:16px;box-shadow:0 0 40px rgba(255,0,0,0.15);text-align:center}.register-container img{width:200px;margin-bottom:30px}.register-container h1{margin-bottom:10px}.subtitle{color:#888;margin-bottom:30px}.form-group{margin-bottom:20px;text-align:left}.form-group label{display:block;margin-bottom:8px;color:#aaa}.form-group input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;box-sizing:border-box}.register-btn{width:100%;padding:14px;border:none;background:linear-gradient(45deg,#ff0000,#990000);color:#fff;border-radius:10px;font-weight:bold;cursor:pointer}.login-link{margin-top:20px;color:#aaa}.login-link a{color:#ff0000;text-decoration:none}.error-message{background:rgba(255,0,0,0.1);border:1px solid #ff0000;color:#ff0000;padding:10px;border-radius:8px;margin-bottom:20px}</style></head><body><div class="register-container"><img src="/photo/logo.svg"><h1 style="color: white;">Создать аккаунт</h1><div class="subtitle">Присоединяйтесь к Plastinka</div>${req.query.error==='exists'?'<div class="error-message">❌ Пользователь с таким именем уже существует</div>':''}<form action="/register" method="POST"><div class="form-group"><label>Имя пользователя</label><input type="text" name="username" required></div><div class="form-group"><label>Пароль</label><input type="password" name="password" required></div><button type="submit" class="register-btn">Зарегистрироваться</button></form><div class="login-link">Уже есть аккаунт? <a href="/login">Войти</a></div><a href="/" style="display:block;margin-top:20px;color:#666;">← Вернуться на главную</a></div></body></html>`);
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
// ===================== ИЗБРАННОЕ ============================
// ============================================================
app.get("/favorites", requireAuth, (req, res) => {
    const user = req.session.user;
    try {
        // Получаем все записи избранного для текущего пользователя
        const favorites = db.prepare(`
            SELECT product_id, added_at 
            FROM favorites 
            WHERE user_id = ? 
            ORDER BY added_at DESC
        `).all(user.id);

        let itemsHTML = '';
        
        for (const fav of favorites) {
            const productId = fav.product_id;
            let item = null;
            let type = '';
            let imagePath = '';
            
            if (productId.startsWith('product_')) {
                type = 'product';
                const id = productId.replace('product_', '');
                item = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
                if (item) imagePath = `/uploads/${item.image}`;
            } else if (productId.startsWith('player_')) {
                type = 'player';
                const id = productId.replace('player_', '');
                item = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
                if (item) imagePath = `/photo/${item.image}`;
            }
            
            if (!item) continue; // товар мог быть удалён
            
            itemsHTML += `
                <div class="product-card" data-fav-id="${productId}" data-type="${type}">
                    <div class="product-image">
                        <img src="${imagePath}" alt="${escapeHtml(item.name)}" onerror="this.src='/photo/plastinka-audio.png'">
                    </div>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(item.name)}</div>
                        <div class="product-artist">${escapeHtml(type === 'product' ? item.artist : 'Проигрыватель')}</div>
                        <div class="product-price">$${item.price}</div>
                        <div class="product-actions">
                            <button class="action-btn" onclick="addToCartMobile('${productId}')">
                                <i class="fas fa-shopping-cart"></i>
                            </button>
                            <button class="action-btn" onclick="removeFromFavorites('${productId}', this)">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
        
        if (itemsHTML === '') {
            itemsHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❤️</div>
                    <h3>Избранное пусто</h3>
                    <p>Добавляйте понравившиеся пластинки, нажимая на сердечко</p>
                    <a href="/catalog" class="empty-btn">Перейти в каталог</a>
                </div>
            `;
        }
        
        // Добавляем JS-функцию для удаления из избранного прямо на странице
        const script = `
            <script>
                function removeFromFavorites(productId, btnElement) {
                    if (!confirm('Удалить из избранного?')) return;
                    fetch('/api/favorites/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: productId })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            // Удаляем карточку из DOM
                            const card = btnElement.closest('.product-card');
                            if (card) card.remove();
                            showToastMobile('Удалено из избранного', false);
                            // Если больше нет карточек, показываем сообщение
                            if (document.querySelectorAll('.product-card').length === 0) {
                                location.reload(); // или обновить содержимое
                            }
                        } else {
                            showToastMobile('Ошибка', true);
                        }
                    });
                }
            </script>
        `;
        
        const content = `<div class="products-grid">${itemsHTML}</div>${script}`;
        res.send(renderMobilePage('Избранное', content, user, 'favorites'));
    } catch (err) {
        console.error("Ошибка загрузки избранного:", err);
        res.status(500).send(renderMobilePage('Ошибка', '<div class="empty-state">❌ Ошибка загрузки</div>', user, 'favorites'));
    }
});

// ============================================================
// ===================== АДМИН ПАНЕЛЬ =========================
// ============================================================
app.get("/admin", requireAdmin, (req, res) => {
    try {
        const products = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
        const players = db.prepare("SELECT * FROM players ORDER BY id DESC").all();
        const users = db.prepare("SELECT id, username, role, avatar FROM users ORDER BY id DESC").all();
        
        let productsRows = '';
        for (const p of products) {
            const rating = db.prepare("SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?").get(p.id);
            const avgRating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
            productsRows += `<tr><td><span class="badge product">📀 Пластинка</span></td><td><img src="/uploads/${escapeHtml(p.image)}" class="table-img"></td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.artist)}</td><td>${escapeHtml(p.genre || '-')}</td><td>${escapeHtml(p.year || '-')}</td><td>$${p.price}</td><td>${generateRatingStars(avgRating, rating?.votes_count || 0)}</td><td class="actions"><button class="edit-product" data-id="${p.id}"><i class="fas fa-edit"></i></button><button class="delete-product" data-id="${p.id}"><i class="fas fa-trash"></i></button></td></tr>`;
        }
        
        let playersRows = '';
        for (const p of players) {
            playersRows += `<tr><td><span class="badge player">🎵 Проигрыватель</span></td><td><img src="/photo/${escapeHtml(p.image)}" class="table-img"></td><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.description) || 'Нет описания'}</td><td>$${p.price}</td><td class="actions"><button class="edit-player" data-id="${p.id}"><i class="fas fa-edit"></i></button><button class="delete-player" data-id="${p.id}"><i class="fas fa-trash"></i></button></td></tr>`;
        }
        
        let usersRows = '';
        for (const u of users) {
            const reviewsCount = db.prepare("SELECT COUNT(*) as count FROM ratings WHERE user_id = ?").get(u.id)?.count || 0;
            const favoritesCount = db.prepare("SELECT COUNT(*) as count FROM favorites WHERE user_id = ?").get(u.id)?.count || 0;
            const cartCount = db.prepare("SELECT SUM(quantity) as total FROM carts WHERE user_id = ?").get(u.id)?.total || 0;
            usersRows += `<tr><td><img src="/avatars/${escapeHtml(u.avatar || 'default-avatar.png')}" class="user-avatar-sm"></td><td><strong>${escapeHtml(u.username)}</strong></td><td><span class="badge ${u.role === 'admin' ? 'admin' : 'user'}">${u.role === 'admin' ? '👑 Админ' : '👤 Пользователь'}</span></td><td class="stats-cell"><button class="reviews-btn" data-id="${u.id}" data-name="${escapeHtml(u.username)}"><i class="fas fa-star"></i> ${reviewsCount}</button></td><td class="stats-cell"><button class="favorites-btn" data-id="${u.id}"><i class="fas fa-heart"></i> ${favoritesCount}</button></td><td class="stats-cell"><button class="cart-btn" data-id="${u.id}"><i class="fas fa-shopping-cart"></i> ${cartCount}</button></td><td class="actions"><button class="edit-user" data-id="${u.id}" data-name="${escapeHtml(u.username)}" data-role="${u.role}"><i class="fas fa-edit"></i></button>${u.username !== 'admin' ? '<button class="delete-user" data-id="' + u.id + '"><i class="fas fa-trash"></i></button>' : ''}</td></tr>`;
        }
        
        res.send(adminPanelHTML(products.length, players.length, users.length, productsRows, playersRows, usersRows, escapeHtml(req.session.user.username)));
    } catch (error) {
        console.error('Admin panel error:', error);
        res.status(500).send('Ошибка загрузки админ панели');
    }
});

function adminPanelHTML(productCount, playerCount, userCount, productsRows, playersRows, usersRows, username) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Админ панель · Plastinka</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: linear-gradient(135deg, #0a0a0a 0%, #0f0f0f 100%); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #fff; min-height: 100vh; }
        .admin-wrapper { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .admin-header { background: rgba(24,24,24,0.95); border-radius: 20px; padding: 20px 30px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,0,0,0.2); flex-wrap: wrap; gap: 15px; }
        .header-left h1 { font-size: 28px; background: linear-gradient(135deg, #fff, #ff4444); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .header-left p { color: #888; font-size: 14px; margin-top: 5px; }
        .header-right { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
        .admin-user { display: flex; align-items: center; gap: 10px; background: rgba(255,0,0,0.1); padding: 8px 16px; border-radius: 40px; }
        .logout-link { color: #ff4444; text-decoration: none; display: flex; align-items: center; gap: 8px; transition: 0.2s; padding: 8px 12px; border-radius: 8px; }
        .logout-link:hover { background: rgba(255,68,68,0.1); color: #ff0000; }
        .home-link { color: #4CAF50; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: rgba(24,24,24,0.9); border-radius: 16px; padding: 20px; border: 1px solid rgba(255,0,0,0.15); transition: 0.2s; text-align: center; }
        .stat-card:hover { border-color: #ff0000; transform: translateY(-2px); }
        .stat-value { font-size: 32px; font-weight: 700; color: #ff4444; }
        .stat-label { color: #888; margin-top: 5px; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .tab-btn { background: rgba(24,24,24,0.9); border: 1px solid rgba(255,0,0,0.2); padding: 12px 24px; border-radius: 12px; color: #fff; cursor: pointer; font-size: 16px; font-weight: 500; transition: 0.2s; display: flex; align-items: center; gap: 8px; }
        .tab-btn:hover { border-color: #ff0000; background: rgba(255,0,0,0.1); }
        .tab-btn.active { background: linear-gradient(135deg, #ff0000, #990000); border-color: #ff0000; }
        .table-container { background: rgba(24,24,24,0.95); border-radius: 20px; border: 1px solid rgba(255,0,0,0.15); overflow-x: auto; margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: rgba(0,0,0,0.4); padding: 15px; text-align: left; color: #ff4444; font-weight: 600; }
        td { padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
        .table-img { width: 50px; height: 50px; object-fit: cover; border-radius: 8px; }
        .user-avatar-sm { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
        .badge.product { background: rgba(76,175,80,0.2); color: #4CAF50; }
        .badge.player { background: rgba(255,122,47,0.2); color: #ff7a2f; }
        .badge.admin { background: rgba(244,67,54,0.2); color: #f44336; }
        .badge.user { background: rgba(33,150,243,0.2); color: #2196F3; }
        .stats-cell { text-align: center; }
        .stats-cell button { background: rgba(255,255,255,0.1); border: none; color: #fff; padding: 6px 12px; border-radius: 20px; cursor: pointer; transition: 0.2s; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
        .stats-cell button:hover { background: #ff0000; transform: scale(1.05); }
        .actions { display: flex; gap: 8px; align-items: center; }
        .edit-product, .delete-product, .edit-player, .delete-player, .edit-user, .delete-user { width: 32px; height: 32px; border-radius: 8px; border: none; cursor: pointer; transition: 0.2s; display: inline-flex; align-items: center; justify-content: center; }
        .edit-product, .edit-player, .edit-user { background: rgba(255,193,7,0.15); color: #ffc107; }
        .edit-product:hover, .edit-player:hover, .edit-user:hover { background: #ffc107; color: #000; }
        .delete-product, .delete-player, .delete-user { background: rgba(244,67,54,0.15); color: #f44336; }
        .delete-product:hover, .delete-player:hover, .delete-user:hover { background: #f44336; color: #fff; }
        .action-buttons { display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 20px; }
        .btn-primary, .btn-secondary, .btn-settings { padding: 12px 24px; border-radius: 12px; border: none; cursor: pointer; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s; }
        .btn-primary { background: linear-gradient(135deg, #4CAF50, #2e7d32); color: white; }
        .btn-secondary { background: linear-gradient(135deg, #ff7a2f, #cc5500); color: white; }
        .btn-settings { background: linear-gradient(135deg, #2196F3, #0d47a1); color: white; }
        .btn-primary:hover, .btn-secondary:hover, .btn-settings:hover { transform: translateY(-2px); filter: brightness(1.05); }
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); backdrop-filter: blur(5px); z-index: 1000; justify-content: center; align-items: center; }
        .modal-overlay.active { display: flex; }
        .modal-content { background: linear-gradient(145deg, #2a2a2a, #1e1e1e); border-radius: 20px; padding: 30px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid #ff7a2f; position: relative; }
        .modal-content h3 { color: #ff7a2f; margin-bottom: 20px; font-size: 24px; }
        .modal-content input, .modal-content select, .modal-content textarea { width: 100%; padding: 12px; margin-bottom: 15px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 14px; }
        .modal-content textarea { resize: vertical; min-height: 80px; }
        .modal-buttons { display: flex; gap: 10px; margin-top: 10px; }
        .modal-buttons button { flex: 1; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        .modal-buttons button[type="submit"] { background: linear-gradient(45deg, #ff0000, #990000); border: none; color: white; }
        .modal-buttons button[type="button"] { background: #333; border: none; color: #fff; }
        .modal-close { position: absolute; top: 15px; right: 15px; background: none; border: none; color: #fff; font-size: 30px; cursor: pointer; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(255, 0, 0, 0.1); transition: 0.3s; }
        .modal-close:hover { background: #ff0000; transform: rotate(90deg); }
        .user-data-item { background: rgba(0,0,0,0.3); border-radius: 12px; padding: 12px; margin-bottom: 10px; transition: 0.2s; }
        .user-data-item:hover { background: rgba(255,0,0,0.1); transform: translateX(5px); }
        .user-data-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
        .user-data-image { width: 50px; height: 50px; object-fit: cover; border-radius: 8px; }
        .user-data-info { flex: 1; }
        .user-data-name { font-weight: bold; color: #fff; }
        .user-data-artist { font-size: 12px; color: #888; }
        .user-data-rating { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
        .user-data-comment { font-size: 13px; color: #ccc; margin-top: 8px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 8px; font-style: italic; }
        .user-data-date { font-size: 10px; color: #666; margin-top: 5px; }
        .admin-reply { margin-top: 10px; padding: 10px; background: rgba(255,122,47,0.1); border-radius: 8px; border-left: 3px solid #ff7a2f; }
        .admin-reply-text { font-size: 12px; color: #ff7a2f; margin-bottom: 5px; }
        .admin-reply-content { font-size: 13px; color: #ddd; }
        .reply-form { margin-top: 10px; display: flex; gap: 10px; }
        .reply-form input { flex: 1; padding: 8px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; }
        .reply-form button { padding: 8px 15px; background: #ff7a2f; border: none; border-radius: 8px; color: #fff; cursor: pointer; }
        .reply-form button:hover { background: #ff0000; }
        .empty-data { text-align: center; padding: 40px; color: #888; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        @media (max-width: 768px) {
            .admin-wrapper { padding: 10px; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
            th, td { padding: 8px; font-size: 12px; }
        }
    </style>
</head>
<body>
<div class="admin-wrapper">
    <div class="admin-header">
        <div class="header-left">
            <h1><i class="fas fa-crown"></i> Админ панель</h1>
            <p>Управление каталогом и пользователями</p>
        </div>
        <div class="header-right">
            <div class="admin-user"><i class="fas fa-user-shield"></i><span>${username}</span></div>
            <a href="/" class="logout-link home-link"><i class="fas fa-home"></i> На сайт</a>
            <a href="/logout" class="logout-link"><i class="fas fa-sign-out-alt"></i> Выйти</a>
        </div>
    </div>
    
    <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${productCount}</div><div class="stat-label">📀 Пластинок</div></div>
        <div class="stat-card"><div class="stat-value">${playerCount}</div><div class="stat-label">🎵 Проигрывателей</div></div>
        <div class="stat-card"><div class="stat-value">${userCount}</div><div class="stat-label">👥 Пользователей</div></div>
        <div class="stat-card"><div class="stat-value">${productCount + playerCount}</div><div class="stat-label">📦 Всего товаров</div></div>
    </div>
    
    <div class="action-buttons">
        <button class="btn-primary" id="addProductBtn"><i class="fas fa-plus-circle"></i> Добавить пластинку</button>
        <button class="btn-secondary" id="addPlayerBtn"><i class="fas fa-plus-circle"></i> Добавить проигрыватель</button>
        <a href="/admin/settings" class="btn-settings"><i class="fas fa-sliders-h"></i> Настройки главной</a>
    </div>
    
    <div class="tabs">
        <button class="tab-btn active" data-tab="products"><i class="fas fa-record-vinyl"></i> Пластинки</button>
        <button class="tab-btn" data-tab="players"><i class="fas fa-headphones"></i> Проигрыватели</button>
        <button class="tab-btn" data-tab="users"><i class="fas fa-users"></i> Пользователи</button>
    </div>
    
    <div id="products-tab" class="tab-content active">
        <div class="table-container">
            <table>
                <thead><tr><th>Тип</th><th>Изображение</th><th>Название</th><th>Исполнитель</th><th>Жанр</th><th>Год</th><th>Цена</th><th>Рейтинг</th><th>Действия</th></tr></thead>
                <tbody>${productsRows || '<tr><td colspan="9">Нет пластинок</td></tr>'}</tbody>
            </table>
        </div>
    </div>
    
    <div id="players-tab" class="tab-content">
        <div class="table-container">
            <table>
                <thead><tr><th>Тип</th><th>Изображение</th><th>Название</th><th>Описание</th><th>Цена</th><th>Действия</th></tr></thead>
                <tbody>${playersRows || '<tr><td colspan="6">Нет проигрывателей</td></tr>'}</tbody>
            </table>
        </div>
    </div>
    
    <div id="users-tab" class="tab-content">
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Аватар</th>
                        <th>Имя</th>
                        <th>Роль</th>
                        <th>📝 Отзывы</th>
                        <th>❤️ Избранное</th>
                        <th>🛒 Корзина</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${usersRows || '<tr><td colspan="7">Нет пользователей</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>
</div>

<!-- Модальные окна -->
<div id="itemModal" class="modal-overlay"><div class="modal-content"><button type="button" class="modal-close" onclick="closeModal('itemModal')">&times;</button><h3 id="modalTitle">Добавить товар</h3><form id="itemForm" enctype="multipart/form-data"><input type="hidden" id="itemId" name="id"><input type="hidden" id="itemType" name="type"><input type="text" id="itemName" name="name" placeholder="Название" required><input type="text" id="itemArtist" name="artist" placeholder="Исполнитель"><input type="text" id="itemGenre" name="genre" placeholder="Жанр"><input type="text" id="itemYear" name="year" placeholder="Год"><input type="number" id="itemPrice" name="price" placeholder="Цена" step="0.01" required><textarea id="itemDescription" name="description" placeholder="Описание"></textarea><input type="file" id="itemImage" name="image" accept="image/*"><input type="file" id="itemAudio" name="audio" accept="audio/*"><div class="modal-buttons"><button type="submit">Сохранить</button><button type="button" onclick="closeModal('itemModal')">Отмена</button></div></form></div></div>

<div id="userModal" class="modal-overlay"><div class="modal-content"><button type="button" class="modal-close" onclick="closeModal('userModal')">&times;</button><h3>Редактировать пользователя</h3><form id="userForm"><input type="hidden" id="editUserId"><input type="text" id="editUsername" placeholder="Имя пользователя" required><select id="editRole"><option value="user">Пользователь</option><option value="admin">Администратор</option></select><input type="password" id="editPassword" placeholder="Новый пароль"><div class="modal-buttons"><button type="submit">Сохранить</button><button type="button" onclick="closeModal('userModal')">Отмена</button></div></form></div></div>

<div id="reviewsModal" class="modal-overlay"><div class="modal-content"><button type="button" class="modal-close" onclick="closeModal('reviewsModal')">&times;</button><h3 id="reviewsTitle">Отзывы пользователя</h3><div id="reviewsList"></div></div></div>

<div id="favoritesModal" class="modal-overlay"><div class="modal-content"><button type="button" class="modal-close" onclick="closeModal('favoritesModal')">&times;</button><h3 id="favoritesTitle">Избранное пользователя</h3><div id="favoritesList"></div></div></div>

<div id="cartModal" class="modal-overlay"><div class="modal-content"><button type="button" class="modal-close" onclick="closeModal('cartModal')">&times;</button><h3 id="cartTitle">Корзина пользователя</h3><div id="cartList"></div><div id="cartTotal"></div></div></div>

<script>
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.onclick = function() {
            document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            document.getElementById(this.dataset.tab + '-tab').classList.add('active');
        };
    });
    
    document.getElementById('addProductBtn').onclick = function() { openAddModal('product'); };
    document.getElementById('addPlayerBtn').onclick = function() { openAddModal('player'); };
    
    function openAddModal(type) {
        document.getElementById('modalTitle').innerText = type === 'product' ? 'Добавить пластинку' : 'Добавить проигрыватель';
        document.getElementById('itemType').value = type;
        document.getElementById('itemId').value = '';
        document.getElementById('itemForm').reset();
        document.getElementById('itemModal').classList.add('active');
    }
    
    document.querySelectorAll('.edit-product').forEach(function(btn) {
        btn.onclick = function() { editItem('product', this.dataset.id); };
    });
    document.querySelectorAll('.edit-player').forEach(function(btn) {
        btn.onclick = function() { editItem('player', this.dataset.id); };
    });
    
    function editItem(type, id) {
        fetch('/admin/get-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type, id: id }) })
            .then(function(res) { return res.json(); }).then(function(data) {
                document.getElementById('modalTitle').innerText = type === 'product' ? 'Редактировать пластинку' : 'Редактировать проигрыватель';
                document.getElementById('itemType').value = type;
                document.getElementById('itemId').value = id;
                document.getElementById('itemName').value = data.name || '';
                document.getElementById('itemArtist').value = data.artist || '';
                document.getElementById('itemGenre').value = data.genre || '';
                document.getElementById('itemYear').value = data.year || '';
                document.getElementById('itemPrice').value = data.price || '';
                document.getElementById('itemDescription').value = data.description || '';
                document.getElementById('itemModal').classList.add('active');
            });
    }
    
    document.querySelectorAll('.delete-product').forEach(function(btn) {
        btn.onclick = function() { if(confirm('Удалить?')) deleteItem('product', this.dataset.id); };
    });
    document.querySelectorAll('.delete-player').forEach(function(btn) {
        btn.onclick = function() { if(confirm('Удалить?')) deleteItem('player', this.dataset.id); };
    });
    
    function deleteItem(type, id) {
        fetch('/admin/delete-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type, id: id }) })
            .then(function(res) { return res.json(); }).then(function(data) { if(data.success) location.reload(); });
    }
    
    document.querySelectorAll('.edit-user').forEach(function(btn) {
        btn.onclick = function() {
            document.getElementById('editUserId').value = this.dataset.id;
            document.getElementById('editUsername').value = this.dataset.name;
            document.getElementById('editRole').value = this.dataset.role;
            document.getElementById('editPassword').value = '';
            document.getElementById('userModal').classList.add('active');
        };
    });
    
    document.querySelectorAll('.delete-user').forEach(function(btn) {
        btn.onclick = function() { if(confirm('Удалить пользователя?')) deleteUser(this.dataset.id); };
    });
    
    function deleteUser(id) {
        fetch('/admin/delete-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
            .then(function(res) { return res.json(); }).then(function(data) { if(data.success) location.reload(); });
    }
    
    function sendReply(reviewId, productId, userId) {
        var replyInput = document.getElementById('reply-input-' + reviewId);
        var replyText = replyInput.value.trim();
        if (!replyText) return;
        fetch('/admin/send-review-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: reviewId, productId: productId, userId: userId, reply: replyText }) })
            .then(function(res) { return res.json(); }).then(function(data) {
                if (data.success) {
                    var replyDiv = document.getElementById('reply-div-' + reviewId);
                    if (replyDiv) replyDiv.innerHTML = '<div class="admin-reply"><div class="admin-reply-text">👑 Администратор ответил:</div><div class="admin-reply-content">' + escapeHtml(replyText) + '</div></div>';
                    replyInput.value = '';
                } else alert('Ошибка отправки ответа');
            });
    }
    
    document.querySelectorAll('.reviews-btn').forEach(function(btn) {
        btn.onclick = function() {
            var userId = this.dataset.id, userName = this.dataset.name;
            document.getElementById('reviewsTitle').innerHTML = 'Отзывы пользователя: ' + userName;
            document.getElementById('reviewsList').innerHTML = '<div style="text-align:center;padding:20px;">Загрузка...</div>';
            document.getElementById('reviewsModal').classList.add('active');
            fetch('/admin/user-reviews/' + userId).then(function(res) { return res.json(); }).then(function(data) {
                if(data.length === 0) { document.getElementById('reviewsList').innerHTML = '<div class="empty-data">📝 Нет отзывов</div>'; return; }
                var html = '';
                for(var i=0; i<data.length; i++) {
                    var r = data[i], stars = '';
                    for(var s=1; s<=5; s++) stars += s <= r.rating ? '⭐' : '☆';
                    html += '<div class="user-data-item" data-review-id="' + r.id + '"><div class="user-data-header"><img src="/uploads/' + escapeHtml(r.product_image) + '" class="user-data-image"><div class="user-data-info"><div class="user-data-name">' + escapeHtml(r.product_name) + '</div><div class="user-data-artist">' + escapeHtml(r.product_artist) + '</div><div class="user-data-rating">' + stars + ' (' + r.rating + '/5)</div><div class="user-data-date">📅 ' + new Date(r.created_at).toLocaleDateString() + '</div></div></div>' + (r.comment ? '<div class="user-data-comment">💬 "' + escapeHtml(r.comment) + '"</div>' : '') + '<div id="reply-div-' + r.id + '">' + (r.admin_reply ? '<div class="admin-reply"><div class="admin-reply-text">👑 Администратор ответил:</div><div class="admin-reply-content">' + escapeHtml(r.admin_reply) + '</div></div>' : '') + '</div><div class="reply-form"><input type="text" id="reply-input-' + r.id + '" placeholder="Ответ администратора..."><button onclick="sendReply(' + r.id + ', ' + r.product_id + ', ' + userId + ')">📨 Ответить</button></div></div>';
                }
                document.getElementById('reviewsList').innerHTML = html;
            });
        };
    });
    
    document.querySelectorAll('.favorites-btn').forEach(function(btn) {
        btn.onclick = function() {
            var userId = this.dataset.id;
            document.getElementById('favoritesTitle').innerHTML = 'Избранное';
            document.getElementById('favoritesList').innerHTML = '<div style="text-align:center;padding:20px;">Загрузка...</div>';
            document.getElementById('favoritesModal').classList.add('active');
            fetch('/admin/user-favorites/' + userId).then(function(res) { return res.json(); }).then(function(data) {
                if(data.length === 0) { document.getElementById('favoritesList').innerHTML = '<div class="empty-data">❤️ Нет избранного</div>'; return; }
                var html = '';
                for(var i=0; i<data.length; i++) {
                    var item = data[i], imgPath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image;
                    html += '<div class="user-data-item"><div class="user-data-header"><img src="' + imgPath + '" class="user-data-image"><div class="user-data-info"><div class="user-data-name">' + escapeHtml(item.name) + '</div><div class="user-data-artist">' + escapeHtml(item.artist) + '</div><div class="user-data-price">$' + item.price + '</div><div class="user-data-date">📅 ' + new Date(item.added_at).toLocaleDateString() + '</div></div></div></div>';
                }
                document.getElementById('favoritesList').innerHTML = html;
            });
        };
    });
    
    document.querySelectorAll('.cart-btn').forEach(function(btn) {
        btn.onclick = function() {
            var userId = this.dataset.id;
            document.getElementById('cartTitle').innerHTML = 'Корзина';
            document.getElementById('cartList').innerHTML = '<div style="text-align:center;padding:20px;">Загрузка...</div>';
            document.getElementById('cartModal').classList.add('active');
            fetch('/admin/user-cart/' + userId).then(function(res) { return res.json(); }).then(function(data) {
                if(data.items.length === 0) { document.getElementById('cartList').innerHTML = '<div class="empty-data">🛒 Корзина пуста</div>'; document.getElementById('cartTotal').innerHTML = ''; return; }
                var html = '', total = 0;
                for(var i=0; i<data.items.length; i++) {
                    var item = data.items[i], imgPath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image, subtotal = item.price * item.quantity;
                    total += subtotal;
                    html += '<div class="user-data-item"><div class="user-data-header"><img src="' + imgPath + '" class="user-data-image"><div class="user-data-info"><div class="user-data-name">' + escapeHtml(item.name) + '</div><div class="user-data-artist">' + escapeHtml(item.artist) + '</div><div class="user-data-price">$' + item.price + ' × ' + item.quantity + ' = $' + subtotal + '</div></div></div></div>';
                }
                document.getElementById('cartList').innerHTML = html;
                document.getElementById('cartTotal').innerHTML = '<span style="color:#ff7a2f; text-align:right; display:block;">Итого: $' + total + '</span>';
            });
        };
    });
    
    function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }
    
    document.getElementById('itemForm').onsubmit = function(e) {
        e.preventDefault();
        var formData = new FormData(this);
        fetch('/admin/save-item', { method: 'POST', body: formData }).then(function(res) { return res.json(); }).then(function(data) { if(data.success) location.reload(); else alert('Ошибка'); });
    };
    
    document.getElementById('userForm').onsubmit = function(e) {
        e.preventDefault();
        var data = { id: document.getElementById('editUserId').value, username: document.getElementById('editUsername').value, role: document.getElementById('editRole').value, password: document.getElementById('editPassword').value };
        fetch('/admin/update-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function(res) { return res.json(); }).then(function(data) { if(data.success) location.reload(); else alert('Ошибка'); });
    };
    
    function escapeHtml(str) { if (!str) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
</script>
</body>
</html>`; // Полный HTML админки
}

function generateRatingStars(rating, votesCount) {
    const fullStars = Math.floor(rating);
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) starsHtml += '<i class="fas fa-star" style="color:#ff7a2f; font-size:12px;"></i>';
        else starsHtml += '<i class="far fa-star" style="color:#555; font-size:12px;"></i>';
    }
    return '<div style="display:flex;align-items:center;gap:4px;">' + starsHtml + '<span style="font-size:11px;">' + rating + '</span><span style="font-size:10px;">(' + votesCount + ')</span></div>';
}

// ============================================================
// API ДЛЯ АДМИН ПАНЕЛИ
// ============================================================
app.post("/admin/get-item", requireAdmin, express.json(), (req, res) => {
    const { type, id } = req.body;
    const table = type === 'product' ? 'products' : 'players';
    try {
        const item = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        res.json(item || {});
    } catch (err) {
        res.json({});
    }
});

app.post("/admin/save-item", requireAdmin, upload.fields([{ name: 'image' }, { name: 'audio' }]), (req, res) => {
    const { type, id, name, artist, genre, year, price, description } = req.body;
    const imageFile = req.files?.image?.[0];
    const audioFile = req.files?.audio?.[0];
    try {
        if (type === 'product') {
            if (id && id !== '' && id !== 'undefined') {
                let query = "UPDATE products SET name=?, artist=?, price=?, description=?, genre=?, year=?";
                let params = [name, artist, parseFloat(price), description || '', genre || '', year || ''];
                if (imageFile) { query += ", image=?"; params.push(imageFile.filename); }
                if (audioFile) { query += ", audio=?"; params.push(audioFile.filename); }
                query += " WHERE id=?";
                params.push(parseInt(id));
                db.prepare(query).run(...params);
            } else {
                db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?,?,?,?,?,?,?,?)")
                    .run(name, artist, parseFloat(price), imageFile?.filename || null, audioFile?.filename || null, description || '', genre || '', year || '');
            }
        } else {
            if (id && id !== '' && id !== 'undefined') {
                let query = "UPDATE players SET name=?, price=?, description=?";
                let params = [name, parseFloat(price), description || ''];
                if (imageFile) { query += ", image=?"; params.push(imageFile.filename); }
                query += " WHERE id=?";
                params.push(parseInt(id));
                db.prepare(query).run(...params);
            } else {
                db.prepare("INSERT INTO players (name, price, image, description) VALUES (?,?,?,?)")
                    .run(name, parseFloat(price), imageFile?.filename || null, description || '');
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post("/admin/delete-item", requireAdmin, express.json(), (req, res) => {
    const { type, id } = req.body;
    const table = type === 'product' ? 'products' : 'players';
    try {
        db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post("/admin/update-user", requireAdmin, express.json(), (req, res) => {
    const { id, username, role, password } = req.body;
    try {
        if (password && password.trim()) {
            const hashedPassword = bcrypt.hashSync(password, 10);
            db.prepare("UPDATE users SET username=?, role=?, password=? WHERE id=?").run(username, role, hashedPassword, id);
        } else {
            db.prepare("UPDATE users SET username=?, role=? WHERE id=?").run(username, role, id);
        }
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post("/admin/delete-user", requireAdmin, express.json(), (req, res) => {
    const { id } = req.body;
    try {
        db.prepare("DELETE FROM users WHERE id=? AND username!='admin'").run(id);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.post("/admin/send-review-reply", requireAdmin, express.json(), (req, res) => {
    const { reviewId, reply } = req.body;
    try {
        db.prepare("UPDATE ratings SET admin_reply = ?, admin_reply_at = CURRENT_TIMESTAMP WHERE id = ?").run(reply, reviewId);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get("/admin/user-reviews/:userId", requireAdmin, (req, res) => {
    try {
        const rows = db.prepare("SELECT r.*, p.name as product_name, p.artist as product_artist, p.image as product_image FROM ratings r JOIN products p ON r.product_id=p.id WHERE r.user_id=? ORDER BY r.created_at DESC").all(req.params.userId);
        res.json(rows || []);
    } catch (err) {
        res.json([]);
    }
});

app.get("/admin/user-favorites/:userId", requireAdmin, (req, res) => {
    try {
        const favs = db.prepare("SELECT f.*, f.added_at FROM favorites f WHERE f.user_id=?").all(req.params.userId);
        const items = [];
        for (const fav of favs) {
            const productId = fav.product_id;
            if (productId.startsWith('product_')) {
                const id = productId.replace('product_', '');
                const product = db.prepare("SELECT name, artist, price, image FROM products WHERE id=?").get(id);
                if (product) items.push({ ...fav, type: 'product', name: product.name, artist: product.artist, price: product.price, image: product.image });
            } else if (productId.startsWith('player_')) {
                const id = productId.replace('player_', '');
                const player = db.prepare("SELECT name, price, image FROM players WHERE id=?").get(id);
                if (player) items.push({ ...fav, type: 'player', name: player.name, artist: 'Проигрыватель', price: player.price, image: player.image });
            }
        }
        res.json(items);
    } catch (err) {
        res.json([]);
    }
});

app.get("/admin/user-cart/:userId", requireAdmin, (req, res) => {
    try {
        const carts = db.prepare("SELECT * FROM carts WHERE user_id=?").all(req.params.userId);
        const items = [];
        for (const cart of carts) {
            const productId = cart.product_id;
            if (productId.startsWith('product_')) {
                const id = productId.replace('product_', '');
                const product = db.prepare("SELECT name, artist, price, image FROM products WHERE id=?").get(id);
                if (product) items.push({ ...cart, type: 'product', name: product.name, artist: product.artist, price: product.price, image: product.image });
            } else if (productId.startsWith('player_')) {
                const id = productId.replace('player_', '');
                const player = db.prepare("SELECT name, price, image FROM players WHERE id=?").get(id);
                if (player) items.push({ ...cart, type: 'player', name: player.name, artist: 'Проигрыватель', price: player.price, image: player.image });
            }
        }
        res.json({ items });
    } catch (err) {
        res.json({ items: [] });
    }
});

// ============================================================
// ===================== КОРЗИНА ==============================
// ============================================================
app.post("/add-to-cart", requireAuth, (req, res) => {
    const productId = req.body.id;
    const userId = req.session.user.id;
    if (!productId) return res.redirect("/catalog?error=1");
    try {
        const existing = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, productId);
        if (existing) {
            db.prepare("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?").run(userId, productId);
        } else {
            db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)").run(userId, productId);
        }
        const referer = req.headers.referer || "/catalog";
        res.redirect(referer);
    } catch (err) {
        res.redirect("/catalog?error=1");
    }
});

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

app.post("/update-cart", requireAuth, (req, res) => {
    const { product_id, action } = req.body;
    const userId = req.session.user.id;
    try {
        const cartItem = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, product_id);
        if (!cartItem) return res.json({ success: false, error: "Товар не найден" });
        
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
        res.json({ success: false });
    }
});

app.post("/remove-from-cart-ajax", requireAuth, (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    try {
        db.prepare("DELETE FROM carts WHERE user_id = ? AND product_id = ?").run(userId, product_id);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});

app.get("/cart", requireAuth, (req, res) => {
    const user = req.session.user;
    try {
        const cartItems = db.prepare("SELECT * FROM carts WHERE user_id = ?").all(user.id);
        const items = [];
        let totalPrice = 0;
        
        for (const item of cartItems) {
            const parts = item.product_id.split('_');
            const type = parts[0], id = parts[1];
            if (type === 'player') {
                const player = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
                if (player) {
                    items.push({ ...item, type: 'player', name: player.name, artist: 'Проигрыватель винила', price: player.price, image: player.image });
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
        
        let itemsHTML = '';
        for (const item of items) {
            const imagePath = item.type === 'player' ? `/photo/${item.image}` : `/uploads/${item.image}`;
            const subtotal = item.price * item.quantity;
            itemsHTML += `
            <div class="plastinka-item" data-product-id="${item.product_id}">
                <div class="image-stack"><img src="${imagePath}" class="album-image"></div>
                <div class="item-info">
                    <span class="plastinka-name">${escapeHtml(item.name)}</span>
                    <span class="plastinka-artist">${escapeHtml(item.artist)}</span>
                    <span class="plastinka-price">${item.price}$</span>
                </div>
                <div class="quantity-controls">
                    <button class="quantity-btn decrease" data-product-id="${item.product_id}">-</button>
                    <span class="quantity-value">${item.quantity}</span>
                    <button class="quantity-btn increase" data-product-id="${item.product_id}">+</button>
                </div>
                <span class="item-subtotal">${subtotal}$</span>
                <button class="remove-plastinka" data-product-id="${item.product_id}"><span class="remove-text">Удалить</span></button>
            </div>`;
        }
        
        if (items.length === 0) {
            itemsHTML = '<div class="empty-cart" style="text-align:center; padding:60px;">Корзина пуста</div>';
        }
        
        const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Корзина</title><link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg"></a></div>
    <div class="search-bar-desktop"><i class="fas fa-search"></i><input type="text" id="desktop-search-input" placeholder="Поиск пластинок..."></div>
    <div class="right-icons"><a href="/catalog"><img src="/photo/icon-katalog.png"></a><a href="/profile"><img src="/photo/profile_icon.png"></a><a href="/cart"><img src="/photo/knopka-korzina.svg"></a></div>
</header>
<section class="plastinka-cart">
    <h1>Ваша корзина</h1>
    <div class="plastinka-grid">${itemsHTML}</div>
    ${items.length > 0 ? `
    <div class="cart-summary">
        <div class="summary-row"><span>Всего товаров:</span><span>${items.reduce((sum, i) => sum + i.quantity, 0)} шт.</span></div>
        <div class="summary-row"><span>Общая сумма:</span><span class="summary-value total">${totalPrice}$</span></div>
        <form action="/order" method="POST" onsubmit="return confirm('Подтвердите заказ');"><button type="submit" class="order-btn">Заказать</button></form>
    </div>
    ` : ''}
</section>
<footer><img src="/photo/logo-2.svg" class="footer-logo" alt="Plastinka"></footer>
<script src="/main.js"></script>
</body>
</html>`;
        res.send(html);
    } catch (err) {
        res.status(500).send("Ошибка загрузки корзины");
    }
});


function renderMobilePage(title, content, user, activeTab = 'home', showNotification = false) {
    // Определяем, открыто ли приложение в Telegram
    const isTelegramWebApp = true; // Будет определено на клиенте
    
    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover"><title>${escapeHtml(title)} · Plastinka</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
    *{margin:0;padding:0;box-sizing:border-box;}body{background:#0f0f0f;color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding-bottom:70px;min-height:100vh;}
    .top-bar{background:#0a0a0a;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100;border-bottom:1px solid #222;}
    .top-bar .logo{height:32px;width:auto;}
    .search-bar{flex:1;background:#1a1a1a;border-radius:20px;padding:8px 16px;display:flex;align-items:center;gap:8px;color:#888;font-size:14px;border:1px solid #333;cursor:pointer;}
    .search-bar i{color:#ff0000;}
    .content{padding:16px;}
    .section-title{font-size:20px;font-weight:bold;margin:20px 0 16px;color:white;letter-spacing:1px;position:relative;padding-left:12px;}
    .section-title::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#ff0000,#990000);border-radius:2px;}
    .products-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;}
    .product-card{background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #333;transition:transform 0.2s,border-color 0.2s;cursor:pointer;}
    .product-card:hover{transform:translateY(-2px);border-color:#ff0000;}
    .product-image{position:relative;aspect-ratio:1;background:#111;}
    .product-image img{width:100%;height:100%;object-fit:cover;}
    .vinyl-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;}
    .product-card:hover .vinyl-overlay{opacity:1;}
    .vinyl-icon{width:50px;height:50px;animation:spin 4s linear infinite;}@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
    .product-info{padding:12px;}
    .product-name{font-weight:bold;font-size:14px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .product-artist{font-size:12px;color:#888;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .product-price{color:#ff0000;font-weight:bold;font-size:16px;margin-bottom:8px;}
    .product-actions{display:flex;gap:8px;}
    .action-btn{flex:1;background:#333;border:none;color:white;padding:8px;border-radius:8px;font-size:14px;cursor:pointer;transition:0.2s;}
    .action-btn.primary{background:linear-gradient(45deg,#ff0000,#990000);}
    .action-btn:hover{opacity:0.8;}
    .bottom-nav{position:fixed;bottom:0;left:0;right:0;background:#0a0a0a;display:flex;justify-content:space-around;padding:8px 0 12px;border-top:1px solid #222;z-index:1000;}
    .nav-item{color:#888;text-decoration:none;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;flex:1;transition:color 0.2s;}
    .nav-item i{font-size:20px;}
    .nav-item.active{color:#ff0000;}
    .auth-prompt{background:linear-gradient(45deg,#ff0000,#990000);padding:20px;border-radius:12px;text-align:center;margin-top:20px;}
    .auth-prompt p{margin-bottom:12px;font-size:14px;}
    .auth-btn{display:inline-block;background:white;color:#ff0000;padding:10px 30px;border-radius:30px;text-decoration:none;font-weight:bold;font-size:14px;}
    .empty-state{text-align:center;padding:60px 20px;}
    .empty-icon{font-size:60px;color:#333;margin-bottom:20px;}
    .empty-state h3{margin-bottom:8px;}
    .empty-state p{color:#888;margin-bottom:20px;}
    .empty-btn{display:inline-block;background:linear-gradient(45deg,#ff0000,#990000);color:white;padding:12px 24px;border-radius:30px;text-decoration:none;font-weight:bold;}
    .modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);backdrop-filter:blur(5px);z-index:2000;justify-content:center;align-items:center;}
    .modal-overlay.active{display:flex;}
    .modal-content{background:linear-gradient(145deg,#2a2a2a,#1e1e1e);border-radius:20px;padding:24px;max-width:90%;width:350px;position:relative;border:1px solid #ff7a2f;max-height:85vh;overflow-y:auto;}
    .modal-close { position: absolute; top: 15px; right: 15px; background: none; border: none; color: #fff; font-size: 30px; cursor: pointer; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(255, 0, 0, 0.1); transition: 0.3s; }
    .modal-close:hover { background: #ff0000; transform: rotate(90deg); }
    .modal-player-image{width:100%;max-height:200px;object-fit:contain;margin-bottom:16px;border-radius:12px;}
    .modal-title{font-size:22px;color:#ff7a2f;margin-bottom:8px;font-weight:bold;}
    .modal-artist{color:#aaa;font-size:16px;margin-bottom:12px;}
    .modal-tags{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
    .modal-tag{background:rgba(255,122,47,0.2);padding:4px 12px;border-radius:20px;font-size:11px;color:#ff7a2f;}
    .modal-description{color:#ccc;line-height:1.5;margin-bottom:16px;font-size:14px;}
    .modal-price{font-size:28px;color:#fff;font-weight:bold;margin-bottom:20px;}
    .modal-price span{color:#ff7a2f;font-size:16px;}
    .modal-actions{display:flex;gap:12px;margin-bottom:12px;}
    .modal-add-to-cart{flex:1;padding:12px;background:linear-gradient(45deg,#ff7a2f,#ff0000);border:none;border-radius:10px;color:white;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;}
    .modal-fav-btn{width:48px;background:rgba(255,255,255,0.1);border:1px solid #ff0000;border-radius:10px;color:#ff0000;font-size:20px;cursor:pointer;transition:0.3s;}
    .modal-fav-btn:hover{background:#ff0000;color:white;}
    .modal-play-btn{width:100%;padding:10px;background:rgba(255,255,255,0.1);border:1px solid #ff7a2f;border-radius:10px;color:#ff7a2f;font-size:14px;cursor:pointer;transition:0.3s;display:flex;align-items:center;justify-content:center;gap:8px;}
    .modal-review-btn{width:100%;margin:10px 0;padding:10px;background:rgba(255,122,47,0.2);border:1px solid #ff7a2f;border-radius:10px;color:#ff7a2f;font-size:14px;cursor:pointer;transition:0.3s;}
    .toast-notification{position:fixed;bottom:20px;right:20px;background:#4CAF50;color:white;padding:12px 20px;border-radius:12px;z-index:3000;animation:fadeInOut 3s;font-size:14px;}@keyframes fadeInOut{0%{opacity:0;bottom:0;}10%{opacity:1;bottom:20px;}90%{opacity:1;bottom:20px;}100%{opacity:0;bottom:0;}}
    .profile-header{text-align:center;padding:20px;}.profile-avatar{width:100px;height:100px;border-radius:50%;border:3px solid #ff0000;margin-bottom:16px;}.profile-name{font-size:24px;margin-bottom:4px;}.profile-role{color:#888;}.profile-stats{display:flex;justify-content:center;gap:40px;padding:20px;background:#1a1a1a;border-radius:12px;margin:20px 0;}.stat{text-align:center;}.stat-value{font-size:24px;font-weight:bold;color:#ff0000;}.stat-label{color:#888;font-size:12px;}.profile-menu{background:#1a1a1a;border-radius:12px;overflow:hidden;}.menu-item{display:flex;align-items:center;gap:12px;padding:16px;color:white;text-decoration:none;border-bottom:1px solid #333;}.admin-panel-btn{display:block;background:linear-gradient(45deg,#ff0000,#990000);color:white;text-decoration:none;padding:16px;border-radius:12px;text-align:center;margin:20px 0;font-weight:bold;}.logout-btn{display:block;background:#222;color:#ff4444;text-decoration:none;padding:16px;border-radius:12px;text-align:center;margin-top:20px;border:1px solid #ff4444;}.cart-item{display:flex;align-items:center;gap:12px;background:#1a1a1a;padding:12px;border-radius:12px;margin-bottom:12px;}.cart-item-image{width:70px;height:70px;object-fit:cover;border-radius:8px;}.cart-item-info{flex:1;}.cart-item-name{font-weight:bold;font-size:14px;margin-bottom:4px;}.cart-item-price{color:#ff0000;font-weight:bold;margin-bottom:8px;}.cart-item-quantity{display:flex;align-items:center;gap:10px;}.quantity-btn{width:28px;height:28px;border-radius:50%;background:#333;border:none;color:white;cursor:pointer;font-size:16px;}.remove-btn{background:transparent;border:none;color:#ff4444;font-size:18px;cursor:pointer;padding:8px;}.cart-total{background:#1a1a1a;padding:16px;border-radius:12px;margin-top:20px;display:flex;justify-content:space-between;align-items:center;}.total-price{font-size:22px;font-weight:bold;color:#ff0000;}.checkout-btn{width:100%;background:linear-gradient(45deg,#ff0000,#990000);border:none;color:white;padding:14px;border-radius:12px;font-weight:bold;font-size:16px;margin-top:16px;cursor:pointer;}
    .avatar-container{position:relative;display:inline-block;cursor:pointer;}.avatar-overlay{position:absolute;bottom:5px;right:5px;background:#ff0000;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #1a1a1a;}
    .avatar-overlay i{color:white;font-size:14px;}
    /* Telegram WebApp тема */
    .telegram-theme body{background:var(--tg-theme-bg-color, #0f0f0f);color:var(--tg-theme-text-color, white);}
    .telegram-theme .top-bar,.telegram-theme .bottom-nav{background:var(--tg-theme-secondary-bg-color, #0a0a0a);}
    .telegram-theme .product-card{background:var(--tg-theme-secondary-bg-color, #1a1a1a);}
    @media (max-width: 480px){.products-grid{grid-template-columns:1fr;}}
    </style>
    </head>
    <body class="telegram-theme">
    ${showNotification ? '<div class="toast-notification">✅ Товар добавлен в корзину!</div>' : ''}
    <div class="top-bar">
        <img src="/photo/logo.svg" class="logo" alt="Plastinka">
        <div class="search-bar" onclick="window.location='/search'">
            <i class="fas fa-search"></i>
            <span>Поиск</span>
        </div>
    </div>
    <div class="content">${content}</div>
    <nav class="bottom-nav">
        <a href="/" class="nav-item ${activeTab === 'home' ? 'active' : ''}"><i class="fas fa-home"></i><span>Главная</span></a>
        <a href="/catalog" class="nav-item ${activeTab === 'catalog' ? 'active' : ''}"><i class="fas fa-record-vinyl"></i><span>Каталог</span></a>
        <a href="/favorites" class="nav-item ${activeTab === 'favorites' ? 'active' : ''}"><i class="fas fa-heart"></i><span>Избранное</span></a>
        <a href="/cart" class="nav-item ${activeTab === 'cart' ? 'active' : ''}"><i class="fas fa-shopping-cart"></i><span>Корзина</span></a>
        <a href="/profile" class="nav-item ${activeTab === 'profile' ? 'active' : ''}"><i class="fas fa-user"></i><span>Профиль</span></a>
    </nav>
    <script>
    // Инициализация Telegram WebApp
    const tg = window.Telegram?.WebApp;
    let tgUser = null;
    
    if (tg) {
        // Растянуть на весь экран
        tg.expand();
        // Показать кнопку "Назад" если нужно
        if (window.history.length > 1) {
            tg.BackButton.show();
            tg.BackButton.onClick(() => {
                window.history.back();
            });
        }
        // Получить данные пользователя
        tgUser = tg.initDataUnsafe?.user;
        tg.ready();
        
        // Применяем тему Telegram
        if (tg.themeParams) {
            document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#0f0f0f');
            document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#ffffff');
            document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#aaaaaa');
            document.documentElement.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#ff0000');
            document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#ff0000');
            document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');
            document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color || '#1a1a1a');
        }
        
        // Авторизация через Telegram
        if (tgUser && tgUser.id) {
            fetch('/api/telegram-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: tgUser.id,
                    first_name: tgUser.first_name || '',
                    last_name: tgUser.last_name || '',
                    username: tgUser.username || '',
                    photo_url: tgUser.photo_url || ''
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    console.log('✅ Авторизация через Telegram успешна');
                    if (data.isNew) {
                        console.log('🆕 Новый пользователь зарегистрирован');
                    }
                    // Обновляем страницу для отображения авторизованного состояния
                    if (!${!!user}) {
                        window.location.reload();
                    }
                }
            })
            .catch(err => console.error('Ошибка авторизации:', err));
        }
    }
    
    // Функции для работы с корзиной и избранным
    function addToCartMobile(id) {
        fetch('/api/cart/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        }).then(() => {
            showToastMobile('Товар добавлен в корзину', false);
            if (tg) tg.HapticFeedback.impactOccurred('light');
        });
    }
    
    function toggleFavoriteMobile(id) {
        fetch('/api/favorites/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        }).then(() => {
            showToastMobile('Избранное обновлено', false);
            if (tg) tg.HapticFeedback.impactOccurred('light');
        });
    }
    
    function showToastMobile(message, isError) {
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerHTML = '<div style="display:flex;align-items:center;gap:8px">' + (isError ? '❌' : '✅') + '<span>' + message + '</span></div>';
        document.body.appendChild(toast);
        setTimeout(() => { if(toast && toast.remove) toast.remove(); }, 3000);
    }
    
    // Функция для закрытия Mini App (если нужно)
    function closeMiniApp() {
        if (tg) tg.close();
    }
    
    // Показываем основную кнопку если нужно
    function showMainButton(text, onClick) {
        if (tg) {
            tg.MainButton.setText(text);
            tg.MainButton.show();
            tg.MainButton.onClick(onClick);
        }
    }
    
    // Скрываем основную кнопку
    function hideMainButton() {
        if (tg) tg.MainButton.hide();
    }
    </script>
    </body>
    </html>`;
}

// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Сервер запущен на порту ${PORT}`);
        console.log(`👤 Админ: admin / admin123`);
        console.log(`⭐ Система рейтинга активна!`);
    });
}

module.exports = app;