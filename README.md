# Aztec State Channels

## Installation
### 1. Ensure correct versioning of aztec-nargo CLI:
```console
aztec-nargo -V
// nargo version = 0.23.0
// noirc version = 0.23.0+602f23f4fb698cf6e37071936a2a46593a998d08
// (git version hash: ea6aebcc4e190d9dbadaf1dd0f70950651eed615,, is dirty: false)
```
You can run `VERSION=0.21.0 aztec-up` to ensure you have a valid aztec-nargo compiler cli

### 2. Set up the proper folder structure for the imports as they currently exist
```
// Once everything is installed, you should have:
PARENT_DIR/
  | - aztec-packages
  | - aztec-state-channels
// such that npm imports in statechannel can access the local aztec-packages build with `file:../aztec-packages/yarn-project/*`
```

### 3. Install the fork of aztec-packages that has compatible @aztec/* for statechannel repo and runs a modified PXE through the sandbox that supports the state channel construction

a. clone the repo in your parent dir: `git clone https://github.com/mach-34/aztec-packages && cd aztec-packages`

b. ensure you are on the right branch: `git checkout app_circuit_pxe`

c. build the entire aztec-packages stack locally: `./bootstrap.sh`
- This can take over an hour. If you have a compatible version of aztec-packages already built locally, you can skip 99% of build time by only building yarn_project: `cd yarn_project && bootstrap.sh`
- You may experience issues building barretenberg. Visit the official [aztec-packages/barretenberg README.md](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg#dependencies) for some help with this 

### 4. Install the Aztec State Channels repository in a new terminal window

a. in PARENT_DIR, run `git clone https://github.com/mach-34/aztec-state-channels && cd statechannel`

b. ensuring `file:../aztec-packages/yarn-project/*` will work for package.json, run `npm i` (yarn will not work)

## Running Tests

### 1. Start Services

a. In a new terminal in the `aztec-state-channels` folder, run a local Ethereum dev node with `npm run anvil`

b. In a new terminal in the `aztec-state-channels` folder, run the sandbox (and first PXE) with `npm run sandbox`

c. In a new terminal in the `aztec-state-channels` folder, run a second PXE with `npm run pxe:secondary`

### 2. Run the aztec-state-channel unit tests

- To run only the state channel tests, run `npm run test:statechannel`

- To run only the contract logic unit tests, run `npm run test:logic`

- To run all test suites, run the normal `npm run test`

## Modifications / Methodology
PXE
ACIR Simulator
Iterations
On Folding/ HONK
