import { describe, expect, jest } from "@jest/globals";
import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  CheatCodes,
  createDebugLogger,
  createPXEClient,
  DebugLogger,
  PXE,
  sleep,
} from "@aztec/aztec.js";
import { createAccount } from "@aztec/accounts/testing";
import {
  TicTacToeContract,
  TicTacToeStateChannel,
  emptyCapsuleStack,
} from "../src/index.js";
import { ContinuedStateChannel } from "../src/channel/continued.js";
import { ExtendedNote, NoteAndSlot } from "@aztec/circuit-types";

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
  let channels: {
    alice: TicTacToeStateChannel;
    bob: TicTacToeStateChannel;
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
    } catch (err) { }
  });

  describe("TicTacToe State Channel Single PXE", () => {
    beforeEach(async () => {
      gameIndex++;
      channels = {
        alice: new TicTacToeStateChannel(
          alicePXE,
          accounts.alice,
          contractAddress,
          gameIndex
        ),
        bob: new TicTacToeStateChannel(
          bobPXE,
          accounts.bob,
          contractAddress,
          gameIndex
        ),
      };
    });

    test("Won Game State Channel", async () => {
      /// OPEN CHANNEL ///
      // sign the channel open message as bob
      let guestChannelOpenSignature = TicTacToeStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );

      // open the channel from alice's PXE
      const openChannelResult = await channels.alice.openChannel(
        guestChannelOpenSignature
      );
      // would transmit the open channel app result to bob
      // bob adds the open channel app result to his state channel
      channels.bob.insertOpenChannel(openChannelResult);

      /// PLAY GAME ///
      // turn 1
      let move = channels.alice.buildMove(0, 0);
      // alice transmits the move to bob, who would sign it
      let opponentSignature = move.sign(accounts.bob);
      // (bob transmits the move back to alice)
      // alice (mock) proves the app circuit for turn 1 and transmits this turn result to bob
      let turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 2
      // bob adds the previous increment's turn result to his channel
      channels.bob.insertTurn(turnResult);
      // the flow now repeats until the game is over
      move = channels.bob.buildMove(1, 0);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 3
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(0, 1);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 4
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(2, 2);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 5 (WINNING MOVE)
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(0, 2);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);
      // alice does not need to transmit the turn 5 message to bob, that loser can see the results on chain

      /// FINALIZE THE GAME ONCHAIN ///
      await channels.alice.finalize();
      // bob can see that he is a loser
      const contract = await TicTacToeContract.at(
        contractAddress,
        accounts.bob
      );
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.alice.getAddress().toBigInt());
    });

    test("Draw Game State Channel", async () => {
      /// OPEN CHANNEL ///
      let guestChannelOpenSignature = TicTacToeStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );
      const openChannelResult = await channels.alice.openChannel(
        guestChannelOpenSignature
      );
      channels.bob.insertOpenChannel(openChannelResult);

      /// PLAY GAME ///
      // turn 1
      let move = channels.alice.buildMove(0, 0);
      let opponentSignature = move.sign(accounts.bob);
      let turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 2
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(0, 1);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 3
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(0, 2);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 4
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(1, 1);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 5
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(1, 0);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 6
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(2, 0);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 7
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(2, 1);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 8
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(1, 2);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 9 (cat's game/ draw)
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(2, 2);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);
      // alice does not need to transmit result to bob

      /// FINALIZE THE GAME ONCHAIN ///
      await channels.alice.finalize();

      // bob can see the draw
      let contract = await TicTacToeContract.at(
        contractAddress,
        accounts.bob
      );
      let game = await contract.methods.get_game(gameIndex).view();
      expect(game.over).toEqual(true);
      expect(game.winner.inner).toEqual(0n);

      // alice can see the draw
      contract = await TicTacToeContract.at(
        contractAddress,
        accounts.alice
      );
      game = await contract.methods.get_game(gameIndex).view();
      expect(game.over).toEqual(true);
      expect(game.winner.inner).toEqual(0n);
    });

    test("State Channel Timeout With No Answer", async () => {
      /// OPEN CHANNEL ///
      let guestChannelOpenSignature = TicTacToeStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );
      const openChannelResult = await channels.alice.openChannel(
        guestChannelOpenSignature
      );
      channels.bob.insertOpenChannel(openChannelResult);

      /// PLAY GAME ///

      // turn 1
      let move = channels.alice.buildMove(2, 2);
      let opponentSignature = move.sign(accounts.bob);
      let turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 2
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(2, 0);
      // bob sends the move to alice, but she does not respond
      turnResult = await channels.bob.turn(move);

      /// SUBMIT LATEST STATE WITH TIMEOUT ///
      await channels.bob.finalize();

      // ensure the onchain state reflects the execution of the state channel
      const contract = await TicTacToeContract.at(
        contractAddress,
        accounts.bob
      );

      // check timeout is active
      const noteHash = await contract.methods
        .get_game_note_hash(gameIndex)
        .view();
      const timestamp = await contract.methods.get_timeout(noteHash).view();
      expect(timestamp).not.toEqual(0n);

      /// CLAIM TIMEOUT ///
      // warp block time 10 minutes to end of timeout window
      await cc.aztec.warp(Number(timestamp) + 600);

      // claim timeout win
      await contract.methods.claim_timeout_win(gameIndex).send().wait();
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
    });

    xtest("State Channel Timeout With Answer", async () => {
      /// OPEN CHANNEL ///
      // sign the channel open message as bob
      let guestChannelOpenSignature = TicTacToeStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );
      const openChannelResult = await channels.alice.openChannel(
        guestChannelOpenSignature
      );
      channels.bob.insertOpenChannel(openChannelResult);

      /// PLAY GAME ///

      // turn 1
      let move = channels.alice.buildMove(0, 0);
      let opponentSignature = move.sign(accounts.bob);
      let turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 2 (TIMEOUT)
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(2, 0);
      // bob sends the move to alice, but she does not respond
      turnResult = await channels.bob.turn(move);

      /// SUBMIT LATEST STATE WITH TIMEOUT ///
      await channels.bob.finalize();
      // ensure the onchain state reflects the execution of the state channel
      let contract = await TicTacToeContract.at(contractAddress, accounts.bob);

      // check timeout is active
      const noteHash = await contract.methods
        .get_game_note_hash(gameIndex)
        .view();
      const timestamp = await contract.methods.get_timeout(noteHash).view();
      expect(timestamp).not.toEqual(0n);
      let board = await contract.methods.get_board(gameIndex).view();
      expect(board.turn).toEqual(2n);

      // ANSWER TIMEOUT
      contract = await TicTacToeContract.at(contractAddress, accounts.alice);
      let answer_res = await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();

      // Confirm board state incremented to next turn
      contract = await TicTacToeContract.at(contractAddress, accounts.bob);
      board = await contract.methods.get_board(gameIndex).view();
      expect(board.turn).toEqual(3n);

      // get starting note as bob
      let txHash = answer_res.txHash;
      const note = await accounts.bob.getNotes({ txHash }).then(notes => notes[0]);
      console.log("Note: ", note)
      // todo: provide way for opponent to get ExtendedNote without cooperation

      /// CONTINUE GAME TO COMPLETION ///

      let continued = {
        alice: new ContinuedStateChannel(alicePXE, accounts.alice, contractAddress, gameIndex, 3),
        bob: new ContinuedStateChannel(bobPXE, accounts.bob, contractAddress, gameIndex, 3),
      }

      // turn 4
      move = continued.bob.buildMove(2, 1);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await continued.bob.turn(move, opponentSignature);

      // turn 5
      continued.alice.insertTurn(turnResult);
      move = continued.alice.buildMove(0, 2);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await continued.alice.turn(move, opponentSignature);

      // finalize continued game
      await accounts.alice.addNote(note);
      await continued.alice.finalize();

      // check alice won
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.alice.getAddress().toBigInt());
    });
  });
});
