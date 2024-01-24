import { describe, expect, jest } from '@jest/globals';
import {
    AccountWalletWithPrivateKey,
    AztecAddress,
    CheatCodes,
    Contract,
    createAccount,
    createDebugLogger,
    createPXEClient,
    DebugLogger,
    Fr,
    PXE,
    sleep
} from '@aztec/aztec.js';
import { TicTacToeContractArtifact } from '../src/artifacts/TicTacToe.js';
import { emptyCapsuleStack, numToHex, signSchnorr } from '../src/utils.js';
import { genSerializedMoveSignature, openChannel, prepareMoves } from './utils/index.js';

const {
    ETH_RPC_URL = 'http://localhost:8545',
    PXE_URL = 'http://localhost:8080'
} = process.env

describe('Tic Tac Toe', () => {
    jest.setTimeout(1500000);
    let contractAddress: AztecAddress;
    let cc: CheatCodes;
    let pxe: PXE;
    let logger: DebugLogger;
    let accounts: {
        alice: AccountWalletWithPrivateKey,
        bob: AccountWalletWithPrivateKey,
        charlie: AccountWalletWithPrivateKey,
        david: AccountWalletWithPrivateKey
    };

    beforeAll(async () => {
        logger = createDebugLogger("tictactoe")

        pxe = await createPXEClient(PXE_URL)

        cc = await CheatCodes.create(ETH_RPC_URL, pxe);

        accounts = {
            alice: await createAccount(pxe),
            bob: await createAccount(pxe),
            charlie: await createAccount(pxe),
            david: await createAccount(pxe),
        }

        const deployed = await Contract.deploy(accounts.alice, TicTacToeContractArtifact, []).send().deployed();
        contractAddress = deployed.address;
        // Clear out capsule stack each time tests are ran
        try {
            await emptyCapsuleStack(deployed);
        } catch (err) { }
    })

    // describe("Test starting and joining game", () => {
    //     test("Start game", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const currentGameIndex = await contract.methods.current_game_index().view();

    //         // Index should start at 0
    //         expect(currentGameIndex).toEqual(0n);
    //         await contract.methods.start_game().send().wait();

    //         // Index should be incremented by one
    //         const newGameIndex = await contract.methods.current_game_index().view();
    //         expect(newGameIndex).toEqual(1n);

    //         // Started by should be updated in storage
    //         const game = await contract.methods.get_game(0n).view();
    //         const aliceAddress = accounts.alice.getAddress().toBigInt();
    //         expect(game.host.address).toEqual(aliceAddress);
    //     });

    //     test("Join game", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
    //         // Game before joining has a default address of 0n
    //         const game = await contract.methods.get_game(0n).view();
    //         expect(game.player.address).toEqual(0n)

    //         // Bob joins game 0
    //         await contract.methods.join_game(0n).send().wait();

    //         // Check that bob is now a player in the game
    //         const updatedGame = await contract.methods.get_game(0n).view();
    //         const bobAddress = accounts.bob.getAddress().toBigInt()
    //         expect(updatedGame.player.address).toEqual(bobAddress);
    //     });
    // })


    // describe("Test turn rules", () => {
    //     test("Can't take turn on game that hasn't been started", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.charlie);
    //         const call = contract.methods.turn(1n, 0n, 0n)
    //         await expect(call.simulate()).rejects.toThrowError(/game.host.address != 0/)
    //     });

    //     test("Can't take turn on game that hasn't been joined", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.charlie);
    //         // Start new game with charlie
    //         await contract.methods.start_game().send().wait();
    //         // Attempt turn on active game without another player joining
    //         const call = contract.methods.turn(1n, 0n, 0n)
    //         await expect(call.simulate()).rejects.toThrowError(/game.player.address != 0/)
    //     });

    //     test("Player must be in game to take turn", async () => {
    //         const contractAlice = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const contractDavid = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.david);
    //         // David joins game
    //         await contractDavid.methods.join_game(1n).send().wait();
    //         // Alice should not be able to move in game between Charlie & David
    //         const call = contractAlice.methods.turn(1n, 0n, 0n);
    //         await expect(call.simulate()).rejects.toThrowError(/\(game\.host\.address == sender\) \| \(game\.player\.address == sender\)/)
    //     });

    //     test("Test out-of-bounds row", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const call = contract.methods.turn(0n, 4n, 0n);
    //         await expect(call.simulate()).rejects.toThrowError(/\(row < 3\) \& \(col < 3\)/)
    //     })

    //     test("Test out-of-bounds columns", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const call = contract.methods.turn(0n, 0n, 4n);
    //         await expect(call.simulate()).rejects.toThrowError(/\(row < 3\) \& \(col < 3\)/)
    //     })

    //     /**
    //      * Game #0 Board
    //      * 
    //      * X    -    -
    //      * -    -    -
    //      * -    -    -
    //      */

    //     test("Valid turn stored in board storage for host (Alice)", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const board = await contract.methods.get_board(0n).view();
    //         expect(board[0]).toEqual(0n);
    //         // Place X at 0,0 
    //         await contract.methods.turn(0n, 0n, 0n).send().wait();
    //         const updatedBoard = await contract.methods.get_board(0n).view();
    //         // Game host should have placement set to 1
    //         expect(updatedBoard[0]).toEqual(1n)
    //     })

    //     test("Alice should not be table to take subsequent turn until bob moves", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const call = contract.methods.turn(0n, 0n, 1n,);
    //         await expect(call.simulate()).rejects.toThrowError(/game.turn % 2 == 0/)
    //     })

    //     /**
    //      * Game #0 Board
    //      * 
    //      * X    -    -
    //      * O    -    -
    //      * -    -    -
    //      */

    //     test("Valid turn stored in board storage for player (Bob)", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
    //         const board = await contract.methods.get_board(0n).view();
    //         expect(board[3]).toEqual(0n);
    //         // Place O at 1, 0 
    //         await contract.methods.turn(0n, 1n, 0n).send().wait();
    //         const updatedBoard = await contract.methods.get_board(0n).view();
    //         // Game player should have placement set to 4
    //         expect(updatedBoard[3]).toEqual(4n)
    //     })

    //     test("Bob should not be able to take subsequent turn until alice moves", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
    //         const call = contract.methods.turn(0n, 1n, 0n);
    //         await expect(call.simulate()).rejects.toThrowError(/game.turn % 2 == 1/)
    //     })
    // })

    // describe("Play a game to completion", () => {

    //     /**
    //      * Game #0 Board
    //      * 
    //      * X    X    X
    //      * O    O    -
    //      * O    -    X
    //      */

    //     test("Play game 0 between Alice and Bob to completion", async () => {
    //         const alice = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const bob = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
    //         const moves = [
    //             { row: 2, col: 2 }, // Alice #2
    //             { row: 1, col: 1 }, // Bob #2
    //             { row: 0, col: 1 }, // Alice #3
    //             { row: 2, col: 0 }, // Bob #3
    //             { row: 0, col: 2 }  // Alice #4
    //         ];
    //         await playGame(0n, moves, alice, bob);
    //         const game = await alice.methods.get_game(0n).view();
    //         const aliceAddress = accounts.alice.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(aliceAddress);
    //     });

    //     test("Bob should not be able to move after winner has been assigned to game", async () => {
    //         const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
    //         const call = contract.methods.turn(0n, 1n, 2n);
    //         await expect(call.simulate()).rejects.toThrowError(/game.winner.address == 0/)
    //     });
    // })

    // describe("Play an entire game out that ends with a draw", () => {

    //     /**
    //      * Game #2 Board
    //      * 
    //      * X    O    X
    //      * X    O    O
    //      * O    X    X
    //      * 
    //      */

    //     test("Game should revert when max turn of 9 is reached", async () => {
    //         const alice = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         const bob = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);

    //         // Start and join game 2
    //         await alice.methods.start_game().send().wait();
    //         await bob.methods.join_game(2n).send().wait();

    //         const moves = [
    //             { row: 0, col: 0 },
    //             { row: 0, col: 1 },
    //             { row: 0, col: 2 },
    //             { row: 1, col: 1 },
    //             { row: 1, col: 0 },
    //             { row: 1, col: 2 },
    //             { row: 2, col: 1 },
    //             { row: 2, col: 0 },
    //             { row: 2, col: 2 },
    //         ];
    //         await playGame(2n, moves, alice, bob);
    //         const call = alice.methods.turn(2n, 0n, 0n);
    //         await expect(call.simulate()).rejects.toThrowError(/game.turn != 9/)
    //     })
    // })

    // describe("Play multiple valid games to completion with a winner", () => {
    //     let activeGameIndex = 3n;
    //     let aliceContract: Contract;
    //     let bobContract: Contract;

    //     beforeAll(async () => {
    //         aliceContract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
    //         bobContract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
    //     });

    //     afterEach(() => {
    //         activeGameIndex++;
    //     });

    //     beforeEach(async () => {
    //         // Create new game
    //         await aliceContract.methods.start_game().send().wait();
    //         await bobContract.methods.join_game(activeGameIndex).send().wait();
    //     });

    //     /**
    //      * Game #3 Board
    //      * 
    //      * O    O    O
    //      * X    -    -
    //      * X    X    -
    //      * 
    //      */
    //     test("Horizontal 0 wins top row", async () => {
    //         const moves = [
    //             { row: 2, col: 0 },
    //             { row: 0, col: 0 },
    //             { row: 2, col: 1 },
    //             { row: 0, col: 1 },
    //             { row: 1, col: 0 },
    //             { row: 0, col: 2 }
    //         ];
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const bobAddress = accounts.bob.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(bobAddress);
    //     });

    //     /**
    //      * Game #3 Board
    //      * 
    //      * O    O    O
    //      * X    -    -
    //      * X    X    -
    //      * 
    //      */
    //     test("O wins horizontal top row", async () => {
    //         const moves = [
    //             { row: 2, col: 0 },
    //             { row: 0, col: 0 },
    //             { row: 2, col: 1 },
    //             { row: 0, col: 1 },
    //             { row: 1, col: 0 },
    //             { row: 0, col: 2 }
    //         ];
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const bobAddress = accounts.bob.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(bobAddress);
    //     });

    //     /**
    //      * Game #4 Board
    //      * 
    //      * X    O    -
    //      * X    O    -
    //      * X    -    -
    //      * 
    //      */

    //     test("X wins verical left column", async () => {
    //         const moves = [
    //             { row: 0, col: 0 },
    //             { row: 0, col: 1 },
    //             { row: 1, col: 0 },
    //             { row: 1, col: 1 },
    //             { row: 2, col: 0 }
    //         ];
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const aliceAddress = accounts.alice.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(aliceAddress);
    //     })

    //     /**
    //      * Game #4 Board
    //      * 
    //      * X    -    O
    //      * X    -    O
    //      * -    X    O
    //      * 
    //      */

    //     test("O wins verical right column", async () => {
    //         const moves = [
    //             { row: 0, col: 0 },
    //             { row: 0, col: 2 },
    //             { row: 2, col: 1 },
    //             { row: 1, col: 2 },
    //             { row: 1, col: 0 },
    //             { row: 2, col: 2 }
    //         ];
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const bobAddress = accounts.bob.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(bobAddress);
    //     });

    //     // /**
    //     //  * Game #5 Board
    //     //  * 
    //     //  * X    -    -
    //     //  * O    X    O
    //     //  * -    -    X
    //     //  * 
    //     //  */

    //     test("X wins diagonal", async () => {
    //         const moves = [
    //             { row: 0, col: 0 },
    //             { row: 1, col: 0 },
    //             { row: 1, col: 1 },
    //             { row: 1, col: 2 },
    //             { row: 2, col: 2 }
    //         ]
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const aliceAddress = accounts.alice.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(aliceAddress);
    //     });

    //     /**
    //      * Game #6 Board
    //      * 
    //      * -    X    O
    //      * X    O    X
    //      * O    -    -
    //      * 
    //      */

    //     test("O wins diagonal", async () => {
    //         const moves = [
    //             { row: 1, col: 0 },
    //             { row: 0, col: 2 },
    //             { row: 0, col: 1 },
    //             { row: 1, col: 1 },
    //             { row: 1, col: 2 },
    //             { row: 2, col: 0 },
    //         ]
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const bobAddress = accounts.bob.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(bobAddress);
    //     });

    //     /**
    //      * Game #7 Board
    //      * 
    //      * -    X    O
    //      * -    X    -
    //      * O    X    -
    //      * 
    //      */

    //     test("X wins middle column", async () => {
    //         const moves = [
    //             { row: 0, col: 1 },
    //             { row: 0, col: 2 },
    //             { row: 1, col: 1 },
    //             { row: 2, col: 0 },
    //             { row: 2, col: 1 },
    //         ]
    //         await playGame(activeGameIndex, moves, aliceContract, bobContract);
    //         const game = await aliceContract.methods.get_game(activeGameIndex).view();
    //         const aliceAddress = accounts.alice.getAddress().toBigInt();
    //         expect(game.winner.address).toEqual(aliceAddress);
    //     });
    // })

    // describe("Test modulus", () => {
    //     test("Test modulo", async () => {

    //     })
    // });

    xdescribe("Test refactor", () => {
        test("Test game read from public state", async () => {
            const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

            // Start game
            await openChannel(contract, 0n, accounts.alice, accounts.bob);

            const game = await contract.methods.get_game(0n).view();

            expect(game.host.address).toEqual(accounts.alice.getAddress().toBigInt());
            expect(game.player.address).toEqual(accounts.bob.getAddress().toBigInt());

            const gameIndex = await contract.methods.get_current_game_index().view();
            expect(gameIndex).toEqual(1n);
        });
    });

    describe('Test game over state channel', () => {
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

                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const call = contract.methods.open_channel(aliceAddress, bobAddress, aliceSignature, charlieSignature, 0n);
                await expect(call.simulate()).rejects.toThrowError(/Challenger signature could not be verified/)
            });

            test('Game starts with two valid signatures and current game index is incremented', async () => {

                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                // Start game
                await openChannel(contract, 0n, accounts.alice, accounts.bob);

                const game = await contract.methods.get_game(0n).view();
                expect(game.host.address).toEqual(accounts.alice.getAddress().toBigInt());
                expect(game.challenger.address).toEqual(accounts.bob.getAddress().toBigInt());

                // TODO: Fix game index logic or remove completely
                // const gameIndex = await contract.methods.get_current_game_index().view();
                // expect(gameIndex).toEqual(1n);
            });
        })

        xdescribe("Testing gameplay over state channel", () => {
            let gameIndex = 0n;

            afterEach(async () => {
                gameIndex++;
            });

            beforeEach(async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                try {
                    await emptyCapsuleStack(contract);
                } catch (err) { }
            })

            test("Test transaction should fail when invalid game index has been provided", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const call = contract.methods.play_game(1n);
                await expect(call.simulate()).rejects.toThrowError(/Game does not exist./)
            });

            test("Transaction should fail when private key other than player's is used to sign move", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                // Create dummy move to pop capsule once
                const prepared = prepareMoves(gameIndex, [{ row: 2, col: 0, player: accounts.alice }]);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                // Sign move as Charlie and replace with Alice's serialized signature
                const charliePrivkey = accounts.charlie.getEncryptionPrivateKey();
                const { s1, s2, s3 } = genSerializedMoveSignature(gameIndex, 1, 2, 0, charliePrivkey);

                prepared[0][3] = s1;
                prepared[0][4] = s2;
                prepared[0][5] = s3;

                await pxe.addCapsule(prepared[0]);

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Move signature could not be verified./)
            });

            test("Transaction should fail when other coordinates than what were signed are provided", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                // Create dummy move to pop capsule once
                const prepared = prepareMoves(gameIndex, [{ row: 2, col: 0, player: accounts.alice }]);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                prepared[0][0] = Fr.fromString(numToHex(1));
                prepared[0][1] = Fr.fromString(numToHex(1));

                await pxe.addCapsule(prepared[0]);

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Move signature could not be verified./)
            });

            test("Moves should only be made by the registered host and player of the game", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const moves = [
                    { row: 2, col: 0, player: accounts.alice },
                    { row: 1, col: 0, player: accounts.bob },
                    { row: 0, col: 0, player: accounts.alice },
                    { row: 0, col: 1, player: accounts.bob },
                    { row: 2, col: 2, player: accounts.charlie },
                ];

                const prepared = prepareMoves(gameIndex, moves);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Sender is not challenger or host./)
            });

            test("If a row index is out of bounds then the transaction should revert", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const moves = [
                    { row: 2, col: 0, player: accounts.alice },
                    { row: 4, col: 1, player: accounts.bob },
                ];

                const prepared = prepareMoves(gameIndex, moves);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Coordinate out of bounds./);
            });

            test("If a column index is out of bounds then the transaction should revert", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const moves = [
                    { row: 2, col: 5, player: accounts.alice },
                ];

                const prepared = prepareMoves(gameIndex, moves);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Coordinate out of bounds./)
            });

            test("If a coordinate is already occupied then the transaction should revert", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const moves = [
                    { row: 2, col: 2, player: accounts.alice },
                    { row: 2, col: 2, player: accounts.bob },
                ];

                const prepared = prepareMoves(gameIndex, moves);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Coordinate is already occupied./);
            });

            test("Player should be unable to make two turns in a row", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const moves = [
                    { row: 0, col: 0, player: accounts.alice },
                    { row: 1, col: 1, player: accounts.bob },
                    { row: 0, col: 1, player: accounts.alice },
                    { row: 0, col: 2, player: accounts.alice },
                ];

                const prepared = prepareMoves(gameIndex, moves);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Only challenger can move./)
            });

            test("Reordered moves should cause signature verification to fail", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);

                const moves = [
                    { row: 0, col: 0, player: accounts.alice },
                    { row: 1, col: 1, player: accounts.bob },
                    { row: 0, col: 1, player: accounts.alice },
                    { row: 2, col: 2, player: accounts.bob },
                    { row: 0, col: 2, player: accounts.alice },
                ];

                const prepared = prepareMoves(gameIndex, moves);

                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);

                // Switch Bob's first move with his second
                const temp = prepared[3];
                prepared[3] = prepared[1];
                prepared[1] = temp;

                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }

                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Move signature could not be verified./)
            });


            test("Play a game until won", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
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
                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);
                await contract.methods.play_game(gameIndex).send().wait();
                const game = await contract.methods.get_game(gameIndex).view();
                expect(game.winner.address).toEqual(accounts.alice.getAddress().toBigInt());
            });

            test("Subsequent move on won game should revert", async () => {
                gameIndex--;
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const moves = [
                    { row: 1, col: 2, player: accounts.bob },
                ];
                const prepared = prepareMoves(gameIndex, moves);

                await pxe.addCapsule(prepared[0]);
                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
            });

            test("Play game to draw", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
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
                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);
                for (const move of prepared) {
                    await pxe.addCapsule(move);
                }
                await contract.methods.play_game(gameIndex).send().wait();
                const game = await contract.methods.get_game(gameIndex).view();
                expect(game.winner.address).toEqual(0n);
                expect(game.over).toEqual(true);
            });

            test("Subsequent move on game with draw should revert", async () => {
                gameIndex--;
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const moves = [
                    { row: 2, col: 0, player: accounts.bob },

                ];
                const prepared = prepareMoves(gameIndex, moves);
                await pxe.addCapsule(prepared[0]);
                const call = contract.methods.play_game(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Game has ended./);
            });
        });
        xdescribe("Test timout function", () => {
            let gameIndex = 1n;
            test("Trigger timeout and confirm it to be set at note hash", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const moves = [
                    { row: 0, col: 0, player: accounts.alice, timeout: true },
                ];
                const prepared = prepareMoves(gameIndex, moves);
                await pxe.addCapsule(prepared[0]);
                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);
                await contract.methods.play_game(gameIndex).send().wait();

                const noteHash = await contract.methods.get_game_note_hash(gameIndex).view();
                const timestamp = await contract.methods.get_timeout(noteHash).view();
                expect(timestamp).not.toEqual(0n);
            });

            test("Transaction should revert if timestamp window has not concluded", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const call = contract.methods.claim_timeout_win(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Player can still dispute timeout./);
            });

            test("Alice should be able to claim game win now that timeout window has passed", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const noteHash = await contract.methods.get_game_note_hash(gameIndex).view();
                const timestamp = await contract.methods.get_timeout(noteHash).view();
                await cc.aztec.warp(Number(timestamp) + 600);
                await contract.methods.claim_timeout_win(gameIndex).send().wait();
                const board = await contract.methods.get_board(gameIndex).view();
                expect(board.over).toBe(true);
                const game = await contract.methods.get_game(gameIndex).view();
                expect(game.winner.address).toEqual(accounts.alice.getAddress().toBigInt());
            });

            test("Disputed timeout should update state to next turn", async () => {
                gameIndex++;
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
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
                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);
                await contract.methods.play_game(gameIndex).send().wait();

                // Confirm that timeout has been triggered
                const noteHash = await contract.methods.get_game_note_hash(gameIndex).view();
                const timestamp = await contract.methods.get_timeout(noteHash).view();
                expect(timestamp).not.toEqual(0n);
                await contract.methods.dispute_timeout(gameIndex, 0, 1).send().wait();
                const board = await contract.methods.get_board(gameIndex).view();
                expect(board.turn).toEqual(5n);
            });

            test("Win should not be claimmable after timeout is disputed", async () => {
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
                const call = contract.methods.claim_timeout_win(gameIndex);
                await expect(call.simulate()).rejects.toThrowError(/Invactive timeout./);
            });

            test("Updated state in dispute timeout function should result in a game winner in some cases", async () => {
                gameIndex++;
                const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
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
                await openChannel(contract, gameIndex, accounts.alice, accounts.bob);
                await contract.methods.play_game(gameIndex).send().wait();

                const bobContract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
                await bobContract.methods.dispute_timeout(gameIndex, 2, 2).send().wait();
                const board = await contract.methods.get_board(gameIndex).view();
                expect(board.over).toEqual(true);
                const game = await contract.methods.get_game(gameIndex).view();
                expect(game.winner.address).toEqual(accounts.bob.getAddress().toBigInt());
            })
        });
    });
});

