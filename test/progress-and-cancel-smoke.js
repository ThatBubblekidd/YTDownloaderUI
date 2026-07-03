const assert = require('assert');
const { spawn } = require('child_process');

function parseProgress(line) {
  const progress = line.match(/\[download\]\s+([\d.]+)%/);
  const speed = line.match(/at\s+([^\s]+\/s)/);
  const eta = line.match(/ETA\s+([^\s]+)/);
  const totalSize = line.match(/\bof\s+~?\s*([0-9.]+\s*(?:KiB|MiB|GiB|TiB|KB|MB|GB|TB|B))/i);
  return {
    percent: progress ? Number(progress[1]) : null,
    speed: speed?.[1] || '',
    eta: eta?.[1] || '',
    totalSize: totalSize?.[1]?.replace(/\s+/g, ' ') || '',
  };
}

async function verifyProgressParsing() {
  const parsed = parseProgress('[download]  42.7% of ~ 18.42MiB at 2.11MiB/s ETA 00:14');
  assert.strictEqual(parsed.percent, 42.7);
  assert.strictEqual(parsed.totalSize, '18.42MiB');
  assert.strictEqual(parsed.speed, '2.11MiB/s');
  assert.strictEqual(parsed.eta, '00:14');
}

async function verifyProcessGroupCancel() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  assert.ok(child.pid > 0);
  process.kill(-child.pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    process.kill(child.pid, 0);
    throw new Error('child still alive after process group SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

(async () => {
  await verifyProgressParsing();
  await verifyProcessGroupCancel();
  console.log('progress-and-cancel smoke ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
