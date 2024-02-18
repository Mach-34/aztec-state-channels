import { AccountWalletWithPrivateKey, Fr, Contract } from "@aztec/aztec.js";
import { signSchnorr, serializeSignature, numToHex } from "./index.js";
import { Move, genSerializedMoveSignature } from "./move.js";

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

export const emptyCapsuleStack = async (contract: Contract) => {
  try {
    await contract.methods.clear_capsule_stack().send().wait();
  } catch (err) {}
};
