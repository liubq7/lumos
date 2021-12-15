import {
  Script,
  HexNumber,
  config,
  CellProvider,
  helpers,
  Cell,
  utils,
  Transaction,
  core,
  WitnessArgs,
  since,
} from "@ckb-lumos/lumos";
import { Reader, normalizers } from "ckb-js-toolkit";
import { Set } from "immutable";
import { values } from "@ckb-lumos/base";
const { getConfig } = config;
const { nameOfScript } = config.helpers;
const { TransactionSkeleton } = helpers;
const { computeScriptHash } = utils;
const { ScriptValue } = values;

interface CreateChequeOptions {
  cellProvider: CellProvider;
  senderLock: Script;
  receiverLock: Script;
  SUDTScript: Script;
  amount: HexNumber;
}

async function injectAmount(
  txSkeleton: helpers.TransactionSkeletonType,
  senderLock: Script,
  SUDTScript: Script,
  SUDTAmount: HexNumber
): Promise<helpers.TransactionSkeletonType> {
  const cellProvider = txSkeleton.get("cellProvider")!;
  const cellCollector = cellProvider.collector({
    lock: senderLock,
    type: SUDTScript,
  });
  let amount = utils.readBigUInt128LE(SUDTAmount);
  const changeCell: Cell = {
    cell_output: {
      capacity: "0x34e62ce00",
      lock: senderLock,
      type: SUDTScript,
    },
    data: "0x",
  };
  let changeAmount: bigint = 0n;

  if (amount > 0n) {
    for await (const inputCell of cellCollector.collect()) {
      console.log(inputCell);
      txSkeleton = txSkeleton.update("inputs", (inputs) =>
        inputs.push(inputCell)
      );
      txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
        witnesses.push("0x")
      );
      const inputAmount = utils.readBigUInt128LE(inputCell.data);
      let deductAmount = inputAmount;
      if (deductAmount > amount) {
        deductAmount = amount;
      }
      amount -= deductAmount;
      changeAmount += inputAmount - deductAmount;
      if (amount === BigInt(0)) break;
    }
  }

  if (amount > 0n) {
    throw new Error("Not enough sUDT in from address!");
  }

  if (changeAmount > BigInt(0)) {
    changeCell.data = utils.toBigUInt128LE(changeAmount);
    txSkeleton = txSkeleton.update("outputs", (outputs) =>
      outputs.push(changeCell)
    );
  }

  return txSkeleton;
}

async function injectCapacity(
  txSkeleton: helpers.TransactionSkeletonType,
  senderLock: Script
): Promise<helpers.TransactionSkeletonType> {
  const inputCapacity = txSkeleton
    .get("inputs")
    .map((c) => BigInt(c.cell_output.capacity))
    .reduce((a, b) => a + b, BigInt(0));
  const outputCapacity = txSkeleton
    .get("outputs")
    .map((c) => BigInt(c.cell_output.capacity))
    .reduce((a, b) => a + b, BigInt(0));
  let needCapacity = outputCapacity - inputCapacity + BigInt(10) ** BigInt(8);

  let changeCapacity: bigint = BigInt(10) ** BigInt(8);
  const changeCell: Cell = {
    cell_output: {
      capacity: "0x0",
      lock: senderLock,
      type: undefined,
    },
    data: "0x",
  };
  const minimalChangeCapacity: bigint =
    helpers.minimalCellCapacity(changeCell) + BigInt(10) ** BigInt(8);

  if (needCapacity < 0n) {
    changeCapacity -= needCapacity;
    needCapacity = 0n;
  }

  // if (needCapacity > 0n || changeCapacity < minimalChangeCapacity) {
    const cellProvider = txSkeleton.get("cellProvider");
    if (!cellProvider) throw new Error("Cell provider is missing!");
    const cellCollector = cellProvider.collector({
      lock: senderLock,
      type: "empty",
      data: "0x",
    });

    let previousInputs = Set<string>();
    for (const input of txSkeleton.get("inputs")) {
      previousInputs = previousInputs.add(
        `${input.out_point!.tx_hash}_${input.out_point!.index}`
      );
    }

    for await (const inputCell of cellCollector.collect()) {
      if (
        previousInputs.has(
          `${inputCell.out_point!.tx_hash}_${inputCell.out_point!.index}`
        )
      )
        continue;
      console.log(inputCell);
      txSkeleton = txSkeleton.update("inputs", (inputs) =>
        inputs.push(inputCell)
      );
      txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
        witnesses.push("0x")
      );
      const inputCapacity = BigInt(inputCell.cell_output.capacity);
      let deductCapacity = inputCapacity;
      if (deductCapacity > needCapacity) {
        deductCapacity = needCapacity;
      }
      needCapacity -= deductCapacity;
      changeCapacity += inputCapacity - deductCapacity;
      if (
        needCapacity === BigInt(0) &&
        (changeCapacity === BigInt(0) ||
          changeCapacity >= minimalChangeCapacity)
      )
        break;
    }
  // }

  if (changeCapacity > BigInt(0)) {
    changeCell.cell_output.capacity = "0x" + changeCapacity.toString(16);
    txSkeleton = txSkeleton.update("outputs", (outputs) =>
      outputs.push(changeCell)
    );
  }

  if (needCapacity > 0n || changeCapacity < minimalChangeCapacity)
    throw new Error("Not enough capacity in from address!");

  const firstIndex = txSkeleton
    .get("inputs")
    .findIndex((input) =>
      new ScriptValue(input.cell_output.lock, { validate: false }).equals(
        new ScriptValue(senderLock, { validate: false })
      )
    );
  if (firstIndex !== -1) {
    while (firstIndex >= txSkeleton.get("witnesses").size) {
      txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
        witnesses.push("0x")
      );
    }
    let witness: string = txSkeleton.get("witnesses").get(firstIndex)!;
    const SECP_SIGNATURE_PLACEHOLDER =
      "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const newWitnessArgs: WitnessArgs = { lock: SECP_SIGNATURE_PLACEHOLDER };

    if (witness !== "0x") {
      const witnessArgs = new core.WitnessArgs(new Reader(witness));
      const lock = witnessArgs.getLock();
      if (
        lock.hasValue() &&
        new Reader(lock.value().raw()).serializeJson() !== newWitnessArgs.lock
      ) {
        throw new Error(
          "Lock field in first witness is set aside for signature!"
        );
      }
      const inputType = witnessArgs.getInputType();
      if (inputType.hasValue()) {
        newWitnessArgs.input_type = new Reader(
          inputType.value().raw()
        ).serializeJson();
      }
      const outputType = witnessArgs.getOutputType();
      if (outputType.hasValue()) {
        newWitnessArgs.output_type = new Reader(
          outputType.value().raw()
        ).serializeJson();
      }
    }
    witness = new Reader(
      core.SerializeWitnessArgs(
        normalizers.NormalizeWitnessArgs(newWitnessArgs)
      )
    ).serializeJson();
    txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
      witnesses.set(firstIndex, witness)
    );
  }

  const txFee = calculateTxFee(txSkeleton);
  changeCapacity = changeCapacity - txFee;

  txSkeleton = txSkeleton.update("outputs", (outputs) => {
    return outputs.pop();
  });
  if (changeCapacity > BigInt(0)) {
    changeCell.cell_output.capacity = "0x" + changeCapacity.toString(16);
    txSkeleton = txSkeleton.update("outputs", (outputs) =>
      outputs.push(changeCell)
    );
  }

  return txSkeleton;
}

function getTransactionSize(
  txSkeleton: helpers.TransactionSkeletonType
): number {
  const tx = helpers.createTransactionFromSkeleton(txSkeleton);
  return getTransactionSizeByTx(tx);
}

function getTransactionSizeByTx(tx: Transaction): number {
  const serializedTx = core.SerializeTransaction(
    normalizers.NormalizeTransaction(tx)
  );
  // 4 is serialized offset bytesize
  const size = serializedTx.byteLength + 4;
  return size;
}

function calculateFee(size: number, feeRate: bigint): bigint {
  const ratio = 1000n;
  const base = BigInt(size) * feeRate;
  const fee = base / ratio;
  if (fee * ratio < base) {
    return fee + 1n;
  }
  return fee;
}

function calculateTxFee(txSkeleton: helpers.TransactionSkeletonType): bigint {
  const feeRate = BigInt(1000);
  const txSize = getTransactionSize(txSkeleton);
  return calculateFee(txSize, feeRate);
}

function generateChequeLock(senderLock: Script, receiverLock: Script): Script {
  const senderLockHash = computeScriptHash(senderLock);
  const receiverLockHash = computeScriptHash(receiverLock);
  const chequeLock: Script = {
    code_hash:
      "0x60d5f39efce409c587cb9ea359cefdead650ca128f0bd9cb3855348f98c70d5b",
    hash_type: "type",
    args: "0x" + receiverLockHash.slice(2, 42) + senderLockHash.slice(2, 42),
  };
  return chequeLock;
}

function verifyLock(lock: Script, config: config.Config): void {
  if (nameOfScript(lock, config.SCRIPTS) !== "SECP256K1_BLAKE160")
    throw new Error("lockScript must be SECP256K1_BLAKE160");
}

function updateCellDeps(
  txSkeleton: helpers.TransactionSkeletonType,
  config: config.Config
): helpers.TransactionSkeletonType {
  txSkeleton = txSkeleton.update("cellDeps", (cellDeps) => {
    return cellDeps.clear();
  });

  const secp256k1Config = config.SCRIPTS.SECP256K1_BLAKE160;
  const sudtConfig = config.SCRIPTS.SUDT;
  const anyoneCanPayConfig = config.SCRIPTS.ANYONE_CAN_PAY;
  if (!secp256k1Config || !sudtConfig || !anyoneCanPayConfig) {
    throw new Error(
      "Provided config does not have SECP256K1_BLAKE160 or SUDT or ANYONE_CAN_PAY script setup!"
    );
  }

  txSkeleton = txSkeleton.update("cellDeps", (cellDeps) => {
    return cellDeps.push(
      {
        out_point: {
          tx_hash: secp256k1Config.TX_HASH,
          index: secp256k1Config.INDEX,
        },
        dep_type: secp256k1Config.DEP_TYPE,
      },
      {
        out_point: {
          tx_hash: sudtConfig.TX_HASH,
          index: sudtConfig.INDEX,
        },
        dep_type: sudtConfig.DEP_TYPE,
      },
      {
        out_point: {
          tx_hash: anyoneCanPayConfig.TX_HASH,
          index: anyoneCanPayConfig.INDEX,
        },
        dep_type: anyoneCanPayConfig.DEP_TYPE,
      },
      {
        dep_type: "dep_group",
        out_point: {
          index: "0x0",
          tx_hash: "0x7f96858be0a9d584b4a9ea190e0420835156a6010a5fde15ffcdc9d9c721ccab"
        }
      }
    );
  });

  return txSkeleton;
}

export async function createChequeCell(
  options: CreateChequeOptions,
  config: config.Config = getConfig()
): Promise<helpers.TransactionSkeletonType> {
  verifyLock(options.senderLock, config);
  verifyLock(options.receiverLock, config);
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });
  txSkeleton = updateCellDeps(txSkeleton, config);

  const chequeLock = generateChequeLock(
    options.senderLock,
    options.receiverLock
  );
  const output: Cell = {
    cell_output: {
      capacity: "0x3c5986200",
      lock: chequeLock,
      type: options.SUDTScript,
    },
    data: options.amount,
  };
  txSkeleton = txSkeleton.update("outputs", (outputs) => {
    return outputs.push(output);
  });

  txSkeleton = await injectAmount(
    txSkeleton,
    options.senderLock,
    options.SUDTScript,
    options.amount
  );
  txSkeleton = await injectCapacity(txSkeleton, options.senderLock);

  return txSkeleton;
}

interface ClaimChequeOptions {
  cellProvider: CellProvider;
  SUDTScript: Script;
  receiverLock: Script;
  senderLock: Script;
}

export async function claimCheque(
  options: ClaimChequeOptions,
  config: config.Config = getConfig()
): Promise<helpers.TransactionSkeletonType> {
  verifyLock(options.senderLock, config);
  verifyLock(options.receiverLock, config);
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });
  txSkeleton = updateCellDeps(txSkeleton, config);

  const chequeLock = generateChequeLock(
    options.senderLock,
    options.receiverLock
  );
  const cellCollector = options.cellProvider.collector({
    lock: chequeLock,
    type: options.SUDTScript,
  });
  const chequeOutput: Cell = {
    cell_output: {
      capacity: "0x3c5986200",
      lock: options.senderLock,
      type: undefined,
    },
    data: "0x",
  };
  let claimAmount = 0n;
  for await (const inputCell of cellCollector.collect()) {
    console.log(inputCell);
    const amount = utils.readBigUInt128LE(inputCell.data);
    claimAmount += amount;
    txSkeleton = txSkeleton.update("inputs", (inputs) =>
      inputs.push(inputCell)
    );
    txSkeleton = txSkeleton.update("outputs", (outputs) => {
      return outputs.push(chequeOutput);
    });
  }

  const udtOutput: Cell = {
    cell_output: {
      capacity: "0x34e62ce00",
      lock: options.receiverLock,
      type: options.SUDTScript,
    },
    data: utils.toBigUInt128LE(claimAmount),
  };
  txSkeleton = txSkeleton.update("outputs", (outputs) => outputs.push(udtOutput));

  txSkeleton = await injectCapacity(txSkeleton, options.receiverLock);

  return txSkeleton;
}

interface WithdrawChequeOptions {
  cellProvider: CellProvider;
  senderLock: Script;
  receiverLock: Script;
  SUDTScript?: Script;
}
export async function withdrawCheque(
  options: WithdrawChequeOptions,
  config: config.Config = getConfig()
): Promise<helpers.TransactionSkeletonType> {
  verifyLock(options.senderLock, config);
  verifyLock(options.receiverLock, config);
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });
  txSkeleton = updateCellDeps(txSkeleton, config);

  const chequeLock = generateChequeLock(
    options.senderLock,
    options.receiverLock
  );
  const chequeCollector = options.cellProvider.collector({
    lock: chequeLock,
    type: options.SUDTScript,
  });
  const inputSince = since.generateSince({
    relative: true,
    type: "epochNumber",
    value: {
      number: 6,
      length: 0,
      index: 0,
  }})
  for await (const inputCell of chequeCollector.collect()) {
    console.log(inputCell);
    const udt: Cell = {
      cell_output: {
        capacity: "0x3cb8e4300",
        lock: options.senderLock,
        type: inputCell.cell_output.type,
      },
      data: inputCell.data,
    };
    txSkeleton = txSkeleton.update("inputs", (inputs) =>
      inputs.push(inputCell)
    );
    txSkeleton = txSkeleton.update("inputSinces", (inputSinces) => {
      return inputSinces.set(txSkeleton.get("inputs").size - 1, inputSince);
    });
    txSkeleton = txSkeleton.update("outputs", (outputs) => {
      return outputs.push(udt);
    });
  }
  
  txSkeleton = await injectCapacity(txSkeleton, options.senderLock);

  return txSkeleton;
}
