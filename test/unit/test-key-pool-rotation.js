import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { keyPool } from '../../lib/admin/key-pool.js';
import { setupModelCredentialsGuard, runWithAdminPrivileges, registerModelManagementRoutes, readProvidersFromPatch } from '../../lib/admin/model-guard.js';

// Isolate test file so production data/key_pools.json is never mutated
const TEST_POOLS_DIR = path.resolve(import.meta.dirname, '../../.tmp-test-suite');
if (!fs.existsSync(TEST_POOLS_DIR)) {
  fs.mkdirSync(TEST_POOLS_DIR, { recursive: true });
}
const TEST_POOLS_FILE = path.join(TEST_POOLS_DIR, 'test_key_pools.json');
process.env.DSH_KEY_POOLS_FILE = TEST_POOLS_FILE;
keyPool.customFilePath = TEST_POOLS_FILE;
keyPool.pools.clear();
keyPool.currentIndices.clear();
keyPool.initialized = false;

console.log('======================================================================');
console.log('   KIỂM THỬ TÍNH NĂNG KEY POOLING & TỰ ĐỘNG PHỤC HỒI LỖI 429         ');
console.log('======================================================================\n');

// 1. Test Key Pool Basic Management
console.log('--- TEST 1: KeyPoolManager - Thêm và Xoay vòng Nhiều Key ---');
const testRef = 'TEST_ROTATION_API_KEY';
const keysInput = `
sk-account1-alpha-key-11111111
sk-account2-beta-key-22222222
sk-account3-gamma-key-33333333
`;

// Add 3 keys
const pool = keyPool.setKeys(testRef, keysInput);
assert.strictEqual(pool.length, 3, 'Key pool phải chứa đúng 3 key sau khi parse input');

const summary1 = keyPool.getPoolSummary(testRef);
assert.strictEqual(summary1.total, 3, 'Tổng số key trong summary phải là 3');
assert.strictEqual(summary1.active, 3, 'Ban đầu tất cả 3 key đều phải active');
assert.strictEqual(summary1.cooldown, 0, 'Ban đầu không có key nào bị cooldown');
console.log('✅ TEST 1.1: Khởi tạo Key Pool với 3 tài khoản thành công!');

// 2. Test Round-Robin Selection
console.log('\n--- TEST 2: Round-Robin Active Key Selection ---');
const keyFirst = keyPool.getActiveKey(testRef);
assert.strictEqual(keyFirst, 'sk-account1-alpha-key-11111111');

const keySecond = keyPool.getActiveKey(testRef);
assert.strictEqual(keySecond, 'sk-account2-beta-key-22222222');

const keyThird = keyPool.getActiveKey(testRef);
assert.strictEqual(keyThird, 'sk-account3-gamma-key-33333333');

const keyWrapAround = keyPool.getActiveKey(testRef);
assert.strictEqual(keyWrapAround, 'sk-account1-alpha-key-11111111');
console.log('✅ TEST 2: Round-Robin luân phiên giữa các key hoạt động chính xác!');

// 3. Test 429 Rate Limit Mark and Instant Rotation
console.log('\n--- TEST 3: Giả lập chạm Rate Limit 429 & Tự động Xoay Key ---');
// Key 1 hits 429 with 60s cooldown
const rot1 = keyPool.markKey429(testRef, 'sk-account1-alpha-key-11111111', 60000);
assert.strictEqual(rot1.rotated, true, 'markKey429 phải trả về rotated = true khi còn key khác');
assert(rot1.nextKey !== 'sk-account1-alpha-key-11111111', 'Key tiếp theo phải khác Key 1 vừa bị phạt');
assert.strictEqual(rot1.availableCount, 2, 'Số key khả dụng còn lại phải là 2');

const summary2 = keyPool.getPoolSummary(testRef);
assert.strictEqual(summary2.active, 2, 'Số key active phải là 2');
assert.strictEqual(summary2.cooldown, 1, 'Số key cooldown phải là 1');
console.log('✅ TEST 3.1: Key 1 dính 429 được đưa vào cooldown, hệ thống tự chuyển sang Key 2!');

// Key 2 hits 429
const rot2 = keyPool.markKey429(testRef, 'sk-account2-beta-key-22222222', 60000);
assert.strictEqual(rot2.rotated, true, 'Xoay sang Key 3 thành công');
assert.strictEqual(rot2.nextKey, 'sk-account3-gamma-key-33333333', 'Key 3 phải là key duy nhất còn active');
assert.strictEqual(rot2.availableCount, 1, 'Số key khả dụng còn lại phải là 1');

const summary3 = keyPool.getPoolSummary(testRef);
assert.strictEqual(summary3.active, 1);
assert.strictEqual(summary3.cooldown, 2);
console.log('✅ TEST 3.2: Key 2 dính 429, hệ thống tự chuyển sang Key 3!');

// Key 3 hits 429 with failedKey = null (tests lastUsed resolution and all-exhausted returning null)
assert.strictEqual(keyPool.getLastUsedKey(testRef), 'sk-account3-gamma-key-33333333');
const rot3 = keyPool.markKey429(testRef, null, 60000);
assert.strictEqual(rot3.rotated, false, 'Không còn key nào khả dụng thì rotated phải là false');
assert.strictEqual(rot3.nextKey, null, 'nextKey phải là null khi toàn bộ pool bị cooldown');
assert.strictEqual(keyPool.getActiveKey(testRef), null, 'getActiveKey phải trả về null khi toàn bộ pool cạn kiệt');
console.log('✅ TEST 3.3: Tự động nhận diện key vừa dùng khi failedKey=null và trả về null khi cạn kiệt key!');

// 4. Test Auto-Recovery when Cooldown expires
console.log('\n--- TEST 4: Tự động phục hồi Key khi hết thời gian Cooldown ---');
// Set a key with expired cooldown (simulate 1 second ago)
const entry = keyPool.pools.get(testRef).find(k => k.key === 'sk-account1-alpha-key-11111111');
entry.cooldownUntil = Date.now() - 1000; // Expired 1 second ago!

const summary4 = keyPool.getPoolSummary(testRef);
assert.strictEqual(summary4.active, 1, 'Key 1 phải tự động hồi phục về active sau khi hết hạn cooldown');
assert.strictEqual(summary4.cooldown, 2, '2 key còn lại vẫn đang trong thời gian cooldown');
assert.strictEqual(keyPool.getActiveKey(testRef), 'sk-account1-alpha-key-11111111', 'Key 1 đã hồi phục và sẵn sàng phục vụ');
console.log('✅ TEST 4: Tự động hồi phục trạng thái Active khi hết thời gian phạt Cooldown!');

// 5. Test Manual Reset Cooldown
console.log('\n--- TEST 5: Quản trị viên chủ động Reset Cooldown ---');
keyPool.resetCooldown(testRef);
const summary5 = keyPool.getPoolSummary(testRef);
assert.strictEqual(summary5.active, 3, 'Tất cả 3 key phải trở về active sau khi reset');
assert.strictEqual(summary5.cooldown, 0, 'Không còn key nào bị cooldown');
console.log('✅ TEST 5: Reset cooldown thành công!');

// 6. Test DSH Context credentials.resolve & agent/request-error Waterfall Integration
console.log('\n--- TEST 6: Tích hợp sâu vào Cordis credentials.resolve & agent/request-error ---');
let capturedEvent = null;
let eventHandler = null;

const mockCredentials = {
  get: () => ({ value: 'default-fallback-key' }),
  resolve: async (ref) => ({ value: 'original-resolve-key', source: 'store' }),
  set: async (ref, val) => {},
  unset: async (ref) => {}
};

const mockCtx = {
  get: (service) => (service === 'credentials' ? mockCredentials : null),
  on: (event, handler) => {
    if (event === 'agent/request-error') {
      eventHandler = handler;
    }
  }
};

setupModelCredentialsGuard(mockCtx);

// Verify credentials.resolve returns pooled key
const resolvedHit = await mockCredentials.resolve(testRef);
assert(resolvedHit.value.startsWith('sk-account'), 'credentials.resolve phải trả về key từ Key Pool');
assert.strictEqual(resolvedHit.source, 'key-pool', 'source phải là key-pool');
console.log('✅ TEST 6.1: credentials.resolve() tự động cung cấp key từ pool!');

// Verify agent/request-error catches 429 and returns { kind: 'retry' }
assert(typeof eventHandler === 'function', 'Listener agent/request-error phải được đăng ký');

// Mock failure payload with 429 Rate Limit
// We use a mock patch provider mapping
keyPool.setKeys('GEMINI_API_KEY', 'sk-gem-1111\nsk-gem-2222');

const mockPayload = {
  provider: 'google',
  failure: {
    code: 'RATE_LIMIT',
    message: 'Resource has been exhausted (e.g. check quota) - 429',
    providerRetryAfterMs: 60000
  }
};

let downstreamCalled = false;
const retryDecision = await eventHandler(mockPayload, () => {
  downstreamCalled = true;
  return Promise.resolve(undefined);
});

assert.strictEqual(retryDecision?.kind, 'retry', 'agent/request-error phải trả về { kind: "retry" } để DSH tự động thử lại ngay!');
assert.strictEqual(downstreamCalled, false, 'Khi xoay key thành công, không để lỗi trôi xuống downstream!');
console.log('✅ TEST 6.2: agent/request-error bắt trúng lỗi 429 và trả về { kind: "retry" } cho DSH agent loop!');

// Clean up test key
keyPool.setKeys(testRef, []);
keyPool.setKeys('GEMINI_API_KEY', []);

console.log('\n--- TEST 7: Kiểm tra Xóa 1 Key đơn lẻ khỏi Pool (removeKeyByIndex) ---');
const refDel = 'TEST_DEL_KEY';
keyPool.setKeys(refDel, 'key-alpha\nkey-beta\nkey-gamma');
let summaryDel = keyPool.getPoolSummary(refDel);
assert.strictEqual(summaryDel.total, 3, 'Khởi tạo phải có 3 keys');

// Xóa key thứ 2 (index 1: key-beta)
keyPool.removeKeyByIndex(refDel, 1);
summaryDel = keyPool.getPoolSummary(refDel);
assert.strictEqual(summaryDel.total, 2, 'Sau khi xóa index 1, pool còn 2 keys');
assert.strictEqual(keyPool.getActiveKey(refDel), 'key-alpha', 'Key alpha vẫn hoạt động');
assert.strictEqual(keyPool.getActiveKey(refDel), 'key-gamma', 'Key gamma vẫn hoạt động');

// Xóa nốt 2 key còn lại
keyPool.removeKeyByIndex(refDel, 0);
keyPool.removeKeyByIndex(refDel, 0);
summaryDel = keyPool.getPoolSummary(refDel);
assert.strictEqual(summaryDel.total, 0, 'Sau khi xóa hết, pool về 0');
console.log('✅ TEST 7: Xóa từng API Key đơn lẻ khỏi Pool hoạt động chuẩn xác!');

console.log('\n--- TEST 8: Kiểm tra Thêm nối tiếp API Key (addKeys) và chống trùng lặp ---');
const refAppend = 'TEST_APPEND_KEY';
keyPool.setKeys(refAppend, ['key-one']);
assert.strictEqual(keyPool.getPoolSummary(refAppend).total, 1, 'Ban đầu có 1 key');

// Thêm key mới bằng addKeys
const resAdd = keyPool.addKeys(refAppend, 'key-two\nkey-three');
assert.strictEqual(resAdd.length, 3, 'Sau khi addKeys phải có tổng cộng 3 keys');
assert.strictEqual(resAdd.addedCount, 2, 'Số lượng key mới thêm vào là 2');
assert.strictEqual(keyPool.getPoolSummary(refAppend).total, 3, 'Summary phản ánh đúng 3 keys');

// Thêm key trùng lặp
const resDup = keyPool.addKeys(refAppend, 'key-two\nkey-four');
assert.strictEqual(resDup.length, 4, 'Sau khi thêm chỉ tăng thêm 1 key (key-four), key-two bị bỏ qua vì đã có');
assert.strictEqual(resDup.addedCount, 1, 'Số lượng key mới thực sự thêm vào là 1');

// Dọn dẹp
keyPool.setKeys(refAppend, []);
console.log('✅ TEST 8: Thêm nối tiếp API Key (addKeys) và chống trùng lặp hoạt động chuẩn xác!');

console.log('\n======================================================================');
console.log('🎉 TẤT CẢ CÁC BÀI TEST KEY POOLING & AUTO-RECOVERY 429 ĐỀU PASS 100%! ');
console.log('======================================================================\n');

