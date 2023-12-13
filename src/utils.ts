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