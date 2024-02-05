import {
  AppExecutionResult,
  NoteAndSlot,
  TxReceipt,
  TxStatus,
} from "@aztec/circuit-types";
import { AztecAddress } from "@aztec/circuits.js";
import { TicTacToeContractArtifact } from "../../src/artifacts/TicTacToe.js";
import {
  AccountWalletWithPrivateKey,
  Contract,
  PXE,
  FunctionSelector,
  Fr,
  SentTx,
} from "@aztec/aztec.js";
import {
  prepareMoves,
  serializeSignature,
  emptyCapsuleStack,
  signSchnorr,
} from "./index.js";

export type OpenChannelSignature = {
  from: AztecAddress;
  sig: [Fr, Fr, Fr];
};

export class TicTacToeStateChannel {
  /** Simulation of the `open_channel` app circuit */
  public openChannelResult: AppExecutionResult | undefined;
  /** Ordered array of  `turn` app circuit simulations */
  public turnResults: AppExecutionResult[] = [];
  /** Running top-level simulation of `orchestrator` app circuit (will be highest level on call "orchestrate") */
  public orchestratorResult: AppExecutionResult | undefined;
  /** Cache of orchestrator side effects until we can figure out how to deterministically compute */
  public orchestratorSideEffectCache: number[] = [];

  // FUNCTION SELECTORS //
  public functionSelectors = {
    open: FunctionSelector.fromSignature("open_channel(Field)"),
    turn: FunctionSelector.fromSignature("turn(Field)"),
    orchestrate: FunctionSelector.fromSignature("orchestrator(Field)"),
  };

  constructor(
    /** PXE Client */
    public readonly pxe: PXE,
    /** Contract address of deployed tic_tac_toe.nr instance */
    public readonly contractAddress: AztecAddress,
    /** Index of the game to play */
    public readonly gameIndex: bigint
  ) {}

  /**
   * Generate the signature needed to open a channel
   * @dev TODO: add game id to the message
   *
   * @param from
   * @param opponent
   * @param isGuest
   * @returns
   */
  public static signOpenChannel(
    from: AccountWalletWithPrivateKey,
    opponent: AztecAddress,
    isGuest?: boolean
  ): OpenChannelSignature {
    let senderAddress = from.getAddress();
    const channelMsg = new Uint8Array(64);
    // serialize the message according to host and guest
    let host = isGuest
      ? Uint8Array.from(opponent.toBuffer())
      : Uint8Array.from(senderAddress.toBuffer());
    let guest = isGuest
      ? Uint8Array.from(senderAddress.toBuffer())
      : Uint8Array.from(opponent.toBuffer());
    channelMsg.set(Uint8Array.from(host), 0);
    channelMsg.set(Uint8Array.from(guest), 32);
    // sign the channel open message
    const signature = signSchnorr(channelMsg, from.getEncryptionPrivateKey());
    const { s1, s2, s3 } = serializeSignature(signature);
    return {
      from: senderAddress,
      sig: [s1, s2, s3],
    };
  }

  /**
   * Execute the simulation for the `open_channel` app circuit. Stores execution result
   * @dev expects no notes to be present
   *
   * @param account - the account wallet to use within the PXE with this contract
   * @param guestSignature - the `challenger` signature consenting to the channel open
   */
  public async openChannel(
    account: AccountWalletWithPrivateKey,
    guestSignature: OpenChannelSignature
  ) {
    // ensure channel is not already opened
    if (this.openChannelResult) {
      throw new Error(`Channel for game id ${this.gameIndex} already opened!`);
    }
    // get contract
    const contract = await this.getContract(account);
    // ensure capsule stack is sanitized
    await emptyCapsuleStack(contract);
    // build the host's channel open signature
    let hostSignature = TicTacToeStateChannel.signOpenChannel(
      account,
      guestSignature.from
    );
    // add the open_channel proving time advice to the capsule stack
    let openChannelCapsule = [
      hostSignature.from,
      guestSignature.from,
      ...hostSignature.sig,
      ...guestSignature.sig,
    ];
    await this.pxe.addCapsule(openChannelCapsule);
    // get the packed arguments for the call
    let packedArguments = await contract.methods
      .open_channel(this.gameIndex)
      .create()
      .then((request) => request.packedArguments[0]);
    // simulate the open_channel call
    let sideEffectCounter = 3; // always 3 on open_channel
    this.openChannelResult = await account.simulateAppCircuit(
      packedArguments,
      this.functionSelectors.open,
      [], // no notes
      [], // no notes
      this.contractAddress,
      this.contractAddress,
      sideEffectCounter
    );
    // push orchestrator side effect start (will also always be 3 (why tho))
    this.orchestratorSideEffectCache.push(sideEffectCounter);
  }

  /**
   * Execute the simulation for the `turn` app circuit. Stores execution result
   *
   * @param account - the account wallet to use within the PXE with this contract
   * @param guestSignature - the `challenger` signature consenting to the channel open
   */
  public async turn(
    account: AccountWalletWithPrivateKey,
    move: { row: number; col: number }
  ) {
    // ensure subsequent turns can be built from the previously stored turn
    if (this.checkChannelOver()) throw new Error("Game is already over!");
    // get contract
    const contract = await this.getContract(account);
    // ensure pxe is sanitized
    await emptyCapsuleStack(contract);
    // add the turn proving time advice to the capsule stack
    let turn = this.turnResults.length;
    let capsuleMove = { row: move.row, col: move.col, player: account };
    let moveCapsule = prepareMoves(this.gameIndex, [capsuleMove], turn)[0];
    await this.pxe.addCapsule(moveCapsule);
    // get the packed arguments for the call
    let packedArguments = await contract.methods
      .turn(this.gameIndex)
      .create()
      .then((request) => request.packedArguments[0]);
    // get execution notes and nullifiers
    let { notes, nullified } = this.getNotesAndNullified();
    // calculate the current side effect counter
    let sideEffectCounter = this.getSideEffectCounter();
    // simulate the turn to get the app execution result
    this.turnResults.push(
      await account.simulateAppCircuit(
        packedArguments,
        this.functionSelectors.turn,
        notes,
        nullified,
        this.contractAddress,
        this.contractAddress,
        sideEffectCounter
      )
    );
    // push orchestrator side effect cache if next call will be orchestrator
    if (this.turnResults.length % 2 === 0 && !this.checkChannelOver()) {
      // get side effect from last turn
      let lastTurn = this.turnResults[this.turnResults.length - 1];
      let lastSideEffectCounter =
        lastTurn.callStackItem.publicInputs.endSideEffectCounter.toBigInt();
      // push the side effect counter to the cache
      this.orchestratorSideEffectCache.push(Number(lastSideEffectCounter + 1n));
    }
  }

  /**
   * Orchestrate the full state channel app logic execution given a complete game
   * @dev does not include entrypoint yet
   * @param account - the account that will post the state channel onchain
   */
  public async orchestrate(account: AccountWalletWithPrivateKey) {
    // ensure the channel is not already orchestrated
    if (this.orchestratorResult) {
      throw new Error(
        `Channel for game id ${this.gameIndex} already orchestrated!`
      );
    }
    // ensure the game is over
    if (!this.checkChannelOver()) {
      throw new Error(`Game for game id ${this.gameIndex} is not over yet!`);
    }
    // get contract
    const contract = await this.getContract(account);
    // get the packed arguments for the call (reusable)
    let packedArguments = await contract.methods
      .orchestrator(this.gameIndex)
      .create()
      .then((request) => request.packedArguments[0]);
    // loop through all app execution circuits and build the nested executions, saving first orchestrator for outside loop
    let numTurns = this.turnResults.length;
    while (numTurns > 2) {
      // get the turn results used in this orchestrator call
      let startIndex = numTurns % 2 === 0 ? numTurns - 2 : numTurns - 1;
      let cachedSimulations = this.turnResults.slice(startIndex, numTurns);
      if (this.orchestratorResult)
        cachedSimulations.push(this.orchestratorResult);
      cachedSimulations = cachedSimulations.reverse();
      // get notes and nullified vector for the orchestrator (starts with output of turn before first in cached simulations)
      let { notes, nullified } = this.getNotesAndNullified(startIndex - 1);

      // simulate the orchestrator iteration
      this.orchestratorResult = await account.simulateAppCircuit(
        packedArguments,
        this.functionSelectors.orchestrate,
        notes,
        nullified,
        this.contractAddress,
        this.contractAddress,
        this.orchestratorSideEffectCache.pop()!,
        cachedSimulations
      );
      // decrement numTurns according to the number of simulations cached
      numTurns = startIndex;
    }
    // simulate the first orchestrator with the open channel result
    let cachedSimulations = [
      this.orchestratorResult!,
      this.turnResults[1],
      this.turnResults[0],
      this.openChannelResult!,
    ];
    this.orchestratorResult = await account.simulateAppCircuit(
      packedArguments,
      this.functionSelectors.orchestrate,
      [],
      [],
      account.getAddress(),
      this.contractAddress,
      this.orchestratorSideEffectCache.pop()!,
      cachedSimulations
    );
  }

  /**
   * Finalizes a state channel onchain
   * @param account - the account that will post the state channel onchain
   *
   * @returns - the transaction receipt, assuming it is mined (throws on failure)
   */
  public async finalize(
    account: AccountWalletWithPrivateKey
  ): Promise<TxReceipt> {
    // if individual turns/ channel open have not been orchestrated yet, do so
    console.log("orchestrator result: ", this.orchestratorResult);
    if (!this.orchestratorResult) {
      await this.orchestrate(account);
    }
    // get contract
    const contract = await this.getContract(account);
    // construct the full tx request to post on chain
    let request = await contract.methods.orchestrator(this.gameIndex).create();
    let tx = await account.proveSimulatedAppCircuits(
      request,
      this.orchestratorResult!
    );

    // broadcast the transaction
    let result = await new SentTx(this.pxe, account.sendTx(tx)).wait();
    if (result.status !== TxStatus.MINED)
      throw new Error(`State channel finalization status is ${result.status}`);
    return account.getTxReceipt(result.txHash);
  }

  /**
   * Inserts a turn execution result built by a counterparty
   * @dev NOT USED CURRENTLY
   * @param turn - the turn sim result to insert
   */
  public insertTurn(turn: AppExecutionResult) {
    this.turnResults.push(turn);
  }

  /**
   * Inserts a channel open execution result built by a counterparty
   * @dev NOT USED CURRENTLY
   * @param openChannel - the channel opening sim result to insert
   */
  public insertOpenChannel(openChannel: AppExecutionResult) {
    this.openChannelResult = openChannel;
  }

  /**
   * Determines based on latest turn result's return value if the game is over
   * @returns - true if the game is over, false otherwise
   */
  public checkChannelOver(): boolean {
    // game cannot be over if no turns have been made
    if (this.turnResults.length === 0) return false;
    // get the latest turn result
    let turn = this.turnResults[this.turnResults.length - 1];
    // get the public return value from the turn
    let isOver = turn.callStackItem.publicInputs.returnValues[0];
    // check if isOver == Fr(1)
    return isOver.equals(new Fr(1));
  }

  /**
   * Returns the execution notes and nullified bool vector given stored state
   *
   * @param turnIndex - the index of the turn to get notes for (defaults to last turn if not provided)
   * @returns notes - the execution notes used so far
   * @returns nullified - the nullified bool vector used so far (corresponds to execution notes)
   */
  public getNotesAndNullified(turnIndex?: number) {
    // if no turns, return from openChannelResult
    if (this.turnResults.length === 0) {
      // should always be [note], [false]
      return {
        notes: this.openChannelResult!.newNotes,
        nullified: this.openChannelResult!.newNotes.map(() => false),
      };
    }
    turnIndex = turnIndex ? turnIndex : this.turnResults.length - 1;
    // otherwise, return from last turn
    let turn = this.turnResults[turnIndex];
    // nullify all notes except last one
    let nullified = [];
    for (let i = 0; i < turn.newNotes.length - 1; i++) {
      nullified.push(true);
    }
    nullified.push(false);
    // return notes and nullified vector
    return {
      notes: turn.newNotes,
      nullified: nullified,
    };
  }

  /**
   * Get the side effect counter according to the stored state
   * @returns - the side effect counter for the next increment
   */
  public getSideEffectCounter(): number {
    let sideEffectCounter = 0n;
    if (this.turnResults.length === 0) {
      // should always return 5 + 1
      sideEffectCounter =
        this.openChannelResult!.callStackItem.publicInputs.endSideEffectCounter.toBigInt() +
        1n;
    } else {
      // if turn % 2 == 1, add 1 to side effect counter else return 2
      let turn = this.turnResults.length;
      let incrementBy = turn % 2 === 1 ? 1n : 2n;
      sideEffectCounter =
        this.turnResults[
          turn - 1
        ].callStackItem.publicInputs.endSideEffectCounter.toBigInt() +
        incrementBy;
      // @dev will change when 3 turns is possible inside one orchestrator
    }
    return Number(sideEffectCounter);
  }

  /**
   * Return the contract instance connected to a specific signer
   * @param account - the account wallet to use within the PXE with this contract
   * @returns - the contract instance
   */
  public async getContract(account: AccountWalletWithPrivateKey) {
    return await Contract.at(
      this.contractAddress,
      TicTacToeContractArtifact,
      account
    );
  }
}