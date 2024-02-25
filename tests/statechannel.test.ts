import { describe, expect, jest } from "@jest/globals";
import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  CheatCodes,
  createDebugLogger,
  createPXEClient,
  DebugLogger,
  Fr,
  PXE,
  sleep,
} from "@aztec/aztec.js";
import { createAccount } from "@aztec/accounts/testing";
import {
  TicTacToeContract,
  BaseStateChannel,
  ContinuedStateChannel,
  emptyCapsuleStack,
  verifySchnorr,
} from "../src/index.js";
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
    alice: BaseStateChannel;
    bob: BaseStateChannel;
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
    beforeEach(async () => {
      gameIndex++;
      channels = {
        alice: new BaseStateChannel(accounts.alice, contractAddress, gameIndex),
        bob: new BaseStateChannel(accounts.bob, contractAddress, gameIndex),
      };
    });

    test("Won Game State Channel", async () => {
      /// OPEN CHANNEL ///
      // sign the channel open message as bob
      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
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
      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
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
      let contract = await TicTacToeContract.at(contractAddress, accounts.bob);
      let game = await contract.methods.get_game(gameIndex).view();
      expect(game.over).toEqual(true);
      expect(game.winner.inner).toEqual(0n);

      // alice can see the draw
      contract = await TicTacToeContract.at(contractAddress, accounts.alice);
      game = await contract.methods.get_game(gameIndex).view();
      expect(game.over).toEqual(true);
      expect(game.winner.inner).toEqual(0n);
    });

    test("Unanswered State Channel Timeout", async () => {
      /// OPEN CHANNEL ///
      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
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

    test("State Channel Timeout Answered (Won by Timeout Culprit)", async () => {
      /// OPEN CHANNEL ///
      // sign the channel open message as bob
      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
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
      let answer_res = await contract.methods
        .answer_timeout(gameIndex, 0, 1)
        .send()
        .wait();

      // Confirm board state incremented to next turn
      contract = await TicTacToeContract.at(contractAddress, accounts.bob);
      board = await contract.methods.get_board(gameIndex).view();
      expect(board.turn).toEqual(3n);

      // get starting note as bob
      contract = await TicTacToeContract.at(contractAddress, accounts.bob);
      let txHash = answer_res.txHash;
      const note = await accounts.bob
        .getNotes({ txHash })
        .then((notes) => notes[0]);

      /// CONTINUE GAME TO COMPLETION ///

      const continued = {
        alice: new ContinuedStateChannel(
          accounts.alice,
          contractAddress,
          gameIndex,
          3
        ),
        bob: new ContinuedStateChannel(
          accounts.bob,
          contractAddress,
          gameIndex,
          3
        ),
      };

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
      await continued.alice.finalize();

      // check alice won
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.alice.getAddress().toBigInt());
    });

    test("State Channel Timeout Answered (Won by Timeout Initiator)", async () => {
      /// OPEN CHANNEL ///
      // sign the channel open message as bob
      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
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
      let move = channels.alice.buildMove(1, 0);
      let opponentSignature = move.sign(accounts.bob);
      let turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 2 (TIMEOUT)
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(0, 0);
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
      let answer_res = await contract.methods
        .answer_timeout(gameIndex, 1, 1)
        .send()
        .wait();

      // Confirm board state incremented to next turn
      contract = await TicTacToeContract.at(contractAddress, accounts.bob);
      board = await contract.methods.get_board(gameIndex).view();
      expect(board.turn).toEqual(3n);

      // get starting note as bob
      let txHash = answer_res.txHash;

      /// CONTINUE GAME TO COMPLETION ///
      const continued = {
        alice: new ContinuedStateChannel(
          accounts.alice,
          contractAddress,
          gameIndex,
          3
        ),
        bob: new ContinuedStateChannel(
          accounts.bob,
          contractAddress,
          gameIndex,
          3
        ),
      };

      // turn 4
      move = continued.bob.buildMove(1, 2);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await continued.bob.turn(move, opponentSignature);

      // turn 5
      continued.alice.insertTurn(turnResult);
      move = continued.alice.buildMove(2, 1);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await continued.alice.turn(move, opponentSignature);

      // turn 6
      continued.bob.insertTurn(turnResult);
      move = continued.bob.buildMove(0, 1);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await continued.bob.turn(move, opponentSignature);

      // turn 7
      continued.alice.insertTurn(turnResult);
      move = continued.alice.buildMove(2, 0);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await continued.alice.turn(move, opponentSignature);

      // turn 8 (WINNING MOVE)
      continued.bob.insertTurn(turnResult);
      move = continued.bob.buildMove(0, 2);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await continued.bob.turn(move, opponentSignature);

      // finalize continued game
      await continued.bob.finalize();

      // check bob won
      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
    });

    test("Double Spend Fraud in State Channel", async () => {
      /// OPEN CHANNEL ///
      // alice would send a signed open channel message to bob
      // this is omitted in above tests because it is only checked client side
      // it shown in this step only to simulate real flow
      let hostOpenChannelSignature = BaseStateChannel.signOpenChannel(
        accounts.alice,
        accounts.bob.getAddress()
      );

      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );
      const openChannelResult = await channels.alice.openChannel(
        guestChannelOpenSignature
      );
      channels.bob.insertOpenChannel(openChannelResult);

      /// PLAY GAME ///
      // these turns are not used and just simulate an example of a game

      // turn 1
      let move = channels.alice.buildMove(0, 0);
      let opponentSignature = move.sign(accounts.bob);
      let turnResult = await channels.alice.turn(move, opponentSignature);

      // turn 2
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(1, 0);
      // bob signs the move before sending it to alice as well
      // this is omitted in above tests because it is only checked client side
      // it shown in this step only to simulate real flow
      let realSignature = move.sign(accounts.bob);

      // alice verifies the signature by bob on move before signing it herself
      let verifiedMove = verifySchnorr(
        move.toMessage(),
        accounts.bob.getCompleteAddress().publicKey,
        new Uint8Array(realSignature.toBuffer())
      );
      expect(verifiedMove);
      opponentSignature = move.sign(accounts.alice);

      // continue expected state channel flow
      turnResult = await channels.bob.turn(move, opponentSignature);

      // turn 3
      channels.alice.insertTurn(turnResult);
      move = channels.alice.buildMove(0, 1);
      // alice signs the move she will eventually double spend and sends it to bob
      realSignature = move.sign(accounts.alice);
      opponentSignature = move.sign(accounts.bob);
      turnResult = await channels.alice.turn(move, opponentSignature);

      /// MAKE FRAUDULENT DOUBLE-SPEND TURN ///
      // ALICE "DOUBLE SPENDS" TURN 3
      let fraudMove = channels.alice.buildMove(0, 2, move.turnIndex);
      let fraudSignature = fraudMove.sign(accounts.alice);

      // alice needs a signature on this new double-spend move and transmits it to bob

      /// PROVE FRAUDULENT DOUBLE-SPEND TURN ///
      // todo: could use simulated result instead of re-proving open_channel
      // bob must add the open channel capsule to his pxe
      let openChannelCapsule = [
        accounts.alice.getAddress(),
        accounts.bob.getAddress(),
        ...hostOpenChannelSignature.sig,
        ...guestChannelOpenSignature.sig,
        Fr.ZERO,
        Fr.ZERO,
      ];
      await accounts.bob.addCapsule(openChannelCapsule);
      // send the proof of double spend to the contract
      let signatures = [realSignature, fraudSignature].map((sig) => [
        ...new Uint8Array(sig.toBuffer()),
      ]);
      const contract = await TicTacToeContract.at(
        contractAddress,
        accounts.bob
      );

      await contract.methods
        .claim_fraud_win(
          gameIndex,
          fraudMove.turnIndex,
          [move.row, move.col],
          [fraudMove.row, fraudMove.col],
          signatures[0],
          signatures[1]
        )
        .send()
        .wait();

      // check that the game has been terminated with bob as winner
      const board = await contract.methods.get_board(gameIndex).view();
      expect(board.over).toEqual(true);

      const game = await contract.methods.get_game(gameIndex).view();
      expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
    });

    test("Fraudulent Timeout in State Channel", async () => {
      // Run a second fraudulent channel as alice to simulate the timeout fraud
      let fraudChannel = new BaseStateChannel(
        accounts.alice,
        contractAddress,
        gameIndex
      );
      /// OPEN CHANNEL ///
      let guestChannelOpenSignature = BaseStateChannel.signOpenChannel(
        accounts.bob,
        accounts.alice.getAddress(),
        true
      );

      const openChannelResult = await channels.alice.openChannel(
        guestChannelOpenSignature
      );
      channels.bob.insertOpenChannel(openChannelResult);

      // add open channel to fraud channel
      fraudChannel.insertOpenChannel(openChannelResult);

      /// PLAY GAME ///
      // turn 1
      let move = channels.alice.buildMove(0, 0);
      let opponentSignature = move.sign(accounts.bob);
      let turnResult = await channels.alice.turn(move, opponentSignature);
      // add turn 1 to fraud channel
      fraudChannel.insertTurn(turnResult);

      // turn 2
      channels.bob.insertTurn(turnResult);
      move = channels.bob.buildMove(0, 1);
      opponentSignature = move.sign(accounts.alice);
      turnResult = await channels.bob.turn(move, opponentSignature);
      // add turn 2 to fraud channel
      fraudChannel.insertTurn(turnResult);
      // stop adding turns as alice will make fraudulent turn from here

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

      /// MAKE FRAUDULENT TIMEOUT ///
      // create a different turn for the fraud timeout
      // could use same turn, wouldn't matter
      let fraudulentTurn = fraudChannel.buildMove(2, 0);
      await fraudChannel.turn(fraudulentTurn);
      // finalize the fraud channel timeout
      await fraudChannel.finalize();

      /// PROVE TIMEOUT WAS FRAUDULENT ///
      // dispute the fraudulent timeout onchain
      const contract = await TicTacToeContract.at(
        contractAddress,
        accounts.bob
      );
      await contract.methods.dispute_timeout(
        gameIndex,
        move.turnIndex,
        [move.row, move.col],
        [...new Uint8Array(opponentSignature.toBuffer())]
      ).send().wait();
      // verify that the game has been terminated with bob as winner
      const game = await contract.methods.get_game(gameIndex).view();
      console.log("game", game);
      expect(game.over).toEqual(true);
      expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
      // verify no timeout
      const noteHash = await contract.methods
        .get_game_note_hash(gameIndex)
        .view();
      const timeoutNullifier = await contract.methods.get_timeout(noteHash).view();
      expect(timeoutNullifier).toEqual(0n);
    });
  });
});
