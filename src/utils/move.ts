import {
  AccountWalletWithPrivateKey,
  GrumpkinPrivateKey,
} from "@aztec/aztec.js";
import { numToHex, signSchnorr, serializeSignature } from "./index.js";

export type Move = {
  row: number;
  col: number;
  player: AccountWalletWithPrivateKey;
  timeout?: boolean;
};

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
