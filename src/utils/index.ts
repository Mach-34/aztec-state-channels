import { Point } from "@aztec/circuits.js";
import { GrumpkinScalar, Schnorr, Fr } from "@aztec/aztec.js";
import { SchnorrSignature } from "@aztec/circuits.js/barretenberg";

/**
 * Converts a number to a 32 byte hex string so structure mirrors Noir's for accurate hashing
 *
 * @param {BigInt | number} num - number to be hexlified
 * @returns 32 bytes hex string
 */
export const numToHex = (num: BigInt | number) => {
  // Add missing padding based of hex number length
  return num.toString(16).padStart(64, "0");
};

/**
 * Produces a schnorr signature over a given message with a given private key
 * @param msg - the message to sign
 * @param privkey - the key to sign the message with
 * @returns the signature over the message by privkey
 */
export const signSchnorr = (
  msg: Uint8Array,
  privkey: GrumpkinScalar
): Uint8Array => {
  const schnorr = new Schnorr();
  const signature = schnorr.constructSignature(msg, privkey);
  return new Uint8Array(signature.toBuffer());
};

/**
 * Verifies a schnorr signature over a given message with a given public key
 * @param msg - the message to verify
 * @param pubkey - the key to verify provenance of the signature
 * @param signature - the signature to verify
 * @returns
 */
export const verifySchnorr = (
  msg: Uint8Array,
  pubkey: Point,
  signature: Uint8Array
): boolean => {
  const schnorr = new Schnorr();
  const schnorrSignature = SchnorrSignature.fromBuffer(Buffer.from(signature));
  return schnorr.verifySignature(msg, pubkey, schnorrSignature);
};

/**
 * Serializes a signature from a signature buffer to 3 Fr elements
 * @param signature
 * @returns - the serialized signature as 3 Fr elements
 */
export const serializeSignature = (signature: Uint8Array) => {
  // Serialized signature to pass into the capsule. Signature is a Uint8Array of length 64
  // and must be split into chunks less than 32 bytes in size to no exceed Field size
  const s1 = Fr.fromBuffer(Buffer.from(signature.slice(0, 20)));
  const s2 = Fr.fromBuffer(Buffer.from(signature.slice(20, 40)));
  // 64 is not divisible by 3 so last slice will be be slightly larger
  const s3 = Fr.fromBuffer(Buffer.from(signature.slice(40)));
  return { s1, s2, s3 };
};

export * from "./move.js";
export * from "./interaction.js";
export * from "./capsule.js";
