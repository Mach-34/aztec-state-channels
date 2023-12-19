#!/bin/bash

RED='\033[0;31m'GREEN='\033[0;32m'
GREEN='\033[0;32m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Check that ~/.aztec/bin/aztec-cli exists
EXPECTED_PATH="$HOME/.aztec/bin/aztec-cli"
ACTUAL_PATH=$(which aztec-cli)

SANDBOX_CMD='SANDBOX_VERSION=0.16.9 /bin/bash -c "$(curl -fsSL 'https://sandbox.aztec.network')"'
if [ "$ACTUAL_PATH" != "$EXPECTED_PATH" ]; then
    echo -e "${RED}Failed to compile Aztec State Channel contracts:${NC} aztec-cli not found in path."
    echo -e "First, make sure ${BLUE}@aztec/cli${NC} is not globally installed through npm or yarn."
    echo -e "Then, run ${BLUE}${SANDBOX_CMD}${NC} to install the working version of the aztec-cli."
    exit 1
fi

contracts_dir="./contracts"

# Check that artifacts asset dir exists
if [ ! -d "./src/artifacts" ]; then
  mkdir ./src/artifacts
fi

# Create empty array to hold contract names
CONTRACTS=()

# Loop through each contract directory and compile
for subdir in "$contracts_dir"/*/; do
    if [ -d "$subdir" ]; then
        # Change to the subdirectory
        cd "$subdir"

        # Execute your commands in the subdirectory
        aztec-cli compile . -ts . > /dev/null

        # Extract the name of the TypeScript file
        ts_file=$(ls *.ts)
        if [[ -n $ts_file ]]; then
            # Remove the file extension to get just the name
            name="${ts_file%.ts}"
            CONTRACTS+=("$name")
        fi
        # Change back to the original directory
        cd ../..
    fi
done

# Move artifacts to the asserts directory in the typescript driver
mv ./contracts/*/target/*.json ./src/artifacts
mv ./contracts/*/*.ts ./src/artifacts

# Update the path for the ABI import in the typescript interface for each contract
case "$OSTYPE" in
    darwin*)
        # macOS
        for name in "${CONTRACTS[@]}"; do
            sed -i '' \
                "s|target/${name}.json|./${name}.json|" \
                src/artifacts/${name}.ts
        done
        ;;
    *)
        # Linux
        for name in "${CONTRACTS[@]}"; do
            sed -i \
                "s|target/${name}.json|./${name}.json|" \
                src/artifacts/${name}.ts
        done
        ;;
esac

# Clean up build space
rm -rf ./contracts/*/target

echo -e "${BLUE}Successfully compiled Aztec State Channel contracts.${NC}"