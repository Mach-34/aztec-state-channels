
/* Autogenerated file, do not edit! */

/* eslint-disable */
import {
  AztecAddress,
  AztecAddressLike,
  CompleteAddress,
  Contract,
  ContractArtifact,
  ContractBase,
  ContractFunctionInteraction,
  ContractMethod,
  DeployMethod,
  EthAddress,
  EthAddressLike,
  FieldLike,
  Fr,
  FunctionSelectorLike,
  loadContractArtifact,
  NoirCompiledContract,
  Point,
  PublicKey,
  Wallet,
} from '@aztec/aztec.js';
import TicTacToeContractArtifactJson from './TicTacToe.json' assert { type: 'json' };
export const TicTacToeContractArtifact = loadContractArtifact(TicTacToeContractArtifactJson as NoirCompiledContract);

/**
 * Type-safe interface for contract TicTacToe;
 */
export class TicTacToeContract extends ContractBase {
  
  private constructor(
    completeAddress: CompleteAddress,
    wallet: Wallet,
    portalContract = EthAddress.ZERO
  ) {
    super(completeAddress, TicTacToeContractArtifact, wallet, portalContract);
  }
  

  
  /**
   * Creates a contract instance.
   * @param address - The deployed contract's address.
   * @param wallet - The wallet to use when interacting with the contract.
   * @returns A promise that resolves to a new Contract instance.
   */
  public static async at(
    address: AztecAddress,
    wallet: Wallet,
  ) {
    return Contract.at(address, TicTacToeContract.artifact, wallet) as Promise<TicTacToeContract>;
  }

  
  /**
   * Creates a tx to deploy a new instance of this contract.
   */
  public static deploy(wallet: Wallet, ) {
    return new DeployMethod<TicTacToeContract>(Point.ZERO, wallet, TicTacToeContractArtifact, TicTacToeContract.at, Array.from(arguments).slice(1));
  }

  /**
   * Creates a tx to deploy a new instance of this contract using the specified public key to derive the address.
   */
  public static deployWithPublicKey(publicKey: PublicKey, wallet: Wallet, ) {
    return new DeployMethod<TicTacToeContract>(publicKey, wallet, TicTacToeContractArtifact, TicTacToeContract.at, Array.from(arguments).slice(2));
  }
  

  
  /**
   * Returns this contract's artifact.
   */
  public static get artifact(): ContractArtifact {
    return TicTacToeContractArtifact;
  }
  

  /** Type-safe wrappers for the public methods exposed by the contract. */
  public methods!: {
    
    /** answer_timeout(game_id: field, row: integer, col: integer) */
    answer_timeout: ((game_id: FieldLike, row: (bigint | number), col: (bigint | number)) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** dispute_timeout(game_id: field, turn_index: integer, move: array, signature: array) */
    dispute_timeout: ((game_id: FieldLike, turn_index: (bigint | number), move: (bigint | number)[], signature: (bigint | number)[]) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_game(index: field) */
    get_game: ((index: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** claim_timeout_win(game_index: field) */
    claim_timeout_win: ((game_index: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_current_game_index() */
    get_current_game_index: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** claim_fraud_win(game_id: field, turn_index: integer, first_move: array, second_move: array, first_signature: array, second_signature: array) */
    claim_fraud_win: ((game_id: FieldLike, turn_index: (bigint | number), first_move: (bigint | number)[], second_move: (bigint | number)[], first_signature: (bigint | number)[], second_signature: (bigint | number)[]) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** open_channel(game_id: field) */
    open_channel: ((game_id: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** clear_capsule_stack() */
    clear_capsule_stack: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** test_capsule() */
    test_capsule: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_game_note_hash(index: field) */
    get_game_note_hash: ((index: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** orchestrator(game_id: field, turn_index: field) */
    orchestrator: ((game_id: FieldLike, turn_index: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_board(index: field) */
    get_board: ((index: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_timeout(hash: field) */
    get_timeout: ((hash: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** trigger_timeout(game_id: field) */
    trigger_timeout: ((game_id: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** turn(game_id: field) */
    turn: ((game_id: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** compute_note_hash_and_nullifier(contract_address: struct, nonce: field, storage_slot: field, preimage: array) */
    compute_note_hash_and_nullifier: ((contract_address: AztecAddressLike, nonce: FieldLike, storage_slot: FieldLike, preimage: FieldLike[]) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;
  };
}
