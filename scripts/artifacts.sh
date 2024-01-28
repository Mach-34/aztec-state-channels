#!/bin/bash

# TODO: Make script OS agnostic, pretty, handle failures, etc
# TODO: include other contracts

# paths to local aztec-cli bin
AZTEC_CLI=$(pwd)/../aztec-packages/yarn-project/cli/dest/bin/index.js

## Compile Counter State Channel Contract
cd ./contracts/counter_channel
aztec-nargo compile

## Generate JSON ABI and TS Bindings
aztec-cli codegen ./target -o . --ts
# $AZTEC_CLI codegen ./target -o . --ts

# Update import in TS bindings to reflect where abi will be
sed -i 's|target/counter-CounterStateChannel.json|./CounterStateChannel.json|' CounterStateChannel.ts

## Copy artifacts to src
mv ./target/counter-CounterStateChannel.json ../../src/artifacts/CounterStateChannel.json
mv CounterStateChannel.ts ../../src/artifacts/CounterStateChannel.ts

## Clean up workspace
rm -rf ./target