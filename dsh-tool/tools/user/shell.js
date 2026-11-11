// dsh-tool/tools/user/shell.js
// User-role shell tool — executes commands strictly inside /data/workspace/<username>/<workspace>
// and auto-categorizes any newly created files into files/<category>/<filename>

import { spawn } from 'node:child_process';
import {
  ensureWorkspaceStructure,
  autoOrganizeWorkspaceStrayFiles,
  sanitizeSegment,
  normalizeWorkspaceName
} from '../common/auto-categorize.js';
import { guardUserPath } from '../common/path-guard.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/data';
const MAX_OUTPUT_BYTES = 128 * 1024;

export async function runBash(args, ctx) {
  const command = String(args.command || '').trim();
  if (!command) throw new Error('Thiếu câu lệnh bash (command).');

  // Block explicit attempts to read /data/all_users_ro or parent traversal outside user workspace
  if (command.includes('/data/all_users_ro')) {
    throw new Error('Truy cập bị từ chối: User không có quyền truy cập /data/all_users_ro.');
  }

  // Path Guard check: block any bash command attempting to write/modify/remove inside /data/kb_ro
  if (command.includes('/data/kb_ro')) {
    const kbWritePattern = /(?:>|>>|\btee\b|\brm\b|\bmv\b|\bcp\b|\btouch\b|\bmkdir\b|\bchmod\b|\bchown\b|\bdd\b|\btruncate\b|\bsed\s+-i)[^;|&]*\/data\/kb_ro|\/data\/kb_ro[^\s;|&]*\s*(?:>|>>)/i;
    if (kbWritePattern.test(command)) {
      guardUserPath('/data/kb_ro/hack.txt', 'write');
    }
  }

  const username = sanitizeSegment(ctx.username || process.env.DSH_USERNAME || 'user', 'user');
  const wsName = normalizeWorkspaceName(args.workspace || ctx.workspace || 'default-workspace', username);
  const wsDir = ensureWorkspaceStructure(WORKSPACE_ROOT, username, wsName);

  const requestedCwd = args.workdir || args.cwd || wsDir;
  const safeCwd = guardUserPath({
    workspaceRoot: WORKSPACE_ROOT,
    username,
    workspace: wsName,
    targetPath: requestedCwd,
    mode: 'write'
  });

  const timeoutMs = Math.min(120000, Math.max(1000, Number(args.timeoutMs || ctx.timeoutMs || 30000)));

  const result = await new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd: safeCwd,
      env: {
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: wsDir,
        USER: username,
        WORKSPACE_DIR: wsDir,
        TERM: 'dumb',
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout) < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
          stdoutTruncated = true;
        }
      } else {
        stdoutTruncated = true;
      }
    });

    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr) < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8');
        if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
          stderrTruncated = true;
        }
      } else {
        stderrTruncated = true;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? (timedOut ? 124 : 1),
        timedOut,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        timedOut: false,
        stdout,
        stderr: stderr + '\n' + err.message,
        stdoutTruncated,
        stderrTruncated
      });
    });
  });

  // Automatically sweep any newly created files into /data/workspace/<user>/<ws>/files/<category>/<file>
  const organized = autoOrganizeWorkspaceStrayFiles(WORKSPACE_ROOT, username, wsName);

  return {
    ok: result.exitCode === 0 && !result.timedOut,
    cwd: safeCwd,
    ...result,
    organizedFiles: organized
  };
}
