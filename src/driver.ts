import {
    AztecAddress,
    DebugLogger,
    FieldLike,
    Fr,
    PXE,
    TxStatus,
    Wallet as AztecWallet,
} from '@aztec/aztec.js';
import { CounterContract } from './artifacts/Counter.js';
import {
    PrivateCallData,
    PreviousKernelData,
    PrivateKernelInputsInit,
    PrivateKernelInputsInner,
    PrivateKernelInputsOrdering,
    PrivateKernelPublicInputs,
    makeEmptyProof,
    VerificationKey
} from '@aztec/circuits.js';
import { ExecutionResult, NoteAndSlot } from '@aztec/acir-simulator';
import {
    KernelProver,
    OutputNoteData,
} from '../node_modules/@aztec/pxe/dest/kernel_prover/kernel_prover.js';
import {
    ProofOutput,
    ProofCreator,
    KernelProofCreator
} from '../node_modules/@aztec/pxe/dest/kernel_prover/proof_creator.js';

/**
 * Deploy L2 Contract
 * @param aztecWallet - the aztec wallet instance
 * @param startingIndex - the index to start at for the contract
 * @returns 
 *  - contract: instance of the deployed l2 contract
 */
export async function deployAndInitialize(
    aztecWallet: AztecWallet,
    startingIndex: number,
): Promise<{
    contractAddress: AztecAddress;
}> {
    // get the address of the aztec wallet deploying the contract
    const address = aztecWallet.getCompleteAddress().address;
    // deploy the contract
    const deployReceipt = await CounterContract.deploy(aztecWallet, startingIndex, address)
        .send()
        .wait();
    // check that the deploy tx is confirmed
    if (deployReceipt.status !== TxStatus.MINED) throw new Error(`Deploy tx status is ${deployReceipt.status}`);
    // return the deployed contract address
    return { contractAddress: deployReceipt.contractAddress! }
}

/**
 * A driver class for aztec state channels
 */
export class StateChannelDriver {

    /**
     * Create a new test harness
     * 
     * @param pxe - private execution environment instance for aztec
     * @param aztecWallet - aztec wallet to deploy with
     * @param logger - debug logger for aztec rpc calls
     * @param startingIndex - the index to start at for the counter contract
     * @returns - new State Channel Driver instance
     */
    static async new(
        pxe: PXE,
        aztecWallet: AztecWallet,
        logger: DebugLogger,
        startingIndex: number,
    ): Promise<StateChannelDriver> {
        // Deploy and initialize all required contracts
        logger('Deploying and initializing Counter Contract on L2...');
        const { contractAddress } = await deployAndInitialize(aztecWallet, startingIndex);
        logger('Deployed and initialized token, portal and its bridge.');
        // return new instance of the state channel driver
        return new StateChannelDriver(
            pxe,
            logger,
            contractAddress,
            startingIndex,
            new KernelProofCreator(logger)
        );
    }

    constructor(
        /** Private eXecution Environment (PXE). */
        public pxe: PXE,
        /** Logger. */
        public logger: DebugLogger,
        /** L2 State Channel (counter) contract. */
        public contractAddress: AztecAddress,
        /** Starting index for the counter contract */
        public startingIndex: number,
        /** Kernel Proof Creator Instance */
        public proofCreator: ProofCreator
    ) { }

    /**
     * Increment the counter for a given account
     * 
     * @param from - the AztecWallet to send increment counter for
     */
    async incrementCount(from: AztecWallet): Promise<void> {
        // connect wallet to contract
        const contract = await CounterContract.at(this.contractAddress, from);
        // send increment tx
        const address = from.getCompleteAddress().address
        const receipt = await contract.methods.increment(address).send().wait();
        // ensure tx was mined
        if (receipt.status !== TxStatus.MINED) throw new Error(`Increment tx status is ${receipt.status}`);
    }

    /**
     * Get the current count for a given account
     * 
     * @param from - the AztecWallet to get the count for
     * @return - the current count for the account
     */
    async getCount(from: AztecWallet): Promise<FieldLike> {
        // connect wallet to contract
        const contract = await CounterContract.at(this.contractAddress, from);
        // view increment balance
        const address = from.getCompleteAddress().address
        const count = await contract.methods.get_counter(address).view();
        // return the count
        return count;
    }

    /**
     * Construct the private call data for an iteration of the kernel prover
     */
    async constructPrivateCallData(): Promise<PrivateCallData> {

    }

    /**
     * Initializes a state channel by constructing a kernel proof for the first iteration
     * that checks the integrity of the tx request
     */
    async initStateChannel(): Promise<void> {

    }

    async constructKernelProof(firstIteration: boolean, previousProof?: ProofOutput): Promise<ProofOutput> {
        const executionStack = [executionResult];
        const newNotes: { [commitmentStr: string]: OutputNoteData } = {};
        let previousVerificationKey = VerificationKey.makeFake();

        let output: ProofOutput = {
            publicInputs: PrivateKernelPublicInputs.empty(),
            proof: makeEmptyProof()
        };


    }
}