import { expect, jest, test, describe, beforeAll } from '@jest/globals';
import {
    AccountWallet,
    DebugLogger,
    createDebugLogger,
    createPXEClient,
    CheatCodes,
    PXE
} from '@aztec/aztec.js';
import { createAccount } from '@aztec/accounts/testing';
import { StateChannelDriver } from './driver.js';
import 'dotenv/config';

const {
    PXE_URL = 'http://localhost:8080',
    ETHEREUM_URL = 'http://localhost:8545',
} = process.env;

describe('State Channel', () => {
    jest.setTimeout(1500000);
    let pxe: PXE;
    let logger: DebugLogger;
    let accounts: {
        alice: AccountWallet,
        bob: AccountWallet
    };
    let driver: StateChannelDriver;
    let cc: CheatCodes;

    beforeAll(async () => {
        // initialize logger
        logger = createDebugLogger("statechannel");

        // initialize sandbox connection
        pxe = await createPXEClient(PXE_URL);

        // initialize aztec signers
        accounts = {
            alice: await createAccount(pxe),
            bob: await createAccount(pxe),
        }
        // initialilze driver
        driver = await StateChannelDriver.new(pxe, accounts.alice, logger, 0);
        // initialize cheat codes
        cc = await CheatCodes.create(ETHEREUM_URL, pxe);
        logger("Initialized Test Environment")
    })

    test("Initialize Counters", async () => {
        // initialize alice
        await driver.initializeCounter(accounts.alice, 0, 2);
        // initialize bob
        await driver.initializeCounter(accounts.bob, 0, 5);
    })

    // test("Increment Counter", async () => {
    //     // initialize the counter
    //     await driver.initializeCounter(accounts.alice, 0, 10);
    //     // increment the counter
    //     const counter = await driver.getCount(accounts.alice);
    //     expect(counter).toEqual(0n);
    //     await driver.incrementManual(accounts.alice);
    //     let newCounter = await driver.getCount(accounts.alice);
    //     expect(newCounter).toEqual(1n);
    //     await driver.incrementManual(accounts.alice);
    //     newCounter = await driver.getCount(accounts.alice);
    //     expect(newCounter).toEqual(2n);
    // });

    // test("Full increment", async () => {
    //     // initialize the counter
    //     await driver.initializeCounter(accounts.bob, 0, 4);
    //     // increment the counter to end in one tx
    //     const counter = await driver.getCount(accounts.bob);
    //     expect(counter).toEqual(0n);
    //     await driver.fullIncrementManual(accounts.bob);
    //     // const newCounter = await driver.getCount(accounts.bob);
    //     // expect(newCounter).toEqual(4n);
    // })

    // test("Function Call", async () => {
    //     const req = await driver.functionCall(accounts.alice);
    //     console.log("Object keys: ", Object.keys(req));
    //     console.log("Data: ", req);
    // });

    // test("Tx request", async () => {
    //     const req = await driver.simulate(accounts.alice);
    //     console.log("Object keys: ", Object.keys(req));
    //     console.log("Data: ", req);
    // });

    // test("Simulation parameters", async () => {
    //     const req = await driver.getSimulationParameters(accounts.alice);
    //     console.log("Object keys: ", Object.keys(req));
    //     console.log("Data: ", req);
    // })

    // test("Get simulation result", async () => {
    //     const result = await driver.simulate(accounts.alice);
    //     console.log("result: ", result);
    // })

    // test("Get the init kernel proof", async () => {
    //     const proof = await driver.initProof(accounts.alice);
    //     console.log("Object keys: ", Object.keys(proof));
    //     console.log("Data: ", proof);
    // })
});