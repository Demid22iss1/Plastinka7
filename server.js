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
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
// ============================================================

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

db.exec(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price REAL,
    image TEXT,
    description TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    avatar TEXT DEFAULT 'default-avatar.png',
    telegram_id INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id TEXT,
    quantity INTEGER DEFAULT 1,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, product_id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, product_id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT
)`);

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

// Добавление настроек по умолчанию
const homepageSetting = db.prepare("SELECT COUNT(*) as count FROM site_settings WHERE key = ?").get('homepage_products');
if (!homepageSetting || homepageSetting.count === 0) {
    db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)").run('homepage_products', 'last_added');
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
}

// Добавление тестовых пластинок
const productsCount = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productsCount.count === 0) {
    const products = [
        ['Dark Side of the Moon', 'Pink Floyd', 35, 'dark-side.png', null, 'Легендарный альбом', 'Rock', '1973'],
        ['Abbey Road', 'The Beatles', 40, 'abbey-road.png', null, 'Последний записанный альбом', 'Rock', '1969'],
        ['Thriller', 'Michael Jackson', 45, 'thriller.png', null, 'Самый продаваемый альбом', 'Pop', '1982'],
        ['Kind of Blue', 'Miles Davis', 45, 'kind-of-blue.png', null, 'Классический джазовый альбом', 'Jazz', '1959'],
        ['Random Access Memories', 'Daft Punk', 38, 'ram.png', null, 'Электронный шедевр', 'Electronic', '2013'],
        ['The Wall', 'Pink Floyd', 42, 'the-wall.png', null, 'Рок-опера', 'Rock', '1979'],
        ['Back in Black', 'AC/DC', 35, 'back-in-black.png', null, 'Хард-рок', 'Rock', '1980']
    ];
    const stmt = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const p of products) stmt.run(p);
}

// Создание администратора
const usersCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
if (usersCount.count === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("admin", hash, "admin");
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
        secure: false,
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
// ФУНКЦИЯ ДЛЯ РЕНДЕРИНГА СТРАНИЦ (общая для всех)
// ============================================================
function renderPage(title, content, user, currentPage = 'home', showNotification = false) {
    const isLoggedIn = !!user;
    const isAdmin = user && user.role === 'admin';
    
    // Определяем активную страницу для подсветки в меню
    let catalogActive = currentPage === 'catalog' ? 'active' : '';
    let profileActive = currentPage === 'profile' ? 'active' : '';
    let cartActive = currentPage === 'cart' ? 'active' : '';
    
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<title>${escapeHtml(title)} · Plastinka</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<style>
@import url('https://fonts.googleapis.com/css2?family=Rubik+Mono+One&display=swap');

/* Глобальные стили */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background: #0f0f0f;
    color: #fff;
    font-family: 'Segoe UI', Arial, sans-serif;
    line-height: 1.5;
}

/* Шапка */
header {
    position: sticky;
    top: 0;
    z-index: 1000;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 5%;
    background: rgba(10, 10, 10, 0.95);
    backdrop-filter: blur(10px);
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    min-height: 70px;
}

.logo {
    flex-shrink: 0;
}
.logo img {
    height: 45px;
    width: auto;
}

.logo a {
    display: block;
}

/* Поиск */
.search-bar {
    flex: 1;
    max-width: 500px;
    margin: 0 20px;
    position: relative;
}

.search-bar form {
    display: flex;
    background: #1a1a1a;
    border-radius: 40px;
    border: 1px solid #333;
    overflow: hidden;
    transition: all 0.2s;
}

.search-bar form:focus-within {
    border-color: #ff0000;
    background: #111;
}

.search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    padding: 10px 15px;
    color: white;
    font-size: 14px;
    outline: none;
}

.search-bar input::placeholder {
    color: #888;
}

.search-bar button {
    background: linear-gradient(45deg, #ff0000, #990000);
    border: none;
    padding: 0 18px;
    cursor: pointer;
    color: white;
    font-size: 14px;
    transition: opacity 0.2s;
}

.search-bar button:hover {
    opacity: 0.9;
}

/* Правая панель иконок */
.right-icons {
    display: flex;
    gap: 20px;
    align-items: center;
    flex-shrink: 0;
}

.right-icons a {
    display: flex;
    align-items: center;
    transition: all 0.25s ease;
}

.right-icons a:hover {
    transform: scale(1.1);
    filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.5));
}

.right-icons img {
    height: 35px;
    width: auto;
}

/* Навигационное меню */
.nav-menu {
    background: #0a0a0a;
    padding: 12px 5%;
    display: flex;
    justify-content: center;
    gap: 30px;
    border-bottom: 1px solid #222;
}

.nav-menu a {
    color: #aaa;
    text-decoration: none;
    font-size: 16px;
    font-weight: 500;
    transition: all 0.2s;
    padding: 5px 0;
    position: relative;
}

.nav-menu a:hover {
    color: #ff0000;
}

.nav-menu a.active {
    color: #ff0000;
}

.nav-menu a.active::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, #ff0000, #990000);
    border-radius: 2px;
}

/* Основной контейнер */
.main-container {
    min-height: calc(100vh - 200px);
    padding: 30px 5%;
}

/* Сетка товаров */
.products-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 25px;
    margin-top: 20px;
}

.product-card {
    background: #181818;
    border-radius: 16px;
    overflow: hidden;
    transition: all 0.3s ease;
    cursor: pointer;
    border: 1px solid #252525;
}

.product-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    border-color: #ff0000;
}

.product-image {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
}

.product-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
}

.product-card:hover .product-image img {
    transform: scale(1.05);
}

.vinyl-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.product-card:hover .vinyl-overlay {
    opacity: 1;
}

.vinyl-icon {
    width: 60px;
    height: 60px;
    animation: rotate 5s linear infinite;
    animation-play-state: paused;
}

.product-card:hover .vinyl-icon {
    animation-play-state: running;
}

@keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.product-info {
    padding: 15px;
}

.product-name {
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 5px;
    color: #fff;
}

.product-artist {
    font-size: 14px;
    color: #aaa;
    margin-bottom: 8px;
}

.rating-stars {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 8px 0;
    flex-wrap: wrap;
}

.rating-stars .star {
    font-size: 14px;
    color: #444;
}

.rating-stars .star.filled {
    color: #ff7a2f;
}

.rating-value {
    font-size: 12px;
    color: #ff7a2f;
    margin-left: 6px;
    font-weight: bold;
}

.votes-count {
    font-size: 10px;
    color: #666;
    margin-left: 4px;
}

.product-price {
    font-size: 22px;
    font-weight: bold;
    color: #ff7a2f;
    margin: 10px 0;
}

.product-actions {
    display: flex;
    gap: 10px;
}

.action-btn {
    flex: 1;
    padding: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
}

.action-btn:hover {
    background: #ff0000;
    transform: scale(1.02);
}

/* Фильтры */
.filters-section {
    background: #181818;
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 30px;
}

.filters-title {
    font-size: 18px;
    margin-bottom: 15px;
    color: #ff7a2f;
}

.filter-group {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    margin-bottom: 15px;
}

.filter-input {
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 8px 12px;
    color: white;
    font-size: 14px;
}

.filter-input:focus {
    outline: none;
    border-color: #ff0000;
}

.filter-select {
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 8px 12px;
    color: white;
    cursor: pointer;
}

.filter-btn {
    background: linear-gradient(45deg, #ff0000, #990000);
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    color: white;
    cursor: pointer;
    transition: opacity 0.2s;
}

.filter-btn:hover {
    opacity: 0.9;
}

.filter-reset {
    background: #333;
}

/* Пагинация */
.pagination {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 30px;
}

.pagination a, .pagination span {
    padding: 8px 14px;
    background: #181818;
    border-radius: 8px;
    color: white;
    text-decoration: none;
    transition: all 0.2s;
}

.pagination a:hover {
    background: #ff0000;
}

.pagination .current {
    background: #ff0000;
}

/* Модальные окна */
.modal-overlay {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(8px);
    z-index: 2000;
    justify-content: center;
    align-items: center;
}

.modal-overlay.active {
    display: flex;
}

.modal-content {
    background: linear-gradient(145deg, #1e1e1e, #151515);
    border-radius: 20px;
    padding: 25px;
    max-width: 500px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    position: relative;
    border: 1px solid #ff7a2f;
    box-shadow: 0 20px 40px rgba(255, 122, 47, 0.2);
}

.modal-close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(255, 0, 0, 0.1);
    border: none;
    color: white;
    font-size: 24px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
}

.modal-close:hover {
    background: #ff0000;
    transform: rotate(90deg);
}

.modal-player-image {
    width: 100%;
    max-height: 250px;
    object-fit: contain;
    border-radius: 12px;
    margin-bottom: 15px;
}

.modal-title {
    font-size: 24px;
    color: #ff7a2f;
    margin-bottom: 8px;
}

.modal-artist {
    color: #aaa;
    font-size: 16px;
    margin-bottom: 12px;
}

.modal-tags {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    flex-wrap: wrap;
}

.modal-tag {
    background: rgba(255, 122, 47, 0.2);
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    color: #ff7a2f;
}

.modal-description {
    color: #ccc;
    line-height: 1.5;
    margin-bottom: 15px;
    font-size: 14px;
}

.modal-price {
    font-size: 28px;
    font-weight: bold;
    margin-bottom: 20px;
}

.modal-price span {
    color: #ff7a2f;
    font-size: 18px;
}

.modal-actions {
    display: flex;
    gap: 15px;
    margin-bottom: 15px;
}

.modal-add-to-cart {
    flex: 1;
    padding: 12px;
    background: linear-gradient(45deg, #ff7a2f, #ff0000);
    border: none;
    border-radius: 10px;
    color: white;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: opacity 0.2s;
}

.modal-fav-btn {
    width: 50px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid #ff0000;
    border-radius: 10px;
    color: #ff0000;
    font-size: 20px;
    cursor: pointer;
    transition: all 0.2s;
}

.modal-fav-btn:hover {
    background: #ff0000;
    color: white;
}

.modal-play-btn, .modal-review-btn {
    width: 100%;
    padding: 10px;
    background: rgba(255, 122, 47, 0.2);
    border: 1px solid #ff7a2f;
    border-radius: 10px;
    color: #ff7a2f;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 8px;
}

.modal-play-btn:hover, .modal-review-btn:hover {
    background: rgba(255, 122, 47, 0.4);
}

/* Секция оценок и комментариев */
.rating-section {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: 15px 0;
    padding: 10px;
    background: rgba(255, 122, 47, 0.1);
    border-radius: 12px;
}

.rating-label {
    font-size: 14px;
    color: #ff7a2f;
    font-weight: bold;
}

.rating-stars-large {
    display: inline-flex;
    gap: 8px;
}

.rating-stars-large .star {
    font-size: 24px;
    cursor: pointer;
    transition: all 0.2s;
    color: #444;
}

.rating-stars-large .star.filled {
    color: #ff7a2f;
}

.rating-stars-large .star.hover {
    color: #ffaa66;
}

.rating-votes {
    font-size: 12px;
    color: #888;
}

.comments-list {
    margin: 15px 0;
    padding: 10px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 12px;
    max-height: 200px;
    overflow-y: auto;
}

.comment-item {
    padding: 10px;
    border-bottom: 1px solid #333;
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
    margin-bottom: 5px;
}

.comment-text {
    font-size: 13px;
    color: #ccc;
}

.no-comments {
    text-align: center;
    color: #666;
    padding: 15px;
}

/* Уведомления */
.toast-notification {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #4CAF50;
    color: white;
    padding: 12px 24px;
    border-radius: 30px;
    z-index: 3000;
    animation: fadeInOut 2.5s forwards;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
}

@keyframes fadeInOut {
    0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
    15% { opacity: 1; transform: translateX(-50%) translateY(0); }
    85% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); visibility: hidden; }
}

/* Адаптивность */
@media (max-width: 768px) {
    header {
        flex-wrap: wrap;
        gap: 10px;
    }
    
    .search-bar {
        order: 3;
        max-width: 100%;
        margin: 5px 0;
        flex: 0 0 100%;
    }
    
    .right-icons {
        gap: 15px;
    }
    
    .right-icons img {
        height: 32px;
    }
    
    .nav-menu {
        gap: 20px;
        padding: 10px 5%;
    }
    
    .nav-menu a {
        font-size: 14px;
    }
    
    .products-grid {
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 15px;
    }
    
    .product-name {
        font-size: 14px;
    }
    
    .product-artist {
        font-size: 12px;
    }
    
    .product-price {
        font-size: 18px;
    }
    
    .modal-content {
        padding: 20px;
        max-width: 95%;
    }
    
    .modal-title {
        font-size: 20px;
    }
}

@media (max-width: 480px) {
    .products-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .filters-section {
        padding: 15px;
    }
    
    .filter-group {
        gap: 10px;
    }
    
    .nav-menu {
        gap: 15px;
    }
    
    .nav-menu a {
        font-size: 12px;
    }
}

/* Футер */
footer {
    background: #0a0a0a;
    padding: 30px 5%;
    text-align: center;
    border-top: 1px solid #222;
    margin-top: 40px;
}

.footer-logo {
    height: 50px;
    opacity: 0.7;
}

.footer-copyright {
    margin-top: 15px;
    color: #666;
    font-size: 12px;
}
</style>
</head>
<body>
<header>
    <div class="logo">
        <a href="/"><img src="/photo/logo.svg" alt="Plastinka"></a>
    </div>
    <div class="search-bar">
        <form action="/catalog" method="GET">
            <input type="text" name="search" placeholder="Поиск пластинок, исполнителей..." value="">
            <button type="submit"><i class="fas fa-search"></i></button>
        </form>
    </div>
    <div class="right-icons">
        <a href="/catalog" class="${catalogActive === 'active' ? 'active' : ''}">
            <img src="/photo/icon-katalog.png" alt="Каталог">
        </a>
        <a href="/profile">
            <img src="/photo/profile_icon.png" alt="Профиль">
        </a>
        <a href="/cart">
            <img src="/photo/knopka-korzina.svg" alt="Корзина">
        </a>
    </div>
</header>
<nav class="nav-menu">
    <a href="/" class="${currentPage === 'home' ? 'active' : ''}">Главная</a>
    <a href="/catalog" class="${currentPage === 'catalog' ? 'active' : ''}">Каталог пластинок</a>
    <a href="/players-catalog" class="${currentPage === 'players' ? 'active' : ''}">Проигрыватели</a>
    ${isLoggedIn ? `<a href="/profile" class="${currentPage === 'profile' ? 'active' : ''}">Профиль</a>` : `<a href="/login">Войти</a>`}
    ${isAdmin ? `<a href="/admin">Админ панель</a>` : ''}
</nav>
<div class="main-container">
    ${showNotification ? '<div class="toast-notification" style="animation: fadeInOut 3s forwards;">✅ Товар добавлен в корзину</div>' : ''}
    ${content}
</div>
<footer>
    <img src="/photo/logo-2.svg" class="footer-logo" alt="Plastinka">
    <div class="footer-copyright">© 2024 Plastinka. Все права защищены.</div>
</footer>

<script>
function showToast(message, isError) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.background = isError ? '#f44336' : '#4CAF50';
    toast.innerHTML = (isError ? '❌ ' : '✅ ') + message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
</script>
</body>
</html>`;
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
// API ДЛЯ РЕЙТИНГОВ
// ============================================================
app.get("/api/rating/:productId", (req, res) => {
    const productId = req.params.productId;
    try {
        const ratingData = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(productId);
        
        const comments = db.prepare(`
            SELECT r.*, u.username 
            FROM ratings r 
            JOIN users u ON r.user_id = u.id 
            WHERE r.product_id = ? 
            ORDER BY r.created_at DESC 
            LIMIT 20
        `).all(productId);
        
        res.json({
            avg_rating: ratingData?.avg_rating ? parseFloat(ratingData.avg_rating).toFixed(1) : 0,
            votes_count: ratingData?.votes_count || 0,
            comments: comments || []
        });
    } catch (err) {
        res.json({ avg_rating: 0, votes_count: 0, comments: [] });
    }
});

app.post("/api/rating/:productId", requireAuth, (req, res) => {
    const productId = req.params.productId;
    const userId = req.session.user.id;
    const { rating, comment } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Некорректная оценка" });
    }
    
    try {
        const existing = db.prepare("SELECT * FROM ratings WHERE user_id = ? AND product_id = ?").get(userId, productId);
        
        if (existing) {
            db.prepare("UPDATE ratings SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND product_id = ?")
                .run(rating, comment || null, userId, productId);
        } else {
            db.prepare("INSERT INTO ratings (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)")
                .run(userId, productId, rating, comment || null);
        }
        
        const ratingData = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(productId);
        const comments = db.prepare(`
            SELECT r.*, u.username 
            FROM ratings r 
            JOIN users u ON r.user_id = u.id 
            WHERE r.product_id = ? 
            ORDER BY r.created_at DESC 
            LIMIT 20
        `).all(productId);
        
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

// ============================================================
// API ПОИСКА
// ============================================================
app.get("/api/search", (req, res) => {
    const query = req.query.q || '';
    if (!query.trim()) {
        return res.json({ results: [] });
    }
    
    try {
        const searchQuery = `%${query}%`;
        
        const products = db.prepare(`
            SELECT id, name, artist, price, image, description, genre, year, 'product' as type
            FROM products 
            WHERE name LIKE ? OR artist LIKE ? OR genre LIKE ?
            LIMIT 10
        `).all(searchQuery, searchQuery, searchQuery);
        
        const players = db.prepare(`
            SELECT id, name, price, image, description, 'player' as type
            FROM players 
            WHERE name LIKE ?
            LIMIT 5
        `).all(searchQuery);
        
        const results = [...products, ...players];
        res.json({ results });
    } catch (err) {
        res.json({ results: [] });
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
body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px;font-family:Arial,sans-serif}
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
.success-message{background:rgba(0,255,0,0.1);border-color:#00ff00;color:#00ff00}
</style></head>
<body>
<div class="login-container">
    <img src="/photo/logo.svg">
    <h1>Добро пожаловать</h1>
    <div class="subtitle">Войдите в свой аккаунт</div>
    ${req.query.error ? '<div class="error-message">❌ Неверное имя пользователя или пароль</div>' : ''}
    ${req.query.registered ? '<div class="error-message success-message">✅ Регистрация успешна!</div>' : ''}
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
body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px;font-family:Arial,sans-serif}
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
// ===================== КАТАЛОГ =====================
// ============================================================
app.get("/catalog", (req, res) => {
    const user = req.session.user;
    const searchQuery = req.query.search || '';
    const genreFilter = req.query.genre || '';
    const sortBy = req.query.sort || 'newest';
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = 12;
    const offset = (page - 1) * itemsPerPage;
    
    try {
        let whereClause = '';
        let params = [];
        
        if (searchQuery) {
            whereClause = `WHERE (name LIKE ? OR artist LIKE ? OR genre LIKE ?)`;
            params = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`];
        }
        
        if (genreFilter && !searchQuery) {
            whereClause = `WHERE genre = ?`;
            params = [genreFilter];
        } else if (genreFilter && searchQuery) {
            whereClause = `WHERE (name LIKE ? OR artist LIKE ? OR genre LIKE ?) AND genre = ?`;
            params = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, genreFilter];
        }
        
        let orderBy = '';
        switch(sortBy) {
            case 'price_asc': orderBy = 'ORDER BY price ASC'; break;
            case 'price_desc': orderBy = 'ORDER BY price DESC'; break;
            case 'name_asc': orderBy = 'ORDER BY name ASC'; break;
            default: orderBy = 'ORDER BY id DESC';
        }
        
        const countQuery = `SELECT COUNT(*) as total FROM products ${whereClause}`;
        const totalCount = db.prepare(countQuery).get(...params);
        const totalPages = Math.ceil(totalCount.total / itemsPerPage);
        
        const productsQuery = `SELECT * FROM products ${whereClause} ${orderBy} LIMIT ? OFFSET ?`;
        let products = db.prepare(productsQuery).all(...params, itemsPerPage, offset);
        
        // Получаем жанры для фильтра
        const genres = db.prepare("SELECT DISTINCT genre FROM products WHERE genre IS NOT NULL AND genre != ''").all();
        
        // Добавляем рейтинги
        for (const product of products) {
            const rating = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(product.id);
            product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
            product.votes_count = rating?.votes_count || 0;
        }
        
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
        
        // Генерация HTML товаров
        let productsHTML = '';
        if (products.length === 0) {
            productsHTML = '<div style="text-align:center;padding:60px;color:#666"><i class="fas fa-search" style="font-size:48px;margin-bottom:20px"></i><h3>Ничего не найдено</h3><p>Попробуйте изменить параметры поиска</p><a href="/catalog" class="filter-btn" style="display:inline-block;margin-top:15px">Сбросить фильтры</a></div>';
        } else {
            for (const product of products) {
                productsHTML += `
                <div class="product-card" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name)}" data-product-artist="${escapeHtml(product.artist)}" data-product-price="${product.price}" data-product-image="/uploads/${product.image}" data-product-description="${escapeHtml(product.description || 'Нет описания')}" data-product-genre="${escapeHtml(product.genre || 'Rock')}" data-product-year="${escapeHtml(product.year || '1970')}" data-product-audio="${product.audio || ''}">
                    <div class="product-image">
                        <img src="/uploads/${product.image}" alt="${escapeHtml(product.name)}" onerror="this.src='/photo/plastinka-audio.png'">
                        <div class="vinyl-overlay">
                            <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                        </div>
                    </div>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(product.name)}</div>
                        <div class="product-artist">${escapeHtml(product.artist)}</div>
                        ${generateStarRatingHTML(product.avg_rating, product.votes_count)}
                        <div class="product-price">$${product.price}</div>
                        <div class="product-actions">
                            <button class="action-btn add-to-cart-btn" data-id="product_${product.id}"><i class="fas fa-shopping-cart"></i> В корзину</button>
                            <button class="action-btn fav-btn" data-id="product_${product.id}"><i class="fas fa-heart"></i></button>
                        </div>
                    </div>
                </div>`;
            }
        }
        
        // Генерация пагинации
        let paginationHTML = '';
        if (totalPages > 1) {
            paginationHTML = '<div class="pagination">';
            if (page > 1) {
                paginationHTML += `<a href="?page=${page-1}&search=${encodeURIComponent(searchQuery)}&genre=${encodeURIComponent(genreFilter)}&sort=${sortBy}">←</a>`;
            }
            for (let i = 1; i <= Math.min(totalPages, 5); i++) {
                if (i === page) {
                    paginationHTML += `<span class="current">${i}</span>`;
                } else {
                    paginationHTML += `<a href="?page=${i}&search=${encodeURIComponent(searchQuery)}&genre=${encodeURIComponent(genreFilter)}&sort=${sortBy}">${i}</a>`;
                }
            }
            if (page < totalPages) {
                paginationHTML += `<a href="?page=${page+1}&search=${encodeURIComponent(searchQuery)}&genre=${encodeURIComponent(genreFilter)}&sort=${sortBy}">→</a>`;
            }
            paginationHTML += '</div>';
        }
        
        // HTML для фильтров
        let genreOptions = '<option value="">Все жанры</option>';
        for (const g of genres) {
            if (g.genre) {
                genreOptions += `<option value="${escapeHtml(g.genre)}" ${genreFilter === g.genre ? 'selected' : ''}>${escapeHtml(g.genre)}</option>`;
            }
        }
        
        const content = `
        <div class="filters-section">
            <div class="filters-title"><i class="fas fa-filter"></i> Фильтры</div>
            <form method="GET" action="/catalog" id="filterForm">
                <div class="filter-group">
                    <select name="genre" class="filter-select" onchange="this.form.submit()">
                        ${genreOptions}
                    </select>
                    <select name="sort" class="filter-select" onchange="this.form.submit()">
                        <option value="newest" ${sortBy === 'newest' ? 'selected' : ''}>Сначала новинки</option>
                        <option value="price_asc" ${sortBy === 'price_asc' ? 'selected' : ''}>По возрастанию цены</option>
                        <option value="price_desc" ${sortBy === 'price_desc' ? 'selected' : ''}>По убыванию цены</option>
                        <option value="name_asc" ${sortBy === 'name_asc' ? 'selected' : ''}>По названию А-Я</option>
                    </select>
                    <input type="text" name="search" class="filter-input" placeholder="Поиск..." value="${escapeHtml(searchQuery)}" style="flex:1">
                    <button type="submit" class="filter-btn"><i class="fas fa-search"></i> Найти</button>
                    ${searchQuery || genreFilter ? `<a href="/catalog" class="filter-btn filter-reset">Сбросить</a>` : ''}
                </div>
            </form>
        </div>
        <div class="catalog-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <h1>🎵 Каталог пластинок</h1>
            <span style="color:#888">Найдено: ${totalCount.total} товаров</span>
        </div>
        <div class="products-grid" id="catalogProductsGrid">
            ${productsHTML}
        </div>
        ${paginationHTML}
        
        <!-- Модальное окно товара -->
        <div id="productModal" class="modal-overlay">
            <div class="modal-content">
                <button class="modal-close" onclick="closeProductModal()">&times;</button>
                <img src="" alt="Пластинка" class="modal-player-image" id="productModalImage">
                <h2 class="modal-title" id="productModalTitle"></h2>
                <p class="modal-artist" id="productModalArtist"></p>
                <div class="modal-tags" id="productModalTags"></div>
                <div class="rating-section">
                    <div class="rating-label">Средняя оценка:</div>
                    <div class="rating-stars-large" id="modalRatingStars"></div>
                    <div class="rating-votes" id="modalRatingVotes"></div>
                </div>
                <div class="comments-list" id="modalCommentsList"></div>
                <p class="modal-description" id="productModalDescription"></p>
                <div class="modal-price" id="productModalPrice"></div>
                <div class="modal-actions">
                    <button onclick="addToCartFromModal()" class="modal-add-to-cart">В корзину</button>
                    <button onclick="toggleFavoriteFromModal()" class="modal-fav-btn"><i class="fas fa-heart"></i></button>
                </div>
                <button onclick="openReviewModal()" class="modal-review-btn">✍️ Оставить отзыв</button>
                <button onclick="playModalPreview()" class="modal-play-btn" id="modalPlayBtn" style="display:none"><i class="fas fa-play"></i> Прослушать</button>
            </div>
        </div>
        
        <!-- Модальное окно отзыва -->
        <div id="reviewModal" class="modal-overlay">
            <div class="modal-content review-modal-content">
                <button class="modal-close" onclick="closeReviewModal()">&times;</button>
                <h3 class="review-title">⭐ Оцените пластинку</h3>
                <div class="review-stars" id="reviewStars" style="display:flex;gap:10px;justify-content:center;margin:15px 0">
                    <i class="far fa-star" data-rating="1" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="2" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="3" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="4" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="5" style="font-size:32px;cursor:pointer"></i>
                </div>
                <textarea id="reviewComment" placeholder="Напишите ваш отзыв (необязательно)..." rows="4" style="width:100%;background:#111;border:1px solid #333;color:white;border-radius:8px;padding:10px;margin-bottom:15px"></textarea>
                <button onclick="submitReview()" class="modal-add-to-cart">Отправить отзыв</button>
                <p id="reviewAuthMessage" style="display:none; color:#ff7a2f; margin-top:12px; text-align:center">🔒 <a href="/login" style="color:#ff7a2f;">Войдите в аккаунт</a>, чтобы оставить отзыв</p>
            </div>
        </div>
        
        <script>
        let currentModalProductId = null;
        let currentModalProductRealId = null;
        let selectedReviewRating = null;
        const isLoggedIn = ${!!user};
        
        function closeProductModal() {
            document.getElementById('productModal').classList.remove('active');
        }
        
        function openReviewModal() {
            if (!isLoggedIn) {
                document.getElementById('reviewAuthMessage').style.display = 'block';
                return;
            }
            document.getElementById('reviewModal').classList.add('active');
        }
        
        function closeReviewModal() {
            document.getElementById('reviewModal').classList.remove('active');
            document.getElementById('reviewComment').value = '';
            selectedReviewRating = null;
            document.querySelectorAll('#reviewStars i').forEach(star => {
                star.className = 'far fa-star';
            });
        }
        
        document.querySelectorAll('#reviewStars i').forEach(star => {
            star.addEventListener('click', function() {
                const rating = this.dataset.rating;
                selectedReviewRating = rating;
                document.querySelectorAll('#reviewStars i').forEach((s, idx) => {
                    if (idx < rating) {
                        s.className = 'fas fa-star';
                    } else {
                        s.className = 'far fa-star';
                    }
                });
            });
        });
        
        async function submitReview() {
            if (!isLoggedIn) {
                alert('Войдите в аккаунт, чтобы оставить отзыв');
                return;
            }
            const rating = selectedReviewRating;
            const comment = document.getElementById('reviewComment').value;
            if (!rating) {
                alert('Выберите оценку');
                return;
            }
            const response = await fetch('/api/rating/' + currentModalProductRealId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: parseInt(rating), comment: comment || '' })
            });
            const data = await response.json();
            if (data.success) {
                showToast('Спасибо за отзыв!');
                closeReviewModal();
                // Обновляем звезды
                const starsContainer = document.getElementById('modalRatingStars');
                if (starsContainer && data.avg_rating) {
                    renderStarsInModal(parseFloat(data.avg_rating));
                    document.getElementById('modalRatingVotes').textContent = '(' + data.votes_count + ' оценок)';
                }
                renderComments(data.comments);
                // Обновляем оценку на карточке
                const cardStars = document.querySelector('.rating-stars[data-product-id="' + currentModalProductRealId + '"]');
                if (cardStars) {
                    updateCardRating(cardStars, parseFloat(data.avg_rating), data.votes_count);
                }
            } else {
                showToast('Ошибка при сохранении оценки', true);
            }
        }
        
        function renderStarsInModal(rating) {
            const container = document.getElementById('modalRatingStars');
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
        
        function renderComments(comments) {
            const container = document.getElementById('modalCommentsList');
            if (!comments || comments.length === 0) {
                container.innerHTML = '<div class="no-comments">📝 Пока нет комментариев. Будьте первым!</div>';
                return;
            }
            let html = '';
            for (let c of comments) {
                let stars = '';
                for (let s = 1; s <= 5; s++) {
                    if (s <= c.rating) stars += '<i class="fas fa-star" style="color:#ff7a2f; font-size:10px;"></i>';
                    else stars += '<i class="far fa-star" style="color:#555; font-size:10px;"></i>';
                }
                html += '<div class="comment-item"><div class="comment-header"><span class="comment-user">' + escapeHtml(c.username) + '</span><span class="comment-date">' + new Date(c.created_at).toLocaleDateString() + '</span></div><div class="comment-rating">' + stars + '</div><div class="comment-text">' + escapeHtml(c.comment || '') + '</div></div>';
            }
            container.innerHTML = html;
        }
        
        function updateCardRating(container, rating, votesCount) {
            let starsHtml = '';
            const fullStars = Math.floor(rating);
            const hasHalfStar = rating % 1 >= 0.5;
            for (let i = 1; i <= 5; i++) {
                if (i <= fullStars) starsHtml += '<i class="fas fa-star star filled"></i>';
                else if (i === fullStars + 1 && hasHalfStar) starsHtml += '<i class="fas fa-star-half-alt star filled"></i>';
                else starsHtml += '<i class="far fa-star star"></i>';
            }
            starsHtml += '<span class="rating-value">' + rating + '</span>';
            starsHtml += '<span class="votes-count">(' + votesCount + ')</span>';
            container.innerHTML = starsHtml;
        }
        
        document.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                if (e.target.closest('.add-to-cart-btn') || e.target.closest('.fav-btn')) return;
                currentModalProductRealId = card.dataset.productId;
                currentModalProductId = 'product_' + card.dataset.productId;
                document.getElementById('productModalImage').src = card.dataset.productImage;
                document.getElementById('productModalTitle').textContent = card.dataset.productName;
                document.getElementById('productModalArtist').textContent = card.dataset.productArtist;
                document.getElementById('productModalTags').innerHTML = '<span class="modal-tag">' + escapeHtml(card.dataset.productGenre) + '</span><span class="modal-tag">' + escapeHtml(card.dataset.productYear) + '</span>';
                document.getElementById('productModalDescription').textContent = card.dataset.productDescription;
                document.getElementById('productModalPrice').innerHTML = card.dataset.productPrice + ' <span>$</span>';
                
                if (card.dataset.productAudio && card.dataset.productAudio !== '') {
                    document.getElementById('modalPlayBtn').style.display = 'flex';
                } else {
                    document.getElementById('modalPlayBtn').style.display = 'none';
                }
                
                const response = await fetch('/api/rating/' + card.dataset.productId);
                const data = await response.json();
                renderStarsInModal(parseFloat(data.avg_rating));
                document.getElementById('modalRatingVotes').textContent = '(' + data.votes_count + ' оценок)';
                renderComments(data.comments);
                
                const favResponse = await fetch('/api/favorites/status/product_' + card.dataset.productId);
                const favData = await favResponse.json();
                const favBtn = document.querySelector('#productModal .modal-fav-btn');
                if (favData.isFavorite) {
                    favBtn.style.color = '#ff0000';
                    favBtn.style.background = 'rgba(255, 0, 0, 0.2)';
                } else {
                    favBtn.style.color = '#fff';
                    favBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                }
                
                document.getElementById('productModal').classList.add('active');
            });
        });
        
        async function addToCartFromModal() {
            if (currentModalProductId) {
                await fetch('/api/cart/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: currentModalProductId })
                });
                showToast('Товар добавлен в корзину');
                closeProductModal();
            }
        }
        
        async function toggleFavoriteFromModal() {
            if (currentModalProductId) {
                const response = await fetch('/api/favorites/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: currentModalProductId })
                });
                const data = await response.json();
                const favBtn = document.querySelector('#productModal .modal-fav-btn');
                if (data.action === 'added') {
                    favBtn.style.color = '#ff0000';
                    favBtn.style.background = 'rgba(255, 0, 0, 0.2)';
                    showToast('Добавлено в избранное');
                } else {
                    favBtn.style.color = '#fff';
                    favBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                    showToast('Удалено из избранного');
                }
            }
        }
        
        function playModalPreview() {
            const audioFile = currentModalProductRealId;
            if (audioFile) {
                const audio = new Audio('/audio/' + audioFile);
                audio.play();
            }
        }
        
        document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const productId = btn.dataset.id;
                await fetch('/api/cart/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: productId })
                });
                showToast('Товар добавлен в корзину');
            });
        });
        
        document.querySelectorAll('.fav-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const productId = btn.dataset.id;
                const response = await fetch('/api/favorites/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: productId })
                });
                const data = await response.json();
                if (data.action === 'added') {
                    btn.style.color = '#ff0000';
                    showToast('Добавлено в избранное');
                } else {
                    btn.style.color = 'white';
                    showToast('Удалено из избранного');
                }
            });
        });
        
        function showToast(msg, isError) {
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.style.background = isError ? '#f44336' : '#4CAF50';
            toast.innerHTML = (isError ? '❌ ' : '✅ ') + msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }
        </script>
        `;
        
        res.send(renderPage('Каталог пластинок', content, user, 'catalog'));
    } catch (err) {
        console.error("Ошибка каталога:", err);
        res.status(500).send("Ошибка загрузки каталога");
    }
});

// ============================================================
// КАТАЛОГ ПРОИГРЫВАТЕЛЕЙ
// ============================================================
app.get("/players-catalog", (req, res) => {
    const user = req.session.user;
    try {
        const players = db.prepare("SELECT * FROM players ORDER BY id").all();
        
        let playersHTML = '';
        if (players.length === 0) {
            playersHTML = '<div style="text-align:center;padding:60px;color:#666">Нет доступных проигрывателей</div>';
        } else {
            for (const player of players) {
                playersHTML += `
                <div class="product-card" data-player-id="${player.id}" data-player-name="${escapeHtml(player.name)}" data-player-price="${player.price}" data-player-image="/photo/${player.image}" data-player-description="${escapeHtml(player.description || 'Высококачественный проигрыватель винила')}">
                    <div class="product-image">
                        <img src="/photo/${player.image}" alt="${escapeHtml(player.name)}" onerror="this.src='/photo/logo.svg'">
                        <div class="vinyl-overlay">
                            <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                        </div>
                    </div>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(player.name)}</div>
                        <div class="product-artist">Проигрыватель</div>
                        <div class="product-price">$${player.price}</div>
                        <div class="product-actions">
                            <button class="action-btn add-to-cart-btn" data-id="player_${player.id}"><i class="fas fa-shopping-cart"></i> В корзину</button>
                            <button class="action-btn fav-btn" data-id="player_${player.id}"><i class="fas fa-heart"></i></button>
                        </div>
                    </div>
                </div>`;
            }
        }
        
        const content = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <h1>🎚️ Каталог проигрывателей</h1>
            <span style="color:#888">Найдено: ${players.length} товаров</span>
        </div>
        <div class="products-grid">
            ${playersHTML}
        </div>
        
        <!-- Модальное окно проигрывателя -->
        <div id="playerModal" class="modal-overlay">
            <div class="modal-content">
                <button class="modal-close" onclick="closePlayerModal()">&times;</button>
                <img src="" alt="Проигрыватель" class="modal-player-image" id="playerModalImage">
                <h2 class="modal-title" id="playerModalTitle"></h2>
                <p class="modal-description" id="playerModalDescription"></p>
                <div class="modal-price" id="playerModalPrice"></div>
                <button onclick="addPlayerToCart()" class="modal-add-to-cart">Добавить в корзину</button>
            </div>
        </div>
        
        <script>
        let currentPlayerId = null;
        
        document.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.add-to-cart-btn') || e.target.closest('.fav-btn')) return;
                currentPlayerId = 'player_' + card.dataset.playerId;
                document.getElementById('playerModalImage').src = card.dataset.playerImage;
                document.getElementById('playerModalTitle').textContent = card.dataset.playerName;
                document.getElementById('playerModalDescription').textContent = card.dataset.playerDescription;
                document.getElementById('playerModalPrice').innerHTML = card.dataset.playerPrice + ' <span>$</span>';
                document.getElementById('playerModal').classList.add('active');
            });
        });
        
        function closePlayerModal() {
            document.getElementById('playerModal').classList.remove('active');
        }
        
        async function addPlayerToCart() {
            if (currentPlayerId) {
                await fetch('/api/cart/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: currentPlayerId })
                });
                showToast('Проигрыватель добавлен в корзину');
                closePlayerModal();
            }
        }
        
        document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const productId = btn.dataset.id;
                await fetch('/api/cart/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: productId })
                });
                showToast('Товар добавлен в корзину');
            });
        });
        
        document.querySelectorAll('.fav-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const productId = btn.dataset.id;
                const response = await fetch('/api/favorites/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: productId })
                });
                const data = await response.json();
                if (data.action === 'added') {
                    btn.style.color = '#ff0000';
                    showToast('Добавлено в избранное');
                } else {
                    btn.style.color = 'white';
                    showToast('Удалено из избранного');
                }
            });
        });
        
        function showToast(msg) {
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = '✅ ' + msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }
        </script>
        `;
        
        res.send(renderPage('Каталог проигрывателей', content, user, 'players'));
    } catch (err) {
        console.error("Ошибка каталога проигрывателей:", err);
        res.status(500).send("Ошибка загрузки каталога");
    }
});

// ============================================================
// ===================== ГЛАВНАЯ СТРАНИЦА =====================
// ============================================================
app.get("/", (req, res) => {
    const user = req.session.user;
    const showNotification = req.query.added === '1';
    
    try {
        const setting = db.prepare("SELECT value FROM site_settings WHERE key = 'homepage_products'").get();
        const homepageMode = setting ? setting.value : 'last_added';
        
        let products = db.prepare("SELECT * FROM products ORDER BY id DESC LIMIT 6").all();
        
        for (const product of products) {
            const rating = db.prepare(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`).get(product.id);
            product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
            product.votes_count = rating?.votes_count || 0;
        }
        
        const players = db.prepare("SELECT * FROM players").all();
        
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
        
        let productsHTML = '';
        for (const product of products) {
            productsHTML += `
            <div class="product-card" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name)}" data-product-artist="${escapeHtml(product.artist)}" data-product-price="${product.price}" data-product-image="/uploads/${product.image}" data-product-description="${escapeHtml(product.description || 'Нет описания')}" data-product-genre="${escapeHtml(product.genre || 'Rock')}" data-product-year="${escapeHtml(product.year || '1970')}" data-product-audio="${product.audio || ''}">
                <div class="product-image">
                    <img src="/uploads/${product.image}" alt="${escapeHtml(product.name)}" onerror="this.src='/photo/plastinka-audio.png'">
                    <div class="vinyl-overlay">
                        <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                    </div>
                </div>
                <div class="product-info">
                    <div class="product-name">${escapeHtml(product.name)}</div>
                    <div class="product-artist">${escapeHtml(product.artist)}</div>
                    ${generateStarRatingHTML(product.avg_rating, product.votes_count)}
                    <div class="product-price">$${product.price}</div>
                    <div class="product-actions">
                        <button class="action-btn add-to-cart-btn" data-id="product_${product.id}"><i class="fas fa-shopping-cart"></i> В корзину</button>
                        <button class="action-btn fav-btn" data-id="product_${product.id}"><i class="fas fa-heart"></i></button>
                    </div>
                </div>
            </div>`;
        }
        
        // Карусель проигрывателей
        let carouselItems = '';
        for (let i = 0; i < 6; i++) {
            for (const player of players) {
                carouselItems += `
                <div class="card" data-player-id="${player.id}" data-name="${escapeHtml(player.name)}" data-price="${player.price}" data-image="/photo/${player.image}" data-description="${escapeHtml(player.description || 'Высококачественный проигрыватель винила')}">
                    <div class="circle orange"></div>
                    <img src="/photo/${player.image}" alt="${player.name}" class="player-image">
                    <button class="view-btn">Смотреть</button>
                </div>`;
            }
        }
        
        const content = `
        <style>
        .player-carousel, .player-carousel2 { width: 100%; overflow: hidden; background: #1e1e1e; padding: 40px 0; position: relative; margin: 30px 0; }
        .player-carousel .carousel-track { display: flex; gap: 40px; width: max-content; animation: scrollLeft 60s linear infinite; align-items: center; }
        .player-carousel2 .carousel-track2 { display: flex; gap: 40px; width: max-content; animation: scrollRight 60s linear infinite; align-items: center; }
        .player-carousel:hover .carousel-track, .player-carousel2:hover .carousel-track2 { animation-play-state: paused; }
        @keyframes scrollLeft { 0% { transform: translateX(0); } 100% { transform: translateX(calc(-50%)); } }
        @keyframes scrollRight { 0% { transform: translateX(-50%); } 100% { transform: translateX(0); } }
        .player-carousel .card, .player-carousel2 .card { position: relative; width: 260px; height: 320px; background: transparent; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform 0.3s ease; cursor: pointer; }
        .player-carousel .card:hover, .player-carousel2 .card:hover { transform: translateY(-10px); }
        .player-carousel .circle, .player-carousel2 .circle { position: absolute; width: 240px; height: 240px; border-radius: 50%; transition: transform 0.4s ease; }
        .player-carousel .card:hover .circle, .player-carousel2 .card:hover .circle { transform: scale(1.1); }
        .player-carousel .orange, .player-carousel2 .orange { background: #ff7a2f; }
        .player-carousel .player-image, .player-carousel2 .player-image { position: relative; width: 220px; height: auto; z-index: 2; object-fit: contain; transition: transform 0.3s ease; }
        .player-carousel .view-btn, .player-carousel2 .view-btn { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(20px); background: linear-gradient(45deg, #D74307, #ff6b2b); color: white; border: none; border-radius: 30px; padding: 8px 20px; font-size: 14px; font-weight: bold; cursor: pointer; opacity: 0; visibility: hidden; transition: all 0.3s ease; z-index: 10; white-space: nowrap; }
        .player-carousel .card:hover .view-btn, .player-carousel2 .card:hover .view-btn { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }
        .player-carousel::before, .player-carousel2::before { content: ''; position: absolute; top: 0; left: 0; width: 100px; height: 100%; background: linear-gradient(90deg, #1e1e1e 0%, transparent 100%); z-index: 10; pointer-events: none; }
        .player-carousel::after, .player-carousel2::after { content: ''; position: absolute; top: 0; right: 0; width: 100px; height: 100%; background: linear-gradient(-90deg, #1e1e1e 0%, transparent 100%); z-index: 10; pointer-events: none; }
        
        .section-title { font-size: 28px; margin: 20px 0; text-align: center; color: #ff7a2f; }
        .hero { height: 60vh; background: linear-gradient(135deg, #1a1a1a, #0a0a0a), url('/photo/hero-bg.jpg'); background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center; text-align: center; margin-bottom: 20px; }
        .hero h1 { font-size: 48px; color: white; text-shadow: 0 0 20px rgba(255,0,0,0.5); }
        </style>
        
        <section class="hero">
            <h1>Винил — это жизнь</h1>
        </section>
        
        <h2 class="section-title">Новинки</h2>
        <div class="products-grid">
            ${productsHTML}
        </div>
        
        <h2 class="section-title">Популярные проигрыватели</h2>
        <section class="player-carousel">
            <div class="carousel-track">${carouselItems}</div>
        </section>
        
        <!-- Модальные окна (аналогично каталогу) -->
        <div id="productModal" class="modal-overlay">
            <div class="modal-content">
                <button class="modal-close" onclick="closeProductModal()">&times;</button>
                <img src="" alt="Пластинка" class="modal-player-image" id="productModalImage">
                <h2 class="modal-title" id="productModalTitle"></h2>
                <p class="modal-artist" id="productModalArtist"></p>
                <div class="modal-tags" id="productModalTags"></div>
                <div class="rating-section">
                    <div class="rating-label">Средняя оценка:</div>
                    <div class="rating-stars-large" id="modalRatingStars"></div>
                    <div class="rating-votes" id="modalRatingVotes"></div>
                </div>
                <div class="comments-list" id="modalCommentsList"></div>
                <p class="modal-description" id="productModalDescription"></p>
                <div class="modal-price" id="productModalPrice"></div>
                <div class="modal-actions">
                    <button onclick="addToCartFromModal()" class="modal-add-to-cart">В корзину</button>
                    <button onclick="toggleFavoriteFromModal()" class="modal-fav-btn"><i class="fas fa-heart"></i></button>
                </div>
                <button onclick="openReviewModal()" class="modal-review-btn">✍️ Оставить отзыв</button>
            </div>
        </div>
        
        <div id="playerModal" class="modal-overlay">
            <div class="modal-content">
                <button class="modal-close" onclick="closePlayerModal()">&times;</button>
                <img src="" alt="Проигрыватель" class="modal-player-image" id="playerModalImage">
                <h2 class="modal-title" id="playerModalTitle"></h2>
                <p class="modal-description" id="playerModalDescription"></p>
                <div class="modal-price" id="playerModalPrice"></div>
                <button onclick="addPlayerToCart()" class="modal-add-to-cart">Добавить в корзину</button>
            </div>
        </div>
        
        <div id="reviewModal" class="modal-overlay">
            <div class="modal-content review-modal-content">
                <button class="modal-close" onclick="closeReviewModal()">&times;</button>
                <h3 class="review-title">⭐ Оцените пластинку</h3>
                <div class="review-stars" id="reviewStars" style="display:flex;gap:10px;justify-content:center;margin:15px 0">
                    <i class="far fa-star" data-rating="1" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="2" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="3" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="4" style="font-size:32px;cursor:pointer"></i>
                    <i class="far fa-star" data-rating="5" style="font-size:32px;cursor:pointer"></i>
                </div>
                <textarea id="reviewComment" placeholder="Напишите ваш отзыв..." rows="4" style="width:100%;background:#111;border:1px solid #333;color:white;border-radius:8px;padding:10px;margin-bottom:15px"></textarea>
                <button onclick="submitReview()" class="modal-add-to-cart">Отправить отзыв</button>
                <p id="reviewAuthMessage" style="display:none; color:#ff7a2f; margin-top:12px; text-align:center">🔒 <a href="/login" style="color:#ff7a2f;">Войдите в аккаунт</a></p>
            </div>
        </div>
        
        <script>
        let currentModalProductId = null;
        let currentModalProductRealId = null;
        let currentPlayerId = null;
        let selectedReviewRating = null;
        const isLoggedIn = ${!!user};
        
        function closeProductModal() { document.getElementById('productModal').classList.remove('active'); }
        function closePlayerModal() { document.getElementById('playerModal').classList.remove('active'); }
        
        function openReviewModal() {
            if (!isLoggedIn) { document.getElementById('reviewAuthMessage').style.display = 'block'; return; }
            document.getElementById('reviewModal').classList.add('active');
        }
        function closeReviewModal() {
            document.getElementById('reviewModal').classList.remove('active');
            document.getElementById('reviewComment').value = '';
            selectedReviewRating = null;
            document.querySelectorAll('#reviewStars i').forEach(star => star.className = 'far fa-star');
        }
        
        document.querySelectorAll('#reviewStars i').forEach(star => {
            star.addEventListener('click', function() {
                selectedReviewRating = this.dataset.rating;
                document.querySelectorAll('#reviewStars i').forEach((s, idx) => {
                    s.className = idx < selectedReviewRating ? 'fas fa-star' : 'far fa-star';
                });
            });
        });
        
        async function submitReview() {
            if (!isLoggedIn) { alert('Войдите в аккаунт'); return; }
            if (!selectedReviewRating) { alert('Выберите оценку'); return; }
            const comment = document.getElementById('reviewComment').value;
            const response = await fetch('/api/rating/' + currentModalProductRealId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: parseInt(selectedReviewRating), comment })
            });
            const data = await response.json();
            if (data.success) {
                showToast('Спасибо за отзыв!');
                closeReviewModal();
                renderStarsInModal(parseFloat(data.avg_rating));
                document.getElementById('modalRatingVotes').textContent = '(' + data.votes_count + ' оценок)';
                renderComments(data.comments);
            }
        }
        
        function renderStarsInModal(rating) {
            const container = document.getElementById('modalRatingStars');
            if (!container) return;
            let html = '';
            for (let i = 1; i <= 5; i++) {
                if (i <= rating) html += '<i class="fas fa-star star filled"></i>';
                else html += '<i class="far fa-star star"></i>';
            }
            container.innerHTML = html;
        }
        
        function renderComments(comments) {
            const container = document.getElementById('modalCommentsList');
            if (!comments || !comments.length) {
                container.innerHTML = '<div class="no-comments">📝 Пока нет комментариев</div>';
                return;
            }
            let html = '';
            for (let c of comments) {
                let stars = '';
                for (let s = 1; s <= 5; s++) {
                    stars += s <= c.rating ? '<i class="fas fa-star" style="color:#ff7a2f;font-size:10px"></i>' : '<i class="far fa-star" style="color:#555;font-size:10px"></i>';
                }
                html += '<div class="comment-item"><div class="comment-header"><span class="comment-user">' + escapeHtml(c.username) + '</span><span class="comment-date">' + new Date(c.created_at).toLocaleDateString() + '</span></div><div class="comment-rating">' + stars + '</div><div class="comment-text">' + escapeHtml(c.comment || '') + '</div></div>';
            }
            container.innerHTML = html;
        }
        
        document.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                if (e.target.closest('.add-to-cart-btn') || e.target.closest('.fav-btn')) return;
                currentModalProductRealId = card.dataset.productId;
                currentModalProductId = 'product_' + card.dataset.productId;
                document.getElementById('productModalImage').src = card.dataset.productImage;
                document.getElementById('productModalTitle').textContent = card.dataset.productName;
                document.getElementById('productModalArtist').textContent = card.dataset.productArtist;
                document.getElementById('productModalTags').innerHTML = '<span class="modal-tag">' + escapeHtml(card.dataset.productGenre) + '</span><span class="modal-tag">' + escapeHtml(card.dataset.productYear) + '</span>';
                document.getElementById('productModalDescription').textContent = card.dataset.productDescription;
                document.getElementById('productModalPrice').innerHTML = card.dataset.productPrice + ' <span>$</span>';
                
                const response = await fetch('/api/rating/' + card.dataset.productId);
                const data = await response.json();
                renderStarsInModal(parseFloat(data.avg_rating));
                document.getElementById('modalRatingVotes').textContent = '(' + data.votes_count + ' оценок)';
                renderComments(data.comments);
                
                document.getElementById('productModal').classList.add('active');
            });
        });
        
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.card');
                currentPlayerId = 'player_' + card.dataset.playerId;
                document.getElementById('playerModalImage').src = card.dataset.image;
                document.getElementById('playerModalTitle').textContent = card.dataset.name;
                document.getElementById('playerModalDescription').textContent = card.dataset.description;
                document.getElementById('playerModalPrice').innerHTML = card.dataset.price + ' <span>$</span>';
                document.getElementById('playerModal').classList.add('active');
            });
        });
        
        async function addToCartFromModal() {
            if (currentModalProductId) {
                await fetch('/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: currentModalProductId }) });
                showToast('Товар добавлен в корзину');
                closeProductModal();
            }
        }
        
        async function toggleFavoriteFromModal() {
            if (currentModalProductId) {
                await fetch('/api/favorites/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: currentModalProductId }) });
                showToast('Избранное обновлено');
            }
        }
        
        async function addPlayerToCart() {
            if (currentPlayerId) {
                await fetch('/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: currentPlayerId }) });
                showToast('Проигрыватель добавлен в корзину');
                closePlayerModal();
            }
        }
        
        document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await fetch('/api/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.id }) });
                showToast('Товар добавлен в корзину');
            });
        });
        
        function showToast(msg) {
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = '✅ ' + msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }
        </script>
        `;
        
        res.send(renderPage('Plastinka', content, user, 'home', showNotification));
    } catch (err) {
        console.error("Ошибка главной страницы:", err);
        res.status(500).send("Ошибка загрузки главной страницы");
    }
});

// ============================================================
// ===================== ПРОФИЛЬ ==============================
// ============================================================

app.get("/profile", requireAuth, (req, res) => {
    const user = req.session.user;
    const userData = db.prepare("SELECT avatar FROM users WHERE id = ?").get(user.id);
    const avatar = userData ? userData.avatar : 'default-avatar.png';
    const favs = db.prepare("SELECT COUNT(*) as favs FROM favorites WHERE user_id = ?").get(user.id);
    const favCount = favs ? favs.favs : 0;
    
    res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Мой профиль · Plastinka</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:linear-gradient(135deg,#0a0a0a 0%,#0f0f0f 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#fff;}
header{position:sticky;top:0;z-index:1000;display:flex;justify-content:space-between;align-items:center;padding:15px 5%;background:#0a0a0a;box-shadow:0 2px 10px rgba(0,0,0,0.3);min-height:80px}
.logo{flex-shrink:0;z-index:2}.logo img{height:50px;width:auto;display:block}
.search-bar-desktop{position:absolute;left:40%;transform:translateX(-50%);width:100%;max-width:500px;min-width:250px;background:#1a1a1a;border-radius:40px;padding:10px 20px;display:flex;align-items:center;gap:10px;border:1px solid #333;transition:border-color 0.2s;z-index:1}
.search-bar-desktop:hover,.search-bar-desktop:focus-within{border-color:#ff0000;background:#111}
.search-bar-desktop i{color:#ff0000;font-size:18px}
.search-bar-desktop input{flex:1;background:transparent;border:none;color:#fff;font-size:16px;outline:none}
.search-bar-desktop input::placeholder{color:#888}
.right-icons{display:flex;gap:20px;align-items:center;flex-shrink:0;margin-left:auto;z-index:2}
.right-icons a{display:flex;align-items:center;transition:all 0.25s ease;line-height:0}
.right-icons a:hover{transform:scale(1.1);filter:drop-shadow(0 0 8px rgba(255, 0, 0, 0.5))}
.right-icons img{height:40px;width:auto;display:block}
@media(max-width:900px){.search-bar-desktop{max-width:350px}}
@media(max-width:768px){header{position:relative;justify-content:flex-start;gap:15px;min-height:auto;flex-wrap:wrap}.search-bar-desktop{position:relative;left:auto;transform:none;max-width:none;flex:1 1 200px;order:1}.right-icons{order:2;gap:15px;margin-left:0}.right-icons img{height:40px}.logo img{height:45px}}
@media(max-width:550px){header{flex-direction:column;align-items:stretch}.logo{text-align:center}.search-bar-desktop{width:100%;max-width:100%;order:1}.right-icons{justify-content:center;order:2;gap:25px;flex-wrap:wrap}.right-icons img{height:40px}}
@media(max-width:480px){.logo img{height:40px}.right-icons img{height:35px}.right-icons{gap:20px}}

.profile-wrapper{max-width:1000px;margin:40px auto;padding:0 20px}
.profile-card{background:rgba(24,24,24,0.95);backdrop-filter:blur(10px);border-radius:32px;border:1px solid rgba(255,0,0,0.3);overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,0.4)}
.profile-cover{height:160px;background:linear-gradient(135deg,#ff0000,#990000);position:relative}
.profile-avatar-wrapper{position:relative;text-align:center;margin-top:-70px;z-index:2}
.profile-avatar{width:130px;height:130px;border-radius:50%;border:5px solid #1a1a1a;object-fit:cover;background:#0a0a0a;box-shadow:0 5px 15px rgba(0,0,0,0.3);cursor:pointer;transition:0.3s}
.profile-avatar:hover{opacity:0.8;transform:scale(1.02)}
.avatar-overlay{position:absolute;bottom:5px;right:5px;background:#ff0000;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px solid #1a1a1a;transition:0.3s}
.avatar-overlay:hover{transform:scale(1.1)}
.avatar-overlay i{color:white;font-size:16px}
.profile-name{text-align:center;font-size:32px;font-weight:700;margin-top:15px;letter-spacing:1px}
.profile-role{text-align:center;color:#ff4444;font-size:16px;margin-top:5px;text-transform:uppercase;font-weight:600}
.profile-stats{display:flex;justify-content:center;gap:60px;padding:25px;background:rgba(0,0,0,0.3);margin:25px 30px;border-radius:24px;flex-wrap:wrap}
.stat{text-align:center;padding:10px 20px;background:rgba(255,255,255,0.05);border-radius:20px;min-width:120px}
.stat-value{font-size:32px;font-weight:bold;color:#ff4444}
.stat-label{color:#aaa;font-size:13px;margin-top:5px}
.profile-menu{margin:20px 30px 30px;display:flex;flex-direction:column;gap:12px}
.menu-item{display:flex;align-items:center;gap:18px;padding:16px 20px;background:rgba(10,10,10,0.6);border-radius:20px;text-decoration:none;color:white;transition:all 0.2s;border:1px solid #333;cursor:pointer}
.menu-item:hover{background:rgba(255,0,0,0.1);border-color:#ff0000;transform:translateX(8px)}
.menu-item i:first-child{width:30px;font-size:20px;color:#ff4444}
.menu-item span{flex:1;font-size:16px}
.arrow{color:#666;font-size:14px}
.admin-panel-btn,.logout-btn{display:block;margin:15px 30px;padding:16px;text-align:center;border-radius:20px;font-weight:bold;font-size:16px;transition:0.2s;text-decoration:none}
.admin-panel-btn{background:linear-gradient(45deg,#ff0000,#990000);color:white;box-shadow:0 5px 15px rgba(255,0,0,0.3)}
.admin-panel-btn:hover{transform:translateY(-3px);box-shadow:0 8px 25px rgba(255,0,0,0.4)}
.logout-btn{background:transparent;color:#ff4444;border:1px solid #ff4444}
.logout-btn:hover{background:rgba(255,68,68,0.1);transform:translateY(-2px)}
footer{text-align:center;padding:40px;background:#0a0a0a;margin-top:60px}
.footer-logo{height:40px}

.modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);backdrop-filter:blur(5px);z-index:1000;justify-content:center;align-items:center}
.modal-content{background:linear-gradient(145deg,#2a2a2a,#1e1e1e);border-radius:20px;padding:30px;max-width:500px;width:90%;position:relative;border:1px solid #ff7a2f}
.modal-content h3{color:#ff7a2f;margin-bottom:20px}
.modal-content input,.modal-content textarea{width:100%;padding:12px;margin-bottom:15px;background:#111;border:1px solid #333;border-radius:8px;color:#fff}
.modal-content textarea{resize:vertical;min-height:80px}
.modal-buttons{display:flex;gap:10px;margin-top:10px}
.modal-buttons button{flex:1;padding:12px;border-radius:8px;font-weight:bold;cursor:pointer}
.modal-buttons button[type="submit"]{background:linear-gradient(45deg,#ff0000,#990000);border:none;color:white}
.modal-buttons button[type="button"]{background:#333;border:none;color:#fff}
.modal-close{position:absolute;top:15px;right:15px;background:rgba(255,0,0,0.1);border:none;color:#fff;font-size:30px;cursor:pointer;width:40px;height:40px;border-radius:50%;transition:0.3s}
.modal-close:hover{background:#ff0000;transform:rotate(90deg)}
@media(max-width:600px){.profile-wrapper{margin:20px auto}.profile-stats{gap:20px;margin:15px;padding:15px}.stat{min-width:80px;padding:8px 12px}.stat-value{font-size:24px}.profile-name{font-size:24px}.profile-avatar{width:100px;height:100px;margin-top:-50px}.profile-cover{height:120px}}

.favorite-item{display:flex;align-items:center;gap:15px;padding:12px;background:rgba(255,255,255,0.05);border-radius:16px;border:1px solid #333;transition:all 0.2s}
.favorite-item:hover{background:rgba(255,255,255,0.1);border-color:#ff7a2f;transform:translateX(5px)}
.toast-notification{position:fixed;bottom:20px;right:20px;background:#4CAF50;color:white;padding:10px 20px;border-radius:8px;z-index:10000;animation:fadeOut 2s forwards;font-size:14px}
@keyframes fadeOut{0%{opacity:1}70%{opacity:1}100%{opacity:0;visibility:hidden}}

.modal-player-image{width:100%;border-radius:12px;margin-bottom:15px}
.modal-title{font-size:28px;color:#ff7a2f;margin-bottom:5px}
.modal-artist{color:#aaa;margin-bottom:15px}
.modal-tags{display:flex;gap:10px;margin-bottom:20px}
.modal-tag{background:rgba(255,122,47,0.2);padding:5px 12px;border-radius:20px;font-size:12px;color:#ff7a2f}
.rating-stars-large{display:flex;gap:5px;margin:10px 0}
.rating-stars-large .star{font-size:24px;cursor:pointer;transition:0.2s}
.rating-stars-large .star:hover{transform:scale(1.1);color:#ff7a2f}
.comments-list{max-height:300px;overflow-y:auto;margin:15px 0}
.comment-item{border-bottom:1px solid #333;padding:10px 0}
.modal-price{font-size:32px;font-weight:bold;color:#ff7a2f;margin:15px 0}
.modal-actions{display:flex;gap:10px;margin:15px 0}
.modal-add-to-cart{flex:1;background:linear-gradient(45deg,#ff7a2f,#ff0000);border:none;color:white;padding:12px;border-radius:8px;cursor:pointer;font-weight:bold}
.modal-fav-btn{width:50px;background:rgba(255,255,255,0.1);border:1px solid #ff0000;border-radius:8px;cursor:pointer;transition:0.2s}
</style>
</head>
<body>
<header>
    <div class="logo"><a href="/"><img src="/photo/logo.svg" alt="Plastinka"></a></div>
    <div class="search-bar-desktop"><i class="fas fa-search"></i><input type="text" id="desktop-search-input" placeholder="Поиск пластинок..."></div>
    <div class="right-icons">
        <a href="/catalog"><img src="/photo/icon-katalog.png" alt="Каталог"></a>
        <a href="/profile"><img src="/photo/profile_icon.png" alt="Профиль"></a>
        <a href="/cart"><img src="/photo/knopka-korzina.svg" alt="Корзина"></a>
    </div>
</header>
<script>
const searchInput=document.getElementById('desktop-search-input');
if(searchInput){searchInput.addEventListener('keypress',function(e){if(e.key==='Enter'){const q=encodeURIComponent(this.value);if(q)window.location.href='/catalog?search='+q;}});}
</script>

<!-- Модальное окно товара -->
<div id="productModal" class="modal-overlay">
    <div class="modal-content" style="max-width:400px;max-height:90vh;overflow-y:auto">
        <button class="modal-close" onclick="closeProductModal()">&times;</button>
        <img src="" alt="Товар" class="modal-player-image" id="productModalImage">
        <h2 class="modal-title" id="productModalTitle"></h2>
        <p class="modal-artist" id="productModalArtist"></p>
        <div class="modal-tags" id="productModalTags"></div>
        <div class="rating-stars-large" id="modalRatingStars">
            <i class="far fa-star star" data-value="1"></i>
            <i class="far fa-star star" data-value="2"></i>
            <i class="far fa-star star" data-value="3"></i>
            <i class="far fa-star star" data-value="4"></i>
            <i class="far fa-star star" data-value="5"></i>
        </div>
        <div class="rating-votes" id="modalRatingVotes" style="color:#666;font-size:12px">(0 оценок)</div>
        <div class="comments-list" id="modalCommentsList"></div>
        <p class="modal-description" id="productModalDescription"></p>
        <div class="modal-price" id="productModalPrice"></div>
        <div class="modal-actions">
            <button onclick="addToCartFromModal()" class="modal-add-to-cart">В корзину</button>
            <button onclick="toggleFavoriteFromModal()" class="modal-fav-btn" id="modalFavBtn"><i class="fas fa-heart"></i></button>
        </div>
    </div>
</div>

<div class="profile-wrapper">
    <div class="profile-card">
        <div class="profile-cover"></div>
        <div class="profile-avatar-wrapper">
            <div class="avatar-container" style="position:relative;display:inline-block">
                <img src="/avatars/${avatar}" class="profile-avatar" id="profileAvatar">
                <div class="avatar-overlay" onclick="openAvatarModal()"><i class="fas fa-camera"></i></div>
            </div>
            <h2 class="profile-name">${escapeHtml(user.username)}</h2>
            <div class="profile-role">${user.role === 'admin' ? 'Администратор' : '🎧 Меломан'}</div>
        </div>
        <div class="profile-stats">
            <div class="stat"><div class="stat-value">0</div><div class="stat-label">Заказов</div></div>
            <div class="stat"><div class="stat-value" id="favCount">${favCount}</div><div class="stat-label">Избранное</div></div>
            <div class="stat"><div class="stat-value">—</div><div class="stat-label">На сайте</div></div>
        </div>
        <div class="profile-menu">
            <div class="menu-item" onclick="openSettingsModal()"><i class="fas fa-user-edit"></i><span>Настройки аккаунта</span><i class="fas fa-chevron-right arrow"></i></div>
            <div class="menu-item" onclick="openFavoritesModal()"><i class="fas fa-heart"></i><span>Избранные пластинки</span><i class="fas fa-chevron-right arrow"></i></div>
            <div class="menu-item" onclick="openSettingsModal()"><i class="fas fa-credit-card"></i><span>Способы оплаты</span><i class="fas fa-chevron-right arrow"></i></div>
        </div>
        ${user.role === 'admin' ? '<a href="/admin" class="admin-panel-btn"><i class="fas fa-crown"></i> Админ панель</a>' : ''}
        <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Выйти из аккаунта</a>
    </div>
</div>

<!-- Модальное окно для аватарки -->
<div id="avatarModal" class="modal-overlay">
    <div class="modal-content" style="text-align:center">
        <button class="modal-close" onclick="closeAvatarModal()">&times;</button>
        <h3>📸 Изменить аватар</h3>
        <div style="width:150px;height:150px;margin:20px auto;overflow:hidden;border-radius:50%;border:3px solid #ff7a2f">
            <img src="/avatars/${avatar}" id="avatarPreview" style="width:100%;height:100%;object-fit:cover">
        </div>
        <input type="file" id="avatarFileInput" accept="image/*" style="display:none">
        <button onclick="document.getElementById('avatarFileInput').click()" style="background:rgba(255,122,47,0.2);border:1px solid #ff7a2f;color:#ff7a2f;padding:10px;border-radius:8px;cursor:pointer;width:100%;margin-bottom:10px">📁 Выбрать изображение</button>
        <div id="cropContainer" style="display:none;margin-top:15px">
            <div style="width:100%;height:300px;margin-bottom:10px"><img id="cropImage" style="max-width:100%;max-height:100%"></div>
            <button onclick="cropAndUpload()" style="background:linear-gradient(45deg,#ff7a2f,#ff0000);border:none;color:white;padding:10px;border-radius:8px;cursor:pointer;width:100%">✂️ Обрезать и загрузить</button>
        </div>
        <p id="avatarUploadMessage" style="margin-top:10px;font-size:12px"></p>
    </div>
</div>

<!-- Модальное окно для настроек -->
<div id="settingsModal" class="modal-overlay">
    <div class="modal-content">
        <button class="modal-close" onclick="closeSettingsModal()">&times;</button>
        <h3>⚙️ Настройки аккаунта</h3>
        <form id="settingsForm">
            <input type="text" id="settingsUsername" value="${escapeHtml(user.username)}" placeholder="Имя пользователя">
            <input type="password" id="settingsCurrentPassword" placeholder="Текущий пароль (для смены)">
            <input type="password" id="settingsNewPassword" placeholder="Новый пароль">
            <div class="modal-buttons"><button type="submit">Сохранить</button><button type="button" onclick="closeSettingsModal()">Отмена</button></div>
        </form>
        <p id="settingsMessage" style="margin-top:15px;text-align:center;font-size:12px"></p>
    </div>
</div>

<!-- Модальное окно избранного -->
<div id="favoritesModal" class="modal-overlay">
    <div class="modal-content" style="max-width:600px;max-height:80vh;overflow-y:auto">
        <button class="modal-close" onclick="closeFavoritesModal()">&times;</button>
        <h3><i class="fas fa-heart"></i> Моё избранное</h3>
        <div id="favoritesList" style="display:flex;flex-direction:column;gap:15px"><div style="text-align:center;padding:40px;color:#666"><i class="fas fa-spinner fa-spin"></i><br>Загрузка...</div></div>
    </div>
</div>

<footer><img src="/photo/logo-2.svg" class="footer-logo" alt="Plastinka"></footer>
<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.js"></script>
<script>
let cropper = null;
let currentModalProductId = null;
let currentModalProductType = null;
let currentModalProductRealId = null;

function openAvatarModal() { document.getElementById('avatarModal').style.display = 'flex'; }
function closeAvatarModal() { 
    document.getElementById('avatarModal').style.display = 'none';
    if(cropper){cropper.destroy();cropper=null;}
    document.getElementById('cropImage').src='';
    document.getElementById('cropContainer').style.display='none';
}

document.getElementById('avatarFileInput').addEventListener('change', function(e){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(ev){
        const cropImage = document.getElementById('cropImage');
        cropImage.src = ev.target.result;
        document.getElementById('cropContainer').style.display = 'block';
        if(cropper) cropper.destroy();
        setTimeout(()=>{
            cropper = new Cropper(cropImage, {aspectRatio:1, viewMode:1, dragMode:'move', cropBoxMovable:true, cropBoxResizable:true, background:false, modal:true, guides:true, center:true, highlight:true, autoCropArea:1});
        },100);
    };
    reader.readAsDataURL(file);
});

function cropAndUpload(){
    if(!cropper){ showToast('Сначала выберите изображение', true); return; }
    const canvas = cropper.getCroppedCanvas({width:300,height:300});
    canvas.toBlob((blob)=>{
        const formData = new FormData();
        formData.append('avatar', blob, 'avatar.jpg');
        fetch('/api/upload-avatar', {method:'POST', body:formData})
            .then(r=>r.json())
            .then(data=>{
                if(data.success){
                    document.getElementById('profileAvatar').src = data.avatar + '?t='+Date.now();
                    document.getElementById('avatarPreview').src = data.avatar + '?t='+Date.now();
                    showToast('Аватар обновлен!');
                    setTimeout(closeAvatarModal,1500);
                } else { showToast('Ошибка загрузки', true); }
            }).catch(()=>showToast('Ошибка загрузки', true));
    },'image/jpeg',0.9);
}

function openSettingsModal() { document.getElementById('settingsModal').style.display = 'flex'; }
function closeSettingsModal() { document.getElementById('settingsModal').style.display = 'none'; }

document.getElementById('settingsForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const username = document.getElementById('settingsUsername').value;
    const currentPassword = document.getElementById('settingsCurrentPassword').value;
    const newPassword = document.getElementById('settingsNewPassword').value;
    const res = await fetch('/api/update-profile', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,currentPassword,newPassword})});
    const data = await res.json();
    if(data.success){
        document.getElementById('settingsMessage').innerHTML = '<span style="color:#4CAF50">✅ Сохранено!</span>';
        setTimeout(()=>{ closeSettingsModal(); location.reload(); },1500);
    } else {
        document.getElementById('settingsMessage').innerHTML = '<span style="color:#ff4444">❌ '+data.error+'</span>';
    }
});

function openFavoritesModal() { document.getElementById('favoritesModal').style.display = 'flex'; loadFavoritesList(); }
function closeFavoritesModal() { document.getElementById('favoritesModal').style.display = 'none'; }

async function loadFavoritesList(){
    const container = document.getElementById('favoritesList');
    try{
        const res = await fetch('/api/favorites/list');
        const data = await res.json();
        if(!data.success || data.favorites.length===0){
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#666"><i class="fas fa-heart-broken" style="font-size:40px"></i><br>Нет избранных товаров<br><a href="/catalog" style="color:#ff7a2f">Перейти в каталог →</a></div>';
            return;
        }
        let html = '';
        for(const item of data.favorites){
            const imgPath = item.type === 'product' ? '/uploads/'+item.image : '/photo/'+item.image;
            html += '<div class="favorite-item">'+
                '<img src="'+imgPath+'" style="width:70px;height:70px;object-fit:cover;border-radius:8px" onerror="this.src=\'/photo/plastinka-audio.png\'">'+
                '<div style="flex:1"><div><strong>'+escapeHtml(item.name)+'</strong></div><div style="color:#aaa">'+escapeHtml(item.artist)+'</div><div style="color:#ff7a2f">$'+item.price+'</div></div>'+
                '<div style="display:flex;gap:8px">'+
                '<button onclick="viewProduct('+item.id+', \'product\')" style="background:rgba(255,122,47,0.2);border:none;color:#ff7a2f;padding:8px 12px;border-radius:8px;cursor:pointer"><i class="fas fa-eye"></i></button>'+
                '<button onclick="removeFromFav('+item.id+', \'product\')" style="background:rgba(255,68,68,0.2);border:none;color:#ff4444;padding:8px 12px;border-radius:8px;cursor:pointer"><i class="fas fa-trash"></i></button>'+
                '</div></div>';
        }
        container.innerHTML = html;
    } catch(e){ container.innerHTML = '<div style="text-align:center;padding:40px;color:#ff4444">Ошибка загрузки</div>'; }
}

async function removeFromFav(productId, type){
    const res = await fetch('/api/favorites/remove', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({productId,type})});
    const data = await res.json();
    if(data.success){
        showToast('Удалено из избранного');
        loadFavoritesList();
        updateFavCount();
    } else { showToast('Ошибка удаления', true); }
}

async function updateFavCount(){
    const res = await fetch('/api/favorites/count');
    const data = await res.json();
    if(data.success){ const el = document.getElementById('favCount'); if(el) el.textContent = data.count; }
}

async function viewProduct(productId, type){
    closeFavoritesModal();
    currentModalProductRealId = productId;
    currentModalProductType = type;
    currentModalProductId = (type === 'product' ? 'product_' : 'player_') + productId;
    
    try{
        const res = await fetch('/api/product?id='+productId+'&type='+type);
        const data = await res.json();
        document.getElementById('productModalImage').src = type === 'product' ? '/uploads/'+data.image : '/photo/'+data.image;
        document.getElementById('productModalTitle').textContent = data.name || '';
        document.getElementById('productModalArtist').textContent = data.artist || (type==='player'?'Проигрыватель':'');
        document.getElementById('productModalDescription').textContent = data.description || 'Нет описания';
        document.getElementById('productModalPrice').innerHTML = (data.price||0)+' <span>$</span>';
        const tags = document.getElementById('productModalTags');
        if(type==='product') tags.innerHTML = '<span class="modal-tag">'+(data.genre||'Не указан')+'</span><span class="modal-tag">'+(data.year||'Год не указан')+'</span>';
        else tags.innerHTML = '<span class="modal-tag">Проигрыватель</span>';
        
        const ratingRes = await fetch('/api/rating/'+productId);
        const ratingData = await ratingRes.json();
        const avgRating = parseFloat(ratingData.avg_rating)||0;
        const starsContainer = document.getElementById('modalRatingStars');
        const starElements = starsContainer.querySelectorAll('.star');
        starElements.forEach((star,idx)=>{
            if(idx+1 <= Math.floor(avgRating)) star.className = 'fas fa-star star';
            else if(avgRating - idx - 1 >= 0.5) star.className = 'fas fa-star-half-alt star';
            else star.className = 'far fa-star star';
            star.style.color = idx+1 <= Math.floor(avgRating) ? '#ff7a2f' : '#555';
        });
        document.getElementById('modalRatingVotes').textContent = '('+(ratingData.votes_count||0)+' оценок)';
        
        let commentsHtml = '';
        if(ratingData.comments && ratingData.comments.length){
            for(const c of ratingData.comments){
                commentsHtml += '<div class="comment-item"><div style="display:flex;justify-content:space-between"><strong>'+escapeHtml(c.username)+'</strong><span style="color:#888;font-size:12px">'+new Date(c.created_at).toLocaleDateString()+'</span></div><div>'+'⭐'.repeat(c.rating)+'</div><div>'+escapeHtml(c.comment||'')+'</div></div>';
            }
        } else { commentsHtml = '<div class="comment-item" style="text-align:center;color:#666">📝 Пока нет комментариев</div>'; }
        document.getElementById('modalCommentsList').innerHTML = commentsHtml;
        
        const favRes = await fetch('/api/favorites/status/'+currentModalProductId);
        const favData = await favRes.json();
        const favBtn = document.getElementById('modalFavBtn');
        if(favData.isFavorite){
            favBtn.style.background = '#ff0000';
            favBtn.style.color = 'white';
        } else {
            favBtn.style.background = 'rgba(255,255,255,0.1)';
            favBtn.style.color = 'white';
        }
        
        document.getElementById('productModal').style.display = 'flex';
    } catch(e){ showToast('Ошибка загрузки товара', true); }
}

async function addToCartFromModal(){
    if(currentModalProductId){
        await fetch('/api/cart/add', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:currentModalProductId})});
        showToast('Товар добавлен в корзину');
        closeProductModal();
    }
}

async function toggleFavoriteFromModal(){
    if(currentModalProductId){
        const res = await fetch('/api/favorites/toggle', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:currentModalProductId})});
        const data = await res.json();
        const favBtn = document.getElementById('modalFavBtn');
        if(data.action === 'added'){
            favBtn.style.background = '#ff0000';
            favBtn.style.color = 'white';
            showToast('Добавлено в избранное');
        } else {
            favBtn.style.background = 'rgba(255,255,255,0.1)';
            favBtn.style.color = 'white';
            showToast('Удалено из избранного');
        }
        updateFavCount();
    }
}

function closeProductModal(){
    document.getElementById('productModal').style.display = 'none';
}

function showToast(msg, isError){
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.background = isError ? '#f44336' : '#4CAF50';
    toast.innerHTML = (isError ? '❌ ' : '✅ ') + msg;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),2500);
}

function escapeHtml(str){ if(!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
</script>
</body>
</html>`);
});

// ============================================================
// ===================== API ДЛЯ ПРОФИЛЯ =====================
// ============================================================

app.get("/api/product", (req, res) => {
    const { id, type } = req.query;
    if(type === 'product'){
        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
        res.json(product || {});
    } else {
        const player = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
        res.json(player || {});
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
            const content = `
            <div style="text-align:center;padding:80px 20px">
                <i class="fas fa-shopping-cart" style="font-size:80px;color:#444"></i>
                <h2 style="margin:20px 0">Корзина пуста</h2>
                <p style="color:#888">Добавьте товары из каталога</p>
                <a href="/catalog" class="filter-btn" style="display:inline-block;margin-top:20px">Перейти в каталог</a>
            </div>`;
            res.send(renderPage('Корзина', content, user, 'cart'));
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
                <img src="${imgPath}" style="width:70px;height:70px;object-fit:cover;border-radius:8px" onerror="this.src='/photo/plastinka-audio.png'">
                <div style="flex:1">
                    <div><strong>${escapeHtml(item.name)}</strong></div>
                    <div style="color:#aaa;font-size:12px">${escapeHtml(item.artist)}</div>
                    <div style="color:#ff7a2f">$${item.price}</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                    <button onclick="updateQty('${item.product_id}', 'decrease')" style="width:30px;height:30px;border-radius:8px;background:#333;border:none;color:#fff;cursor:pointer">-</button>
                    <span>${item.quantity}</span>
                    <button onclick="updateQty('${item.product_id}', 'increase')" style="width:30px;height:30px;border-radius:8px;background:#333;border:none;color:#fff;cursor:pointer">+</button>
                </div>
                <button onclick="removeItem('${item.product_id}')" style="background:#ff444420;border:none;color:#ff4444;padding:8px 12px;border-radius:8px;cursor:pointer"><i class="fas fa-trash"></i></button>
            </div>`;
        }
        
        const content = `
        <style>
        .cart-container { max-width: 800px; margin: 0 auto; }
        .cart-title { font-size: 28px; margin-bottom: 20px; }
        .cart-total { background: #1a1a1a; padding: 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin: 20px 0; }
        .total-price { font-size: 28px; color: #ff7a2f; }
        .checkout-btn { width: 100%; padding: 15px; background: linear-gradient(45deg, #ff0000, #990000); border: none; border-radius: 12px; color: white; font-size: 18px; cursor: pointer; transition: opacity 0.2s; }
        .checkout-btn:hover { opacity: 0.9; }
        </style>
        
        <div class="cart-container">
            <h1 class="cart-title"><i class="fas fa-shopping-cart"></i> Корзина</h1>
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
                // Очистка корзины через API
                const items = document.querySelectorAll('.cart-items > div');
                for (const item of items) {
                    const removeBtn = item.querySelector('button:last-child');
                    if (removeBtn) removeBtn.click();
                }
                setTimeout(() => { window.location.href = '/'; }, 1000);
            }
        }
        </script>
        `;
        
        res.send(renderPage('Корзина', content, user, 'cart'));
    } catch (err) {
        console.error("Ошибка корзины:", err);
        res.status(500).send("Ошибка загрузки корзины");
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
        console.log(`📀 Каталог: http://localhost:${PORT}/catalog`);
        console.log(`🎚️ Проигрыватели: http://localhost:${PORT}/players-catalog`);
        console.log(`👤 Профиль: http://localhost:${PORT}/profile`);
        console.log(`🛒 Корзина: http://localhost:${PORT}/cart`);
    });
}

module.exports = app;