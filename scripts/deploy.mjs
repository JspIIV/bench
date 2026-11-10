// Deploy Bench end to end on GenLayer Bradbury. On GenLayer Chain (chain 4221): Kleros v2's DisputeTemplateRegistry
// behind Kleros's own UUPS proxy, the Bench arbitrator, and Kleros v2's DisputeResolver with Bench as its arbitrator, all
// Kleros code unmodified. Then the court Intelligent Contract, then the one time wiring of the Bench to it.
//   PCHG=<pw> node scripts/deploy.mjs
import { Wallet, JsonRpcProvider, ContractFactory, Contract, Interface } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { client, fees, EXPLORER } from './net.mjs';
import { compile, ROOT } from './compile.mjs';

const PW = process.env.PCHG || '';
if (!PW) { console.error('set PCHG'); process.exit(1); }
const KS = path.join(os.homedir(), '.genlayer', 'keystores');
const w = await Wallet.fromEncryptedJson(fs.readFileSync(path.join(KS, 'pchg.json'), 'utf8'), PW);
const evm = w.connect(new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221));
const OUT = path.join(ROOT, 'deployment.json');
const dep = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { network: 'genlayer testnet bradbury phase 2', chain_id: 4221 };
const save = () => fs.writeFileSync(OUT, JSON.stringify(dep, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deploy(key, name, args = []) {
  if (dep[key]) return dep[key].address;
  const c = compile(name);
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'evm', 'abi', name + '.json'), JSON.stringify(c.abi, null, 2));
  const contract = await new ContractFactory(c.abi, c.bytecode, evm).deploy(...args);
  await contract.waitForDeployment();
  dep[key] = { address: await contract.getAddress(), tx: contract.deploymentTransaction().hash };
  dep.compiler = c.version;
  save();
  console.log('deployed', key.padEnd(26), dep[key].address);
  return dep[key].address;
}

console.log('deployer', w.address);
const impl = await deploy('template_registry_impl', 'DisputeTemplateRegistry');
const init = new Interface(compile('DisputeTemplateRegistry').abi).encodeFunctionData('initialize', [w.address]);
const registry = await deploy('template_registry', 'DisputeTemplateRegistryProxy', [impl, init]);
fs.writeFileSync(path.join(ROOT, 'evm', 'abi', 'DisputeTemplateRegistry.json'), JSON.stringify(compile('DisputeTemplateRegistry').abi, null, 2));
const bench = await deploy('bench', 'Bench');
await deploy('dispute_resolver', 'DisputeResolver', [bench, registry]);

if (!dep.court) {
  const c = client(w.privateKey);
  const code = fs.readFileSync(path.join(ROOT, 'contracts', 'bench.py'), 'utf8');
  const hash = await c.deployContract({ code, args: [bench], fees: await fees(c) });
  console.log('court tx', hash);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const tx = await c.getTransaction({ hash });
    if (['ACCEPTED', 'FINALIZED'].includes(tx.statusName)) {
      if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') { console.error('deploy failed', tx.txExecutionResultName); process.exit(1); }
      dep.court = { address: tx.txDataDecoded?.contractAddress || tx.recipient, tx: hash };
      dep.address = dep.court.address; dep.tx = hash; dep.deployed_at = new Date().toISOString();
      save();
      break;
    }
  }
}
if (!dep.wired) {
  await (await new Contract(bench, compile('Bench').abi, evm).setCourt(dep.court.address)).wait();
  dep.wired = true; save();
}
console.log('COURT', dep.court?.address, EXPLORER + '/address/' + dep.court?.address);
process.exit(0);
