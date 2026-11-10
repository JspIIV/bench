// Independent check that every EVM contract Bench relies on runs exactly the source in this repository: Kleros v2's
// DisputeTemplateRegistry and its proxy and the DisputeResolver (vendor/kleros, unmodified), and the Bench arbitrator.
// GenLayer Chain's explorer cannot verify source yet, so this compiles each with Kleros's settings (solc 0.8.30, viaIR,
// 700 runs, cancun), reads the code from the chain and compares byte for byte. Immutable values are set at deployment, so
// their slots are taken from the chain and printed.
//   node scripts/verify_evm.mjs
import { JsonRpcProvider } from 'ethers';
import { execSync } from 'child_process';
import fs from 'fs'; import path from 'path';
import { compile, ROOT } from './compile.mjs';

const chain = new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221);
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8'));
const TARGETS = [['template_registry_impl', 'DisputeTemplateRegistry'], ['template_registry', 'DisputeTemplateRegistryProxy'],
  ['dispute_resolver', 'DisputeResolver'], ['bench', 'Bench']];
let all = true;
const commit = execSync('git rev-parse HEAD', { cwd: path.join(ROOT, 'vendor', 'kleros') }).toString().trim();
console.log('Kleros v2 at', commit.slice(0, 12), '| solc 0.8.30, viaIR, 700 runs, cancun | chain 4221');
for (const [key, name] of TARGETS) {
  const c = compile(name);
  const live = (await chain.getCode(dep[key].address)).slice(2).toLowerCase();
  const filled = c.deployed.split('');
  const fixed = [];
  for (const spots of Object.values(c.refs)) for (const { start, length } of spots) {
    for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i];
    fixed.push('immutable 0x' + live.slice(start * 2, (start + length) * 2).slice(-40));
  }
  const same = filled.join('') === live;
  all = all && same;
  console.log(`${same ? 'MATCH    ' : 'DIFFERENT'} ${name.padEnd(30)} ${dep[key].address}  ${[...new Set(fixed)].slice(0, 2).join(', ')}`);
}
console.log(all ? 'every contract on chain is the source in this repository' : 'at least one contract differs');
process.exit(all ? 0 : 1);
