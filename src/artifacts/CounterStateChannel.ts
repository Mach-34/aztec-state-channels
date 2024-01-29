
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
import CounterStateChannelContractArtifactJson from './CounterStateChannel.json' assert { type: 'json' };
export const CounterStateChannelContractArtifact = loadContractArtifact(CounterStateChannelContractArtifactJson as NoirCompiledContract);

/**
 * Type-safe interface for contract CounterStateChannel;
 */
export class CounterStateChannelContract extends ContractBase {
  
  private constructor(
    completeAddress: CompleteAddress,
    wallet: Wallet,
    portalContract = EthAddress.ZERO
  ) {
    super(completeAddress, CounterStateChannelContractArtifact, wallet, portalContract);
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
    return Contract.at(address, CounterStateChannelContract.artifact, wallet) as Promise<CounterStateChannelContract>;
  }

  
  /**
   * Creates a tx to deploy a new instance of this contract.
   */
  public static deploy(wallet: Wallet, ) {
    return new DeployMethod<CounterStateChannelContract>(Point.ZERO, wallet, CounterStateChannelContractArtifact, CounterStateChannelContract.at, Array.from(arguments).slice(1));
  }

  /**
   * Creates a tx to deploy a new instance of this contract using the specified public key to derive the address.
   */
  public static deployWithPublicKey(publicKey: PublicKey, wallet: Wallet, ) {
    return new DeployMethod<CounterStateChannelContract>(publicKey, wallet, CounterStateChannelContractArtifact, CounterStateChannelContract.at, Array.from(arguments).slice(2));
  }
  

  
  /**
   * Returns this contract's artifact.
   */
  public static get artifact(): ContractArtifact {
    return CounterStateChannelContractArtifact;
  }
  

  /** Type-safe wrappers for the public methods exposed by the contract. */
  public methods!: {
    
    /** init_counter(start: field, end: field, owner: struct) */
    init_counter: ((start: FieldLike, end: FieldLike, owner: AztecAddressLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** increment_single(owner: struct) */
    increment_single: ((owner: AztecAddressLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** increment_multiple(owner: field) */
    increment_multiple: ((owner: FieldLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** get_counter(owner: struct) */
    get_counter: ((owner: AztecAddressLike) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;

    /** compute_note_hash_and_nullifier(contract_address: struct, nonce: field, storage_slot: field, preimage: array) */
    compute_note_hash_and_nullifier: ((contract_address: AztecAddressLike, nonce: FieldLike, storage_slot: FieldLike, preimage: FieldLike[]) => ContractFunctionInteraction) & Pick<ContractMethod, 'selector'>;
  };
}
