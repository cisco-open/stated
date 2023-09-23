# Use an official Node.js runtime as the base image
FROM node:20.5.1

# Set the working directory inside the container
WORKDIR /usr/src/app

# Bundle the application source code inside the container
# Note, that files listed in .dockerignore will be ignored
COPY . .

# Install application dependencies
RUN npm install


# Grant execute permissions for the stated-workflow-docker.js file
RUN chmod +x stated-workflow-docker.js

# Specify the command to run when the container starts
CMD ["node", "--experimental-vm-modules", "./stated-workflow-docker.js"]
