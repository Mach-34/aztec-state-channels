import { AccountWalletWithPrivateKey, Contract } from "@aztec/aztec.js";
import { signSchnorr } from "./index.js";
import { Move } from "./move.js";

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

// export const playGame = async (
//   gameId: BigInt,
//   moves: Move[],
//   host: Contract,
//   player: Contract
// ) => {
//   for (let i = 0; i < moves.length; i++) {
//     const { row, col } = moves[i];
//     if (i % 2 === 0) {
//       await host.methods.turn(gameId, row, col).send().wait();
//     } else {
//       await player.methods.turn(gameId, row, col).send().wait();
//     }
//   }
// };
