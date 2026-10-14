const fs = require('node:fs');
const fsp = require('node:fs/promises');

// Container mount root resilience: VirtioFS/9p on Windows Docker mounts returns EPERM on chmod metadata updates.
if (fsp && typeof fsp.chmod === 'function') {
  const origFspChmod = fsp.chmod;
  fsp.chmod = async function (targetPath, mode) {
    try {
      return await origFspChmod.call(this, targetPath, mode);
    } catch (err) {
      if ((err.code === 'EPERM' || err.code === 'EINVAL') && typeof targetPath === 'string') {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) return;
        } catch (_) {}
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
      if ((err.code === 'EPERM' || err.code === 'EINVAL') && typeof targetPath === 'string') {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) return;
        } catch (_) {}
      }
      throw err;
    }
  };
}

if (fs && typeof fs.chmod === 'function') {
  const origFsChmod = fs.chmod;
  fs.chmod = function (targetPath, mode, callback) {
    return origFsChmod.call(this, targetPath, mode, (err) => {
      if (err && (err.code === 'EPERM' || err.code === 'EINVAL') && typeof targetPath === 'string') {
        try {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) return callback ? callback(null) : undefined;
        } catch (_) {}
      }
      if (callback) return callback(err);
    });
  };
}

