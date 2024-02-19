import {
  AccountWalletWithPrivateKey,
  AztecAddress,
  Schnorr,
} from "@aztec/aztec.js";
import { numToHex, signSchnorr, serializeSignature } from "./index.js";
import { SchnorrSignature } from "@aztec/circuits.js/barretenberg";

/** The pure data used for a move */
export class Move {
  constructor(
    public readonly sender: AztecAddress,
    public readonly row: number,
    public readonly col: number,
    public readonly turnIndex: number,
    public readonly gameIndex: BigInt
  ) {}

  /**
   * Generate the message used in a move
   * @todo: should be pedersen hashed
   *
   * @returns - the message serialized in binary (but not as field elements)
   */
  public toMessage(): Uint8Array {
    const moveMsg = new Uint8Array(67);
    const addressBytes = Uint8Array.from(this.sender.toBuffer());
    const gameIndexBytes = Uint8Array.from(
      Buffer.from(numToHex(this.gameIndex), "hex")
    );
    moveMsg.set(addressBytes, 0);
    moveMsg.set(gameIndexBytes, 32);
    moveMsg.set([this.turnIndex, this.row, this.col], 64);
    return moveMsg;
  }

  /**
   * Produce a schnorr signature over the serialized move by the signer account's grumpkin key
   *
   * @param signer - the account to sign the data with
   * @returns - the schnorr signature over this move
   */
  public sign(signer: AccountWalletWithPrivateKey): SchnorrSignature {
    let message = this.toMessage();
    const schnorr = new Schnorr();
    return schnorr.constructSignature(
      message,
      signer.getEncryptionPrivateKey()
    );
  }
}

/** All data used in a turn() call */
export type Turn = {
  move: Move;
  signatures: {
    sender: SchnorrSignature; // the signature of the turn sender
    // the signature of the turn sender's counterparty (NOT EXPLICITLY GUEST)
    opponent?: SchnorrSignature; // undefined if timeout
  };
  // if true, should trigger a timeout
  timeout?: boolean;
};
