#!/bin/bash

# paths to local aztec-cli bin
AZTEC_CLI=$(pwd)/../aztec-packages/yarn-project/cli/dest/bin/index.js

cd contracts/tic_tac_toe

# Compile ACIR
aztec-nargo compile
# Generate TypeScript artifacts
$AZTEC_CLI codegen ./target -o . --ts
# Update path for the ABI import in the typescript interface
case "$OSTYPE" in
    darwin*)
        # macOS
        sed -i '' 's|target/tic_tac_toe-TicTacToe.json|./TicTacToe.json|' TicTacToe.ts
        ;;
    *)
        # Linux
        sed -i 's|target/tic_tac_toe-TicTacToe.json|./TicTacToe.json|' TicTacToe.ts
        ;;
esac
# Move artifacts to js repository
mv ./target/tic_tac_toe-TicTacToe.json ../../src/artifacts/TicTacToe.json
mv TicTacToe.ts ../../src/artifacts/TicTacToe.ts
# Cleanup
rm -rf ./target
