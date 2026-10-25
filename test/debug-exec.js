// debug-exec.js — minimal repro of the exec hang (not part of the test suite)
import Docker from 'dockerode';
const docker = new Docker(process.platform === 'win32' ? { socketPath: '//./pipe/docker_engine' } : { socketPath: '/var/run/docker.sock' });

const c = docker.getContainer('dsh-tool-alice');
const payload = JSON.stringify({ tool: 'list_dir', args: { workspace: 'alice-space', path: '.' }, username: 'alice', role: 'user' });
const b64 = Buffer.from(payload, 'utf8').toString('base64');

console.log('exec create...');
const exec = await c.exec({ Cmd: ['node', '/opt/dsh-tool/runner.js', '--b64', b64], AttachStdout: true, AttachStderr: true, AttachStdin: false, Tty: false });
console.log('exec id', exec.id, 'start...');
const t = Date.now();
const stream = await exec.start({ hijack: true, stdin: false });
console.log('started in', Date.now() - t, 'ms');

stream.on('data', (d) => console.log('DATA:', JSON.stringify(d.toString('utf8'))));
stream.on('end', () => console.log('END event'));
stream.on('close', () => console.log('CLOSE event'));
stream.on('error', (e) => console.log('ERROR event', e.message));

setTimeout(async () => {
  const i = await exec.inspect();
  console.log('inspect: Running=', i.Running, 'ExitCode=', i.ExitCode);
  process.exit(0);
}, 8000);
