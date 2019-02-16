const { Transaction } = require('@zilliqa-js/account');
const { BN, Long, bytes, units } = require('@zilliqa-js/util');
const { Zilliqa } = require('@zilliqa-js/zilliqa');
const CP = require ('@zilliqa-js/crypto');

const zilliqa = new Zilliqa('https://dev-api.zilliqa.com');

// These are set by the core protocol, and may vary per-chain.
// These numbers are JUST AN EXAMPLE. They will NOT WORK on the public testnet
// or mainnet. Please check what they are before proceeding, or your
// transactions will simply be rejected.
const CHAIN_ID = 333;
const MSG_VERSION = 1;
const VERSION = bytes.pack(CHAIN_ID, MSG_VERSION);

// Populate the wallet with an account
const privkey = '869a01d55b9e417eea90e32b5d166d2bed7ba289fe2c8ea71357db6db5001f97';

zilliqa.wallet.addByPrivateKey(
  privkey
);

const address = CP.getAddressFromPrivateKey(privkey);
console.log("Your account address is:");
console.log(`0x${address}`);

async function testBlockchain() {
  try {

    // Get Balance
    const balance = await zilliqa.blockchain.getBalance(address);
    // Get Minimum Gas Price from blockchain
    const minGasPrice = await zilliqa.blockchain.getMinimumGasPrice();
    console.log(minGasPrice);
    console.log(units.Units);
    console.log(`Your account balance is:`);
    console.log(balance.result)
    console.log(`Current Minimum Gas Price: ${minGasPrice.result}`);
    const myGasPrice = units.toQa('1000', units.Units.Li); // Gas Price that will be used by all transactions
    console.log(`My Gas Price ${myGasPrice.toString()}`)
    console.log('Sufficient Gas Price?');
    console.log(myGasPrice.gte(new BN(minGasPrice.result))); // Checks if your gas price is less than the minimum gas price

    // Send a transaction to the network
    const tx = await zilliqa.blockchain.createTransaction(
      zilliqa.transactions.new({
        version: VERSION,
        toAddr: "573EC96638C8BB1C386394602E1460634F02ADDA",
        amount: new BN(units.toQa("1", units.Units.Li)), // Sending an amount in Zil (888) and converting the amount to Qa
        gasPrice: myGasPrice, // Minimum gasPrice veries. Check the `GetMinimumGasPrice` on the blockchain
        gasLimit: Long.fromNumber(1)
      })
    );

    console.log(`The transaction status is:`);
    console.log(tx.receipt);

    // Deploy a contract
    const code = `
scilla_version 0

(***************************************************)
(*               Associated library                *)
(***************************************************)

import BoolUtils

library HTLCLib

let blk_leq =
  fun (blk1 : BNum) =>
  fun (blk2 : BNum) =>
    let bc1 = builtin blt blk1 blk2 in 
    let bc2 = builtin eq blk1 blk2 in 
    orb bc1 bc2

let one_msg = 
  fun (msg : Message) => 
    let nil_msg = Nil {Message} in
    Cons {Message} msg nil_msg

let not_claimable_code = Int32 1
let claimable_code = Int32 2
let not_refundable_code = Int32 3
let refunable_code = Int32 4


(***************************************************)
(*             Contract definition                 *)
(***************************************************)

contract HTLC

(*  Parameters *)
(refund_address    : ByStr20,
redeem_address     : ByStr20,
expiration_blk     : BNum,
secretHash         : ByStr32)

transition claim (secret : ByStr32)
  hashed_secret = builtin sha256hash secret;
  is_correct_secret = builtin eq hashed_secret secretHash;
  blk <- & BLOCKNUMBER;
  bal <- _balance;
  in_time = blk_leq blk expiration_blk;
  is_claimable = andb is_correct_secret in_time;

  match is_claimable with
  | False =>
    e = {_eventname : "notClaimable"; code : not_claimable_code};
    event e
  | True =>
    msg  = {_tag : ""; _recipient : redeem_address; _amount : bal; 
            code : claimable_code};
    msgs = one_msg msg;
    e = {_eventname : "Claimed"; code : claimable_code};
    event e;
    send msgs     
  end
end

transition expire ()
  blk <- & BLOCKNUMBER;
  bal <- _balance;
  in_time = blk_leq blk expiration_blk;
  is_expired = negb in_time;

  match is_expired with
  | False =>
    e = {_eventname : "notRefundable"; code : not_refundable_code};
    event e
  | True =>
    msg  = {_tag : ""; _recipient : refund_address; _amount : bal; 
            code : claimable_code};
    msgs = one_msg msg;
    e = {_eventname : "Claimed"; code : refundable_code};
    event e;
    send msgs     
  end
end`;

    const init = [
      // this parameter is mandatory for all init arrays
      {
        vname: "_scilla_version",
        type: "Uint32",
        value: "0"
      },
      {
        vname: "refund_address",
        type: "ByStr20",
        value: "0x0fd1fa24a755051bb06e87cf5a27b389a28d84df"
      },
      {
        vname: "redeem_address",
        type: "ByStr20",
        value: "0x43050e59fb74bcd3598c70a96a284fc79a48649e"
      },
      {
        vname: "expiration_blk",
        type: "BNum",
        value: "86150"
      },
      {
        vname: "secretHash",
        type: "ByStr32",
        // NOTE: all byte strings passed to Scilla contracts _must_ be
        // prefixed with 0x. Failure to do so will result in the network
        // rejecting the transaction while consuming gas!
        value: "192f358b9eb5c51b27dff7a7cc82c8ffe058e2c92fdc2474b88bf5c41a14567f"
      }
    ];

    // Instance of class Contract
    const contract = zilliqa.contracts.new(code, init);

    // Deploy the contract
    const [deployTx, htlc] = await contract.deploy({
      version: VERSION,
      gasPrice: myGasPrice,
      gasLimit: Long.fromNumber(10000)
    });

    // Introspect the state of the underlying transaction
    console.log(`Deployment Transaction ID: ${deployTx.id}`);
    console.log(`Deployment Transaction Receipt:`);
    console.log(deployTx.txParams.receipt);

    // Get the deployed contract address
    console.log("The contract address is:");
    console.log(htlc.address);
    const callTx = await htlc.call(
      "claim",
      [
        {
          vname: "secret",
          type: "ByStr32",
          value: "77c1c548c7e525da21a791116d00954493196e17c10ff53b12d55731867640ef"
        }
      ],
      {
        // amount, gasPrice and gasLimit must be explicitly provided
        version: VERSION,
        amount: new BN(0),
        gasPrice: myGasPrice,
        gasLimit: Long.fromNumber(8000),
      }
    );
    console.log(callTx);

    //Get the contract state
    const state = await hello.getState();
    console.log("The state of the contract is:");
    console.log(state);
  } catch (err) {
    console.log(err);
  }
}

testBlockchain();
