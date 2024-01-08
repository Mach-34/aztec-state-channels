import { ExecutionResult, ProofOutput, OutputNoteData } from "@aztec/types";
import { Point, VerificationKey } from "@aztec/circuits.js";
import {
    Contract,
    GrumpkinScalar,
    Schnorr
} from "@aztec/aztec.js";
import { SchnorrSignature } from "@aztec/circuits.js/barretenberg";

export type KernelProof = {
    proof: ProofOutput,
    verificationKey: VerificationKey,
    outputNotes: OutputNoteData[],
    executionResult: ExecutionResult,
}

export const emptyCapsuleStack = async (contract: Contract) => {
    try {
        await contract.methods.clear_capsule_stack().send().wait();
    } catch (err) { }
}

/**
 * Converts a number to a 32 byte hex string so structure mirrors Noir's for accurate hashing
 * 
 * @param {BigInt | number} num - number to be hexlified
 * @returns 32 bytes hex string
 */
export const numToHex = (num: BigInt | number) => {
    // Add missing padding based of hex number length
    return num.toString(16).padStart(64, '0');
}

export const signSchnorr = (msg: Uint8Array, privkey: GrumpkinScalar): Uint8Array => {
    const schnorr = new Schnorr();
    const signature = schnorr.constructSignature(msg, privkey);
    return new Uint8Array(signature.toBuffer());
}

export const verifySchnorr = (msg: Uint8Array, pubkey: Point, signature: Uint8Array): boolean => {
    const schnorr = new Schnorr();
    const schnorrSignature = SchnorrSignature.fromBuffer(Buffer.from(signature));
    return schnorr.verifySignature(msg, pubkey, schnorrSignature);
}
