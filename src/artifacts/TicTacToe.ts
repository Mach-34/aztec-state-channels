
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
  Point,
  PublicKey,
  Wallet,
} from '@aztec/aztec.js';
import TicTacToeContractArtifactJson from './TicTacToe.json' assert { type: 'json' };
export const TicTacToeContractArtifact = TicTacToeContractArtifactJson as ContractArtifact;

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
    return new DeployMethod<TicTacToeContract>(Point.ZERO, wallet, TicTacToeContractArtifact, Array.from(arguments).slice(1));
  }

  /**
   * Creates a tx to deploy a new instance of this contract using the specified public key to derive the address.
   */
  public static deployWithPublicKey(publicKey: PublicKey, wallet: Wallet, ) {
    return new DeployMethod<TicTacToeContract>(publicKey, wallet, TicTacToeContractArtifact, Array.from(arguments).slice(2));
  }
  

  
  /**
   * Returns this contract's artifact.
   */
  public static get artifact(): ContractArtifact {
    return TicTacToeContractArtifact;
  }
  

  /** Type-safe wrappers for the public methods exposed by the contract. */
  public methods!: {
    
    /** clear_capsule_stack() */
    clear_capsule_stack: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** compute_note_hash_and_nullifier(contract_address: field, nonce: field, storage_slot: field, preimage: array) */
    compute_note_hash_and_nullifier: ((contract_address: FieldLike, nonce: FieldLike, storage_slot: FieldLike, preimage: FieldLike[]) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** current_game_index() */
    current_game_index: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_current_game_index() */
    get_current_game_index: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_game(index: field) */
    get_game: ((index: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** increment_current_game_index() */
    increment_current_game_index: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** open_channel(host: field, player: field, host_signature: array, player_signature: array, game_id: field) */
    open_channel: ((host: FieldLike, player: FieldLike, host_signature: (bigint | number)[], player_signature: (bigint | number)[], game_id: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** play_game(game_id: field) */
    play_game: ((game_id: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** test_capsule() */
    test_capsule: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** test_move_signature(account: field, game_index: field, turn: integer, row: integer, col: integer, s_1: field, s_2: field, s_3: field) */
    test_move_signature: ((account: FieldLike, game_index: FieldLike, turn: (bigint | number), row: (bigint | number), col: (bigint | number), s_1: FieldLike, s_2: FieldLike, s_3: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** test_note_removal_from_set() */
    test_note_removal_from_set: (() => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;
  };
}
