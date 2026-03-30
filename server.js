const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const path = require('path');
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 💡 [시스템 설정 임시 DB]
let appSettings = {
  autoApprove: false,   // 자동승인 여부
  enforceBreak: true,   // 2시간 운행 15분 휴식 강제 여부
  orgCode: "ROUTE2026"  // 현재 조직코드
};

// 💡 [임시 DB] 기사 목록 (warnings: 경고 횟수 추가)
let drivers = [
  { id: "d1", name: "김기사", orgCode: "ROUTE2026", status: "approved", lat: 37.3950, lng: 127.1110, driveTime: "4시간 30분", restTime: "30분", warnings: 0, routes: [{ id: "r1", name: "카카오 판교아지트", address: "경기 성남시 분당구 판교역로 166" }] },
  { id: "d2", name: "이배달", orgCode: "ROUTE2026", status: "approved", lat: 37.4020, lng: 127.1085, driveTime: "2시간 10분", restTime: "0분", warnings: 1, routes: [] },
  { id: "d3", name: "박신입", orgCode: "ROUTE2026", status: "pending", lat: 0, lng: 0, driveTime: "0시간", restTime: "0분", warnings: 0, routes: [] }
];

let admins = [];

// --- Auth API ---
app.post('/api/register', (req, res) => {
  const { email, phone, password, orgCode } = req.body;
  if (admins.find(a => a.email === email)) return res.status(400).json({ success: false, message: '이미 가입된 이메일입니다.' });
  admins.push({ email, phone, password, orgCode });
  // 첫 관리자 가입 시 조직코드 동기화
  appSettings.orgCode = orgCode;
  res.json({ success: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const admin = admins.find(a => a.email === email && a.password === password);
  if (admin) res.json({ success: true, orgCode: admin.orgCode });
  else res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 틀렸습니다.' });
});

// --- 화면 라우팅 ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- 관제 & 설정 API 라우터 ---
app.get('/api/settings', (req, res) => res.json(appSettings));

app.post('/api/settings', (req, res) => {
  appSettings = { ...appSettings, ...req.body };
  res.json({ success: true, settings: appSettings });
});

app.get('/api/drivers', (req, res) => res.json(drivers));

app.post('/api/drivers/:id/approve', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.id);
  if (driver) driver.status = "approved";
  res.json({ success: true });
});

// 💡 [새로운 기능] 기사 경고 부여
app.post('/api/drivers/:id/warn', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.id);
  if (driver) {
    driver.warnings = (driver.warnings || 0) + 1;
    // 추후 FCM이나 소켓으로 기사 앱에 푸시 알림을 쏘는 로직이 들어갈 자리입니다.
  }
  res.json({ success: true });
});

// 💡 [새로운 기능] 기사 강제 탈퇴
app.delete('/api/drivers/:id', (req, res) => {
  drivers = drivers.filter(d => d.id !== req.params.id);
  res.json({ success: true });
});

app.post('/api/drivers/:id/routes', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.id);
  if (driver) driver.routes.push({ id: "r" + Date.now(), name: req.body.name, address: req.body.address });
  res.json({ success: true, routes: driver ? driver.routes : [] });
});

app.delete('/api/drivers/:id/routes/:routeId', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.id);
  if (driver) driver.routes = driver.routes.filter(r => r.id !== req.params.routeId);
  res.json({ success: true, routes: driver ? driver.routes : [] });
});

// --- 실시간 GPS 소켓 통신 ---
io.on('connection', (socket) => {
  const moveInterval = setInterval(() => {
    drivers.forEach(d => {
      if (d.status === 'approved' && d.lat !== 0) {
        d.lat += (Math.random() - 0.5) * 0.001;
        d.lng += (Math.random() - 0.5) * 0.001;
      }
    });
    socket.emit('location_update', drivers);
  }, 3000);
  socket.on('disconnect', () => clearInterval(moveInterval));
});

app.post('/api/drivers/register', (req, res) => {
  const { email, password, phone, orgCode } = req.body;

  // 1. 조직코드 검증
  if (orgCode !== appSettings.orgCode) {
    return res.status(400).json({ success: false, message: '유효하지 않은 조직코드입니다.' });
  }

  // 2. 관리자의 설정에 따라 '승인(approved)' 또는 '대기(pending)' 상태 결정
  const newStatus = appSettings.autoApprove ? 'approved' : 'pending';

  // 3. 임시 DB에 새 기사 추가
  const newDriver = {
    id: "d" + Date.now(),
    name: "신규기사(" + phone.slice(-4) + ")", // 임시 이름 부여
    email: email,
    phone: phone,
    orgCode: orgCode,
    status: newStatus,
    lat: 0, lng: 0, driveTime: "0시간", restTime: "0분", warnings: 0, routes: []
  };
  
  drivers.push(newDriver);
  console.log(`✅ 새 기사 가입 요청: ${email} / 상태: ${newStatus}`);

  // 4. 앱으로 가입 결과와 상태 반환
  res.json({ success: true, status: newStatus });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ 관리자 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});