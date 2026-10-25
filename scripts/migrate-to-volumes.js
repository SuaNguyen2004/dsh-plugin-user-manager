// scripts/migrate-to-volumes.js
// Phase 6: One-shot, idempotent migration from Host `data/` + legacy volume layout
// into Docker Named Volumes (dsh-gateway-data, dsh-homes, dsh-vol-admin, dsh-vol-user<id>).
//
// Uses dockerode directly (one short-lived helper container mounting the target volumes)
// and argv base64 payloads so it never depends on cmd.exe, stdin pipes, or host bind-mounts.
//
// SAFETY GUARANTEE:
//   - Strictly READ-ONLY against Host `data/` (NEVER deletes or modifies host files).
//   - Normalizes workspace volumes into:
//       /data/<username>/<workspace>/files/<category>/<file>
//   - Outputs a before/after reconciliation report to stdout and docs/MIGRATION_REPORT.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docker } from '../gateway/orchestrator.js';
import { sanitizeSegment } from '../dsh-tool/tools/common/auto-categorize.js';

const ROOT = process.cwd();
const HOST_DATA = fs.existsSync(path.resolve(ROOT, 'data', 'users.db'))
  ? path.resolve(ROOT, 'data')
  : path.resolve(ROOT, 'draft', 'legacy', 'host-data-backup');
const REPORT_PATH = path.resolve(ROOT, 'docs', 'MIGRATION_REPORT.md');

function walkHostTree(dir, rel = '') {
  let files = 0, bytes = 0;
  const list = [];
  if (!fs.existsSync(dir)) return { files, bytes, list };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('[View]') || entry.name === 'session.lock') continue;
    const full = path.join(dir, entry.name);
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      const sub = walkHostTree(full, r);
      files += sub.files;
      bytes += sub.bytes;
      list.push(...sub.list);
    } else if (st.isFile()) {
      files += 1;
      bytes += st.size;
      list.push({ rel: r, full, bytes: st.size });
    }
  }
  return { files, bytes, list };
}

async function ensureVolume(Name, Labels = {}) {
  try {
    await docker.createVolume({ Name, Labels });
  } catch (e) {
    if (!/already exists|409/i.test(String(e?.message || e))) throw e;
  }
}

function demuxExecOutput(buf) {
  const parts = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const type = buf[off];
    const len = buf.readUInt32BE(off + 4);
    if (type !== 1 && type !== 2) {
      parts.push(buf.subarray(off).toString('utf8'));
      break;
    }
    if (type === 1) parts.push(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len;
  }
  if (off < buf.length) parts.push(buf.subarray(off).toString('utf8'));
  return parts.join('');
}

/** Execute a Node snippet inside a running container using argv base64 (zero stdin pipe). */
export async function execNodeInContainer(container, jsCode) {
  const b64 = Buffer.from(jsCode, 'utf8').toString('base64');
  const exec = await container.exec({
    Cmd: ['node', '-e', `eval(Buffer.from(process.argv[1],'base64').toString('utf8'))`, b64],
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const chunks = [];
  await new Promise((resolve) => {
    stream.on('data', (c) => chunks.push(c));
    stream.once('end', resolve);
    stream.once('close', resolve);
    stream.once('error', resolve);
  });
  return demuxExecOutput(Buffer.concat(chunks)).trim();
}

/** Upload a single host file into `destPath` inside the helper container.
 *  Chunk = 24KB raw -> ~32KB inner b64 -> ~44KB outer b64 argv (well under Linux MAX_ARG_STRLEN 128KB). */
async function uploadFileToContainer(container, hostFilePath, containerDestPath) {
  const buf = fs.readFileSync(hostFilePath);
  const CHUNK = 24 * 1024;
  if (buf.length === 0) {
    await execNodeInContainer(container, `
      const fs = require('fs'), path = require('path');
      const dst = ${JSON.stringify(containerDestPath)};
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, '');
    `);
    return;
  }
  for (let off = 0; off < buf.length; off += CHUNK) {
    const sliceB64 = buf.subarray(off, off + CHUNK).toString('base64');
    const isFirst = off === 0;
    await execNodeInContainer(container, `
      const fs = require('fs'), path = require('path');
      const dst = ${JSON.stringify(containerDestPath)};
      const data = Buffer.from(${JSON.stringify(sliceB64)}, 'base64');
      if (${isFirst}) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, data);
      } else {
        fs.appendFileSync(dst, data);
      }
    `);
  }
}

async function uploadHostTreeToContainer(container, hostSrcDir, containerDestDir) {
  const { list } = walkHostTree(hostSrcDir);
  for (const item of list) {
    await uploadFileToContainer(container, item.full, `${containerDestDir}/${item.rel}`);
  }
}

export async function runMigration() {
  console.log('=== PHASE 6: MIGRATING LEGACY DATA INTO DOCKER NAMED VOLUMES ===');
  console.log('(Host data/ is treated strictly READ-ONLY — originals are NEVER deleted here.)');

  // 1. Read users from Host data/users.db (read-only)
  process.env.SQLITE_PATH = path.join(HOST_DATA, 'users.db');
  const { sequelize } = await import('../database/index.js');
  const [users] = await sequelize.query('SELECT id, username, role, status FROM users ORDER BY id ASC');

  const beforeHostDb = fs.existsSync(path.join(HOST_DATA, 'users.db')) ? fs.statSync(path.join(HOST_DATA, 'users.db')).size : 0;
  const beforeHostHomes = walkHostTree(path.join(HOST_DATA, 'dsh_homes'));
  const beforeAdminHome = walkHostTree(path.join(HOST_DATA, 'admin_dsh_home'));
  const beforeHostWorkspaces = walkHostTree(path.join(HOST_DATA, 'workspaces'));

  // 2. Ensure volumes
  await ensureVolume('dsh-gateway-data', { 'dsh.managed': 'true', 'dsh.role': 'gateway' });
  await ensureVolume('dsh-homes', { 'dsh.managed': 'true', 'dsh.role': 'homes' });
  await ensureVolume('dsh-vol-admin', { 'dsh.managed': 'true', 'dsh.userId': '1', 'dsh.username': 'admin' });

  const binds = [
    'dsh-gateway-data:/mnt/gw:rw',
    'dsh-homes:/mnt/homes:rw',
    'dsh-vol-admin:/mnt/ws/1:rw'
  ];
  for (const u of users) {
    if (u.role === 'admin' || Number(u.id) === 1) continue;
    const vName = `dsh-vol-user${u.id}`;
    await ensureVolume(vName, { 'dsh.managed': 'true', 'dsh.userId': String(u.id), 'dsh.username': sanitizeSegment(u.username) });
    binds.push(`${vName}:/mnt/ws/${u.id}:rw`);
  }

  // Start one short-lived helper container with all target volumes mounted
  try { await docker.getContainer('test-dsh-migrator').remove({ force: true }); } catch {}
  const helper = await docker.createContainer({
    Image: 'dsh-tool:latest',
    name: 'test-dsh-migrator',
    User: 'root',
    Entrypoint: ['sh', '-c'],
    Cmd: ['sleep 600'],
    Labels: { 'dsh.managed': 'true', 'dsh.role': 'migrator' },
    HostConfig: { Binds: binds, NetworkMode: 'none' }
  });
  await helper.start();

  try {
    // 3. Checkpoint WAL into a temp file in os.tmpdir(), then upload users.db + JSON configs to /mnt/gw
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mig-gw-'));
    try {
      const stagedDb = path.join(staging, 'users.db').replace(/\\/g, '/');
      await sequelize.query(`VACUUM INTO '${stagedDb.replace(/'/g, "''")}'`);
      await uploadFileToContainer(helper, stagedDb, '/mnt/gw/users.db');
      for (const cfg of ['key_pools.json', 'models_scope.json', 'models_config.json']) {
        const src = path.join(HOST_DATA, cfg);
        if (fs.existsSync(src)) await uploadFileToContainer(helper, src, `/mnt/gw/${cfg}`);
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    console.log('[1/3] users.db (WAL checkpointed via VACUUM INTO) + gateway JSON configs -> dsh-gateway-data');

    // 4. Upload admin_dsh_home -> /mnt/homes/user-1-admin and data/dsh_homes/user-* -> /mnt/homes/user-*
    if (fs.existsSync(path.join(HOST_DATA, 'admin_dsh_home'))) {
      await uploadHostTreeToContainer(helper, path.join(HOST_DATA, 'admin_dsh_home'), '/mnt/homes/user-1-admin');
    }
    const hostHomesDir = path.join(HOST_DATA, 'dsh_homes');
    if (fs.existsSync(hostHomesDir)) {
      for (const entry of fs.readdirSync(hostHomesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!/^user-\d+-[a-zA-Z0-9_-]+$/.test(entry.name)) {
          console.log(`  [skip] non-conforming home directory: ${entry.name}`);
          continue;
        }
        await uploadHostTreeToContainer(helper, path.join(hostHomesDir, entry.name), `/mnt/homes/${entry.name}`);
      }
    }
    console.log('[2/3] admin_dsh_home + data/dsh_homes/user-* -> dsh-homes');

    // 5. Upload any host workspace files & normalize each user's workspace volume
    for (const u of users) {
      const cleanUser = sanitizeSegment(u.username, 'user');
      const hostUserWs = path.join(HOST_DATA, 'workspaces', `${u.id}_${u.username}`);
      if (fs.existsSync(hostUserWs) && u.role !== 'admin') {
        await uploadHostTreeToContainer(helper, hostUserWs, `/mnt/ws/${u.id}/${cleanUser}`);
      }
    }

    const normOut = await execNodeInContainer(helper, `
      const fs = require('fs'), path = require('path');
      const users = ${JSON.stringify(users.map((u) => ({
        id: u.id,
        username: sanitizeSegment(u.username, 'user'),
        role: u.role,
        volume: (u.role === 'admin' || Number(u.id) === 1) ? 'dsh-vol-admin' : 'dsh-vol-user' + u.id
      })))};
      const CATS = ['docs', 'pdf', 'sheets', 'images', 'others'];

      function catOf(name) {
        const ext = (path.extname(name) || '').toLowerCase().replace(/^\\./, '');
        if (['doc','docx','dot','dotx','odt','rtf','txt','md','json','yaml','yml','xml','log','py','js','ts','html','css'].includes(ext)) return 'docs';
        if (ext === 'pdf') return 'pdf';
        if (['xls','xlsx','xlsm','csv','tsv'].includes(ext)) return 'sheets';
        if (['png','jpg','jpeg','gif','bmp','webp','svg'].includes(ext)) return 'images';
        return 'others';
      }
      function ensureWs(root, user, ws) {
        const wsDir = path.join(root, user, ws);
        for (const c of CATS) fs.mkdirSync(path.join(wsDir, 'files', c), { recursive: true });
        return wsDir;
      }
      function collectFiles(dir, out = []) {
        if (!fs.existsSync(dir)) return out;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          const st = fs.lstatSync(full);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) collectFiles(full, out);
          else if (st.isFile() && e.name !== 'workspace.json' && e.name !== '.credentials.yaml') out.push(full);
        }
        return out;
      }
      function moveInto(f, wsDir) {
        const base = path.basename(f);
        const dest = path.join(wsDir, 'files', catOf(base), base);
        if (f === dest) return;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.copyFileSync(f, dest);
        fs.rmSync(f, { force: true });
      }
      function walkStats(d, rel = '') {
        let files = 0, bytes = 0; const list = [];
        if (!fs.existsSync(d)) return { files, bytes, list };
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
          const st = fs.lstatSync(full);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) { const s = walkStats(full, r); files += s.files; bytes += s.bytes; list.push(...s.list); }
          else if (st.isFile()) { files += 1; bytes += st.size; list.push({ path: r, bytes: st.size }); }
        }
        return { files, bytes, list };
      }

      const volumeSummaries = [];
      for (const u of users) {
        const root = '/mnt/ws/' + u.id;
        fs.mkdirSync(path.join(root, u.username), { recursive: true });
        ensureWs(root, u.username, 'default-workspace');

        // A) Move any legacy top-level workspace dirs into /data/<user>/<ws>/files/<cat>/<file>
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name === u.username) continue;
          const wsName = entry.name.toLowerCase() === 'workspace' ? 'default-workspace' : entry.name;
          const wsDir = ensureWs(root, u.username, wsName);
          const legacyDir = path.join(root, entry.name);
          for (const f of collectFiles(legacyDir)) moveInto(f, wsDir);
          fs.rmSync(legacyDir, { recursive: true, force: true });
        }

        // B) Normalize each workspace under /data/<user>/<ws>
        const userDir = path.join(root, u.username);
        for (const wsEntry of fs.readdirSync(userDir, { withFileTypes: true })) {
          if (!wsEntry.isDirectory()) continue;
          const wsDir = ensureWs(root, u.username, wsEntry.name);
          const nested = path.join(wsDir, 'workspace');
          if (fs.existsSync(nested) && fs.lstatSync(nested).isDirectory()) {
            for (const f of collectFiles(nested)) moveInto(f, wsDir);
            fs.rmSync(nested, { recursive: true, force: true });
          }
          for (const e of fs.readdirSync(wsDir, { withFileTypes: true })) {
            const full = path.join(wsDir, e.name);
            if (e.isFile()) {
              if (e.name === 'workspace.json') fs.rmSync(full, { force: true });
              else moveInto(full, wsDir);
            }
          }
        }
        const st = walkStats(root);
        volumeSummaries.push({ userId: u.id, username: u.username, role: u.role, volume: u.volume, ...st });
      }

      const afterGwVol = walkStats('/mnt/gw');
      const afterHomesVol = walkStats('/mnt/homes');
      const homesDirs = fs.existsSync('/mnt/homes') ? fs.readdirSync('/mnt/homes') : [];
      require('child_process').execSync('chown -R node:node /mnt/gw /mnt/homes /mnt/ws');
      process.stdout.write(JSON.stringify({ afterGwVol, afterHomesVol, homesDirs, volumeSummaries }));
    `);

    const parsed = JSON.parse(normOut.split('\n').pop());
    console.log('[3/3] workspace volumes normalized to /data/<user>/<ws>/files/<cat>/<file>');

    const { afterGwVol, afterHomesVol, homesDirs, volumeSummaries } = parsed;
    const report = [
      '# BÁO CÁO ĐỐI CHIẾU MIGRATE DỮ LIỆU (PHASE 6)',
      '',
      `> Thời gian chạy: \`${new Date().toISOString()}\``,
      '> **Trạng thái dữ liệu gốc trên Host (`data/`): GIỮ NGUYÊN 100% — chưa xóa.** Việc dọn dẹp host chỉ được thực hiện sau khi bạn xác nhận báo cáo này.',
      '',
      '## 1. Đối chiếu tổng quan (Host trước → Volume sau)',
      '',
      '| Hạng mục | Nguồn trên Host | Đích Volume | Số file | Dung lượng |',
      '| :--- | :--- | :--- | :--- | :--- |',
      `| SQLite + config gateway | \`data/users.db\` (+WAL, ${beforeHostDb} B) + 3 JSON | \`dsh-gateway-data\` | ${afterGwVol.files} | ${afterGwVol.bytes} B |`,
      `| DSH homes (chat + settings) | \`data/admin_dsh_home\` + \`data/dsh_homes/user-*\` (${beforeAdminHome.files + beforeHostHomes.files} file, ${beforeAdminHome.bytes + beforeHostHomes.bytes} B) | \`dsh-homes\` | ${afterHomesVol.files} | ${afterHomesVol.bytes} B |`,
      `| Workspaces người dùng | \`data/workspaces/*\` + \`dsh-vol-*\` cũ | \`dsh-vol-admin\`, \`dsh-vol-user1..5\` | ${volumeSummaries.reduce((a, b) => a + b.files, 0)} | ${volumeSummaries.reduce((a, b) => a + b.bytes, 0)} B |`,
      '',
      '## 2. Chi tiết từng volume workspace (chuẩn `/data/<user>/<ws>/files/<loại>/<file>`)',
      '',
      ...volumeSummaries.map((v) => [
        `### User \`${v.username}\` (id=${v.userId}, role=${v.role}) — volume \`${v.volume}\`: ${v.files} file / ${v.bytes} B`,
        '',
        ...(v.list.length ? v.list.map((f) => `- \`/data/${f.path}\` (${f.bytes} B)`) : ['_(chưa có file nào — đã tạo khung thư mục chuẩn)_']),
        ''
      ].join('\n')),
      '## 3. Nội dung volume `dsh-gateway-data`',
      '',
      ...afterGwVol.list.map((f) => `- \`/data/gateway/${f.path}\` (${f.bytes} B)`),
      ''
    ].join('\n');

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, report, 'utf8');

    return { afterGwVol, afterHomesVol, homesDirs, volumeSummaries, users, reportPath: REPORT_PATH };
  } finally {
    try { await helper.remove({ force: true }); } catch {}
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate-to-volumes.js')) {
  runMigration().then((r) => {
    console.log('\nReport written to:', r.reportPath);
    console.log('✅ Migration finished. Host data untouched — awaiting your confirmation.');
    process.exit(0);
  }).catch((e) => {
    console.error('[migrate-to-volumes] FAILED:', e.message || e);
    process.exit(1);
  });
}
