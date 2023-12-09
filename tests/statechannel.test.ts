import { expect, jest, test, describe, beforeAll } from '@jest/globals';
import {
    AccountWallet,
    DebugLogger,
    createDebugLogger,
    createPXEClient,
    createAccount,
    CheatCodes,
    PXE
} from '@aztec/aztec.js';
import { StateChannelDriver } from '../src/driver.js';
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

    test("Increment Counter", async () => {
        const counter = await driver.getCount(accounts.alice);
        expect(counter).toEqual(0n);
        await driver.incrementCount(accounts.alice);
        const newCounter = await driver.getCount(accounts.alice);
        expect(newCounter).toEqual(1n);
    });
});
