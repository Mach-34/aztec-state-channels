# Aztec State Channels

## Instructions on Demo:

1. Ensure correct versioning of aztec nargo:
```console
aztec-nargo -V
// nargo version = 0.23.0
// noirc version = 0.23.0+602f23f4fb698cf6e37071936a2a46593a998d08
// (git version hash: 602f23f4fb698cf6e37071936a2a46593a998d08, is dirty: false)
```

2. Set up the proper folder structure for the imports as they currently exist
```
// Once everything is installed, you should have:
PARENT_DIR/
  | - aztec-packages
  | - statechannel
// such that npm imports in statechannel can access the local aztec-packages build with `file:../aztec-packages/yarn-project/*`
```

3. Install the fork of aztec-packages that has compatible @aztec/* for statechannel repo and runs a modified PXE through the sandbox that supports the state channel construction

3a. clone the repo in your parent dir: `git clone https://github.com/mach-34/aztec-packages && cd aztec-packages`

3b. ensure you are on the right branch: `git checkout app_circuit_pxe

3c. build the entire aztec-packages stack locally: `./bootstrap.sh`
- This can take over an hour. If you have a compatible version of aztec-packages already built locally, you can skip 99% of build time by only building yarn_project: `cd yarn_project && bootstrap.sh`
- You may experience issues building barretenberg. Visit the official [aztec-packages/barretenberg README.md](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg#dependencies) for some help with this 

4. Run the custom sandbox stack

4a. in a new terminal, run a local ethereum node: `anvil -p 8545 --host 0.0.0.0 --chain-id 31337`

4b. in the original terminal window (should be in PARENT_DIR/aztec-packages), do `cd ./yarn_project/aztec/ && yarn start`

5. Install the Aztec State Channels repository in a new terminal window
5a. in PARENT_DIR, run `git clone https://github.com/mach-34/aztec-state-channels && cd statechannel`
5b. ensuring `file:../aztec-packages/yarn-project/*` will work for package.json, run `npm i` (yarn will not work)

6. Run the state channel unit test: `npm run test tests/statechannel.test.ts`

## Modifications / Methodology
(TODO)

PXE
ACIR Simulator