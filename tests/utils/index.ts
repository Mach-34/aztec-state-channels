import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  CompleteAddress,
  Contract,
  Fr,
  GrumpkinPrivateKey,
  Point,
  generatePublicKey,
  FunctionSelector,
  PXE,
} from "@aztec/aztec.js";
import {
  emptyCapsuleStack,
  numToHex,
  signSchnorr,
  verifySchnorr,
} from "../../src/utils.js";
import { NoteAndSlot } from "@aztec/circuit-types";
import { TicTacToeContractArtifact } from "../../src/artifacts/TicTacToe.js";

type Move = {
  row: number;
  col: number;
  player: AccountWalletWithPrivateKey;
  timeout?: boolean;
};

const TurnSelector = FunctionSelector.fromSignature("turn(Field)");

// export const generateCompleteAddress = (address: string): CompleteAddress => {
//     const aztecAddress = AztecAddress.fromString(address);
//     const publicKey = Point.fromString(address);
//     const partialAddress = Fr.fromString('');
// }

export const deserializeMoveSignature = (
  s1: BigInt,
  s2: BigInt,
  s3: BigInt
): Uint8Array => {
  const signature = new Uint8Array(64);
  const s1_bytes = Uint8Array.from(Buffer.from(numToHex(s1), "hex")).slice(12);
  const s2_bytes = Uint8Array.from(Buffer.from(numToHex(s2), "hex")).slice(12);
  const s3_bytes = Uint8Array.from(Buffer.from(numToHex(s3), "hex")).slice(8);

  signature.set(s1_bytes, 0);
  signature.set(s2_bytes, 20);
  signature.set(s3_bytes, 40);
  return signature;
};

export const genMoveMsg = (
  gameIndex: BigInt,
  turn: number,
  row: number,
  col: number
) => {
  const moveMsg = new Uint8Array(35);
  const gameIndexBytes = Uint8Array.from(
    Buffer.from(numToHex(gameIndex), "hex")
  );
  moveMsg.set(gameIndexBytes, 0);
  moveMsg.set([turn, row, col], 32);
  return moveMsg;
};

export const genSerializedMoveSignature = (
  gameIndex: BigInt,
  turn: number,
  row: number,
  col: number,
  privKey: GrumpkinPrivateKey
) => {
  // Message is formed by concatenating game index, move row, and move column together
  const moveMsg = genMoveMsg(gameIndex, turn, row, col);

  const signature = signSchnorr(moveMsg, privKey);

  return serializeSignature(signature);
};

// export const genSerializedStartSignature = (
//     turn: number,
//     row: number,
//     col: number,
//     privKey: GrumpkinPrivateKey
// ) => {
//     // Message is formed by concatenating game index, move row, and move column together
//     const moveMsg = genMoveMsg(gameIndex, turn, row, col);
//     const signature = signSchnorr(moveMsg, privKey);
//     return serializeSignature(signature)
// }

export const openChannel = async (
  contract: Contract,
  gameIndex: BigInt,
  host: AccountWalletWithPrivateKey,
  player: AccountWalletWithPrivateKey
) => {
  const hostAddress = host.getAddress();
  const playerAddress = player.getAddress();

  // Create open channel msg by concatenating host and player address bytes
  const channelMsg = new Uint8Array(64);
  channelMsg.set(Uint8Array.from(hostAddress.toBuffer()), 0);
  channelMsg.set(Uint8Array.from(playerAddress.toBuffer()), 32);

  const hostPrivkey = host.getEncryptionPrivateKey();
  const hostSignature = signSchnorr(channelMsg, hostPrivkey);

  const playerPrivkey = player.getEncryptionPrivateKey();
  const playerSignature = signSchnorr(channelMsg, playerPrivkey);

  await contract.methods
    .open_channel(
      hostAddress,
      playerAddress,
      hostSignature,
      playerSignature,
      gameIndex
    )
    .send()
    .wait();
};

export const playGame = async (
  gameId: BigInt,
  moves: Move[],
  host: Contract,
  player: Contract
) => {
  for (let i = 0; i < moves.length; i++) {
    const { row, col } = moves[i];
    if (i % 2 === 0) {
      await host.methods.turn(gameId, row, col).send().wait();
    } else {
      await player.methods.turn(gameId, row, col).send().wait();
    }
  }
};

// export const prepareGameStart = (alice: account: 2) => {

// }

export const prepareMoves = (
  gameIndex: BigInt,
  moves: Move[],
  startIndex: number = 0
) => {
  return moves
    .map((move, index) => {
      const privKey = move.player.getEncryptionPrivateKey();
      const { s1, s2, s3 } = genSerializedMoveSignature(
        gameIndex,
        index + startIndex,
        move.row,
        move.col,
        privKey
      );
      return [
        Fr.fromString(numToHex(move.row)),
        Fr.fromString(numToHex(move.col)),
        move.player.getAddress(),
        s1,
        s2,
        s3,
        Fr.fromString(numToHex(move.timeout ? 1 : 0)),
        Fr.fromString(numToHex(0)), // Open channel capsule requires length 8 so pad extra value
      ];
    })
    .reverse();
};

export const prepareOpenChannel = (
  alice: AccountWalletWithPrivateKey,
  bob: AccountWalletWithPrivateKey
) => {
  const aliceAddress = alice.getAddress();
  const bobAddress = bob.getAddress();

  // Create open channel msg by concatenating host and player address bytes
  const channelMsg = new Uint8Array(64);
  channelMsg.set(Uint8Array.from(aliceAddress.toBuffer()), 0);
  channelMsg.set(Uint8Array.from(bobAddress.toBuffer()), 32);

  const alicePrivkey = alice.getEncryptionPrivateKey();
  const aliceSignature = signSchnorr(channelMsg, alicePrivkey);
  const {
    s1: alice_s1,
    s2: alice_s2,
    s3: alice_s3,
  } = serializeSignature(aliceSignature);

  const bobPrivkey = bob.getEncryptionPrivateKey();
  const bobSignature = signSchnorr(channelMsg, bobPrivkey);
  const {
    s1: bob_s1,
    s2: bob_s2,
    s3: bob_s3,
  } = serializeSignature(bobSignature);

  return [
    aliceAddress,
    bobAddress,
    alice_s1,
    alice_s2,
    alice_s3,
    bob_s1,
    bob_s2,
    bob_s3,
  ];
};

export const serializeSignature = (signature: Uint8Array) => {
  // Serialized signature to pass into the capsule. Signature is a Uint8Array of length 64
  // and must be split into chunks less than 32 bytes in size to no exceed Field size
  const s1 = Fr.fromBuffer(Buffer.from(signature.slice(0, 20)));
  const s2 = Fr.fromBuffer(Buffer.from(signature.slice(20, 40)));
  // 64 is not divisible by 3 so last slice will be be slightly larger
  const s3 = Fr.fromBuffer(Buffer.from(signature.slice(40)));
  return { s1, s2, s3 };
};

// export const simulateTurn = async (
//   pxe: PXE,
//   account: AccountWalletWithPrivateKey,
//   contractAddress: AztecAddress,
//   gameIndex: BigInt,
//   move: { row: number; col: number; turn: number },
//   executionNotes: NoteAndSlot[],
//   nullified: boolean[],
//   sideEffectCounter: number
// ) => {
//   // connect to contract
//   let contract = await Contract.at(
//     contractAddress,
//     TicTacToeContractArtifact,
//     account
//   );
//   // ensure pxe is sanitized
//   await emptyCapsuleStack(contract);
//   // build capsule for turn
//   let capsuleMove = { row: move.row, col: move.col, player: account };
//   let moveCapsule = prepareMoves(gameIndex, [capsuleMove], move.turn)[0];
//   await pxe.addCapsule(moveCapsule);
//   // get execution context
//   let request = await contract.methods.turn(gameIndex).create();
//   let packedArgs = request.packedArguments[0];
//   // simulate the turn to get the app execution result
//   let result = await account.simulateAppCircuit(
//     packedArgs,
//     TurnSelector,
//     executionNotes,
//     nullified,
//     contractAddress,
//     contractAddress,
//     sideEffectCounter
//   );
//   return result;
// };

export { signSchnorr, emptyCapsuleStack };
export * from "./channel.js";