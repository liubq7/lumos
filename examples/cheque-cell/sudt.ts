import {
  CkitProvider,
  MintSudtBuilder,
  predefined,
  internal,
} from "@ckitjs/ckit";

const { Secp256k1Signer } = internal;

const privateKey =
  "0xf571db32dace55dc75f6df7f2e1a0fb0ec730cfdde2ed6e5a4998673503d513b";

async function getContext() {
  const provider = new CkitProvider(
    "https://testnet.ckb.dev/indexer",
    "https://testnet.ckb.dev/rpc"
  );
  await provider.init(predefined.Aggron);

  const lockConfig = provider.newScriptTemplate("SECP256K1_BLAKE160");
  const signer = new Secp256k1Signer(privateKey, provider, lockConfig);

  return { provider, signer };
}

async function showBasicInfo() {
  const { provider, signer } = await getContext();

  const address = await signer.getAddress();
  console.log(`address is : ${address}`);

  const lock = provider.parseToScript(address);
  console.log(`lock is : ${JSON.stringify(lock)}`);

  const ckbBalance = await provider.getCkbLiveCellsBalance(address);
  console.log(`ckb balance is: ${ckbBalance}`);
}

async function createUdt() {
  const { provider, signer } = await getContext();
  const address = await signer.getAddress();

  const unsigned = await new MintSudtBuilder(
    {
      recipients: [
        {
          recipient: address,
          amount: "0x64",
          // additionalCapacity: helpers.CkbAmount.fromCkb('1').toHex(),
          capacityPolicy: "createCell" as const,
        },
      ],
    },
    provider,
    address
  ).build();

  const signed = await signer.seal(unsigned);

  const txHash = await provider.sendTransaction(signed);
  console.log(`udt has created with txHash: ${txHash}`);
}

showBasicInfo();
createUdt();
// udt has created with txHash: 0xa2f549fabf7936f02923e454f67df16738977bf5cccfa142e48ca0ff01f34769
