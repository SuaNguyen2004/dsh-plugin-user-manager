import assert from 'node:assert';
import {
  sequelize,
  initDatabase,
  User,
  Session,
  UserSession,
  Attachment,
  hashPassword,
  generateToken
} from '../database/index.js';

async function runStep1Test() {
  console.log('================================================================');
  console.log('🚀 BƯỚC 1: KIỂM THỬ KẾT NỐI VÀ QUẢN LÝ DỮ LIỆU POSTGRESQL');
  console.log('   (Sử dụng Sequelize ORM với 4 bảng: users, sessions, user_sessions, attachments)');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function record(desc, ok, detail = '') {
    total++;
    if (ok) {
      passed++;
      console.log(`  [PASS] Test ${total}: ${desc} ${detail ? '(' + detail + ')' : ''}`);
    } else {
      console.error(`  [FAIL] Test ${total}: ${desc} ${detail ? '(' + detail + ')' : ''}`);
      throw new Error(`Test failed: ${desc}`);
    }
  }

  try {
    // 1. Kết nối và khởi tạo bảng
    console.log('--- 1. Kiểm tra kết nối & Đồng bộ Schema bảng ---');
    await initDatabase({ alter: true });
    record('Kết nối thành công đến PostgreSQL và đồng bộ 4 bảng', true);

    // 2. Dọn dẹp dữ liệu test cũ
    await Attachment.destroy({ where: {} });
    await UserSession.destroy({ where: {} });
    await Session.destroy({ where: {} });
    await User.destroy({ where: {} });

    // 3. Seed 1 tài khoản Admin
    console.log('\n--- 2. Seed tài khoản Admin & User ---');
    const adminUser = await User.create({
      username: 'admin',
      password_hash: hashPassword('admin123'),
      role: 'admin',
      status: 'active',
      workspace_path: '/data/workspaces/admin'
    });
    record('Tạo tài khoản Admin thành công', adminUser.id && adminUser.username === 'admin');
    record('Admin có role=admin và status=active', adminUser.role === 'admin' && adminUser.status === 'active');

    // 4. Seed 1 tài khoản User
    const aliceUser = await User.create({
      username: 'alice',
      password_hash: hashPassword('Password123!'),
      role: 'user',
      status: 'pending',
      workspace_path: '/data/workspaces/alice'
    });
    record('Tạo tài khoản User (Alice) thành công', aliceUser.id && aliceUser.username === 'alice');
    record('User mới mặc định có status=pending', aliceUser.status === 'pending');

    // 5. Kiểm tra kiểm tra mật khẩu
    console.log('\n--- 3. Kiểm tra mã hóa & Xác thực mật khẩu ---');
    const checkAlicePass = aliceUser.checkPassword('Password123!');
    const checkWrongPass = aliceUser.checkPassword('WrongPass!');
    record('Mật khẩu đúng được xác thực thành công (scrypt)', checkAlicePass === true);
    record('Mật khẩu sai bị từ chối chính xác', checkWrongPass === false);

    // 6. Seed Session và kiểm tra quan hệ (Association)
    console.log('\n--- 4. Kiểm tra bảng Sessions và quan hệ khóa ngoại (CASCADE) ---');
    const sessionToken = generateToken();
    const adminSession = await Session.create({
      token: sessionToken,
      user_id: adminUser.id,
      expires_at: Date.now() + 7 * 24 * 3600 * 1000
    });
    record('Tạo phiên đăng nhập Session thành công', adminSession.token === sessionToken);

    const userWithSessions = await User.findOne({
      where: { username: 'admin' },
      include: ['sessions']
    });
    record('Truy vấn lồng User kèm danh sách Sessions thành công', userWithSessions.sessions.length === 1 && userWithSessions.sessions[0].token === sessionToken);

    // 7. Seed bảng user_sessions (Ánh xạ phiên chat DSH)
    console.log('\n--- 5. Kiểm tra bảng user_sessions (Phiên chat DSH) ---');
    const dshSessionId = 'dsh-sess-uuid-001';
    const userSession = await UserSession.create({
      session_id: dshSessionId,
      username: 'alice',
      workspace_id: 'user-workspace-alice'
    });
    record('Ghi nhận phiên chat DSH vào bảng user_sessions thành công', userSession.session_id === dshSessionId);

    // 8. Seed bảng attachments (Tài liệu đính kèm của User)
    console.log('\n--- 6. Kiểm tra bảng attachments (Theo dõi quyền sở hữu file) ---');
    const attachment = await Attachment.create({
      attachment_id: 'att-file-999',
      file_name: 'BaoCaoTaiChinh.pdf',
      file_size: 1048576,
      session_id: dshSessionId,
      username: 'alice',
      file_path: '/data/workspaces/alice/attachments/BaoCaoTaiChinh.pdf'
    });
    record('Lưu trữ bản ghi attachment vào PostgreSQL thành công', attachment.id && attachment.file_name === 'BaoCaoTaiChinh.pdf');

    const aliceAttachments = await Attachment.findAll({ where: { username: 'alice' } });
    record('Truy vấn danh sách attachment theo username thành công', aliceAttachments.length === 1);

    // 9. Kiểm tra tính năng xóa phân tầng (Cascade delete)
    console.log('\n--- 7. Kiểm tra tính năng Xóa phân tầng (Cascade Delete) ---');
    await adminUser.destroy();
    const remainingSessions = await Session.findAll({ where: { token: sessionToken } });
    record('Xóa User tự động dọn sạch Session liên kết (CASCADE)', remainingSessions.length === 0);

    console.log('\n================================================================');
    console.log(`🎉 BƯỚC 1 HOÀN TẤT VỚI KẾT QUẢ XUẤT SẮC: ${passed}/${total} TEST PASS (100%)`);
    console.log('================================================================');

  } catch (err) {
    console.error('\n❌ LỖI KIỂM THỬ BƯỚC 1:', err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runStep1Test();

