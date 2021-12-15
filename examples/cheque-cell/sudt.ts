import { bootstrap } from "global-agent";
bootstrap();

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

async function createUdt() {
  const { provider, signer } = await getContext();
  const address = await signer.getAddress();

  const unsigned = await new MintSudtBuilder(
    {
      recipients: [
        {
          recipient: address,
          amount: "0x3e8",
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

createUdt();
