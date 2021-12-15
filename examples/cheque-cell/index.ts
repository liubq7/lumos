import {
  bootstrap
} from 'global-agent';

bootstrap();

import { Indexer, Script, helpers, config, RPC, commons, hd } from "@ckb-lumos/lumos";
import { claimCheque, createChequeCell, withdrawCheque } from "./lib";
import { normalizers, validators, Reader } from "ckb-js-toolkit";
import {
  core,
  WitnessArgs,
} from "@ckb-lumos/base";

const CKB_RPC_URL = "https://testnet.ckb.dev/rpc";
const CKB_INDEXER_URL = "https://testnet.ckb.dev/indexer";
const indexer = new Indexer(CKB_INDEXER_URL, CKB_RPC_URL);
const rpc = new RPC(CKB_RPC_URL);

const ALICE = {
  PRIVATE_KEY:
    "0xf571db32dace55dc75f6df7f2e1a0fb0ec730cfdde2ed6e5a4998673503d513b",
  ADDRESS: "ckt1qyqptxys5l9vk39ft0hswscxgseawc77y2wqlr558h",
  ARGS: "0x159890a7cacb44a95bef0743064433d763de229c",
  //LOCKHASH: "0x173924b290925c48a9cd55d00360fd6ad81e2081c8e0ada42dce1aafd2cfc1cf"
};
const senderScript = helpers.parseAddress(ALICE.ADDRESS, { config: config.predefined.AGGRON4 });

const BOB = {
  // PRIVATE_KEY:
  //   "0x2c56a92a03d767542222432e4f2a0584f01e516311f705041d86b1af7573751f",
  // ADDRESS: "ckt1qyqr6dwc07kqqz96tvfwu8zenvgzlj84lhuqsm0peh",
  // ARGS: "0x3d35d87fac0008ba5b12ee1c599b102fc8f5fdf8",

  PRIVATE_KEY:
    "0xbe06025fbd8c74f65a513a28e62ac56f3227fcb307307a0f2a0ef34d4a66e81f",
  ADDRESS: "ckt1qyqvq4wldr7aglr2t9jmn2epe45ztkrfdfmqca2hd7",
  ARGS: "0xc055df68fdd47c6a5965b9ab21cd6825d8696a76",
}
const receiverLock = helpers.parseAddress(BOB.ADDRESS, { config: config.predefined.AGGRON4 });

const sudtScript: Script = {
  code_hash: "0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4",
  args: "0x173924b290925c48a9cd55d00360fd6ad81e2081c8e0ada42dce1aafd2cfc1cf",
  hash_type: "type"
}

const createOptions = {
  cellProvider: indexer,
  senderLock: senderScript,
  receiverLock: receiverLock,
  SUDTScript: sudtScript,
  amount: "0x14000000000000000000000000000000",
}

const claimOptions = {
  cellProvider: indexer,
  SUDTScript: sudtScript,
  receiverLock: receiverLock,
  senderLock: senderScript
}

const WithdrawChequeOptions = {
  cellProvider: indexer,
  senderLock: senderScript,
  receiverLock: receiverLock,
  SUDTScript: sudtScript,
}

async function signAndSendTransaction(
  txSkeleton: helpers.TransactionSkeletonType,
  privatekey: string,
  rpc: RPC
): Promise<string> {
  txSkeleton = commons.common.prepareSigningEntries(txSkeleton);
  // const signingEntry = txSkeleton.get("signingEntries").get(1)!;
  // const message = signingEntry.message;
  // const Sig = hd.key.signRecoverable(message!, privatekey);

  // const tx = helpers.createTransactionFromSkeleton(txSkeleton);
  // const witness = tx.witnesses[signingEntry.index];
  // const witnessArgs = new core.WitnessArgs(new Reader(witness));
  // const newWitnessArgs: WitnessArgs = {
  //   lock: Sig,
  // };
  // const inputType = witnessArgs.getInputType();
  // if (inputType.hasValue()) {
  //   newWitnessArgs.input_type = new Reader(
  //     inputType.value().raw()
  //   ).serializeJson();
  // }
  // const outputType = witnessArgs.getOutputType();
  // if (outputType.hasValue()) {
  //   newWitnessArgs.output_type = new Reader(
  //     outputType.value().raw()
  //   ).serializeJson();
  // }
  // validators.ValidateWitnessArgs(newWitnessArgs);
  // tx.witnesses[signingEntry.index] = new Reader(
  //   core.SerializeWitnessArgs(
  //     normalizers.NormalizeWitnessArgs(newWitnessArgs)
  //   )
  // ).serializeJson();

  const message = txSkeleton.get("signingEntries").get(0)?.message;
  const Sig = hd.key.signRecoverable(message!, privatekey);
  const tx = helpers.sealTransaction(txSkeleton, [Sig]);

  console.log(JSON.stringify(tx));
  const hash = await rpc.send_transaction(tx, "passthrough");
  console.log("The transaction hash is", hash);
  return hash;
}

async function create() {
  // let txSkeleton = await createChequeCell(createOptions, config.predefined.AGGRON4);
  // await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);

  let txSkeleton = await claimCheque(claimOptions, config.predefined.AGGRON4);
  await signAndSendTransaction(txSkeleton, BOB.PRIVATE_KEY, rpc);

  // let txSkeleton = await withdrawCheque(WithdrawChequeOptions, config.predefined.AGGRON4);
  // await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
}
create();
