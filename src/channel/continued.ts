import {
  AppExecutionResult,
  Note,
  NoteAndSlot,
  TxReceipt,
  TxStatus,
} from "@aztec/circuit-types";
import { AztecAddress } from "@aztec/circuits.js";
import { TicTacToeContract } from "../artifacts/TicTacToe.js";
import {
  AccountWalletWithPrivateKey,
  Contract,
  PXE,
  FunctionSelector,
  Fr,
  SentTx,
} from "@aztec/aztec.js";
import {
  // prepareMoves,
  serializeSignature,
  emptyCapsuleStack,
  signSchnorr,
  numToHex,
  Move,
  Turn,
  encapsulateTurn,
} from "../utils/index.js";
import { SchnorrSignature } from "@aztec/circuits.js/barretenberg";

export type OpenChannelSignature = {
  from: AztecAddress;
  sig: [Fr, Fr, Fr];
};

export class ContinuedStateChannel {
  /** Ordered array of  `turn` app circuit simulations */
  public turnResults: AppExecutionResult[] = [];
  /** Running top-level simulation of `orchestrator` app circuit (will be highest level on call "orchestrate") */
  public orchestratorResult: AppExecutionResult | undefined;

  // FUNCTION SELECTORS //
  public functionSelectors = {
    turn: FunctionSelector.fromSignature("turn(Field)"),
    orchestrate: FunctionSelector.fromSignature("orchestrator(Field)"),
  };

  constructor(
    /** PXE Client */
    public readonly pxe: PXE,
    /** Account to sign and send with */
    public readonly account: AccountWalletWithPrivateKey,
    /** Contract address of deployed tic_tac_toe.nr instance */
    public readonly contractAddress: AztecAddress,
    /** Index of the game to play */
    public readonly gameIndex: bigint,
    /** Turn index to continue from */
    public readonly startIndex: number,
    /** Starting Note */
    public readonly startingNote: NoteAndSlot
  ) {}

  /**
   * Build a move object supplementing channel state
   *
   * @param row - the x coordinate of the move
   * @param col - the y coordinate of the move
   * @returns - a move message for the given game and turn
   */
  public buildMove(row: number, col: number): Move {
    return new Move(
      this.account.getAddress(),
      row,
      col,
      this.turnResults.length + this.startIndex,
      this.gameIndex
    );
  }

  /**
   * Execute the simulation for the `turn` app circuit. Stores execution result
   *
   * @param account - the account wallet to use within the PXE with this contract
   * @param guestSignature - the `challenger` signature consenting to the channel open
   */
  public async turn(
    move: Move,
    opponentSignature?: SchnorrSignature
  ): Promise<AppExecutionResult> {
    // ensure subsequent turns can be built from the previously stored turn
    if (this.checkChannelOver()) throw new Error("Game is already over!");
    // get contract
    const contract = await this.getContract();
    // ensure pxe is sanitized
    await emptyCapsuleStack(contract);
    // add the turn proving time advice to the capsule stack
    let turnCapsule = encapsulateTurn({
      move: move,
      signatures: {
        sender: move.sign(this.account),
        opponent: opponentSignature,
      },
      timeout: opponentSignature === undefined,
    });
    await this.account.addCapsule(turnCapsule);
    // get the packed arguments for the call
    let packedArguments = await contract.methods
      .turn(this.gameIndex)
      .create()
      .then((request) => request.packedArguments[0]);
    // get execution notes and nullifiers
    let notes = this.getNotesForTurn();
    console.log(`Turn ${move.turnIndex} note length: ${notes.length}`);
    // calculate the current side effect counter
    let sideEffectCounter = this.getTurnSideEffectCounter();
    console.log(`Turn ${move.turnIndex} side effect counter: ${sideEffectCounter}`);
    // simulate the turn to get the app execution result
    const result = await this.account.simulateAppCircuit(
      packedArguments,
      this.functionSelectors.turn,
      notes,
      this.contractAddress,
      this.contractAddress,
      sideEffectCounter
    );
    this.turnResults.push(result);
    return result;
  }

  /**
   * Orchestrate the full state channel app logic execution given a complete game
   * @dev does not include entrypoint yet
   * @param account - the account that will post the state channel onchain
   */
  public async orchestrate() {
    // ensure the channel is not already orchestrated
    if (this.orchestratorResult) {
      throw new Error(
        `Channel for game id ${this.gameIndex} already orchestrated!`
      );
    }

    const contract = await this.getContract();
    // get the packed arguments for the call (reusable)
    let packedArguments = await contract.methods
      .orchestrator(this.gameIndex)
      .create()
      .then((request) => request.packedArguments[0]);
    // loop through all app execution circuits and build the nested executions, saving first orchestrator for outside loop
    let numTurns = this.turnResults.length;
    while (numTurns >= 0) {
      // get the turn results used in this orchestrator call
      let numElements = numTurns % 3;
      let startIndex =
        numElements === 0 ? numTurns - 3 : numTurns - numElements;
      let cachedSimulations = this.turnResults.slice(startIndex, numTurns);
      if (this.orchestratorResult)
        cachedSimulations.push(this.orchestratorResult);
      cachedSimulations = cachedSimulations.reverse();
      // get notes and nullified vector for the orchestrator (starts with output of turn before first in cached simulations)
      let notes = this.getNotesForTurn(startIndex - 1);
      // get the side effect counter for the orchestrator (always 1 - the side effect counter for first turn in orchestrator)
      let sideEffectCounter = this.getTurnSideEffectCounter(startIndex) - 1;
      // simulate the orchestrator iteration
      this.orchestratorResult = await this.account.simulateAppCircuit(
        packedArguments,
        this.functionSelectors.orchestrate,
        notes,
        startIndex === 0 ? this.account.getAddress() : this.contractAddress,
        this.contractAddress,
        sideEffectCounter,
        cachedSimulations
      );
      // decrement numTurns according to the number of simulations cached
      numTurns = startIndex;
    }
  }

  /**
   * Finalizes a state channel onchain
   * @param account - the account that will post the state channel onchain
   *
   * @returns - the transaction receipt, assuming it is mined (throws on failure)
   */
  public async finalize(): Promise<TxReceipt> {
    // if individual turns/ channel open have not been orchestrated yet, do so
    if (!this.orchestratorResult) {
      await this.orchestrate();
    }
    // get contract
    const contract = await this.getContract();
    // construct the full tx request to post on chain
    let request = await contract.methods.orchestrator(this.gameIndex).create();
    let tx = await this.account.proveSimulatedAppCircuits(
      request,
      this.orchestratorResult!
    );
    // broadcast the transaction
    let result = await new SentTx(this.account, this.account.sendTx(tx)).wait();
    if (result.status !== TxStatus.MINED)
      throw new Error(`State channel finalization status is ${result.status}`);
    return this.account.getTxReceipt(result.txHash);
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
  public getNotesForTurn(turnIndex?: number): NoteAndSlot[] {
    // if no turns, return from openChannelResult
    if (this.turnResults.length === 0 || turnIndex === -1) {
      console.log("exiting get notes");
      return [this.startingNote];
    }
    // otherwise, return from last turn
    turnIndex = turnIndex ? turnIndex : this.turnResults.length - 1;
    console.log("================TURN INDEX: ", turnIndex);
    let turn = this.turnResults[turnIndex];
    // return note
    console.log("Turn: ", turnIndex);
    console.log("Notes: ", [turn.newNotes[turn.newNotes.length - 1]]);
    return [turn.newNotes[turn.newNotes.length - 1]];
  }

  /**
   * Get the side effect counter according to the stored state
   * @param index - the index to compute side effect counter for
   *
   * @returns - the side effect counter for the next increment
   */
  public getTurnSideEffectCounter(turnIndex?: number): number {
    // ensure valid turn index
    turnIndex = turnIndex ? turnIndex : this.turnResults.length;
    if (turnIndex > this.turnResults.length)
      throw new Error("Invalid turn index");
    if (turnIndex === 0) return 4;
    // if turn is 2 (using 0 index), or if turn > 3 and is a multiple of 3, increment by 2
    const incrementBy = this.turnResults.length % 3 === 0 ? 2n : 1n;
    const sideEffectCounter =
      this.turnResults[
        turnIndex - 1
      ].callStackItem.publicInputs.endSideEffectCounter.toBigInt() +
      incrementBy;
    return Number(sideEffectCounter);
  }

  /**
   * Return the contract instance connected to a specific signer
   * @param account - the account wallet to use within the PXE with this contract
   * @returns - the contract instance
   */
  public async getContract(): Promise<TicTacToeContract> {
    return await TicTacToeContract.at(this.contractAddress, this.account);
  }
}
