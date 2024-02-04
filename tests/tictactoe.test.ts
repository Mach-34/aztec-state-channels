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
  openChannel,
  prepareMoves,
  prepareOpenChannel,
  serializeSignature,
  simulateTurn,
} from "./utils/index.js";
import { AppExecutionResult, NoteAndSlot } from "@aztec/circuit-types";
import { FunctionSelector } from "@aztec/aztec.js";
import { computeSiloedNullifierSecretKey } from "@aztec/circuits.js";
const {
  ETH_RPC_URL = "http://localhost:8545",
  PXE_URL = "http://localhost:8080",
} = process.env;

type StateChannel = {
  open: AppExecutionResult | undefined;
  turns: AppExecutionResult[];
};

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
    } catch (err) {}
  });

  describe("State Channel Test", () => {
    test("State channel time", async () => {
      // in side effects: 24, 23, 14, 3
      // set game index
      let gameIndex = 1n;
      let stateChannel: StateChannel = {
        open: undefined,
        turns: [],
      };
      /// OPEN CHANNEL ///
      // get contract as alice
      let contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );
      await emptyCapsuleStack(contract);
      // add channel open data to capsule stack
      const openChannelCapsule = prepareOpenChannel(
        accounts.alice,
        accounts.bob
      );
      await pxe.addCapsule(openChannelCapsule);
      // build app execution request for channel open
      let request = await contract.methods.open_channel(gameIndex).create();
      let executionNotes: NoteAndSlot[] = [];
      let nullified: boolean[] = [];
      let sideEffectCounter = 3;

      stateChannel.open = await accounts.alice.simulateAppCircuit(
        request.packedArguments[0],
        FunctionSelector.fromSignature("open_channel(Field)"),
        executionNotes,
        nullified,
        contractAddress,
        sideEffectCounter
      );
      sideEffectCounter = Number(
        stateChannel.open.callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      );
      executionNotes = stateChannel.open.newNotes;
      nullified = [false];

      console.log("FLAG");

      /// TURN 1 ///
      // add move to capsule
      stateChannel.turns.push(
        await simulateTurn(
          pxe,
          accounts.alice,
          contractAddress,
          gameIndex,
          { row: 0, col: 0, turn: 0 },
          executionNotes,
          nullified,
          sideEffectCounter
        )
      );
      sideEffectCounter = Number(
        stateChannel.turns[0].callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      ) + 2;
      executionNotes = stateChannel.turns[0].newNotes;
      nullified = [true, false];
      console.log("Side effects: ", sideEffectCounter);


      /// TURN 2 ///
      stateChannel.turns.push(
        await simulateTurn(
          pxe,
          accounts.bob,
          contractAddress,
          gameIndex,
          { row: 1, col: 1, turn: 1 },
          executionNotes,
          nullified,
          sideEffectCounter
        )
      );
      sideEffectCounter = Number(
        stateChannel.turns[1].callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      ) + 3; // + 1 for next call, + 1 for orchestrator loop
      executionNotes = stateChannel.turns[1].newNotes;
      nullified = [true, true, false];

      // // console.log(
      // //   "new commitmenmts: ",
      // //   stateChannel.turns[1].callStackItem.publicInputs.newCommitments
      // // );
      // // console.log(
      // //   "new callstack hashes: ",
      // //   stateChannel.turns[1].callStackItem.publicInputs.privateCallStackHashes
      // // );
      // // console.log("x", stateChannel.turns[1].callStackItem.publicInputs);

      console.log("Side effects: ", sideEffectCounter);
      /// TURN 3 ///
      stateChannel.turns.push(
        await simulateTurn(
          pxe,
          accounts.alice,
          contractAddress,
          gameIndex,
          { row: 0, col: 1, turn: 2 },
          executionNotes,
          nullified,
          sideEffectCounter
        )
      );
      sideEffectCounter = Number(
        stateChannel.turns[2].callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      ) + 2;
      executionNotes = stateChannel.turns[2].newNotes;
      nullified = [true, true, true, false];
      console.log("Side effects: ", sideEffectCounter);

      /// TURN 4 ///
      stateChannel.turns.push(
        await simulateTurn(
          pxe,
          accounts.bob,
          contractAddress,
          gameIndex,
          { row: 2, col: 2, turn: 3 },
          executionNotes,
          nullified,
          sideEffectCounter
        )
      );
      sideEffectCounter = Number(
        stateChannel.turns[3].callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      ) + 3; // + 1 for next call, + 1 for orchestrator loop
      executionNotes = stateChannel.turns[3].newNotes;
      nullified = [true, true, true, true, false];
      console.log("Side effects: ", sideEffectCounter);

      /// TURN 4 ///
      stateChannel.turns.push(
        await simulateTurn(
          pxe,
          accounts.alice,
          contractAddress,
          gameIndex,
          { row: 0, col: 2, turn: 4 },
          executionNotes,
          nullified,
          sideEffectCounter
        )
      );
      sideEffectCounter = Number(
        stateChannel.turns[4].callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      );
      executionNotes = stateChannel.turns[4].newNotes;
      nullified = [true, true, true, true, true, false];

      console.log(
        "State Channel Turns: ",
        stateChannel.turns[4].callStackItem.publicInputs.returnValues
      );
      sideEffectCounter = Number(
        stateChannel.turns[3].callStackItem.publicInputs.endSideEffectCounter.toBigInt()
      );
      console.log("Side effects: ", sideEffectCounter);


      /////// FINALIZE STATE CHANNEL ///////

      // ORCHESTRATOR 3
      contract = await Contract.at(
        contractAddress,
        TicTacToeContractArtifact,
        accounts.alice
      );
      // build cachedSimulations
      let cachedSimulations = [stateChannel.turns[4]];
      // sideEffectCounter = Number(
      //   stateChannel.turns[4].callStackItem.publicInputs.endSideEffectCounter.toBigInt() -
      //     3n
      // );
      sideEffectCounter = 24;
      // build args
      request = await contract.methods.turn(gameIndex).create();
      executionNotes = stateChannel.turns[3].newNotes;
      nullified = [true, true, true, true, false];
      let result = await accounts.alice.simulateAppCircuit(
        request.packedArguments[0],
        FunctionSelector.fromSignature("orchestrator(Field)"),
        executionNotes,
        nullified,
        contractAddress,
        sideEffectCounter,
        cachedSimulations
      );

      console.log("Result: ", request);
    });
  });

  describe("Test state channel over orchestrator function", () => {
    let gameIndex = 0n;

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
      } catch (err) {}
    });

    xdescribe("Test game creation", () => {
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
    xdescribe("Test gameplay over state channel", () => {
      xtest("Transaction should fail when private key other than player's is used to sign move", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        // Create dummy move to pop capsule once
        const prepared = prepareMoves(gameIndex, [
          { row: 2, col: 0, player: accounts.alice },
        ]);

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        // Sign move as Charlie and replace with Alice's serialized signature
        const charliePrivkey = accounts.charlie.getEncryptionPrivateKey();
        const { s1, s2, s3 } = genSerializedMoveSignature(
          gameIndex,
          1,
          2,
          0,
          charliePrivkey
        );

        prepared[0][3] = s1;
        prepared[0][4] = s2;
        prepared[0][5] = s3;

        await pxe.addCapsule(prepared[0]);
        await pxe.addCapsule(openChannelCapsule);
        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Move signature could not be verified./
        );
      });

      xtest("Transaction should fail when other coordinates than what were signed are provided", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        // Create dummy move to pop capsule once
        const prepared = prepareMoves(gameIndex, [
          { row: 2, col: 0, player: accounts.alice },
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
          /Move signature could not be verified./
        );
      });

      xtest("Moves should only be made by the registered host and player of the game", async () => {
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
          { row: 2, col: 0, player: accounts.alice },
          { row: 1, col: 0, player: accounts.bob },
          { row: 0, col: 0, player: accounts.alice },
          { row: 0, col: 1, player: accounts.bob },
          { row: 2, col: 2, player: accounts.charlie },
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

      xtest("If a row index is out of bounds then the transaction should revert", async () => {
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
          { row: 2, col: 0, player: accounts.alice },
          { row: 4, col: 1, player: accounts.bob },
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

      xtest("If a column index is out of bounds then the transaction should revert", async () => {
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const openChannelCapsule = prepareOpenChannel(
          accounts.alice,
          accounts.bob
        );

        const moves = [{ row: 2, col: 5, player: accounts.alice }];

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

      xtest("If a coordinate is already occupied then the transaction should revert", async () => {
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
          { row: 2, col: 2, player: accounts.alice },
          { row: 2, col: 2, player: accounts.bob },
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

      xtest("Player should be unable to make two turns in a row", async () => {
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 1, col: 1, player: accounts.bob },
          { row: 0, col: 1, player: accounts.alice },
          { row: 0, col: 2, player: accounts.alice },
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

      xtest("Reordered moves should cause signature verification to fail", async () => {
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 1, col: 1, player: accounts.bob },
          { row: 0, col: 1, player: accounts.alice },
          { row: 2, col: 2, player: accounts.bob },
          { row: 0, col: 2, player: accounts.alice },
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
          /Move signature could not be verified./
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 1, col: 1, player: accounts.bob },
          { row: 0, col: 1, player: accounts.alice },
          { row: 2, col: 2, player: accounts.bob },
          { row: 0, col: 2, player: accounts.alice },
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

      xtest("Subsequent move on won game should revert", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );

        const moves = [{ row: 1, col: 2, player: accounts.bob }];

        const prepared = prepareMoves(gameIndex, moves);
        await pxe.addCapsule(prepared[0]);

        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });

      xtest("Play game to draw", async () => {
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 0, col: 1, player: accounts.bob },
          { row: 0, col: 2, player: accounts.alice },
          { row: 1, col: 1, player: accounts.bob },
          { row: 1, col: 0, player: accounts.alice },
          { row: 1, col: 2, player: accounts.bob },
          { row: 2, col: 1, player: accounts.alice },
          { row: 2, col: 0, player: accounts.bob },
          { row: 2, col: 2, player: accounts.alice },
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

      xtest("Subsequent move on game with draw should revert", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const moves = [{ row: 2, col: 0, player: accounts.bob }];
        const prepared = prepareMoves(gameIndex, moves);
        await pxe.addCapsule(prepared[0]);
        const call = contract.methods.orchestrator(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
      });
    });

    xdescribe("Test timout function", () => {
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
          { row: 1, col: 1, player: accounts.alice, timeout: true },
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

      xtest("Transaction should revert if timestamp window has not concluded", async () => {
        gameIndex--;
        const contract = await Contract.at(
          contractAddress,
          TicTacToeContractArtifact,
          accounts.alice
        );
        const call = contract.methods.claim_timeout_win(gameIndex);
        await expect(call.simulate()).rejects.toThrowError(
          /Player can still dispute timeout./
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

      xtest("Disputed timeout should update state to next turn", async () => {
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 2, col: 0, player: accounts.bob },
          { row: 2, col: 1, player: accounts.alice },
          { row: 2, col: 2, player: accounts.bob, timeout: true },
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
        await contract.methods.dispute_timeout(gameIndex, 0, 1).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.turn).toEqual(5n);
      });

      xtest("Win should not be claimmable after timeout is disputed", async () => {
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

      xtest("Updated state in dispute timeout function should result in a game winner in some cases", async () => {
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 2, col: 0, player: accounts.bob },
          { row: 0, col: 1, player: accounts.alice },
          { row: 2, col: 1, player: accounts.bob },
          { row: 1, col: 0, player: accounts.alice, timeout: true },
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
          .dispute_timeout(gameIndex, 2, 2)
          .send()
          .wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.over).toEqual(true);
        const game = await contract.methods.get_game(gameIndex).view();
        expect(game.winner.inner).toEqual(accounts.bob.getAddress().toBigInt());
      });

      xtest("When timeout is disputed then game should be playable again to conclusion", async () => {
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
          { row: 0, col: 0, player: accounts.alice },
          { row: 2, col: 0, player: accounts.bob },
          { row: 2, col: 1, player: accounts.alice },
          { row: 2, col: 2, player: accounts.bob, timeout: true },
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
        await contract.methods.dispute_timeout(gameIndex, 0, 1).send().wait();
        const board = await contract.methods.get_board(gameIndex).view();
        expect(board.turn).toEqual(5n);

        const moves2 = [
          { row: 1, col: 2, player: accounts.bob },
          { row: 1, col: 0, player: accounts.alice },
          { row: 0, col: 2, player: accounts.bob },
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
