import React, { useEffect, useState } from "react";
import { helpers, Script } from "@ckb-lumos/lumos";
import ReactDOM from "react-dom";
import { capacityOf, CONFIG, detectCardano, transfer, CardanoApi } from "./lib";
import { Address } from "@emurgo/cardano-serialization-lib-nodejs";

const app = document.getElementById("root");
ReactDOM.render(<App />, app);

export function App() {
  const [cardanoAddr, setCardanoAddr] = useState("");
  const [cardanoBechAddr, setCardanoBechAddr] = useState("");

  const [cardanoApi, setCardanoApi] = useState<CardanoApi>();

  const [pwAddr, setPwAddr] = useState("");
  const [pwLock, setPwLock] = useState<Script>();
  const [balance, setBalance] = useState("-");

  const [transferAddr, setTransferAddress] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  const [isSendingTx, setIsSendingTx] = useState(false);
  const [txHash, setTxHash] = useState("");

  // TODO: change account event listener

  async function connectToNami() {
    const cardano = await detectCardano();
    cardano.nami
      .enable()
      .then((api) => {
        console.log("enabled: ", api);
        setCardanoApi(api);

        return api.getUsedAddresses();
      })
      .then(([cardanoAddr]: string[]) => {
        const cardanoBechAddr = Address.from_bytes(Buffer.from(cardanoAddr, "hex")).to_bech32();
        setCardanoBechAddr(cardanoBechAddr);

        const pwLock: Script = {
          code_hash: CONFIG.SCRIPTS.PW_LOCK.CODE_HASH,
          hash_type: CONFIG.SCRIPTS.PW_LOCK.HASH_TYPE,
          args: cardanoAddr,
        };

        const pwAddr = helpers.generateAddress(pwLock);

        setCardanoAddr(cardanoAddr);
        setPwAddr(pwAddr);
        setPwLock(pwLock);

        return pwAddr;
      })
      .then((pwAddr) => capacityOf(pwAddr))
      .then((balance) => setBalance(balance.div(10 ** 8).toString() + " CKB"));
  }

  function onTransfer() {
    if (isSendingTx) return;
    setIsSendingTx(true);

    transfer({ amount: transferAmount, from: pwAddr, to: transferAddr, api: cardanoApi! })
      .then(setTxHash)
      // .catch((e) => alert(e.message || JSON.stringify(e)))
      .finally(() => setIsSendingTx(false));
  }

  if (!cardanoAddr) return <button onClick={connectToNami}>Connect to Nami</button>;

  return (
    <div>
      <ul>
        <li>Cardano Address: {cardanoAddr}</li>
        <li>Cardano Address: {cardanoBechAddr}</li>

        <li>Nervos Address(PW): {pwAddr}</li>
        <li>
          Current Pw lock script:
          <pre>{JSON.stringify(pwLock, null, 2)}</pre>
        </li>

        <li>Balance: {balance}</li>
      </ul>

      <div>
        <h2>Transfer to</h2>
        <label htmlFor="address">Address</label>&nbsp;
        <input id="address" type="text" onChange={(e) => setTransferAddress(e.target.value)} placeholder="ckt1..." />
        <br />
        <label htmlFor="amount">Amount</label>
        &nbsp;
        <input id="amount" type="text" onChange={(e) => setTransferAmount(e.target.value)} placeholder="shannon" />
        <br />
        <button onClick={onTransfer} disabled={isSendingTx}>
          Transfer
        </button>
        <p>Tx Hash: {txHash}</p>
      </div>
    </div>
  );
}
