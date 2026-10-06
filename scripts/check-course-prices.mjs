import {spawnSync} from 'node:child_process';
const r=spawnSync(process.execPath,['--test','--test-name-pattern=D1 catalogue','payment-worker/test/d1.test.mjs'],{stdio:'inherit'});process.exitCode=r.status;
