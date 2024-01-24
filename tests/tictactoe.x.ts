// import { describe, expect, jest } from '@jest/globals';
// import {
//     AccountWallet,
//     AztecAddress,
//     Contract,
//     createAccount,
//     createDebugLogger,
//     createPXEClient,
//     DebugLogger,
//     PXE
// } from '@aztec/aztec.js';
// import { TicTacToeContractArtifact } from '../src/artifacts/TicTacToe.js';
// import { playGame } from '../src/utils.js';

// const {
//     PXE_URL = 'http://localhost:8080'
// } = process.env

// describe('Tic Tac Toe', () => {
//     jest.setTimeout(1500000);
//     let contractAddress: AztecAddress;
//     let pxe: PXE;
//     let logger: DebugLogger;
//     let accounts: {
//         alice: AccountWallet,
//         bob: AccountWallet,
//         charlie: AccountWallet,
//         david: AccountWallet
//     };

//     beforeAll(async () => {
//         logger = createDebugLogger("tictactoe")

//         pxe = await createPXEClient(PXE_URL)

//         accounts = {
//             alice: await createAccount(pxe),
//             bob: await createAccount(pxe),
//             charlie: await createAccount(pxe),
//             david: await createAccount(pxe),
//         }

//         const deployed = await Contract.deploy(accounts.alice, TicTacToeContractArtifact, []).send().deployed();
//         contractAddress = deployed.address;
//     })

//     describe("Test starting and joining game", () => {
//         test("Start game", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const currentGameIndex = await contract.methods.current_game_index().view();

//             // Index should start at 0
//             expect(currentGameIndex).toEqual(0n);
//             await contract.methods.start_game().send().wait();

//             // Index should be incremented by one
//             const newGameIndex = await contract.methods.current_game_index().view();
//             expect(newGameIndex).toEqual(1n);

//             // Started by should be updated in storage
//             const game = await contract.methods.get_game(0n).view();
//             const aliceAddress = accounts.alice.getAddress().toBigInt();
//             expect(game.host.address).toEqual(aliceAddress);
//         });

//         test("Join game", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
//             // Game before joining has a default address of 0n
//             const game = await contract.methods.get_game(0n).view();
//             expect(game.player.address).toEqual(0n)

//             // Bob joins game 0
//             await contract.methods.join_game(0n).send().wait();

//             // Check that bob is now a player in the game
//             const updatedGame = await contract.methods.get_game(0n).view();
//             const bobAddress = accounts.bob.getAddress().toBigInt()
//             expect(updatedGame.player.address).toEqual(bobAddress);
//         });
//     })


//     describe("Test turn rules", () => {
//         test("Can't take turn on game that hasn't been started", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.charlie);
//             const call = contract.methods.turn(1n, 0n, 0n)
//             await expect(call.simulate()).rejects.toThrowError(/game.host.address != 0/)
//         });

//         test("Can't take turn on game that hasn't been joined", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.charlie);
//             // Start new game with charlie
//             await contract.methods.start_game().send().wait();
//             // Attempt turn on active game without another player joining
//             const call = contract.methods.turn(1n, 0n, 0n)
//             await expect(call.simulate()).rejects.toThrowError(/game.player.address != 0/)
//         });

//         test("Player must be in game to take turn", async () => {
//             const contractAlice = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const contractDavid = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.david);
//             // David joins game
//             await contractDavid.methods.join_game(1n).send().wait();
//             // Alice should not be able to move in game between Charlie & David
//             const call = contractAlice.methods.turn(1n, 0n, 0n);
//             await expect(call.simulate()).rejects.toThrowError(/\(game\.host\.address == sender\) \| \(game\.player\.address == sender\)/)
//         });

//         test("Test out-of-bounds row", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const call = contract.methods.turn(0n, 4n, 0n);
//             await expect(call.simulate()).rejects.toThrowError(/\(row < 3\) \& \(col < 3\)/)
//         })

//         test("Test out-of-bounds columns", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const call = contract.methods.turn(0n, 0n, 4n);
//             await expect(call.simulate()).rejects.toThrowError(/\(row < 3\) \& \(col < 3\)/)
//         })

//         /**
//          * Game #0 Board
//          * 
//          * X    -    -
//          * -    -    -
//          * -    -    -
//          */

//         test("Valid turn stored in board storage for host (Alice)", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const board = await contract.methods.get_board(0n).view();
//             expect(board[0]).toEqual(0n);
//             // Place X at 0,0 
//             await contract.methods.turn(0n, 0n, 0n).send().wait();
//             const updatedBoard = await contract.methods.get_board(0n).view();
//             // Game host should have placement set to 1
//             expect(updatedBoard[0]).toEqual(1n)
//         })

//         test("Alice should not be table to take subsequent turn until bob moves", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const call = contract.methods.turn(0n, 0n, 1n,);
//             await expect(call.simulate()).rejects.toThrowError(/game.turn % 2 == 0/)
//         })

//         /**
//          * Game #0 Board
//          * 
//          * X    -    -
//          * O    -    -
//          * -    -    -
//          */

//         test("Valid turn stored in board storage for player (Bob)", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
//             const board = await contract.methods.get_board(0n).view();
//             expect(board[3]).toEqual(0n);
//             // Place O at 1, 0 
//             await contract.methods.turn(0n, 1n, 0n).send().wait();
//             const updatedBoard = await contract.methods.get_board(0n).view();
//             // Game player should have placement set to 4
//             expect(updatedBoard[3]).toEqual(4n)
//         })

//         test("Bob should not be able to take subsequent turn until alice moves", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
//             const call = contract.methods.turn(0n, 1n, 0n);
//             await expect(call.simulate()).rejects.toThrowError(/game.turn % 2 == 1/)
//         })
//     })

//     describe("Play a game to completion", () => {

//         /**
//          * Game #0 Board
//          * 
//          * X    X    X
//          * O    O    -
//          * O    -    X
//          */

//         test("Play game 0 between Alice and Bob to completion", async () => {
//             const alice = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const bob = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
//             const moves = [
//                 { row: 2, col: 2 }, // Alice #2
//                 { row: 1, col: 1 }, // Bob #2
//                 { row: 0, col: 1 }, // Alice #3
//                 { row: 2, col: 0 }, // Bob #3
//                 { row: 0, col: 2 }  // Alice #4
//             ];
//             await playGame(0n, moves, alice, bob);
//             const game = await alice.methods.get_game(0n).view();
//             const aliceAddress = accounts.alice.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(aliceAddress);
//         });

//         test("Bob should not be able to move after winner has been assigned to game", async () => {
//             const contract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
//             const call = contract.methods.turn(0n, 1n, 2n);
//             await expect(call.simulate()).rejects.toThrowError(/game.winner.address == 0/)
//         });
//     })

//     describe("Play an entire game out that ends with a draw", () => {

//         /**
//          * Game #2 Board
//          * 
//          * X    O    X
//          * X    O    O
//          * O    X    X
//          * 
//          */

//         test("Game should revert when max turn of 9 is reached", async () => {
//             const alice = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             const bob = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);

//             // Start and join game 2
//             await alice.methods.start_game().send().wait();
//             await bob.methods.join_game(2n).send().wait();

//             const moves = [
//                 { row: 0, col: 0 },
//                 { row: 0, col: 1 },
//                 { row: 0, col: 2 },
//                 { row: 1, col: 1 },
//                 { row: 1, col: 0 },
//                 { row: 1, col: 2 },
//                 { row: 2, col: 1 },
//                 { row: 2, col: 0 },
//                 { row: 2, col: 2 },
//             ];
//             await playGame(2n, moves, alice, bob);
//             const call = alice.methods.turn(2n, 0n, 0n);
//             await expect(call.simulate()).rejects.toThrowError(/game.turn != 9/)
//         })
//     })

//     describe("Play multiple valid games to completion with a winner", () => {
//         let activeGameIndex = 3n;
//         let aliceContract: Contract;
//         let bobContract: Contract;

//         beforeAll(async () => {
//             aliceContract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.alice);
//             bobContract = await Contract.at(contractAddress, TicTacToeContractArtifact, accounts.bob);
//         });

//         afterEach(() => {
//             activeGameIndex++;
//         });

//         beforeEach(async () => {
//             // Create new game
//             await aliceContract.methods.start_game().send().wait();
//             await bobContract.methods.join_game(activeGameIndex).send().wait();
//         });

//         /**
//          * Game #3 Board
//          * 
//          * O    O    O
//          * X    -    -
//          * X    X    -
//          * 
//          */
//         test("Horizontal 0 wins top row", async () => {
//             const moves = [
//                 { row: 2, col: 0 },
//                 { row: 0, col: 0 },
//                 { row: 2, col: 1 },
//                 { row: 0, col: 1 },
//                 { row: 1, col: 0 },
//                 { row: 0, col: 2 }
//             ];
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const bobAddress = accounts.bob.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(bobAddress);
//         });

//         /**
//          * Game #3 Board
//          * 
//          * O    O    O
//          * X    -    -
//          * X    X    -
//          * 
//          */
//         test("O wins horizontal top row", async () => {
//             const moves = [
//                 { row: 2, col: 0 },
//                 { row: 0, col: 0 },
//                 { row: 2, col: 1 },
//                 { row: 0, col: 1 },
//                 { row: 1, col: 0 },
//                 { row: 0, col: 2 }
//             ];
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const bobAddress = accounts.bob.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(bobAddress);
//         });

//         /**
//          * Game #4 Board
//          * 
//          * X    O    -
//          * X    O    -
//          * X    -    -
//          * 
//          */

//         test("X wins verical left column", async () => {
//             const moves = [
//                 { row: 0, col: 0 },
//                 { row: 0, col: 1 },
//                 { row: 1, col: 0 },
//                 { row: 1, col: 1 },
//                 { row: 2, col: 0 }
//             ];
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const aliceAddress = accounts.alice.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(aliceAddress);
//         })

//         /**
//          * Game #4 Board
//          * 
//          * X    -    O
//          * X    -    O
//          * -    X    O
//          * 
//          */

//         test("O wins verical right column", async () => {
//             const moves = [
//                 { row: 0, col: 0 },
//                 { row: 0, col: 2 },
//                 { row: 2, col: 1 },
//                 { row: 1, col: 2 },
//                 { row: 1, col: 0 },
//                 { row: 2, col: 2 }
//             ];
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const bobAddress = accounts.bob.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(bobAddress);
//         });

//         // /**
//         //  * Game #5 Board
//         //  * 
//         //  * X    -    -
//         //  * O    X    O
//         //  * -    -    X
//         //  * 
//         //  */

//         test("X wins diagonal", async () => {
//             const moves = [
//                 { row: 0, col: 0 },
//                 { row: 1, col: 0 },
//                 { row: 1, col: 1 },
//                 { row: 1, col: 2 },
//                 { row: 2, col: 2 }
//             ]
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const aliceAddress = accounts.alice.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(aliceAddress);
//         });

//         /**
//          * Game #6 Board
//          * 
//          * -    X    O
//          * X    O    X
//          * O    -    -
//          * 
//          */

//         test("O wins diagonal", async () => {
//             const moves = [
//                 { row: 1, col: 0 },
//                 { row: 0, col: 2 },
//                 { row: 0, col: 1 },
//                 { row: 1, col: 1 },
//                 { row: 1, col: 2 },
//                 { row: 2, col: 0 },
//             ]
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const bobAddress = accounts.bob.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(bobAddress);
//         });

//         /**
//          * Game #7 Board
//          * 
//          * -    X    O
//          * -    X    -
//          * O    X    -
//          * 
//          */

//         test("X wins middle column", async () => {
//             const moves = [
//                 { row: 0, col: 1 },
//                 { row: 0, col: 2 },
//                 { row: 1, col: 1 },
//                 { row: 2, col: 0 },
//                 { row: 2, col: 1 },
//             ]
//             await playGame(activeGameIndex, moves, aliceContract, bobContract);
//             const game = await aliceContract.methods.get_game(activeGameIndex).view();
//             const aliceAddress = accounts.alice.getAddress().toBigInt();
//             expect(game.winner.address).toEqual(aliceAddress);
//         });
//     })
// });

