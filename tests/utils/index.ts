import { AccountWalletWithPrivateKey } from "@aztec/aztec.js";
import { Turn, Move } from "../../src/utils/move.js";

export type RawMove = {
  row: number;
  col: number;
  timeout?: boolean;
};

export const prepareTurns = (
  moves: RawMove[],
  gameIndex: BigInt,
  host: AccountWalletWithPrivateKey,
  challenger: AccountWalletWithPrivateKey,
  startIndex: number = 0
): Turn[] => {
  return moves.map((rawMove, i) => {
    const sender = i % 2 === 0 ? host : challenger;
    const opponent = i % 2 === 0 ? challenger : host;
    console.log("Sender Address: ", sender.getAddress());
    console.log("Opponent Address: ", opponent.getAddress());
    const turnIndex = i + startIndex;
    let move = new Move(
      sender.getAddress(),
      rawMove.row,
      rawMove.col,
      turnIndex,
      gameIndex
    );
    let signatures = {
      sender: move.sign(sender),
      opponent: rawMove.timeout ? undefined : move.sign(opponent),
    };
    return { move, signatures, timeout: rawMove.timeout };
  });
};
