---
name: bench-kleros-arbitrator
description: Use Internet Court as the arbitrator of any Kleros v2 arbitrable contract (IArbitratorV2), so a dispute over a question with cited sources is ruled by GenLayer validators in minutes and the ruling is delivered on chain with no relayer. Use when a contract written for Kleros needs fast, evidence-based arbitration.
---

# Bench: Internet Court as a Kleros v2 arbitrator

Internet Court lists Kleros as a third-party arbitration option. Bench goes the other way: it lets every contract
written for Kleros's `IArbitratorV2` choose Internet Court as its arbitrator, with no change to that contract.

## Deployed on GenLayer Bradbury Phase 2 (chain 4221)

| Contract | Address | Source |
|---|---|---|
| Court (Intelligent Contract) | `0xe4bCCa0B0AF695adFE5F1E8e8157Bcf0e51fA648` | `contracts/bench.py` |
| Bench (IArbitratorV2) | `0xd1bc9151777800454A3235a7FF0739306249e487` | `evm/Bench.sol` |
| DisputeResolver (Kleros v2, example arbitrable) | `0x164c46be9CE1e97ab0E3941b583D8E2C4A1082d2` | Kleros v2, unmodified |
| DisputeTemplateRegistry (Kleros v2, proxy) | `0x1b0fbC1AEeEBe5cF8Ac6BA83A6d19f0e776f102A` | same |

RPC for GenLayer writes: `https://rpc-bradbury.genlayer.com`. RPC for EVM calls: `https://rpc.testnet-chain.genlayer.com`.

## Workflow

1. **Agree on the case.** Write a Kleros dispute template: `{ "question", "answers": [{ "title", "description" }], "policyURI" }`,
   citing at least one https page that settles it. Its keccak256 is the arbitrator extra data:
   `extraData = abi.encode(keccak256(bytes(template)))`.
2. **Open the dispute** from the arbitrable, as with any Kleros arbitrator. With Kleros's DisputeResolver:
   `resolver.createDisputeForTemplate(extraData, template, "", numberOfAnswers)`.
3. **File the case:** `bench.fileCase(disputeID, bytes(template))`. Anybody may; only the committed text is accepted.
4. **Ask the court** on GenLayer, funding the message that delivers the ruling:
   ```js
   const gasLimit = 500000n, maxGasPrice = 1000000000n, budget = gasLimit * maxGasPrice;
   const feeParams = AbiCoder.defaultAbiCoder().encode(['uint256','uint256'], [gasLimit, maxGasPrice]);
   const messageAllocations = [{ messageType: 0, onAcceptance: false, recipient: BENCH, budget, feeParams }];
   const e = await client.estimateTransactionFees({ totalMessageFees: budget, messageAllocations });
   await client.writeContract({ address: COURT, functionName: 'arbitrate', args: [disputeID],
     fees: { distribution: e.distribution, feeValue: e.feeValue, messageAllocations } });
   ```
5. **Read the outcome:** `bench.currentRuling(id)`, the arbitrable's own record, or `court.case(id)` for the answer and the
   reasoning. If a ruling was recorded but not delivered, `bench.execute(id)` delivers it; `court.resend(id)` repeats a
   ruling that never reached the Bench.

## Decision payload

| Field | Where | Meaning |
|---|---|---|
| `ruling` | `court.case(id).ruling`, `bench.currentRuling(id)` | `1..n` an answer, `0` the court refuses to arbitrate |
| `answer` | `court.case(id).answer` | the chosen answer's title |
| `why` | same | the leading judge's words, not agreed by the round |
| `sources` | same | the https URLs read, at most two |
| `reason` | Bench's record | sha256 of `bench|<id>|<ruling>` |

## Limits

- Arbitrables must live on GenLayer Chain for the court to reach them directly.
- No appeal rounds, and Kleros's evidence module is not read: cite the evidence in the template.
