import { AccountWalletWithPrivateKey, Fr, Contract } from "@aztec/aztec.js";
import { signSchnorr, serializeSignature, numToHex } from "./index.js";
import { Move, Turn } from "./move.js";
import { SchnorrSignature } from "@aztec/circuits.js/barretenberg";

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
    // Open channel capsule requires length 8 so pad extra value
    Fr.ZERO,
    Fr.ZERO
  ];
};

/**
 * Serializes a turn into a list of field elements ordered for capsule popping inside of witcalc
 * 
 * @param turn - the turn to serialize into a list of Fr elements 
 * @returns - a formatted capsule to push to stack
 */
export const encapsulateTurn = (turn: Turn) => {
  return [
    Fr.fromString(numToHex(turn.move.row)),
    Fr.fromString(numToHex(turn.move.col)),
    turn.move.sender,
    ...turn.signatures.sender.toFields(),
    ...(turn.signatures.opponent ?? SchnorrSignature.EMPTY).toFields(),
    Fr.fromString(numToHex(turn.timeout ? 1 : 0)),
  ].reverse();
};

export const emptyCapsuleStack = async (contract: Contract) => {
  try {
    await contract.methods.clear_capsule_stack().send().wait();
  } catch (err) {}
};
