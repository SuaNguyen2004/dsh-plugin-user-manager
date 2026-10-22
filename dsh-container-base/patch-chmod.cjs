const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

function getAllowedMountRoots() {
  const allowed = new Set();
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  allowed.add(path.resolve(dshHome));
  allowed.add(path.resolve('/data/dsh_home'));
  allowed.add(path.resolve('/data/workspace'));
  return allowed;
}

function isAllowedMountRoot(targetPath) {
  if (typeof targetPath !== 'string') return false;
  try {
    const resolved = path.resolve(targetPath);
    for (const root of getAllowedMountRoots()) {
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

if (process.env.ENABLE_DOCKER_CHMOD_WORKAROUND === 'true' && !global.__DOCKER_CHMOD_PATCHED__) {
  global.__DOCKER_CHMOD_PATCHED__ = true;

  if (fsp && typeof fsp.chmod === 'function') {
    const origFspChmod = fsp.chmod;
    fsp.chmod = async function (targetPath, mode) {
      try {
        return await origFspChmod.call(this, targetPath, mode);
      } catch (err) {
        if ((err.code === 'EPERM' || err.code === 'EINVAL') && isAllowedMountRoot(targetPath)) {
          return;
        }
        throw err;
      }
    };
  }

  if (fs && typeof fs.chmodSync === 'function') {
    const origFsChmodSync = fs.chmodSync;
    fs.chmodSync = function (targetPath, mode) {
      try {
        return origFsChmodSync.call(this, targetPath, mode);
      } catch (err) {
        if ((err.code === 'EPERM' || err.code === 'EINVAL') && isAllowedMountRoot(targetPath)) {
          return;
        }
        throw err;
      }
    };
  }

  if (fs && typeof fs.chmod === 'function') {
    const origFsChmod = fs.chmod;
    fs.chmod = function (targetPath, mode, callback) {
      origFsChmod.call(this, targetPath, mode, (err, result) => {
        if (err && (err.code === 'EPERM' || err.code === 'EINVAL') && isAllowedMountRoot(targetPath)) {
          return callback(null, result);
        }
        return callback(err, result);
      });
    };
  }
}

