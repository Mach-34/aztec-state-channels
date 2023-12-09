#!/bin/sh

RED='\033[0;31m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Check that ~/.aztec/bin/aztec-cli exists
EXPECTED_PATH="$HOME/.aztec/bin/aztec-cli"
ACTUAL_PATH=$(which aztec-cli)

INSTALL_CMD='SANDBOX_VERSION=0.16.7 /bin/bash -c "$(curl -fsSL 'https://sandbox.aztec.network')"'
if [ "$ACTUAL_PATH" != "$EXPECTED_PATH" ]; then
    echo "${RED}Failed to compile Aztec State Channel contracts:${NC} aztec-cli not found in path."
    echo "First, make sure ${BLUE}@aztec/cli${NC} is not globally installed through npm or yarn."
    echo "Then, run ${BLUE}${INSTALL_CMD}${NC} to install the working version of the aztec-cli."
    exit 1
fi

# Check that artifacts asset dir exists
if [ ! -d "./src/artifacts" ]; then
  mkdir ./src/artifacts
fi

# Compile State Channel contract artifacts
cd ./contracts
aztec-cli compile . -ts . > /dev/null
cd ..

# Move artifacts to the asserts directory in the typescript driver
mv ./contracts/target/CounterStateChannel.json ./src/artifacts
mv ./contracts/CounterStateChannel.ts ./src/artifacts

# Update the path for the ABI import in the typescript interface for the state channel contract
case "$OSTYPE" in
    darwin*)
        # macOS
        sed -i '' \
            "s|target/CounterStateChannel.json|./CounterStateChannel.json|" \
            src/artifacts/CounterStateChannel.ts
        ;;
    *)
        # Linux
        sed -i \
            "s|target/CounterStateChannel.json|./CounterStateChannel.json|" \
            src/artifacts/CounterStateChannel.ts
        ;;
esac

# Clean up build space
rm -rf ./contracts/target

echo "${BLUE}Successfully compiled Aztec State Channel contracts.${NC}"