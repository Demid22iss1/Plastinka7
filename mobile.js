// mobile.js - Мобильная версия сайта для Telegram Mini App
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const path = require("path");
const bcrypt = require("bcryptjs");

const app = express();
const db = new sqlite3.Database("./database.sqlite");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "plastinka-mobile-secret-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 дней
    }
}));

// Middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect("/mobile/login");
    next();
};

// ============================================
// МОБИЛЬНЫЙ ШАБЛОН
// ============================================
function getMobileLayout(title, content, user = null, activeTab = 'home') {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>${title} · Plastinka</title>
    <link rel="stylesheet" href="/mobile.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
    <!-- Верхняя панель -->
    <div class="top-bar">
        <img src="/photo/logo.svg" class="logo" alt="Plastinka">
        <div class="search-bar" onclick="window.location='/mobile/search'">
            <i class="fas fa-search"></i>
            <span>Поиск пластинок...</span>
        </div>
        ${user ? `<img src="/avatars/default-avatar.png" class="avatar-small">` : ''}
    </div>

    <!-- Основной контент -->
    <div class="content">
        ${content}
    </div>

    <!-- Нижняя навигация -->
    <nav class="bottom-nav">
        <a href="/mobile" class="nav-item ${activeTab === 'home' ? 'active' : ''}">
            <i class="fas fa-home"></i>
            <span>Главная</span>
        </a>
        <a href="/mobile/favorites" class="nav-item ${activeTab === 'favorites' ? 'active' : ''}">
            <i class="fas fa-heart"></i>
            <span>Избранное</span>
        </a>
        <a href="/mobile/cart" class="nav-item ${activeTab === 'cart' ? 'active' : ''}">
            <div class="cart-badge" id="cart-badge" data-count="0">
                <i class="fas fa-shopping-cart"></i>
            </div>
            <span>Корзина</span>
        </a>
        <a href="/mobile/profile" class="nav-item ${activeTab === 'profile' ? 'active' : ''}">
            <i class="fas fa-user"></i>
            <span>Профиль</span>
        </a>
    </nav>

    <script>
        // Эмуляция Telegram Mini App
        if (window.Telegram && Telegram.WebApp) {
            Telegram.WebApp.ready();
            Telegram.WebApp.expand();
        }
        
        // Обновление счетчика корзины
        function updateCartBadge(count) {
            const badge = document.getElementById('cart-badge');
            if (badge) {
                badge.setAttribute('data-count', count);
            }
        }
    </script>
</body>
</html>
    `;
}

// ============================================
// МАРШРУТЫ
// ============================================

// Главная мобильная
app.get("/mobile", (req, res) => {
    const user = req.session.user;
    
    db.all("SELECT * FROM products ORDER BY RANDOM() LIMIT 10", [], (err, products) => {
        let content = `
            <h2 class="section-title">Новинки</h2>
            <div class="products-grid">
        `;
        
        products.forEach(product => {
            content += `
                <div class="product-card" onclick="window.location='/mobile/product/${product.id}'">
                    <div class="product-image">
                        <img src="/uploads/${product.image}" alt="${product.name}">
                        <div class="vinyl-overlay">
                            <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                        </div>
                    </div>
                    <div class="product-info">
                        <div class="product-name">${product.name}</div>
                        <div class="product-artist">${product.artist}</div>
                        <div class="product-price">$${product.price}</div>
                        <div class="product-actions">
                            <button class="action-btn" onclick="event.stopPropagation(); addToCart('product_${product.id}')">
                                <i class="fas fa-shopping-cart"></i>
                            </button>
                            <button class="action-btn" onclick="event.stopPropagation(); toggleFavorite('product_${product.id}')">
                                <i class="fas fa-heart"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });
        
        content += `</div>`;
        
        if (!user) {
            content += `
                <div class="auth-prompt">
                    <p>Войдите, чтобы добавлять товары в избранное и корзину</p>
                    <a href="/mobile/login" class="auth-btn">Войти</a>
                </div>
            `;
        }
        
        res.send(getMobileLayout('Главная', content, user, 'home'));
    });
});

// Детальная страница товара
app.get("/mobile/product/:id", requireAuth, (req, res) => {
    const id = req.params.id;
    const user = req.session.user;
    
    db.get("SELECT * FROM products WHERE id = ?", [id], (err, product) => {
        if (!product) return res.redirect("/mobile");
        
        const content = `
            <div class="product-detail">
                <img src="/uploads/${product.image}" class="detail-image">
                
                <div class="detail-info">
                    <h1 class="detail-title">${product.name}</h1>
                    <p class="detail-artist">${product.artist}</p>
                    
                    <div class="detail-tags">
                        <span class="tag">${product.genre || 'Rock'}</span>
                        <span class="tag">${product.year || '1970'}</span>
                    </div>
                    
                    <p class="detail-description">${product.description || 'Описание отсутствует'}</p>
                    
                    <div class="detail-price-block">
                        <span class="detail-price">$${product.price}</span>
                        ${product.audio ? `
                            <button onclick="playPreview('${product.audio}')" class="play-btn">
                                <i class="fas fa-play"></i>
                            </button>
                        ` : ''}
                    </div>
                    
                    <div class="detail-actions">
                        <button onclick="addToCart('product_${product.id}')" class="add-to-cart-btn">
                            <i class="fas fa-shopping-cart"></i> В корзину
                        </button>
                        <button onclick="toggleFavorite('product_${product.id}')" class="favorite-btn">
                            <i class="fas fa-heart"></i>
                        </button>
                    </div>
                </div>
            </div>
            
            <audio id="preview-audio" style="display: none;"></audio>
            
            <script>
                function playPreview(audioFile) {
                    const audio = document.getElementById('preview-audio');
                    audio.src = '/audio/' + audioFile;
                    audio.play();
                }
                
                function addToCart(id) {
                    fetch('/mobile/api/cart/add', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({id: id})
                    }).then(() => {
                        alert('✅ Товар добавлен в корзину!');
                    });
                }
                
                function toggleFavorite(id) {
                    fetch('/mobile/api/favorites/toggle', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({id: id})
                    }).then(() => {
                        alert('❤️ Добавлено в избранное!');
                    });
                }
            </script>
        `;
        
        res.send(getMobileLayout(product.name, content, user, 'home'));
    });
});

// Корзина
app.get("/mobile/cart", requireAuth, (req, res) => {
    const user = req.session.user;
    const userId = user.id;
    
    db.all("SELECT * FROM carts WHERE user_id = ?", [userId], (err, cartItems) => {
        if (cartItems.length === 0) {
            return res.send(getMobileLayout('Корзина', `
                <div class="empty-state">
                    <i class="fas fa-shopping-cart empty-icon"></i>
                    <h3>Корзина пуста</h3>
                    <p>Добавьте товары, чтобы оформить заказ</p>
                    <a href="/mobile" class="empty-btn">В каталог</a>
                </div>
            `, user, 'cart'));
        }
        
        let total = 0;
        let itemsHtml = '';
        let completed = 0;
        
        cartItems.forEach((item, index) => {
            const parts = item.product_id.split('_');
            const type = parts[0];
            const id = parts[1];
            
            if (type === 'product') {
                db.get("SELECT * FROM products WHERE id = ?", [id], (err, product) => {
                    if (product) {
                        total += product.price * item.quantity;
                        itemsHtml += `
                            <div class="cart-item">
                                <img src="/uploads/${product.image}" class="cart-item-image">
                                <div class="cart-item-info">
                                    <div class="cart-item-name">${product.name}</div>
                                    <div class="cart-item-price">$${product.price}</div>
                                    <div class="cart-item-quantity">
                                        <button class="quantity-btn" onclick="updateQuantity('${item.product_id}', 'decrease')">-</button>
                                        <span>${item.quantity}</span>
                                        <button class="quantity-btn" onclick="updateQuantity('${item.product_id}', 'increase')">+</button>
                                    </div>
                                </div>
                                <button class="remove-btn" onclick="removeFromCart('${item.product_id}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `;
                    }
                    completed++;
                    if (completed === cartItems.length) {
                        sendResponse();
                    }
                });
            }
        });
        
        function sendResponse() {
            const content = `
                ${itemsHtml}
                
                <div class="cart-total">
                    <span>Итого:</span>
                    <span class="total-price">$${total}</span>
                </div>
                
                <button class="checkout-btn" onclick="checkout()">
                    Оформить заказ
                </button>
                
                <script>
                    function updateQuantity(id, action) {
                        fetch('/mobile/api/cart/update', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({product_id: id, action: action})
                        }).then(() => location.reload());
                    }
                    
                    function removeFromCart(id) {
                        if(confirm('Удалить товар из корзины?')) {
                            fetch('/mobile/api/cart/remove', {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({product_id: id})
                            }).then(() => location.reload());
                        }
                    }
                    
                    function checkout() {
                        if(confirm('Подтвердите заказ')) {
                            fetch('/mobile/api/order', {method: 'POST'}).then(() => {
                                alert('✅ Заказ оформлен!');
                                window.location = '/mobile';
                            });
                        }
                    }
                </script>
            `;
            
            res.send(getMobileLayout('Корзина', content, user, 'cart'));
        }
    });
});

// Профиль
app.get("/mobile/profile", requireAuth, (req, res) => {
    const user = req.session.user;
    
    db.get("SELECT COUNT(*) as favs FROM favorites WHERE user_id = ?", [user.id], (err, favs) => {
        db.get("SELECT COUNT(*) as carts FROM carts WHERE user_id = ?", [user.id], (err, carts) => {
            const content = `
                <div class="profile-header">
                    <img src="/avatars/default-avatar.png" class="profile-avatar">
                    <h2 class="profile-name">${user.username}</h2>
                    <p class="profile-role">${user.role === 'admin' ? 'Администратор' : 'Покупатель'}</p>
                </div>
                
                <div class="profile-stats">
                    <div class="stat">
                        <div class="stat-value">0</div>
                        <div class="stat-label">Заказов</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${favs.favs}</div>
                        <div class="stat-label">Избранное</div>
                    </div>
                </div>
                
                <div class="profile-menu">
                    <a href="#" class="menu-item">
                        <i class="fas fa-history"></i>
                        <span>История заказов</span>
                        <i class="fas fa-chevron-right arrow"></i>
                    </a>
                    <a href="/mobile/favorites" class="menu-item">
                        <i class="fas fa-heart"></i>
                        <span>Избранное</span>
                        <i class="fas fa-chevron-right arrow"></i>
                    </a>
                    <a href="#" class="menu-item">
                        <i class="fas fa-credit-card"></i>
                        <span>Способы оплаты</span>
                        <i class="fas fa-chevron-right arrow"></i>
                    </a>
                    <a href="#" class="menu-item">
                        <i class="fas fa-cog"></i>
                        <span>Настройки</span>
                        <i class="fas fa-chevron-right arrow"></i>
                    </a>
                </div>
                
                ${user.role === 'admin' ? `
                    <a href="/mobile/admin" class="admin-panel-btn">
                        <i class="fas fa-crown"></i> Админ панель
                    </a>
                ` : ''}
                
                <a href="/mobile/logout" class="logout-btn">Выйти</a>
            `;
            
            res.send(getMobileLayout('Профиль', content, user, 'profile'));
        });
    });
});

// Избранное
app.get("/mobile/favorites", requireAuth, (req, res) => {
    const user = req.session.user;
    const userId = user.id;
    
    db.all("SELECT * FROM favorites WHERE user_id = ? ORDER BY added_at DESC", [userId], (err, favorites) => {
        if (favorites.length === 0) {
            return res.send(getMobileLayout('Избранное', `
                <div class="empty-state">
                    <i class="fas fa-heart empty-icon"></i>
                    <h3>В избранном пока пусто</h3>
                    <p>Добавляйте понравившиеся пластинки</p>
                    <a href="/mobile" class="empty-btn">В каталог</a>
                </div>
            `, user, 'favorites'));
        }
        
        let content = `<div class="products-grid">`;
        let completed = 0;
        
        favorites.forEach((fav, index) => {
            const parts = fav.product_id.split('_');
            const type = parts[0];
            const id = parts[1];
            
            if (type === 'product') {
                db.get("SELECT * FROM products WHERE id = ?", [id], (err, product) => {
                    if (product) {
                        content += `
                            <div class="product-card favorite-item">
                                <div class="favorite-heart"><i class="fas fa-heart"></i></div>
                                <div class="product-image">
                                    <img src="/uploads/${product.image}">
                                </div>
                                <div class="product-info">
                                    <div class="product-name">${product.name}</div>
                                    <div class="product-artist">${product.artist}</div>
                                    <div class="product-price">$${product.price}</div>
                                    <button class="action-btn primary" onclick="addToCart('${fav.product_id}')">
                                        В корзину
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                    completed++;
                    if (completed === favorites.length) {
                        content += `</div>`;
                        res.send(getMobileLayout('Избранное', content, user, 'favorites'));
                    }
                });
            }
        });
    });
});

// Поиск
app.get("/mobile/search", (req, res) => {
    const query = req.query.q || '';
    const user = req.session.user;
    
    db.all("SELECT * FROM products WHERE name LIKE ? OR artist LIKE ? LIMIT 20", 
        [`%${query}%`, `%${query}%`], (err, products) => {
        
        let content = `
            <div class="search-header">
                <div class="search-box">
                    <i class="fas fa-search"></i>
                    <input type="text" id="search-input" placeholder="Поиск пластинок..." value="${query}" autofocus>
                </div>
            </div>
            
            <h2 class="section-title">Результаты (${products.length})</h2>
        `;
        
        if (products.length > 0) {
            content += `<div class="products-grid">`;
            products.forEach(product => {
                content += `
                    <div class="product-card" onclick="window.location='/mobile/product/${product.id}'">
                        <div class="product-image">
                            <img src="/uploads/${product.image}">
                        </div>
                        <div class="product-info">
                            <div class="product-name">${product.name}</div>
                            <div class="product-artist">${product.artist}</div>
                            <div class="product-price">$${product.price}</div>
                        </div>
                    </div>
                `;
            });
            content += `</div>`;
        } else {
            content += `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>Ничего не найдено</p>
                </div>
            `;
        }
        
        res.send(getMobileLayout('Поиск', content, user, 'home'));
    });
});

// ============================================
// API ДЛЯ МОБИЛЬНОЙ ВЕРСИИ
// ============================================

// Добавление в корзину
app.post("/mobile/api/cart/add", requireAuth, express.json(), (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    
    db.run(`INSERT INTO carts (user_id, product_id, quantity) 
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, product_id) 
            DO UPDATE SET quantity = quantity + 1`,
        [userId, id], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true });
        }
    });
});

// Обновление количества
app.post("/mobile/api/cart/update", requireAuth, express.json(), (req, res) => {
    const { product_id, action } = req.body;
    const userId = req.session.user.id;
    
    if (action === 'increase') {
        db.run("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?", 
            [userId, product_id]);
    } else if (action === 'decrease') {
        db.run("UPDATE carts SET quantity = quantity - 1 WHERE user_id = ? AND product_id = ? AND quantity > 1", 
            [userId, product_id]);
    }
    
    res.json({ success: true });
});

// Удаление из корзины
app.post("/mobile/api/cart/remove", requireAuth, express.json(), (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    
    db.run("DELETE FROM carts WHERE user_id = ? AND product_id = ?", [userId, product_id]);
    res.json({ success: true });
});

// Избранное toggle
app.post("/mobile/api/favorites/toggle", requireAuth, express.json(), (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    
    db.get("SELECT * FROM favorites WHERE user_id = ? AND product_id = ?", [userId, id], (err, fav) => {
        if (fav) {
            db.run("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", [userId, id]);
            res.json({ success: true, action: 'removed' });
        } else {
            db.run("INSERT INTO favorites (user_id, product_id) VALUES (?, ?)", [userId, id]);
            res.json({ success: true, action: 'added' });
        }
    });
});

// Оформление заказа
app.post("/mobile/api/order", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    db.run("DELETE FROM carts WHERE user_id = ?", [userId]);
    res.json({ success: true });
});

// ============================================
// АВТОРИЗАЦИЯ (мобильная)
// ============================================

app.get("/mobile/login", (req, res) => {
    if (req.session.user) return res.redirect("/mobile");
    
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Вход · Plastinka</title>
    <link rel="stylesheet" href="/mobile.css">
</head>
<body class="auth-body">
    <div class="auth-card">
        <img src="/photo/logo.svg" class="auth-logo">
        <h2>Добро пожаловать</h2>
        <p class="auth-subtitle">Войдите в свой аккаунт</p>
        
        ${req.query.error ? '<div class="auth-error">Неверный логин или пароль</div>' : ''}
        
        <form action="/mobile/login" method="POST">
            <div class="auth-input-group">
                <label>Имя пользователя</label>
                <input type="text" name="username" required>
            </div>
            <div class="auth-input-group">
                <label>Пароль</label>
                <input type="password" name="password" required>
            </div>
            <button type="submit" class="auth-submit-btn">Войти</button>
        </form>
        
        <p class="auth-link">
            Нет аккаунта? <a href="/mobile/register">Зарегистрироваться</a>
        </p>
    </div>
</body>
</html>
    `);
});

app.post("/mobile/login", (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role
            };
            res.redirect("/mobile");
        } else {
            res.redirect("/mobile/login?error=1");
        }
    });
});

app.get("/mobile/register", (req, res) => {
    if (req.session.user) return res.redirect("/mobile");
    
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Регистрация · Plastinka</title>
    <link rel="stylesheet" href="/mobile.css">
</head>
<body class="auth-body">
    <div class="auth-card">
        <img src="/photo/logo.svg" class="auth-logo">
        <h2>Создать аккаунт</h2>
        <p class="auth-subtitle">Присоединяйтесь к Plastinka</p>
        
        ${req.query.error === 'exists' ? '<div class="auth-error">Пользователь уже существует</div>' : ''}
        
        <form action="/mobile/register" method="POST">
            <div class="auth-input-group">
                <label>Имя пользователя</label>
                <input type="text" name="username" required>
            </div>
            <div class="auth-input-group">
                <label>Пароль</label>
                <input type="password" name="password" required>
            </div>
            <button type="submit" class="auth-submit-btn">Зарегистрироваться</button>
        </form>
        
        <p class="auth-link">
            Уже есть аккаунт? <a href="/mobile/login">Войти</a>
        </p>
    </div>
</body>
</html>
    `);
});

app.post("/mobile/register", (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user) {
            res.redirect("/mobile/register?error=exists");
        } else {
            const hash = bcrypt.hashSync(password, 10);
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                [username, hash, "user"], function(err) {
                    if (err) res.redirect("/mobile/register?error=exists");
                    else res.redirect("/mobile/login?registered=1");
                }
            );
        }
    });
});

app.get("/mobile/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/mobile");
});

// Админ панель (упрощенная)
app.get("/mobile/admin", requireAuth, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.redirect("/mobile");
    }
    
    const user = req.session.user;
    
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, products) => {
        let content = `
            <div class="admin-header">
                <h2>Админ панель</h2>
                <a href="/mobile/admin/add" class="admin-add-btn">+ Добавить</a>
            </div>
            
            <div class="admin-products">
        `;
        
        products.forEach(product => {
            content += `
                <div class="admin-product-item">
                    <img src="/uploads/${product.image}" class="admin-product-image">
                    <div class="admin-product-info">
                        <div class="admin-product-name">${product.name}</div>
                        <div class="admin-product-price">$${product.price}</div>
                    </div>
                    <div class="admin-product-actions">
                        <a href="/mobile/admin/edit/${product.id}" class="admin-edit-btn">✏️</a>
                        <form action="/mobile/admin/delete/${product.id}" method="POST" style="display:inline;">
                            <button type="submit" class="admin-delete-btn" onclick="return confirm('Удалить?')">🗑️</button>
                        </form>
                    </div>
                </div>
            `;
        });
        
        content += `</div>`;
        
        res.send(getMobileLayout('Админ', content, user, 'profile'));
    });
});

// Запуск мобильного сервера
app.listen(3001, () => {
    console.log("📱 Мобильная версия запущена на http://localhost:3001/mobile");
});

module.exports = app;