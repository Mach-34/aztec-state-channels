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
    david: AccountWalletWithPrivateKey;
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
      david: await createAccount(pxe),
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

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Challenger signature could not be verified/
        );
      });
    });

    describe("Test gameplay over state channel", () => {
      test("Transaction should fail when opponent move signature is incorrect", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // mutate turn to make signature invalid
        let moves: RawMove[] = [{ row: 2, col: 0 }];
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
        console.log("turnCapsules", turnCapsules[0].length);
        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        console.log("Alice Address: ", accounts.alice.getAddress().toString());
        console.log("Bob Address: ", accounts.bob.getAddress().toString());
        for(let i = 0; i < turnCapsules[0].length; i++) {
          console.log(`Capsule index ${i}: `, turnCapsules[0][i].toString());
        }
        // add to capsule
        await accounts.alice.addCapsule(turnCapsules[0]);
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify opponent signature./
        );
      });

      xtest("Transaction should fail when sender move signature is incorrect", async () => {
        const contract = await TicTacToeContract.at(
          contractAddress,
          accounts.alice
        );

        // mutate turn to make signature invalid
        let moves: RawMove[] = [{ row: 2, col: 0 }];
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
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify sender signature./
        );
      });

      // xtest("Transaction should fail when other coordinates than what were signed are provided", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );
      //   // Create dummy move to pop capsule once
      //   const prepared = prepareMoves(gameIndex, [
      //     { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //   ]);

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   prepared[0][0] = Fr.fromString(numToHex(1));
      //   prepared[0][1] = Fr.fromString(numToHex(1));

      //   await pxe.addCapsule(prepared[0]);
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Could not verify sender signature./
      //   );
      // });

      // xtest("Moves should only be made by the registered host and player of the game", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 1, col: 0, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 2, col: 2, sender: accounts.charlie, opponent: accounts.bob },
      //   ];

      //   const prepared = prepareMoves(gameIndex, moves);

      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Sender is not challenger or host./
      //   );
      // });

      // xtest("If a row index is out of bounds then the transaction should revert", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 4, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //   ];

      //   const prepared = prepareMoves(gameIndex, moves);
      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Coordinate out of bounds./
      //   );
      // });

      // xtest("If a column index is out of bounds then the transaction should revert", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [{ row: 2, col: 5, sender: accounts.alice, opponent: accounts.bob }];

      //   const prepared = prepareMoves(gameIndex, moves);

      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Coordinate out of bounds./
      //   );
      // });

      // xtest("If a coordinate is already occupied then the transaction should revert", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 2, col: 2, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
      //   ];

      //   const prepared = prepareMoves(gameIndex, moves);

      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Coordinate is already occupied./
      //   );
      // });

      // xtest("Player should be unable to make two turns in a row", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
      //   ];

      //   const prepared = prepareMoves(gameIndex, moves);

      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Only challenger can move./
      //   );
      // });

      // xtest("Reordered moves should cause signature verification to fail", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
      //   ];

      //   const prepared = prepareMoves(gameIndex, moves);

      //   // Switch Bob's first move with his second
      //   const temp = prepared[3];
      //   prepared[3] = prepared[1];
      //   prepared[1] = temp;

      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(
      //     /Could not verify sender signature./
      //   );
      // });

      // xtest("Play a game until won", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );
      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
      //   ];
      //   const prepared = prepareMoves(gameIndex, moves);
      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   await contract.methods.orchestrator(gameIndex).send().wait();
      //   const game = await contract.methods.get_game(gameIndex).view();
      //   expect(game.winner.inner).toEqual(
      //     accounts.alice.getAddress().toBigInt()
      //   );
      // });

      // xtest("Subsequent move on won game should revert", async () => {
      //   gameIndex--;
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const moves = [{ row: 1, col: 2, sender: accounts.bob, opponent: accounts.alice }];

      //   const prepared = prepareMoves(gameIndex, moves);
      //   await pxe.addCapsule(prepared[0]);

      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      // });

      // xtest("Play game to draw", async () => {
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );

      //   const openChannelCapsule = prepareOpenChannel(
      //     accounts.alice,
      //     accounts.bob
      //   );

      //   const moves = [
      //     { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 1, col: 0, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 1, col: 2, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
      //     { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
      //     { row: 2, col: 2, sender: accounts.alice, opponent: accounts.bob },
      //   ];
      //   const prepared = prepareMoves(gameIndex, moves);
      //   for (const move of prepared) {
      //     await pxe.addCapsule(move);
      //   }
      //   await pxe.addCapsule(openChannelCapsule);

      //   await contract.methods.orchestrator(gameIndex).send().wait();
      //   const game = await contract.methods.get_game(gameIndex).view();
      //   expect(game.winner.inner).toEqual(0n);
      //   expect(game.over).toEqual(true);
      // });

      // xtest("Subsequent move on game with draw should revert", async () => {
      //   gameIndex--;
      //   const contract = await TicTacToeContract.at(
      //     contractAddress,
      //     accounts.alice
      //   );
      //   const moves = [{ row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice }];
      //   const prepared = prepareMoves(gameIndex, moves);
      //   await pxe.addCapsule(prepared[0]);
      //   const call = contract.methods.orchestrator(gameIndex);
      //   await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      // });
    });

    // describe("Test timeout in case of no return move", () => {
    //   test("Trigger timeout and confirm it to be set at note hash", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );
    //     const moves = [
    //       { row: 1, col: 1, sender: accounts.alice, opponent: accounts.bob, timeout: true },
    //     ];

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const prepared = prepareMoves(gameIndex, moves);
    //     await pxe.addCapsule(prepared[0]);
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);
    //   });

    //   test("Transaction should revert if timestamp window has not concluded", async () => {
    //     gameIndex--;
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );
    //     const call = contract.methods.claim_timeout_win(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Player can still answer timeout./
    //     );
    //   });

    //   test("Alice should be able to claim game win now that timeout window has passed", async () => {
    //     gameIndex--;
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );
    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     await cc.aztec.warp(Number(timestamp) + 600);
    //     await contract.methods.claim_timeout_win(gameIndex).send().wait();
    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.over).toBe(true);
    //     const game = await contract.methods.get_game(gameIndex).view();
    //     expect(game.winner.inner).toEqual(
    //       accounts.alice.getAddress().toBigInt()
    //     );
    //   });

    //   test("Answered timeout should update state to next turn", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Confirm that timeout has been triggered
    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);
    //     await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();
    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.turn).toEqual(5n);
    //   });

    //   test("Win should not be claimmable after timeout is answered", async () => {
    //     gameIndex--;
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );
    //     const call = contract.methods.claim_timeout_win(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Invactive timeout./
    //     );
    //   });

    //   test("Updated state in answer timeout function should result in a game winner in some cases", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 1, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 1, col: 0, sender: accounts.alice, opponent: accounts.bob, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const bobContract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.bob
    //     );
    //     await bobContract.methods
    //       .answer_timeout(gameIndex, 2, 2)
    //       .send()
    //       .wait();
    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.over).toEqual(true);
    //     const game = await contract.methods.get_game(gameIndex).view();
    //     expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
    //   });

    //   test("When timeout is answered then game should be playable again to conclusion", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Confirm that timeout has been triggered
    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);
    //     await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();
    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.turn).toEqual(5n);

    //     const moves2 = [
    //       { row: 1, col: 2, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 1, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 2, sender: accounts.bob, opponent: accounts.alice },
    //     ];

    //     const prepared2 = prepareMoves(gameIndex, moves2, moves.length + 1);
    //     for (const move of prepared2) {
    //       await pxe.addCapsule(move);
    //     }

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const boardUpdated = await contract.methods.get_board(gameIndex).view();
    //     expect(boardUpdated.over).toEqual(true);
    //     const gameUpdated = await contract.methods.get_game(gameIndex).view();
    //     expect(gameUpdated.winner.inner).toEqual(
    //       accounts.bob.getAddress().toBigInt()
    //     );
    //   });
    // });

    // describe("Test timeout in case of no counter party signature", () => {
    //   test("If no timeout is triggered then a missing opponent signature should revert", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);

    //     // Remove Alice's signature from fourth move
    //     prepared[3][6] = Fr.fromString(numToHex(0));
    //     prepared[3][7] = Fr.fromString(numToHex(0));
    //     prepared[3][8] = Fr.fromString(numToHex(0));

    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     const call = contract.methods.orchestrator(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Could not verify opponent signature./
    //     );
    //   });

    //   test("Timeout should be triggerable with a missing opponent signature", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);

    //     // Remove Alice's signature from fourth move
    //     prepared[0][6] = Fr.fromString(numToHex(0));
    //     prepared[0][7] = Fr.fromString(numToHex(0));
    //     prepared[0][8] = Fr.fromString(numToHex(0));

    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Confirm that timeout has been triggered
    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);
    //   })

    //   test("Timeout from missing opponent signature on winning move should result in win when timeout is answered", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);

    //     // Remove Bob's signature from fifth move
    //     prepared[0][6] = Fr.fromString(numToHex(0));
    //     prepared[0][7] = Fr.fromString(numToHex(0));
    //     prepared[0][8] = Fr.fromString(numToHex(0));

    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Confirm that timeout has been triggered
    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);

    //     const bobContract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.bob
    //     );

    //     await bobContract.methods.answer_timeout(gameIndex, 2, 1).send().wait();

    //     // Game should now be over and Alice set as the winner
    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.over).toEqual(true);
    //     expect(board.turn).toEqual(5n);
    //     const game = await contract.methods.get_game(gameIndex).view();
    //     expect(game.winner.inner).toEqual(
    //       accounts.alice.getAddress().toBigInt()
    //     );
    //   })
    // });

    // describe("Test timeout triggered manually after dispute", () => {
    //   test("External timeout trigger function should revert if it is called on a nonexistent game", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const call = contract.methods.trigger_timeout(gameIndex + 10n);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Game does not exist./
    //     );
    //   });

    //   test("Trigger timeout should revert if a game is over", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 1, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 2, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //     ];
    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const call = contract.methods.trigger_timeout(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Game has ended./
    //     );
    //   });

    //   test("Trigger timeout should fail if player is not a participant in game", async () => {

    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 1, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];
    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Answer timeout as Alice
    //     await contract.methods.answer_timeout(gameIndex, 1, 1).send().wait();

    //     const charlieContract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.charlie
    //     );

    //     const call = charlieContract.methods.trigger_timeout(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /You must be in the game to trigger a timeout./
    //     );
    //   });

    //   test("Trigger timeout should fail if it is the trigger's turn", async () => {

    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 1, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];
    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Answer timeout as Alice
    //     await contract.methods.answer_timeout(gameIndex, 1, 1).send().wait();

    //     const bobContract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.bob
    //     );

    //     const call = bobContract.methods.trigger_timeout(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Must be opponent's turn to trigger timeout./
    //     );
    //   });

    //   test("Trigger timeout should fail if it is the trigger's turn", async () => {

    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 0, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 1, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];
    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     // Answer timeout as Alice
    //     await contract.methods.answer_timeout(gameIndex, 1, 1).send().wait();

    //     await contract.methods.trigger_timeout(gameIndex).send().wait();

    //     // Confirm timeout has been triggered
    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);

    //     // Answer as bob
    //     const bobContract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.bob
    //     );
    //     await bobContract.methods.answer_timeout(gameIndex, 2, 1).send().wait();

    //     // Confirm timeout is no longer set
    //     const timestampUpdated = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestampUpdated).toEqual(0n);
    //   });
    // });

    // describe("Test fraud claim in case of two moves made for the same turn", () => {
    //   test("Signatures must be from same to turn for fraud win to be claimed", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.charlie
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const bobAddress = accounts.bob.getAddress();
    //     const bobPrivkey = accounts.bob.getEncryptionPrivateKey();
    //     // Sign two seperate moves for the same turn as bob
    //     const firstMove = { row: 0, col: 1 };
    //     const secondMove = { row: 1, col: 0 };

    //     const { s1: first_s1, s2: first_s2, s3: first_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       firstMove.row,
    //       firstMove.col,
    //       bobPrivkey
    //     );
    //     const firstSignature = deserializeMoveSignature(first_s1.toBigInt(), first_s2.toBigInt(), first_s3.toBigInt());

    //     const { s1: second_s1, s2: second_s2, s3: second_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       firstMove.row,
    //       firstMove.col,
    //       bobPrivkey
    //     );

    //     const secondSignature = deserializeMoveSignature(second_s1.toBigInt(), second_s2.toBigInt(), second_s3.toBigInt());

    //     await pxe.addCapsule(openChannelCapsule);

    //     const call = contract.methods.claim_fraud_win(
    //       gameIndex,
    //       1,
    //       [firstMove.row, firstMove.col],
    //       [secondMove.row, secondMove.col],
    //       firstSignature,
    //       secondSignature
    //     );
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Sender is not host or challenger./
    //     );
    //   });

    //   test("Fraud win cannot be claimed with one of the signatures being from a different turn", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const bobAddress = accounts.bob.getAddress();
    //     const bobPrivkey = accounts.bob.getEncryptionPrivateKey();
    //     // Sign two seperate moves for the same turn as bob
    //     const firstMove = { row: 0, col: 1 };
    //     const secondMove = { row: 1, col: 0 };

    //     const { s1: first_s1, s2: first_s2, s3: first_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       firstMove.row,
    //       firstMove.col,
    //       bobPrivkey
    //     );
    //     const firstSignature = deserializeMoveSignature(first_s1.toBigInt(), first_s2.toBigInt(), first_s3.toBigInt());

    //     const { s1: second_s1, s2: second_s2, s3: second_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       3,
    //       firstMove.row,
    //       firstMove.col,
    //       bobPrivkey
    //     );

    //     const secondSignature = deserializeMoveSignature(second_s1.toBigInt(), second_s2.toBigInt(), second_s3.toBigInt());

    //     await pxe.addCapsule(openChannelCapsule);

    //     const call = contract.methods.claim_fraud_win(
    //       gameIndex,
    //       1,
    //       [firstMove.row, firstMove.col],
    //       [secondMove.row, secondMove.col],
    //       firstSignature,
    //       secondSignature
    //     );
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /One of the signatures provided was not valid./
    //     );
    //   });

    //   test("Fraud win cannot be claimed if the signatures have been generated by different accounts", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const alicePrivkey = accounts.alice.getEncryptionPrivateKey();
    //     const bobAddress = accounts.bob.getAddress();
    //     const bobPrivkey = accounts.bob.getEncryptionPrivateKey();
    //     // Sign two seperate moves for the same turn as bob
    //     const firstMove = { row: 0, col: 1 };
    //     const secondMove = { row: 1, col: 0 };

    //     const { s1: first_s1, s2: first_s2, s3: first_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       firstMove.row,
    //       firstMove.col,
    //       bobPrivkey
    //     );
    //     const firstSignature = deserializeMoveSignature(first_s1.toBigInt(), first_s2.toBigInt(), first_s3.toBigInt());

    //     const { s1: second_s1, s2: second_s2, s3: second_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       firstMove.row,
    //       firstMove.col,
    //       alicePrivkey
    //     );

    //     const secondSignature = deserializeMoveSignature(second_s1.toBigInt(), second_s2.toBigInt(), second_s3.toBigInt());

    //     await pxe.addCapsule(openChannelCapsule);

    //     const call = contract.methods.claim_fraud_win(
    //       gameIndex,
    //       1,
    //       [firstMove.row, firstMove.col],
    //       [secondMove.row, secondMove.col],
    //       firstSignature,
    //       secondSignature
    //     );
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /One of the signatures provided was not valid./
    //     );
    //   });

    //   test("Proof of dual signatures for the same turn signed by the same party will result in game win be awarded to victim", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const bobAddress = accounts.bob.getAddress();
    //     const bobPrivkey = accounts.bob.getEncryptionPrivateKey();
    //     // Sign two seperate moves for the same turn as bob
    //     const firstMove = { row: 0, col: 1 };
    //     const secondMove = { row: 1, col: 0 };

    //     const { s1: first_s1, s2: first_s2, s3: first_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       firstMove.row,
    //       firstMove.col,
    //       bobPrivkey
    //     );
    //     const firstSignature = deserializeMoveSignature(first_s1.toBigInt(), first_s2.toBigInt(), first_s3.toBigInt());

    //     const { s1: second_s1, s2: second_s2, s3: second_s3 } = genSerializedMoveSignature(
    //       bobAddress,
    //       gameIndex,
    //       1,
    //       secondMove.row,
    //       secondMove.col,
    //       bobPrivkey
    //     );

    //     const secondSignature = deserializeMoveSignature(second_s1.toBigInt(), second_s2.toBigInt(), second_s3.toBigInt());

    //     await pxe.addCapsule(openChannelCapsule);

    //     await contract.methods.claim_fraud_win(
    //       gameIndex,
    //       1,
    //       [firstMove.row, firstMove.col],
    //       [secondMove.row, secondMove.col],
    //       firstSignature,
    //       secondSignature
    //     ).send().wait();

    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.over).toEqual(true);

    //     const game = await contract.methods.get_game(gameIndex).view();
    //     expect(game.winner.inner).toEqual(
    //       accounts.alice.getAddress().toBigInt()
    //     );
    //   });

    //   test("Moves submitted upon fraud win will revert now that game has eneded", async () => {
    //     gameIndex--;
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 1, col: 0, sender: accounts.bob, opponent: accounts.alice, timeout: true }
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }

    //     const call = contract.methods.orchestrator(gameIndex);
    //     await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
    //   });
    // });

    // describe("Test fraudulent timeout dispute", () => {
    //   test("Transaction should revert if game does not exists", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.bob
    //     );

    //     const call = contract.methods.dispute_timeout(gameIndex + 100n, 0, new Uint8Array(64), accounts.alice.getAddress(), [0, 0]);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Game does not exist./
    //     );
    //   });

    //   test("Timeout cannot be disputed with a signature over a turn earlier than the turn the timeout was triggered", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     const signature = deserializeMoveSignature(
    //       prepared[2][3].toBigInt(),
    //       prepared[2][4].toBigInt(),
    //       prepared[2][5].toBigInt()
    //     );

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const call = contract.methods.dispute_timeout(gameIndex, 2, signature, accounts.alice.getAddress(), [moves[2].row, moves[2].col]);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Cannot dispute a timeout with a turn prior to turn it was triggered on./
    //     );
    //   });

    //   test("Timeout cannot be disputed with a signature signed by an unrelated party", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     const nextMove = { row: 2, col: 2 };

    //     const { s1, s2, s3 } = genSerializedMoveSignature(
    //       accounts.alice.getAddress(),
    //       gameIndex,
    //       4,
    //       nextMove.row,
    //       nextMove.col,
    //       accounts.charlie.getEncryptionPrivateKey()
    //     );

    //     const signature = deserializeMoveSignature(s1.toBigInt(), s2.toBigInt(), s3.toBigInt());

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const call = contract.methods.dispute_timeout(gameIndex, 4, signature, accounts.alice.getAddress(), [nextMove.row, nextMove.col]);
    //     await expect(call.simulate()).rejects.toThrowError(
    //       /Invalid signature./
    //     );
    //   });

    //   test("Timeout should be disputed if player provides evidence that opponent has advanced state beyond current timeout turn", async () => {
    //     const contract = await TicTacToeContract.at(
    //       contractAddress,
    //       accounts.alice
    //     );

    //     const openChannelCapsule = prepareOpenChannel(
    //       accounts.alice,
    //       accounts.bob
    //     );

    //     const moves = [
    //       { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
    //       { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    //       { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice, timeout: true },
    //     ];

    //     const prepared = prepareMoves(gameIndex, moves);
    //     for (const move of prepared) {
    //       await pxe.addCapsule(move);
    //     }
    //     await pxe.addCapsule(openChannelCapsule);

    //     const nextMove = { row: 2, col: 2 };

    //     const { s1, s2, s3 } = genSerializedMoveSignature(
    //       accounts.alice.getAddress(),
    //       gameIndex,
    //       4,
    //       nextMove.row,
    //       nextMove.col,
    //       accounts.bob.getEncryptionPrivateKey()
    //     );

    //     const signature = deserializeMoveSignature(s1.toBigInt(), s2.toBigInt(), s3.toBigInt());

    //     await contract.methods.orchestrator(gameIndex).send().wait();

    //     const noteHash = await contract.methods
    //       .get_game_note_hash(gameIndex)
    //       .view();
    //     const timestamp = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestamp).not.toEqual(0n);

    //     await contract.methods.dispute_timeout(gameIndex, 4, signature, accounts.alice.getAddress(), [nextMove.row, nextMove.col]).send().wait();

    //     const board = await contract.methods.get_board(gameIndex).view();
    //     expect(board.over).toEqual(true);
    //     const game = await contract.methods.get_game(gameIndex).view();
    //     expect(game.winner.inner).toEqual(
    //       accounts.alice.getAddress().toBigInt()
    //     );
    //     const timestampAfterDispute = await contract.methods.get_timeout(noteHash).view();
    //     expect(timestampAfterDispute).toEqual(0n);
    //   });

    //   xtest("Transaction following dispute should revert", async () => {
    //     // TODO
    //   })
    // })
  });
});
