import { Cell, config, core, helpers, Indexer, RPC, toolkit, utils } from "@ckb-lumos/lumos";
import { Keccak256Hasher } from "./keccak256-hasher";

export const CONFIG = config.createConfig({
  PREFIX: "ckt",
  SCRIPTS: {
    ...config.predefined.AGGRON4.SCRIPTS,
    PW_LOCK: {
      CODE_HASH: "0x58c5f491aba6d61678b7cf7edf4910b1f5e00ec0cde2f42e0abb4fd9aff25a63",
      HASH_TYPE: "type",
      TX_HASH: "0x57a62003daeab9d54aa29b944fc3b451213a5ebdf2e232216a3cfed0dde61b38",
      INDEX: "0x0",
      DEP_TYPE: "code",
    },
  },
});

config.initializeConfig(CONFIG);

const CKB_RPC_URL = "https://testnet.ckb.dev/rpc";
const CKB_INDEXER_URL = "https://testnet.ckb.dev/indexer";
const rpc = new RPC(CKB_RPC_URL);
const indexer = new Indexer(CKB_INDEXER_URL, CKB_RPC_URL);

// prettier-ignore
interface EthereumRpc {
    (payload: { method: 'personal_sign'; params: [string /*from*/, string /*message*/] }): Promise<string>;
  }

// prettier-ignore
export interface EthereumProvider {
    selectedAddress: string;
    isMetaMask?: boolean;
    enable: () => Promise<string[]>;
    addListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    removeEventListener: (event: 'accountsChanged', listener: (addresses: string[]) => void) => void;
    request: EthereumRpc;
  }
// @ts-ignore
export const ethereum = window.ethereum as EthereumProvider;

export function asyncSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Options {
  from: string;
  to: string;
  amount: string;
}

export async function transfer(options: Options): Promise<string> {
  let tx = helpers.TransactionSkeleton({});
  const fromScript = helpers.parseAddress(options.from);
  const toScript = helpers.parseAddress(options.to);

  // additional 0.001 ckb for tx fee
  // the tx fee could calculated by tx size
  // this is just a simple example
  const neededCapacity = BigInt(options.amount) + /*0.00*/ 100000n;
  let collectedSum = 0n;
  const collectedCells: Cell[] = [];
  const collector = indexer.collector({ lock: fromScript, type: "empty" });
  for await (const cell of collector.collect()) {
    collectedSum += BigInt(cell.cell_output.capacity);
    collectedCells.push(cell);
    if (collectedSum >= neededCapacity) break;
  }

  if (collectedSum < neededCapacity) {
    throw new Error(`Not enough CKB, expected: ${neededCapacity}, actual: ${collectedSum} `);
  }

  const transferOutput: Cell = {
    cell_output: {
      capacity: "0x" + BigInt(options.amount).toString(16),
      lock: toScript,
    },
    data: "0x",
  };

  const changeOutput: Cell = {
    cell_output: {
      capacity: "0x" + BigInt(collectedSum - neededCapacity).toString(16),
      lock: fromScript,
    },
    data: "0x",
  };

  tx = tx.update("inputs", (inputs) => inputs.push(...collectedCells));
  tx = tx.update("outputs", (outputs) => outputs.push(transferOutput, changeOutput));
  tx = tx.update("cellDeps", (cellDeps) =>
    cellDeps.push(
      // pw lock dep
      {
        out_point: {
          tx_hash: CONFIG.SCRIPTS.PW_LOCK.TX_HASH,
          index: CONFIG.SCRIPTS.PW_LOCK.INDEX,
        },
        dep_type: CONFIG.SCRIPTS.PW_LOCK.DEP_TYPE,
      },
    )
  );

  const messageForSigning = (() => {
    const hasher = new Keccak256Hasher();

    const rawTxHash = utils.ckbHash(
      core.SerializeRawTransaction(
        toolkit.normalizers.NormalizeRawTransaction(helpers.createTransactionFromSkeleton(tx))
      )
    );

    hasher.updateReader(rawTxHash);
    const witness = new toolkit.Reader("0x" + '0'.repeat(170));
    hasher.update(serializeBigInt(witness.length()));
    hasher.updateReader(witness);

    return hasher.digest().serializeJson();
  })();

  let signedMessage = await ethereum.request({
    method: "personal_sign",
    params: [ethereum.selectedAddress, messageForSigning],
  });

  let v = Number.parseInt(signedMessage.slice(-2), 16);
  if (v >= 27) v -= 27;
  signedMessage = "0x" + signedMessage.slice(2, -2) + v.toString(16).padStart(2, "0");

  // TODO: ?
  const witnessArgs = new core.WitnessArgs(new toolkit.Reader("0x" + '0'.repeat(170)));
  const signedWitness = new toolkit.Reader(
    core.SerializeWitnessArgs(
      toolkit.normalizers.NormalizeWitnessArgs({
        ...witnessArgs,
        lock: signedMessage,
      })
    )
  ).serializeJson();

  tx = tx.update("witnesses", (witnesses) => witnesses.push(signedWitness));

  const signedTx = helpers.createTransactionFromSkeleton(tx);
  const txHash = await rpc.send_transaction(signedTx, "passthrough");

  return txHash;
}

function serializeBigInt(i: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, i, true);
  return view.buffer;
}

export async function capacityOf(address: string): Promise<bigint> {
  const collector = indexer.collector({
    lock: helpers.parseAddress(address),
  });

  let balance = 0n;
  for await (const cell of collector.collect()) {
    balance += BigInt(cell.cell_output.capacity);
  }

  return balance;
}
