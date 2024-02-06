import { describe, expect, jest } from "@jest/globals";
import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  CheatCodes,
  createDebugLogger,
  createPXEClient,
  DebugLogger,
  PXE,
} from "@aztec/aztec.js";
import { createAccount } from "@aztec/accounts/testing";
import {
  TicTacToeContract,
  TicTacToeStateChannel,
  emptyCapsuleStack,
} from "../src/index.js";

const {
  ETH_RPC_URL = "http://localhost:8545",
  PRIMARY_PXE_URL = "http://localhost:8080",
  SECONDARY_PXE_URL = "http://localhost:8085",
} = process.env;

describe("State Channel Test With Two PXEs", () => {
  jest.setTimeout(1500000);
  let contractAddress: AztecAddress;
  let cc: CheatCodes;
  let alicePXE: PXE;
  let bobPXE: PXE;
  let logger: DebugLogger;
  let accounts: {
    alice: AccountWalletWithPrivateKey;
    bob: AccountWalletWithPrivateKey;
  };
  let gameIndex = 0n;

  beforeAll(async () => {
    logger = createDebugLogger("tic_tac_toe:state_channel");

    alicePXE = await createPXEClient(PRIMARY_PXE_URL);
    bobPXE = await createPXEClient(SECONDARY_PXE_URL);

    cc = await CheatCodes.create(ETH_RPC_URL, alicePXE);

    accounts = {
      alice: await createAccount(alicePXE),
      bob: await createAccount(bobPXE),
    };

    // register recipients
    await alicePXE.registerRecipient(accounts.bob.getCompleteAddress());
    await bobPXE.registerRecipient(accounts.alice.getCompleteAddress());

    // deploy contract through alice's PXE
    const deployed = await TicTacToeContract.deploy(accounts.alice)
      .send()
      .deployed();
    contractAddress = deployed.address;

    // register contract with bob's PXE
    await bobPXE.addContracts([
      {
        artifact: deployed.artifact,
        completeAddress: deployed.completeAddress,
        portalContract: deployed.portalContract,
      },
    ]);

    // Clear out capsule stack each time tests are ran
    try {
      await emptyCapsuleStack(deployed);
    } catch (err) {}
  });

  describe("TicTacToe State Channel Single PXE", () => {
    afterEach(async () => {
      gameIndex++;
    });

    test("Won Game State Channel", async () => {
      const aliceStateChannel = new TicTacToeStateChannel(
        alicePXE,
        contractAddress,
        gameIndex
      );
      const bobStateChannel = new TicTacToeStateChannel(
        bobPXE,
        contractAddress,
        gameIndex
      );

      /// OPEN CHANNEL ///
      // sign the channel open message as bob
      let guestChannelOpenSignature = TicTacToeStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );
      // open the channel from alice's PXE
      await aliceStateChannel.openChannel(
        accounts.alice,
        guestChannelOpenSignature
      );
      // would transmit the open channel app result to bob
      const openChannelMessage = aliceStateChannel.openChannelResult!;
      // bob adds the open channel app result to his state channel
      bobStateChannel.insertOpenChannel(openChannelMessage);

      /// PLAY GAME ///
      // turn 1
      let move = { row: 0, col: 0 };
      await aliceStateChannel.turn(accounts.alice, move);
      // would transmit turn 1 to bob
      const turn1Message = aliceStateChannel.turnResults[0]!;

      // turn 2
      // bob adds the turn 1 message to his state channel
      bobStateChannel.insertTurn(turn1Message);
      move = { row: 1, col: 1 };
      await bobStateChannel.turn(accounts.bob, move);
      // would transmit turn 1 to bob
      const turn2Message = bobStateChannel.turnResults[1]!;

      // turn 3
      // alice adds the turn 2 message to her state channel
      aliceStateChannel.insertTurn(turn2Message);
      move = { row: 0, col: 1 };
      await aliceStateChannel.turn(accounts.alice, move);
      // would transmit turn 3 to bob
      const turn3Message = aliceStateChannel.turnResults[2]!;

      // turn 4
      // bob adds the turn 1 message to his state channel
      bobStateChannel.insertTurn(turn3Message);
      move = { row: 2, col: 2 };
      await bobStateChannel.turn(accounts.bob, move);
      // would transmit turn 4 to alice
      const turn4Message = bobStateChannel.turnResults[3]!;

      // turn 5 (WINNING MOVE)
      // alice adds the turn 4 message to her state channel
      aliceStateChannel.insertTurn(turn4Message);
      move = { row: 0, col: 2 };
      await aliceStateChannel.turn(accounts.alice, move);
      // alice does not need to transmit the turn 5 message to bob, that loser can see the results on chain

      /// FINALIZE THE GAME ONCHAIN ///
      await aliceStateChannel.finalize(accounts.alice);
      // bob can see that he is a loser
      const contract = await TicTacToeContract.at(
        contractAddress,
        accounts.bob
      );
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.alice.getAddress().toBigInt());
    });

    xtest("Draw Game State Channel", async () => {});

    xtest("Statechannel Timeout With No Dispute", async () => {});
    xtest("Statechannel Timeout With Dispute", async () => {});
  });
});
