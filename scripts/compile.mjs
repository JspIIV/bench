// Compiles Kleros v2's arbitration contracts (vendor/kleros, unmodified, MIT) and Bench with Kleros's own settings:
// solc 0.8.30, viaIR, optimizer on, 700 runs, EVM cancun (contracts/solidity.config.json). GenLayer Chain runs PUSH0,
// TSTORE and MCOPY. The compiler is the official soljson build, checked against binaries.soliditylang.org (sha256 81475c98...).
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import url from 'url';

const require = createRequire(import.meta.url);
export const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const solc = require('solc/wrapper')(require(path.join(ROOT, 'tools', 'soljson-v0.8.30.cjs')));
const KL = path.join(ROOT, 'vendor', 'kleros', 'contracts', 'src');
const OZ = path.join(ROOT, 'node_modules', '@openzeppelin', 'contracts');
export const SETTINGS = { viaIR: true, optimizer: { enabled: true, runs: 700 }, evmVersion: 'cancun' };

export const SOURCES = {
  DisputeTemplateRegistry: 'kleros/arbitration/DisputeTemplateRegistry.sol',
  DisputeTemplateRegistryProxy: 'kleros/proxy/KlerosProxies.sol',
  DisputeResolver: 'kleros/arbitration/arbitrables/DisputeResolver.sol',
  Bench: 'evm/Bench.sol',
};

function resolve(p) {
  if (p.startsWith('kleros/')) return path.join(KL, p.slice(7));
  if (p.startsWith('@openzeppelin/contracts/')) return path.join(OZ, p.slice('@openzeppelin/contracts/'.length));
  return path.join(ROOT, p);
}
function findImport(p) {
  const f = resolve(p);
  return fs.existsSync(f) ? { contents: fs.readFileSync(f, 'utf8') } : { error: 'not found: ' + p };
}

const cache = {};
export function compile(name) {
  if (cache[name]) return cache[name];
  const file = SOURCES[name];
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { [file]: { content: findImport(file).contents } },
    settings: { ...SETTINGS, outputSelection: { [file]: { [name]: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } },
  }), { import: findImport }));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts[file][name];
  cache[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, deployed: c.evm.deployedBytecode.object.toLowerCase(),
    refs: c.evm.deployedBytecode.immutableReferences || {}, version: solc.version() };
  return cache[name];
}

if (process.argv[1] && process.argv[1].endsWith('compile.mjs')) {
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  for (const n of (process.argv[2] ? process.argv.slice(2) : Object.keys(SOURCES))) {
    const c = compile(n);
    fs.writeFileSync(path.join(ROOT, 'evm', 'abi', n + '.json'), JSON.stringify(c.abi, null, 2));
    console.log(n.padEnd(30), (c.bytecode.length - 2) / 2, 'bytes', c.version);
  }
}
