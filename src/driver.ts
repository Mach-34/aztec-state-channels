import {
    AztecAddress,
    DebugLogger,
    FieldLike,
    Fr,
    PXE,
    TxStatus,
    Wallet as AztecWallet,
    FunctionCall,
    TxExecutionRequest,
} from '@aztec/aztec.js';
import { KernelProofData } from '@aztec/types';
import { CounterStateChannelContract } from './artifacts/CounterStateChannel.js';
import { ExecutionResult } from '@aztec/types';
// import { KernelProof } from './utils.js';

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
    const deployReceipt = await CounterStateChannelContract.deploy(aztecWallet)
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
    ) { }

    /**
     * Initialize a new counter counter for a given account
     * 
     * @param from - the AztecWallet to initialize the counter for
     * @param start - the starting value for the counter
     * @param end - the ending value to stop the counter at once reached
     */
    async initializeCounter(from: AztecWallet, start: number, end: number): Promise<void> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // send initialize tx
        const address = from.getCompleteAddress().address;
        const receipt = await contract.methods.init_counter(start, end, address).send().wait();
        // ensure tx was mined
        if (receipt.status !== TxStatus.MINED) throw new Error(`Initialize tx status is ${receipt.status}`);
    }

    /**
     * Increment the counter for a given account once (manually)
     * 
     * @param from - the AztecWallet to increment the counter for
     */
    async incrementManual(from: AztecWallet): Promise<void> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // send increment tx
        const address = from.getCompleteAddress().address;
        const receipt = await contract.methods.increment_single(address).send().wait();
        // ensure tx was mined
        if (receipt.status !== TxStatus.MINED) throw new Error(`Increment tx status is ${receipt.status}`);
    }

    async fullIncrementManual(from: AztecWallet): Promise<void> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // send increment tx
        const address = from.getCompleteAddress().address;
        const receipt = await contract.methods.increment_multiple(address).send().wait();
        // ensure tx was mined
        if (receipt.status !== TxStatus.MINED) throw new Error(`Increment tx status is ${receipt.status}`);
    }

    /**
     * Get the current count for a given account
     * 
     * @param from - the AztecWallet to get the count for
     * @return - the current count for the account
     */
    async getCounter(from: AztecWallet): Promise<{
        owner: FieldLike,
        value: FieldLike,
        end: FieldLike
    }> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // view increment balance
        const address = from.getCompleteAddress().address
        const note = await contract.methods.get_counter(address).view();
        // return the count
        return note;
    }

    async functionCall(from: AztecWallet): Promise<FunctionCall> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // generate the execution request for the increment tx
        const address = from.getCompleteAddress().address;
        const request = await contract.methods.increment_multiple(address).request();
        return request;
    }

    async simulate(from: AztecWallet): Promise<TxExecutionRequest> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // generate the execution request for the increment tx
        const address = from.getCompleteAddress().address;
        const request = await contract.methods.increment_multiple(address).create();
        const result = await from.simulate(request);
        return result;
    }

    async getSimulationParameters(from: AztecWallet): Promise<ExecutionResult> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // generate the execution request for the increment tx
        const address = from.getCompleteAddress().address;
        const request = await contract.methods.increment_multiple(address).create();
        // simulate the execution request
        const result = await this.pxe.getSimulationParameters(request);
        return result;
    }

    async initProof(from: AztecWallet): Promise<KernelProofData> {
        // connect wallet to contract
        const contract = await CounterStateChannelContract.at(this.contractAddress, from);
        // generate execution request
        const address = from.getCompleteAddress().address;
        const request = await contract.methods.increment_multiple(address).create();
        // generate the first proof (init proof) for the state channel via kernel proving
        const kernelProof = await from.proveInit(request);
        return kernelProof;
    }


    // /**
    //  * Construct the private call data for an iteration of the kernel prover
    //  */
    // async constructPrivateCallData(): Promise<PrivateCallData> {

    // }

    // /**
    //  * Initializes a state channel by constructing a kernel proof for the first iteration
    //  * that checks the integrity of the tx request
    //  */
    // async initStateChannel(): Promise<void> {

    // }

    // async constructKernelProof(firstIteration: boolean, previousProof?: ProofOutput): Promise<ProofOutput> {
    //     const executionStack = [executionResult];
    //     const newNotes: { [commitmentStr: string]: OutputNoteData } = {};
    //     let previousVerificationKey = VerificationKey.makeFake();

    //     let output: ProofOutput = {
    //         publicInputs: PrivateKernelPublicInputs.empty(),
    //         proof: makeEmptyProof()
    //     };


    // }
}