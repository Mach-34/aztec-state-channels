import { ExecutionResult, ProofOutput, OutputNoteData } from "@aztec/types";
import { VerificationKey } from "@aztec/circuits.js";
import { Contract } from "@aztec/aztec.js";

type Move = {
    row: number,
    col: number
}

export type KernelProof = {
    proof: ProofOutput,
    verificationKey: VerificationKey,
    outputNotes: OutputNoteData[],
    executionResult: ExecutionResult,
}

/**
 * Converts a number to a 32 byte hex string so structure mirrors Noir's for accurate hashing
 * 
 * @param {number} num - number to be hexlified
 * @returns 32 bytes hex string
 */
export const numToHex = (num: number) => {
    // Add missing padding based of hex number length
    return num.toString(16).padStart(64, '0');
}

export const playGame = async (gameId: BigInt, moves: Move[], host: Contract, player: Contract) => {
    for (let i = 0; i < moves.length; i++) {
        const { row, col } = moves[i];
        if (i % 2 === 0) {
            await host.methods.turn(gameId, row, col).send().wait();
        } else {
            await player.methods.turn(gameId, row, col).send().wait();
        }
    }
}