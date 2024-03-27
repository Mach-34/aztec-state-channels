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
  emptyCapsuleStack,
  numToHex,
  signSchnorr,
  prepareOpenChannel,
  serializeSignature,
  TicTacToeContract,
  Move,
  encapsulateTurn,
} from "../src/index.js";
import { prepareTurns, RawMove } from "./utils/index.js";

const {
  ETH_RPC_URL = "http://localhost:8545",
  PXE_URL = "http://localhost:8080",
} = process.env;

describe("Tic Tac Toe", () => {
  jest.setTimeout(1500000);
  let contractAddress: AztecAddress;
  let cc: CheatCodes;
  let pxe: PXE;
  let logger: DebugLogger;
  let accounts: {
    alice: AccountWalletWithPrivateKey;
    bob: AccountWalletWithPrivateKey;
    charlie: AccountWalletWithPrivateKey;
  };
  let gameIndex = 0n;

  beforeAll(async () => {
    logger = createDebugLogger("tic_tac_toe:logic");

    pxe = await createPXEClient(PXE_URL);

    cc = await CheatCodes.create(ETH_RPC_URL, pxe);

    accounts = {
      alice: await createAccount(pxe),
      bob: await createAccount(pxe),
      charlie: await createAccount(pxe),
    };

    const deployed = await TicTacToeContract.deploy(accounts.alice)
      .send()
      .deployed();
    contractAddress = deployed.address;
    // Clear out capsule stack each time tests are ran
    try {
      await emptyCapsuleStack(deployed);
    } catch (err) {}
  });

  describe("Test state channel over orchestrator function", () => {
    afterEach(async () => {
      gameIndex++;
    });

    beforeEach(async () => {
      const contract = await TicTacToeContract.at(
        contractAddress,
        accounts.alice
      );
      try {
        await emptyCapsuleStack(contract);
      } catch (err) {}
    });

    describe("Test game creation", () => {
      test("Game should fail to start if at least one signature is not valid", async () => {
        const aliceAddress = accounts.alice.getAddress().toBuffer();
        const bobAddress = accounts.bob.getAddress().toBuffer();

        // Create open channel msg by concatenating host and player address bytes
        const channelMsg = new Uint8Array(64);
        channelMsg.set(Uint8Array.from(aliceAddress), 0);
        channelMsg.set(Uint8Array.from(bobAddress), 32);

        const alicePrivkey = accounts.alice.getEncryptionPrivateKey();
        const aliceSignature = signSchnorr(channelMsg, alicePrivkey);

        const charliePrivkey = accounts.charlie.getEncryptionPrivateKey();
        const charlieSignature = signSchnorr(channelMsg, charliePrivkey);

        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        const {
          s1: alice_s1,
          s2: alice_s2,
          s3: alice_s3,
        } = serializeSignature(aliceSignature);
        const {
          s1: charlie_s1,
          s2: charlie_s2,
          s3: charlie_s3,
        } = serializeSignature(charlieSignature);

        await pxe.addCapsule([
          accounts.alice.getAddress(),
          accounts.bob.getAddress(),
          alice_s1,
          alice_s2,
          alice_s3,
          charlie_s1,
          charlie_s2,
          charlie_s3,
          Fr.fromString(numToHex(0)),
          Fr.fromString(numToHex(0)),
        ]);

        const call = contract.methods.orchestrator(gameIndex, 1n);
        await expect(call.simulate()).rejects.toThrowError(
          /Challenger signature could not be verified/
        );
      });
    });

    describe("Test normal gameplay over state channel", () => {
      test("Transaction should fail when opponent move signature is incorrect", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // mutate turn to make signature invalid
        const moves: RawMove[] = [{ row: 2, col: 0 }];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );
        const badSignature = turns[0].move.sign(accounts.charlie);
        turns[0].signatures.opponent = badSignature;

        // prepare capsules
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // add to capsule
        await accounts.alice.addCapsule(turnCapsules[0]);
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify opponent signature./
        );
      });

      test("Transaction should fail when sender move signature is incorrect", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // mutate turn to make signature invalid
        const moves: RawMove[] = [{ row: 2, col: 0 }];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );
        const badSignature = turns[0].move.sign(accounts.charlie);
        turns[0].signatures.sender = badSignature;

        // prepare capsules
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // add to capsule
        await accounts.alice.addCapsule(turnCapsules[0]);
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify sender signature./
        );
      });

      test("Transaction should fail when other coordinates than what were signed are provided", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // create turn
        const moves: RawMove[] = [{ row: 2, col: 0 }];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // prepare capsules
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // mutate capsule index 0 and 1 (row and col) to mismatch signature
        turnCapsules[0][0] = Fr.fromString(numToHex(1));
        turnCapsules[0][1] = Fr.fromString(numToHex(1));

        // add to capsule
        await accounts.alice.addCapsule(turnCapsules[0]);
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify sender signature./
        );
      });

      test("Moves should only be made by the registered host and player of the game", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns for alice and bob
        const moves: RawMove[] = [
          { row: 2, col: 0 },
          { row: 1, col: 0 },
          { row: 0, col: 0 },
          { row: 0, col: 1 },
        ];
        let turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // prepare a turn with charlie as sender
        const charlieTurn = prepareTurns(
          [{ row: 2, col: 2 }],
          gameIndex,
          accounts.charlie,
          accounts.bob,
          4
        );
        turns = charlieTurn.concat(turns);

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        await expect(call.simulate()).rejects.toThrowError(
          /Sender is not challenger or host./
        );
      });

      test("If a row index is out of bounds then the transaction should revert", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with row out of bound
        const moves: RawMove[] = [
          { row: 2, col: 0 },
          { row: 4, col: 1 },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        await expect(call.simulate()).rejects.toThrowError(
          /Coordinate out of bounds./
        );
      });

      test("If a column index is out of bounds then the transaction should revert", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with column out of bound
        const moves: RawMove[] = [{ row: 2, col: 5 }];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        await expect(call.simulate()).rejects.toThrowError(
          /Coordinate out of bounds./
        );
      });

      test("If a coordinate is already occupied then the transaction should revert", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns
        const moves: RawMove[] = [
          { row: 2, col: 2 },
          { row: 2, col: 2 },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        await expect(call.simulate()).rejects.toThrowError(
          /Coordinate is already occupied./
        );
      });

      test("Player should be unable to make two turns in a row", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns normally
        const moves: RawMove[] = [
          { row: 0, col: 0 },
          { row: 1, col: 1 },
          { row: 0, col: 1 },
        ];
        let turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );
        // prepare an additional turn where alice attempts to go again, even with bob's consent
        let doubleTurn = prepareTurns(
          [{ row: 0, col: 2 }],
          gameIndex,
          accounts.bob,
          accounts.alice,
          3
        );
        // goes at start (end of stack) since capsules are FIFO
        turns = doubleTurn.concat(turns);

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        // would be "Only host can move" if bob tried to go
        await expect(call.simulate()).rejects.toThrowError(
          /Only challenger can move./
        );
      });

      test("Reordered moves should cause signature verification to fail", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // create turns
        const moves = [
          { row: 0, col: 0 },
          { row: 1, col: 1 },
          { row: 0, col: 1 },
          { row: 2, col: 2 },
          { row: 0, col: 2 },
        ];
        let turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // reorder turns so bob's first move is now his second
        const temp = turns[3];
        turns[3] = turns[1];
        turns[1] = temp;

        // encapsulate turn
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify sender signature./
        );
      });

      test("Play a game until won", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // create turns
        const moves: RawMove[] = [
          { row: 0, col: 0 },
          { row: 1, col: 1 },
          { row: 0, col: 1 },
          { row: 2, col: 2 },
          { row: 0, col: 2 },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();
        const game = await contract.methods.get_game(gameIndex).view();

        // ensure game outcome
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Subsequent move on won game should revert", async () => {
        // decrement game index to play on last game
        gameIndex--;
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // create turn
        const turns = prepareTurns(
          [{ row: 1, col: 2 }],
          gameIndex,
          accounts.alice,
          accounts.bob,
          5
        );

        // encapsulate turn
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsule
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }

        const call = contract.methods.orchestrator(gameIndex, turns.length);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });

      test("Play game to draw", async () => {
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // create turns
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1 },
          { row: 1, col: 0 },
          { row: 1, col: 2 },
          { row: 2, col: 1 },
          { row: 2, col: 0 },
          { row: 2, col: 2 },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob,
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        const game = await contract.methods.get_game(gameIndex).view();
        // ensure game outcome
        expect(game.winner.inner).toEqual(0n);
        expect(game.over).toEqual(true);
      });

      test("Subsequent move on game with draw should revert", async () => {
        // decrement game index to play on last game
        gameIndex--;
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // create turn
        const turn = prepareTurns(
          [{ row: 2, col: 0 }],
          gameIndex,
          accounts.alice,
          accounts.bob,
          9
        )[0];

        // encapsulate turn
        const turnCapsule = encapsulateTurn(turn);

        // add capsule
        await accounts.alice.addCapsule(turnCapsule);

        const call = contract.methods.orchestrator(gameIndex, 1);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });
    });

    describe("Test timeout", () => {
      test("External timeout trigger function should revert if it is called on a nonexistent game", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // attempt to trigger timeout on a game that does not exist
        const call = contract.methods.trigger_timeout(gameIndex + 1337n);
        await expect(call.simulate()).rejects.toThrowError(
          /Game does not exist./
        );
      });

      test("If no timeout is triggered then a missing opponent signature should revert", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns normally
        const moves = [
          { row: 0, col: 0 },
          { row: 2, col: 0 },
          { row: 2, col: 1 },
          { row: 2, col: 2 },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // remove opponent (alice) signature from last move
        turnCapsules[3][6] = Fr.ZERO;
        turnCapsules[3][7] = Fr.ZERO;
        turnCapsules[3][8] = Fr.ZERO;

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // try to call the orchestrator without a timeout but missing opponent signature
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );

        const call = contract.methods.orchestrator(gameIndex, moves.length + 1);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify opponent signature./
        );
      });

      test("Trigger timeout should fail if player is not a participant in game", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns where bob initiates timeout
        const moves = [
          { row: 0, col: 2 },
          { row: 0, col: 0 },
          { row: 1, col: 2 },
          { row: 0, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // post current state to contract and trigger timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // Answer timeout as Alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods.answer_timeout(gameIndex, 1, 1).send().wait();

        // Attempt to trigger timeout as charlie (non participant)
        // honestly would probably fail because they don't have the note when pxe's are siloed but added guard
        const charlieContract = await TicTacToeContract.at(
          contractAddress,
          accounts.charlie
        );

        const call = charlieContract.methods.trigger_timeout(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /You must be in the game to trigger a timeout./
        );
      });

      test("Cannot trigger timeout if sender's turn", async () => {
        // multiple timeouts in this test is done to "easily" provide the state where a sender
        // can try to trigger a timeout even though it is their turn

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with bob initiating timeout
        const moves = [
          { row: 0, col: 2 },
          { row: 0, col: 0 },
          { row: 1, col: 2 },
          { row: 0, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // trigger timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );

        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // Answer timeout as Alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods.answer_timeout(gameIndex, 1, 1).send().wait();

        // attempt to trigger timeout as bob again even though it is bob's turn
        contract = await TicTacToeContract.at(contractAddress, accounts.bob);

        const call = contract.methods.trigger_timeout(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Must be opponent's turn to trigger timeout./
        );
      });

      test("Trigger timeout and confirm it to be set at note hash", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turn with timeout
        const turns = prepareTurns(
          [{ row: 1, col: 1, timeout: true }],
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turn
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex, turns.length + 1).send().wait();

        // ensure timeout has been initiated
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);
      });

      test("Transaction should revert if timestamp window has not concluded", async () => {
        // target the same gameIndex as previous test
        gameIndex--;

        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // try to claim timeout win before timeout window has passed
        const call = contract.methods.claim_timeout_win(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Player can still answer timeout./
        );
      });

      test("Alice should be able to claim game win now that timeout window has passed", async () => {
        // target same gameIndex as previous tests
        gameIndex--;
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // get the content hash of the board state
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();

        // warp the testing environment 10 minutes to pass timeout window
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        await cc.aztec.warp(Number(timestamp) + 600);

        // claim a timeout win outside of the state channel
        await contract.methods.claim_timeout_win(gameIndex).send().wait();

        // verify the game outcome
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toBe(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Trigger timeout should revert if a game is over", async () => {
        // target same gameIndex as previous tests
        gameIndex--;
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // try to trigger timeout on a game that has already ended
        const call = contract.methods.trigger_timeout(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });

      test("Answered timeout should update state to next turn", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with timeout
        const moves: RawMove[] = [
          { row: 0, col: 0 },
          { row: 2, col: 0 },
          { row: 2, col: 1 },
          { row: 2, col: 2, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turn
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // Confirm that timeout has been triggered
        let noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        let timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);

        // answer timeout and confirm state has been updated
        await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.turn).toEqual(5n);

        // confirm that timeout is no longer active
        noteHash = await contract.methods.get_game_note_hash(gameIndex).view();
        timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).toEqual(0n);
      });

      test("Win should not be claimmable after timeout is answered", async () => {
        // target same gameIndex as previous tests
        gameIndex--;
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // try to claim timeout win even though timeout has been rationally resolved
        const call = contract.methods.claim_timeout_win(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Invactive timeout./
        );
      });

      test("Updated state in answer timeout function should result in a game winner in some cases", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with timeout, where last move is a timeout
        const moves = [
          { row: 0, col: 0 },
          { row: 2, col: 0 },
          { row: 0, col: 1 },
          { row: 2, col: 1 },
          { row: 1, col: 0, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const move of turnCapsules) {
          await accounts.alice.addCapsule(move);
        }
        await accounts.alice.addCapsule(openChannelCapsule);

        // post a game-winning timeout that doesn't actually end the game
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // bob answers timeout and forces a win. their move is discarded
        // if they don't answer, they'll just lose anyways
        const bobContract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await bobContract.methods.answer_timeout(gameIndex, 2, 2).send().wait();

        // Confirm that timeout has been triggered
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toEqual(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
      });

      test("When timeout is answered then game should be playable again to conclusion", async () => {
        /// PRE TIMEOUT ///
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with timeout initiated by bob
        let moves = [
          { row: 0, col: 0 },
          { row: 2, col: 0 },
          { row: 2, col: 1 },
          { row: 2, col: 2, timeout: true },
        ];
        let turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        let turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const move of turnCapsules) {
          await accounts.bob.addCapsule(move);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // post state so far and initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );

        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // Confirm that timeout has been initiated
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);

        // answer the timeout as alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.turn).toEqual(5n);

        /// POST TIMEOUT ///
        // prepare turns to finish the game where alice wins
        moves = [
          { row: 1, col: 2 },
          { row: 1, col: 0 },
          { row: 0, col: 2 },
        ];
        let turnIndex = turns.length + 1; // + 1 to account for move made out of channel answering
        turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob,
          turnIndex
        );

        // encapsulate turns
        turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }

        // finalize game as alice
        await contract.methods.orchestrator(gameIndex, moves.length).send().wait();

        // Confirm that game has been won
        const boardUpdated = await contract.methods.get_board(gameIndex).view();
        expect(boardUpdated.over).toEqual(true);
        const gameUpdated = await contract.methods.get_game(gameIndex).view();
        expect(gameUpdated.winner.inner).toEqual(
          accounts.bob.getAddress().toBigInt()
        );
      });

      test("Manual timeout should be triggerable following answer to timeout triggered within open channel", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare turns with bob initiating timeout
        const moves = [
          { row: 0, col: 2 },
          { row: 0, col: 0 },
          { row: 1, col: 2 },
          { row: 0, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // trigger timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );

        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // Answer timeout as Alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods.answer_timeout(gameIndex, 1, 1).send().wait();

        await contract.methods.trigger_timeout(gameIndex).send().wait();

        // ensure that the timeout is active
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);
      });
    });

    // fraud case where a party produces signatures over two different state proposals for the same state increment
    // an honest actor can repeatedly send the same state proposal without punishment
    // fraud can be claimed simply with an open channel and two signatures over different state proposals; there is
    // no need to verify interstitial state when this occurs
    describe('"Double Spend" Fraud', () => {
      test("Cannot claim fraud if not channel participant", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.charlie
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );
        await accounts.alice.addCapsule(openChannelCapsule);

        // sign two different moves as bob
        const fraudulentTurnIndex = 1;
        const moves = [
          { row: 0, col: 1 },
          { row: 1, col: 0 },
        ].map(
          (move) =>
            new Move(
              accounts.bob.getAddress(),
              move.row,
              move.col,
              fraudulentTurnIndex,
              gameIndex
            )
        );
        const signatures = moves.map((move) => [
          ...new Uint8Array(move.sign(accounts.bob).toBuffer()),
        ]);

        const call = contract.methods.claim_fraud_win(
          gameIndex,
          fraudulentTurnIndex,
          [moves[0].row, moves[0].col],
          [moves[1].row, moves[1].col],
          signatures[0],
          signatures[1]
        );
        await expect(call.simulate()).rejects.toThrowError(
          /Sender is not host or challenger./
        );
      });

      test("Cannot claim fraud with signatures over different state increments", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );
        await accounts.bob.addCapsule(openChannelCapsule);

        // simulate normal construction of a state channel up to turn 3
        const moves = [
          { row: 0, col: 1 },
          { row: 1, col: 0 },
          { row: 1, col: 1 },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // get info used for fraud claim
        const claimedFraudMoves = [turns[0].move, turns[2].move];
        const signatures = [
          turns[0].signatures.sender,
          turns[2].signatures.sender,
        ].map((move) => [...new Uint8Array(move.toBuffer())]);

        // attempt to claim fraud as alice using two normal moves from bob
        const call = contract.methods.claim_fraud_win(
          gameIndex,
          claimedFraudMoves[0].turnIndex,
          [claimedFraudMoves[0].row, claimedFraudMoves[0].col],
          [claimedFraudMoves[1].row, claimedFraudMoves[1].col],
          signatures[0],
          signatures[1]
        );
        await expect(call.simulate()).rejects.toThrowError(
          /One of the signatures provided was not valid./
        );
      });

      test("Fraud win cannot be claimed if the signatures have been generated by different accounts", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );
        await accounts.alice.addCapsule(openChannelCapsule);

        // build a move for bob
        const bobMove = new Move(accounts.bob.getAddress(), 0, 1, 1, gameIndex);
        const bobSignature = [
          ...new Uint8Array(bobMove.sign(accounts.bob).toBuffer()),
        ];

        // build a different move on same turn index for charlie
        const charlieMove = new Move(
          accounts.charlie.getAddress(),
          1,
          0,
          1,
          gameIndex
        );
        const charlieSignature = [
          ...new Uint8Array(charlieMove.sign(accounts.charlie).toBuffer()),
        ];

        // attempt to claim fraud with signatures from different accounts
        const call = contract.methods.claim_fraud_win(
          gameIndex,
          1,
          [bobMove.row, bobMove.col],
          [charlieMove.row, charlieMove.col],
          bobSignature,
          charlieSignature
        );
        await expect(call.simulate()).rejects.toThrowError(
          /One of the signatures provided was not valid./
        );
      });

      test("Cannot call fraud on self", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );
        await accounts.alice.addCapsule(openChannelCapsule);

        // sign two different moves as bob
        const fraudulentTurnIndex = 1;
        const moves = [
          { row: 0, col: 1 },
          { row: 1, col: 0 },
        ].map(
          (move) =>
            new Move(
              accounts.bob.getAddress(),
              move.row,
              move.col,
              fraudulentTurnIndex,
              gameIndex
            )
        );
        const signatures = moves.map((move) => [
          ...new Uint8Array(move.sign(accounts.bob).toBuffer()),
        ]);

        // try to claim fraud on self
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        const call = contract.methods.claim_fraud_win(
          gameIndex,
          fraudulentTurnIndex,
          [moves[0].row, moves[0].col],
          [moves[1].row, moves[1].col],
          signatures[0],
          signatures[1]
        );
        await expect(call.simulate()).rejects.toThrowError(
          /One of the signatures provided was not valid./
        );
      });

      test("Proof of dual signatures for the same turn signed by the same party will result in game win be awarded to victim", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );
        await accounts.alice.addCapsule(openChannelCapsule);

        // sign two different moves as bob
        const fraudulentTurnIndex = 1;
        const moves = [
          { row: 0, col: 1 },
          { row: 1, col: 0 },
        ].map(
          (move) =>
            new Move(
              accounts.bob.getAddress(),
              move.row,
              move.col,
              fraudulentTurnIndex,
              gameIndex
            )
        );
        const signatures = moves.map((move) => [
          ...new Uint8Array(move.sign(accounts.bob).toBuffer()),
        ]);

        // successfully prove "double spend" fraud
        await contract.methods
          .claim_fraud_win(
            gameIndex,
            fraudulentTurnIndex,
            [moves[0].row, moves[0].col],
            [moves[1].row, moves[1].col],
            signatures[0],
            signatures[1]
          )
          .send()
          .wait();

        // verify game outcome
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toEqual(true);

        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Moves submitted upon fraud win will revert now that game has eneded", async () => {
        // decrement game index to target last game
        gameIndex--;

        // prepare turns
        const moves: RawMove[] = [
          { row: 0, col: 0 },
          { row: 1, col: 0, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.alice.addCapsule(turn);
        }

        // attempt to continue game after fraud win has been claimed
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );
        const call = contract.methods.orchestrator(gameIndex, moves.length);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });
    });

    // fraud case where a party tries to timeout while counterparty can prove state has already advanced past that state increment
    // in practice, this is somewhat similar to the "double spend" fraud case, but the counterparty may not have access to signature
    // over a different move used in the timeout or the timeout could be the same move
    describe("Test fraudulent timeout dispute", () => {
      test("Transaction should revert if game does not exists", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );

        // attempt to dispute a timeout on a game that does not exist
        const call = contract.methods.dispute_timeout(
          gameIndex + 100n,
          0,
          [0, 0],
          [...new Uint8Array(64)]
        );
        await expect(call.simulate()).rejects.toThrowError(
          /Game does not exist./
        );
      });

      test("Timeout cannot be disputed with a signature over a turn earlier than the turn the timeout was triggered", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare moves with a timeout triggered by bob
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // attempt to dispute a timeout with an earlier turn as alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        const signature = [...turns[1].signatures.sender.toBuffer()];
        const call = contract.methods.dispute_timeout(
          gameIndex,
          2,
          [moves[2].row, moves[2].col],
          signature
        );
        await expect(call.simulate()).rejects.toThrowError(
          /Cannot dispute a timeout with a turn prior to turn it was triggered on./
        );
      });

      test("Timeout cannot be disputed with a signature signed by an unrelated party", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare moves with a timeout triggered by bob
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // create a random later move by bob signed by charlie
        let move = new Move(accounts.bob.getAddress(), 2, 2, 5, gameIndex);
        let signature = [
          ...new Uint8Array(move.sign(accounts.charlie).toBuffer()),
        ];

        // attempt to claim fraud with a signature signed by an unrelated party as alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        const call = contract.methods.dispute_timeout(
          gameIndex,
          4,
          [move.row, move.col],
          signature
        );
        await expect(call.simulate()).rejects.toThrowError(
          /Invalid signature/
        );
      });

      test("Dispute on proof of different state increment for the same turn timeout was triggered on", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare moves with a timeout triggered by bob on turn #4
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();
        // make a signature on a different  move for turn 4 by bob
        // in practice a full channel would likely have been built to 5 when timeout triggered on 3
        const disputedTurnIndex = 3;
        const disputedMove = new Move(
          accounts.bob.getAddress(),
          2,
          2,
          disputedTurnIndex,
          gameIndex
        );
        const signature = [
          ...new Uint8Array(disputedMove.sign(accounts.bob).toBuffer()),
        ];

        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods
          .dispute_timeout(
            gameIndex,
            disputedTurnIndex,
            [disputedMove.row, disputedMove.col],
            signature
          )
          .send()
          .wait();

        // ensure the game has been won by alice
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toEqual(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Cannot dispute timeout on same state increment using same move signature as was used in timeout", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare moves with a timeout triggered by bob on turn #4
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // try to dispute a timeout with the same move / signature used in the timeout
        const disputedTurnIndex = 3;
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        const call = contract.methods.dispute_timeout(
          gameIndex,
          disputedTurnIndex,
          [moves[3].row, moves[3].col],
          [...new Uint8Array(turns[3].signatures.sender.toBuffer())]
        );
        await expect(call.simulate()).rejects.toThrowError(
          /Disputed move is the same as the timeout move./
        );
      });

      test("Dispute using counterparty signature on own move", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare moves with a timeout triggered by bob on turn #4
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // make a signature by bob on turn #5 made by alice
        const disputedTurnIndex = 4;
        const disputedMove = new Move(
          accounts.alice.getAddress(),
          2,
          2,
          disputedTurnIndex,
          gameIndex
        );
        const signature = [
          ...new Uint8Array(disputedMove.sign(accounts.bob).toBuffer()),
        ];

        // dispute a timeout as fraudulent as alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods
          .dispute_timeout(
            gameIndex,
            disputedTurnIndex,
            [disputedMove.row, disputedMove.col],
            signature
          )
          .send()
          .wait();

        // ensure the game has been won by alice
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Timeout should be disputed if player provides evidence that opponent has advanced state beyond current timeout turn", async () => {
        // prepare open channel
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // prepare moves with a timeout triggered by bob on turn #4
        const moves = [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 1, timeout: true },
        ];
        const turns = prepareTurns(
          moves,
          gameIndex,
          accounts.alice,
          accounts.bob
        );

        // encapsulate turns
        const turnCapsules = turns.map((turn) => encapsulateTurn(turn));

        // add capsules
        for (const turn of turnCapsules) {
          await accounts.bob.addCapsule(turn);
        }
        await accounts.bob.addCapsule(openChannelCapsule);

        // initiate a timeout as bob
        let contract = await TicTacToeContract.at(
          contractAddress,
          accounts.bob
        );
        await contract.methods.orchestrator(gameIndex, moves.length + 1).send().wait();

        // ensure that the timeout is active
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);

        // make a signature by bob on turn #6
        // in practice a full channel would likely have been built to 5 when timeout triggered on 3
        const disputedTurnIndex = 5;
        const disputedMove = new Move(
          accounts.bob.getAddress(),
          2,
          2,
          disputedTurnIndex,
          gameIndex
        );
        const signature = [
          ...new Uint8Array(disputedMove.sign(accounts.bob).toBuffer()),
        ];

        // dispute a timeout as fraudulent as alice
        contract = await TicTacToeContract.at(contractAddress, accounts.alice);
        await contract.methods
          .dispute_timeout(
            gameIndex,
            disputedTurnIndex,
            [disputedMove.row, disputedMove.col],
            signature
          )
          .send()
          .wait();

        // ensure the game has been won by alice
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toEqual(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );

        // ensure the timeout has been cleared
        const timestampAfterDispute = await contract.methods
          .get_timeout(noteHash)
          .view();
        expect(timestampAfterDispute).toEqual(0n);
      });
    });
  });

  xit("Can use nudge to advance block", async () => {
    // get contract
    let contract = await TicTacToeContract.at(contractAddress, accounts.alice);
    // get current block
    const timestampPre = await cc.eth.timestamp()
    await sleep(10000);
    const timestampPost = await cc.eth.timestamp()
    console.log("timestampPre", timestampPre);
    console.log("timestampPost", timestampPost);
    // nudge
    await contract.methods.nudge().send().wait();
    // get timestamp afterwards
    const timestampAfter = await cc.eth.timestamp()
    console.log("timestampAfter", timestampAfter);
  })
});
