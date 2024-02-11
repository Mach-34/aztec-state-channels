import { describe, expect, jest } from "@jest/globals";
import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  CheatCodes,
  Contract,
  createDebugLogger,
  createPXEClient,
  DebugLogger,
  PXE,
} from "@aztec/aztec.js";
import { createAccount } from "@aztec/accounts/testing";
import { TicTacToeContractArtifact } from "../src/artifacts/TicTacToe.js";
import { emptyCapsuleStack } from "../src/utils.js";
import { TicTacToeStateChannel } from "./utils/index.js";

const {
  ETH_RPC_URL = "http://localhost:8545",
  PXE_URL = "http://localhost:8080",
} = process.env;

describe("State Channel Test", () => {
  jest.setTimeout(1500000);
  let contractAddress: AztecAddress;
  let cc: CheatCodes;
  let pxe: PXE;
  let logger: DebugLogger;
  let accounts: {
    alice: AccountWalletWithPrivateKey;
    bob: AccountWalletWithPrivateKey;
  };
  let gameIndex = 0n;

  beforeAll(async () => {
    logger = createDebugLogger("state_channel:tic_tac_toe");

    pxe = await createPXEClient(PXE_URL);

    cc = await CheatCodes.create(ETH_RPC_URL, pxe);

    accounts = {
      alice: await createAccount(pxe),
      bob: await createAccount(pxe),
    };

    const deployed = await Contract.deploy(
      accounts.alice,
      TicTacToeContractArtifact,
      []
    )
      .send()
      .deployed();
    contractAddress = deployed.address;
    // Clear out capsule stack each time tests are ran
    try {
      await emptyCapsuleStack(deployed);
    } catch (err) { }
  });

  describe("TicTacToe State Channel Single PXE", () => {
    afterEach(async () => {
      gameIndex++;
    });

    test("Won Game State Channel", async () => {
      // create the tic tac toe state channel driver
      const stateChannel = new TicTacToeStateChannel(
        pxe,
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
      // open the channel
      await stateChannel.openChannel(accounts.alice, guestChannelOpenSignature);

      /// PLAY GAME ///
      // turn 1
      let move = { row: 0, col: 0 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 2
      move = { row: 1, col: 0 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 3
      move = { row: 0, col: 1 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 4
      move = { row: 1, col: 1 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 5 
      move = { row: 2, col: 0 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 6 
      move = { row: 2, col: 1 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 7 (WINNING MOVE)
      move = { row: 0, col: 2 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);

      /// FINALIZE THE GAME ONCHAIN ///
      await stateChannel.finalize(accounts.alice);
      // // ensure the onchain state reflects the execution of the state channel
      const contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.alice.getAddress().toBigInt());
    });

    test("Draw Game State Channel", async () => {

      // create the tic tac toe state channel driver
      const stateChannel = new TicTacToeStateChannel(
        pxe,
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
      // open the channel
      await stateChannel.openChannel(accounts.alice, guestChannelOpenSignature);


      /// PLAY GAME ///
      // turn 1
      let move = { row: 0, col: 0 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 2
      move = { row: 0, col: 1 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 3
      move = { row: 0, col: 2 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 4
      move = { row: 1, col: 1 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 5
      move = { row: 1, col: 0 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 6
      move = { row: 1, col: 2 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 7
      move = { row: 2, col: 1 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 8
      move = { row: 2, col: 0 };
      await stateChannel.turn(accounts.bob, accounts.alice, move);
      // turn 9
      move = { row: 2, col: 2 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);

      /// FINALIZE THE GAME ONCHAIN ///
      await stateChannel.finalize(accounts.alice);
      // // ensure the onchain state reflects the execution of the state channel
      const contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );

      const board = await contract.methods.get_board(gameIndex).view();
      expect(board.over).toEqual(true);
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.over).toEqual(true);
      expect(game.winner.inner).toEqual(0n);
    });

    xtest("Statechannel Timeout With No Answer", async () => {
      const stateChannel = new TicTacToeStateChannel(
        pxe,
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
      // open the channel
      await stateChannel.openChannel(accounts.alice, guestChannelOpenSignature);

      /// PLAY GAME ///

      // turn 1
      let move = { row: 2, col: 2 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 2 (TIMEOUT)
      await stateChannel.turn(accounts.bob, accounts.alice, { row: 2, col: 0, timeout: true });


      /// SUBMIT LATEST STATE WITH TIMEOUT ///
      await stateChannel.finalize(accounts.alice);
      // // ensure the onchain state reflects the execution of the state channel
      const contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );

      // CHECK THAT TIMEOUT HAS BEEN SET
      const noteHash = await contract.methods
        .get_game_note_hash(gameIndex)
        .view();
      const timestamp = await contract.methods.get_timeout(noteHash).view();
      expect(timestamp).not.toEqual(0n);

      // console.log('Cheat codes: ', cc.aztec.warp);

      await cc.aztec.warp(Number(timestamp) + 600)
      // await contract.methods.claim_timeout_win(gameIndex).send().wait();
      // const game = await contract.methods.get_game(gameIndex).view();
      // expect(game.winner.inner).toEqual(
      //   accounts.bob.getAddress().toBigInt()
      // );
    });

    xtest("Statechannel Timeout With Answer", async () => {

      const stateChannel = new TicTacToeStateChannel(
        pxe,
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
      // open the channel
      await stateChannel.openChannel(accounts.alice, guestChannelOpenSignature);

      /// PLAY GAME ///

      // turn 1
      let move = { row: 2, col: 2 };
      await stateChannel.turn(accounts.alice, accounts.bob, move);
      // turn 2 (TIMEOUT)
      await stateChannel.turn(accounts.bob, accounts.alice, { row: 2, col: 0, timeout: true });


      /// SUBMIT LATEST STATE WITH TIMEOUT ///
      await stateChannel.finalize(accounts.alice);
      // // ensure the onchain state reflects the execution of the state channel
      const contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );

      // CHECK THAT TIMEOUT HAS BEEN SET
      const noteHash = await contract.methods
        .get_game_note_hash(gameIndex)
        .view();
      const timestamp = await contract.methods.get_timeout(noteHash).view();
      expect(timestamp).not.toEqual(0n);

      // ANSWER TIMEOUT
      await contract.methods.answer_timeout(gameIndex, 0, 0).send().wait();
      // Confirm board state incremented to next turn
      const board = await contract.methods.get_board(gameIndex).view();
      expect(board.turn).toEqual(3n);

      /// CONTINUE GAME TO COMPLETION ///

      // // turn 4
      // move = { row: 2, col: 2 };
      // await stateChannel.turn(accounts.bob, move);
      // // turn 5 (WINNING MOVE)
      // move = { row: 1, col: 1 };
      // await stateChannel.turn(accounts.alice, move);

      // await stateChannel.finalize(accounts.alice);
      // const game = await contract.methods.get_game(gameIndex).view();
      // expect(game.winner.inner).toEqual(accounts.alice.getAddress().toBigInt());

    });
  });
});
