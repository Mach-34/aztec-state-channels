# Use an official Node.js runtime as a parent image
FROM node:latest

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the binary into the container at /usr/src/app
COPY ../../aztec-packages/yarn_project/aztec/dest /usr/src/app/

# Make sure the binary is executable
RUN ls /usr/src/app

# Run the binary when the container launches
CMD ["echo hi"]
