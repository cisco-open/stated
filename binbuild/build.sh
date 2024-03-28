#!/bin/bash

# Step 1: Copy the Node.js binary to a new file named 'stated'
cp "$(command -v node)" stated

# Check if the copy was successful
if [ $? -ne 0 ]; then
    echo "Error copying the Node.js binary. Exiting."
    exit 1
fi

# Step 2: Remove the existing code signature from 'stated'
codesign --remove-signature stated

# Check if the signature removal was successful
if [ $? -ne 0 ]; then
    echo "Error removing code signature. Exiting."
    exit 1
fi

# Optional: This step is attempting to run Node.js with a specific configuration
# and is not directly related to modifying the 'stated' binary.
# Ensure that 'sea-config.json' exists in the current directory or adjust the path as necessary.
if [ ! -f sea-config.json ]; then
    echo "sea-config.json does not exist. Please ensure it's in the current directory. Exiting."
    exit 1
fi
node --experimental-sea-config sea-config.json

# Step 3: Inject the blob into 'stated' using 'postject'
npx postject stated NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA

# Check if the postject command was successful
if [ $? -ne 0 ]; then
    echo "Error injecting the blob with postject. Exiting."
    exit 1
fi

# Step 4: Re-sign 'stated' with an ad-hoc signature
codesign --sign - stated

# Check if the re-signing was successful
if [ $? -ne 0 ]; then
    echo "Error re-signing 'stated'. Exiting."
    exit 1
fi

echo "'stated' has been successfully processed and signed."
