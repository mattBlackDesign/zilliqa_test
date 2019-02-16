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
const privkey = '95c68a61493b0e1c68963716ce40dce918bb6a9a8582e51d33fe302169038076';

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
    const code = `scilla_version 0

    (* HelloWorld contract *)

    import ListUtils

    (***************************************************)
    (*               Associated library                *)
    (***************************************************)
    library HelloWorld

    let one_msg =
      fun (msg : Message) =>
      let nil_msg = Nil {Message} in
      Cons {Message} msg nil_msg

    let not_owner_code = Int32 1
    let set_hello_code = Int32 2

    (***************************************************)
    (*             The contract definition             *)
    (***************************************************)

    contract HelloWorld
    (owner: ByStr20)

    field welcome_msg : String = ""

    transition setHello (msg : String)
      is_owner = builtin eq owner _sender;
      match is_owner with
      | False =>
        msg = {_tag : "Main"; _recipient : _sender; _amount : Uint128 0; code : not_owner_code};
        msgs = one_msg msg;
        send msgs
      | True =>
        welcome_msg := msg;
        msg = {_tag : "Main"; _recipient : _sender; _amount : Uint128 0; code : set_hello_code};
        msgs = one_msg msg;
        send msgs
      end
    end


    transition getHello ()
        r <- welcome_msg;
        e = {_eventname: "getHello()"; msg: r};
        event e
    end`;

    const init = [
      // this parameter is mandatory for all init arrays
      {
        vname: "_scilla_version",
        type: "Uint32",
        value: "0"
      },
      {
        vname: "owner",
        type: "ByStr20",
        // NOTE: all byte strings passed to Scilla contracts _must_ be
        // prefixed with 0x. Failure to do so will result in the network
        // rejecting the transaction while consuming gas!
        value: `0x${address}`
      }
    ];

    // Instance of class Contract
    const contract = zilliqa.contracts.new(code, init);

    // Deploy the contract
    const [deployTx, hello] = await contract.deploy({
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
    console.log(hello.address);
    const callTx = await hello.call(
      "setHello",
      [
        {
          vname: "msg",
          type: "String",
          value: "Hello World"
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
