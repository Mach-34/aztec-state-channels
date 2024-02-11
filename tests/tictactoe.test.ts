import { describe, expect, jest } from "@jest/globals";
import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  CheatCodes,
  Contract,
  createDebugLogger,
  createPXEClient,
  DebugLogger,
  Fr,
  PXE,
} from "@aztec/aztec.js";
import { createAccount } from "@aztec/accounts/testing";
import { TicTacToeContractArtifact } from "../src/artifacts/TicTacToe.js";
import { emptyCapsuleStack, numToHex, signSchnorr } from "../src/utils.js";
import {
  genSerializedMoveSignature,
  prepareMoves,
  prepareOpenChannel,
  serializeSignature,
} from "./utils/index.js";
import { FunctionSelector } from "@aztec/aztec.js";
const {
  ETH_RPC_URL = "http://localhost:8545",
  PXE_URL = "http://localhost:8080",
} = process.env;

xdescribe("Tic Tac Toe", () => {
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
    logger = createDebugLogger("tictactoe");

    pxe = await createPXEClient(PXE_URL);

    cc = await CheatCodes.create(ETH_RPC_URL, pxe);

    accounts = {
      alice: await createAccount(pxe),
      bob: await createAccount(pxe),
      charlie: await createAccount(pxe),
      david: await createAccount(pxe),
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

  xtest("Test two move signatures", async () => {
    const contract = await Contract.at(
      contractAddress,
      TicTacToeContractArtifact,
      accounts.alice
    );

    const openChannelCapsule = prepareOpenChannel(
      accounts.alice,
      accounts.bob
    );

    const moves = [
      { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
      { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
      { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
      { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
      { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
    ];
    const prepared = prepareMoves(gameIndex, moves);
    for (const move of prepared) {
      await pxe.addCapsule(move);
    }
    await pxe.addCapsule(openChannelCapsule);

    await contract.methods.orchestrator(gameIndex).send().wait();
  });

  describe("Test state channel over orchestrator function", () => {
    afterEach(async () => {
      gameIndex++;
    });

    beforeEach(async () => {
      const contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );
      try {
        await emptyCapsuleStack(contract);
      } catch (err) { }
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

        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
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
          Fr.fromString(numToHex(0))
        ]);

        const call = contract.methods.orchestrator(
          aliceAddress,
          bobAddress,
          aliceSignature,
          charlieSignature,
          gameIndex
        );
        await expect(call.simulate()).rejects.toThrowError(
          /Challenger signature could not be verified/
        );
      });
    });

    describe("Test gameplay over state channel", () => {
      test("Transaction should fail when opponent move signature is incorrect", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        // Create dummy move to pop capsule once
        const prepared = prepareMoves(gameIndex, [
          { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
        ]);

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const alicePrivkey = accounts.alice.getEncryptionPrivateKey();
        const { s1: alice_s1, s2: alice_s2, s3: alice_s3 } = genSerializedMoveSignature(
          accounts.alice.getAddress(),
          gameIndex,
          0,
          2,
          0,
          alicePrivkey
        );

        // Sign move as Charlie instead of Bob
        const charliePrivkey = accounts.charlie.getEncryptionPrivateKey();
        const { s1: charlie_s1, s2: charlie_s2, s3: charlie_s3 } = genSerializedMoveSignature(
          accounts.alice.getAddress(),
          gameIndex,
          0,
          2,
          0,
          charliePrivkey
        );

        prepared[0][3] = alice_s1;
        prepared[0][4] = alice_s2;
        prepared[0][5] = alice_s3;
        prepared[0][6] = charlie_s1;
        prepared[0][7] = charlie_s2;
        prepared[0][8] = charlie_s3;

        await pxe.addCapsule(prepared[0]);
        await pxe.addCapsule(openChannelCapsule);
        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify opponent signature./
        );
      });

      test("Transaction should fail when sender move signature is incorrect", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        // Create dummy move to pop capsule once
        const prepared = prepareMoves(gameIndex, [
          { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
        ]);

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );


        const alicePrivkey = accounts.alice.getEncryptionPrivateKey();
        const { s1: alice_s1, s2: alice_s2, s3: alice_s3 } = genSerializedMoveSignature(
          accounts.bob.getAddress(), // Sign with Bob as sender instead of Alice
          gameIndex,
          0,
          2,
          0,
          alicePrivkey
        );

        prepared[0][3] = alice_s1;
        prepared[0][4] = alice_s2;
        prepared[0][5] = alice_s3;

        await pxe.addCapsule(prepared[0]);
        await pxe.addCapsule(openChannelCapsule);
        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify sender signature./
        );
      });

      test("Transaction should fail when other coordinates than what were signed are provided", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        // Create dummy move to pop capsule once
        const prepared = prepareMoves(gameIndex, [
          { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
        ]);

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        prepared[0][0] = Fr.fromString(numToHex(1));
        prepared[0][1] = Fr.fromString(numToHex(1));

        await pxe.addCapsule(prepared[0]);
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify opponent signature./
        );
      });

      test("Moves should only be made by the registered host and player of the game", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 1, col: 0, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 2, col: 2, sender: accounts.charlie, opponent: accounts.bob },
        ];

        const prepared = prepareMoves(gameIndex, moves);

        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Sender is not challenger or host./
        );
      });

      test("If a row index is out of bounds then the transaction should revert", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 2, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 4, col: 1, sender: accounts.bob, opponent: accounts.alice },
        ];

        const prepared = prepareMoves(gameIndex, moves);
        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Coordinate out of bounds./
        );
      });

      test("If a column index is out of bounds then the transaction should revert", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [{ row: 2, col: 5, sender: accounts.alice, opponent: accounts.bob }];

        const prepared = prepareMoves(gameIndex, moves);

        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Coordinate out of bounds./
        );
      });

      test("If a coordinate is already occupied then the transaction should revert", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 2, col: 2, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
        ];

        const prepared = prepareMoves(gameIndex, moves);

        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Coordinate is already occupied./
        );
      });

      test("Player should be unable to make two turns in a row", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
        ];

        const prepared = prepareMoves(gameIndex, moves);

        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Only challenger can move./
        );
      });

      test("Reordered moves should cause signature verification to fail", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
        ];

        const prepared = prepareMoves(gameIndex, moves);

        // Switch Bob's first move with his second
        const temp = prepared[3];
        prepared[3] = prepared[1];
        prepared[1] = temp;

        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Could not verify opponent signature./
        );
      });

      test("Play a game until won", async () => {
        // print function selectors
        let open = FunctionSelector.fromSignature(
          "open_channel(Field)"
        ).toString();
        let turn = FunctionSelector.fromSignature("turn(Field)").toString();
        let orchestrator = FunctionSelector.fromSignature(
          "orchestrator(Field)"
        ).toString();
        console.log("open: ", open);
        console.log("turn: ", turn);
        console.log("orchestrator: ", orchestrator);
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
        ];
        const prepared = prepareMoves(gameIndex, moves);
        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex).send().wait();
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Subsequent move on won game should revert", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const moves = [{ row: 1, col: 2, sender: accounts.bob, opponent: accounts.alice }];

        const prepared = prepareMoves(gameIndex, moves);
        await pxe.addCapsule(prepared[0]);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });

      test("Play game to draw", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 0, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 2, sender: accounts.alice, opponent: accounts.bob },
          { row: 1, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 1, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 1, col: 2, sender: accounts.bob, opponent: accounts.alice },
          { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
          { row: 2, col: 2, sender: accounts.alice, opponent: accounts.bob },
        ];
        const prepared = prepareMoves(gameIndex, moves);
        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex).send().wait();
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(0n);
        expect(game.over).toEqual(true);
      });

      test("Subsequent move on game with draw should revert", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const moves = [{ row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice }];
        const prepared = prepareMoves(gameIndex, moves);
        await pxe.addCapsule(prepared[0]);
        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });
    });

    describe("Test timout function", () => {
      test("Trigger timeout and confirm it to be set at note hash", async () => {
        console.log(
          "trigger timeout selector: ",
          FunctionSelector.fromSignature(
            "trigger_timeout(Field,Field)"
          ).toString()
        );
        console.log(
          "set_winner_from_timeout: ",
          FunctionSelector.fromSignature(
            "set_winner_from_timeout(Field,Field)"
          ).toString()
        );
        console.log(
          "claim_timeout_win: ",
          FunctionSelector.fromSignature("claim_timeout_win(Field)").toString()
        );
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const moves = [
          { row: 1, col: 1, sender: accounts.alice, opponent: accounts.bob, timeout: true },
        ];

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const prepared = prepareMoves(gameIndex, moves);
        await pxe.addCapsule(prepared[0]);
        await pxe.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex).send().wait();

        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);
      });

      test("Transaction should revert if timestamp window has not concluded", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const call = contract.methods.claim_timeout_win(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Player can still answer timeout./
        );
      });

      test("Alice should be able to claim game win now that timeout window has passed", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        await cc.aztec.warp(Number(timestamp) + 600);
        await contract.methods.claim_timeout_win(gameIndex).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toBe(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(
          accounts.alice.getAddress().toBigInt()
        );
      });

      test("Answered timeout should update state to next turn", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
          { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice, timeout: true },
        ];

        const prepared = prepareMoves(gameIndex, moves);
        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex).send().wait();

        // Confirm that timeout has been triggered
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);
        await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.turn).toEqual(5n);
      });

      test("Win should not be claimmable after timeout is answered", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const call = contract.methods.claim_timeout_win(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Invactive timeout./
        );
      });

      test("Updated state in answer timeout function should result in a game winner in some cases", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
          { row: 0, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 1, sender: accounts.bob, opponent: accounts.alice },
          { row: 1, col: 0, sender: accounts.alice, opponent: accounts.bob, timeout: true },
        ];

        const prepared = prepareMoves(gameIndex, moves);
        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex).send().wait();

        const bobContract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.bob
        );
        await bobContract.methods
          .answer_timeout(gameIndex, 2, 2)
          .send()
          .wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toEqual(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
      });

      test("When timeout is answered then game should be playable again to conclusion", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [
          { row: 0, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 0, sender: accounts.bob, opponent: accounts.alice },
          { row: 2, col: 1, sender: accounts.alice, opponent: accounts.bob },
          { row: 2, col: 2, sender: accounts.bob, opponent: accounts.alice, timeout: true },
        ];

        const prepared = prepareMoves(gameIndex, moves);
        for (const move of prepared) {
          await pxe.addCapsule(move);
        }
        await pxe.addCapsule(openChannelCapsule);

        await contract.methods.orchestrator(gameIndex).send().wait();

        // Confirm that timeout has been triggered
        const noteHash = await contract.methods
          .get_game_note_hash(gameIndex)
          .view();
        const timestamp = await contract.methods.get_timeout(noteHash).view();
        expect(timestamp).not.toEqual(0n);
        await contract.methods.answer_timeout(gameIndex, 0, 1).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.turn).toEqual(5n);

        const moves2 = [
          { row: 1, col: 2, sender: accounts.bob, opponent: accounts.alice },
          { row: 1, col: 0, sender: accounts.alice, opponent: accounts.bob },
          { row: 0, col: 2, sender: accounts.bob, opponent: accounts.alice },
        ];

        const prepared2 = prepareMoves(gameIndex, moves2, moves.length + 1);
        for (const move of prepared2) {
          await pxe.addCapsule(move);
        }

        await contract.methods.orchestrator(gameIndex).send().wait();

        const boardUpdated = await contract.methods.get_board(gameIndex).view();
        expect(boardUpdated.over).toEqual(true);
        const gameUpdated = await contract.methods.get_game(gameIndex).view();
        expect(gameUpdated.winner.inner).toEqual(
          accounts.bob.getAddress().toBigInt()
        );
      });
    });
  });
});
