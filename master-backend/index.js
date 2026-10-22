import { startMasterServer } from './server.js';
import { User, hashPassword } from '../database/index.js';

const PORT = parseInt(process.env.MASTER_PORT || '4000', 10);

async function main() {
  try {
    const server = await startMasterServer(PORT);

    // Ensure default active admin exists
    const admin = await User.findOne({ where: { username: 'admin' } });
    if (!admin) {
      await User.create({
        username: 'admin',
        password_hash: hashPassword('admin123'),
        role: 'admin',
        status: 'active',
        workspace_path: '/data/workspaces/admin'
      });
      console.log('[Master Backend] Seeded default active Admin: admin / admin123');
    }
  } catch (err) {
    console.error('[Master Backend] Fatal error on startup:', err);
    process.exit(1);
  }
}

main();

