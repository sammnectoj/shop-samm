const express = require('express');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== 1. KHỞI TẠO DATABASE ĐƠN GIẢN (JSON) ======
const DB_FILE = path.join(__dirname, 'data.json');
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], history: [], orders: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ====== 2. CẤU HÌNH UPLOAD FILE (LƯU VÀO THƯ MỤC UPLOADS) ======
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
// Giới hạn file 20MB
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ====== 3. MIDDLEWARE ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Chứa các file HTML/CSS
app.use('/uploads', express.static('uploads')); // Để truy cập ảnh đã tải lên

app.use(session({
  secret: 'samm-x-modz-vip-sieu-bao-mat',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 ngày
}));

// Hàm kiểm tra đăng nhập
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Bạn chưa đăng nhập!' });
  next();
}

// ====== 4. API AUTH (ĐĂNG KÝ / ĐĂNG NHẬP / ĐĂNG XUẤT) ======
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Thiếu thông tin' });
  if (username.length < 3) return res.json({ error: 'Tên phải từ 3 ký tự trở lên' });
  if (password.length < 4) return res.json({ error: 'Mật khẩu phải từ 4 ký tự trở lên' });

  const db = loadDB();
  const isExist = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (isExist) {
    return res.json({ error: 'Tên đăng nhập này đã có người sử dụng!' });
  }
  
  db.users.push({ username, password, createdAt: Date.now() });
  saveDB(db);
  res.json({ ok: true, message: 'Đăng ký tài khoản thành công!' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  
  req.session.user = username;
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.json({ error: 'Mật khẩu mới phải từ 4 ký tự' });
  
  const db = loadDB();
  const user = db.users.find(u => u.username === req.session.user);
  
  if (!user || user.password !== oldPassword) {
    return res.json({ error: 'Mật khẩu cũ không chính xác' });
  }
  
  user.password = newPassword;
  saveDB(db);
  res.json({ ok: true, message: 'Đổi mật khẩu thành công!' });
});

// ====== 5. API UPLOAD FILE ======
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ error: 'Không tìm thấy file tải lên' });
  
  const db = loadDB();
  const record = {
    id: Date.now().toString(),
    owner: req.session.user,
    originalName: req.file.originalname,
    filename: req.file.filename,
    url: '/uploads/' + req.file.filename,
    size: req.file.size,
    mime: req.file.mimetype,
    uploadedAt: Date.now()
  };
  
  db.history.push(record);
  saveDB(db);
  res.json({ ok: true, file: record });
});

app.get('/api/history', requireAuth, (req, res) => {
  const db = loadDB();
  // Chỉ lấy lịch sử của người đang đăng nhập, xếp mới nhất lên đầu
  const list = db.history
    .filter(h => h.owner === req.session.user)
    .sort((a,b) => b.uploadedAt - a.uploadedAt);
  res.json({ history: list });
});

// ====== 6. API ĐƠN HÀNG ======
app.get('/api/orders', requireAuth, (req, res) => {
  const db = loadDB();
  const list = db.orders.filter(o => o.owner === req.session.user);
  res.json({ orders: list });
});

app.post('/api/orders', requireAuth, (req, res) => {
  const { item, price } = req.body;
  const db = loadDB();
  const order = {
    id: 'ORD' + Date.now(),
    owner: req.session.user,
    item: item || 'Sản phẩm không tên',
    price: price || 0,
    status: 'Đang xử lý',
    createdAt: Date.now()
  };
  
  db.orders.push(order);
  saveDB(db);
  res.json({ ok: true, order });
});

// ====== 7. CHẶN TRUY CẬP TRÁI PHÉP VÀO CÁC TRANG HTML ======
const PROTECTED_PAGES = ['/orders.html', '/history.html', '/account.html'];
app.use((req, res, next) => {
  // Nếu vào các trang bảo vệ mà chưa đăng nhập -> đá về trang login
  if (PROTECTED_PAGES.includes(req.path) && !req.session.user) {
    return res.redirect('/login.html');
  }
  next();
});

// ====== 8. KHỞI CHẠY SERVER ======
app.listen(PORT, () => {
  console.log(`🚀 Server SHOP SAMM X MODZ VIP đang chạy tại: http://localhost:${PORT}`);
});
